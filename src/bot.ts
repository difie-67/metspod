import { Bot, Context, InlineKeyboard, Keyboard } from "grammy";
import { config, dealLimits, networkFeeUnits } from "./config";
import {
  cancelDraftDeal,
  claimDealSetup,
  countActiveDealsForUser,
  createDeal,
  DealRow,
  DealStatus,
  getDeal,
  getDealByInviteToken,
  getDealsByStatuses,
  getDealsForUser,
  getAdminStats,
  getPendingDealsForUser,
  getRecentDeals,
  getUser,
  isDealParticipant,
  joinDeal,
  setDealAddresses,
  setDealConsent,
  setDealContractAddress,
  setDealStatus,
  setWalletAddress,
  upsertUser,
  markConsentAsked,
} from "./db";
import { formatTonAmount, parseTonAmount } from "./amounts";
import { feeBpsForAmount, feeBreakdown, formatFeePercent } from "./fees";
import { emoji } from "./emoji";
import {
  computeEscrowAddress,
  depositFor,
  formatAddress,
  getArbiterWallet,
  getDealOnChainState,
  getEscrowCodeHash,
  getServiceWalletInfo,
  isContractActive,
  parseAddress,
  sendCancel,
  sendResolve,
} from "./ton";

export const bot = new Bot(config.botToken);

const BTN_NEW = "Новая сделка";
const BTN_DEALS = "Мои сделки";
const BTN_WALLET = "Кошелёк";
const BTN_HELP = "Помощь";
const BTN_VERIFY = "Проверить прозрачность";
const BTN_ADMIN = "Админ-панель";
const BTN_STOP = "Закрыть ввод";

export function mainMenu(admin = false): Keyboard {
  const keyboard = new Keyboard()
    .text(BTN_NEW).icon(emoji.newDeal).text(BTN_DEALS).icon(emoji.myDeals).row()
    .text(BTN_WALLET).icon(emoji.wallet).text(BTN_HELP).icon(emoji.help).row()
    .text(BTN_VERIFY).icon(emoji.transparency);
  if (config.miniAppUrl) keyboard.row().webApp("Открыть Mini App", config.miniAppUrl);
  if (admin) keyboard.row().text(BTN_ADMIN).icon(emoji.safety);
  return keyboard.resized().persistent();
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function monospace(value: string): string {
  return `<code>${escapeHtml(value)}</code>`;
}

function isArbiter(tgId: number): boolean {
  return config.arbiterTgIds.includes(tgId);
}

function formatDealAmount(deal: DealRow): string {
  return `${formatTonAmount(deal.amount_units)} TON`;
}

/** Exact deposit the buyer must send under the frozen per-deal fee terms. */
function formatDealTotal(deal: DealRow): string {
  return `${formatTonAmount(depositFor(deal).total)} TON`;
}

function feeGridText(): string {
  return "до 2 TON — 2%; 2–10 TON — 1.3%; 10–35 TON — 0.9%; от 35 TON — 0.6%";
}

function feeLines(deal: DealRow): string {
  const fees = depositFor(deal);
  const percent = formatFeePercent(fees.feeBps);
  const commissionNote = fees.feeFromSeller
    ? `Комиссия платформы (${percent}%, удерживается с продавца): ${formatTonAmount(fees.serviceFee)} TON`
    : `Комиссия платформы (${percent}%, сверху от покупателя): ${formatTonAmount(fees.serviceFee)} TON`;
  return [
    `Продавец получит: ${formatTonAmount(fees.sellerPayout)} TON`,
    commissionNote,
    `Сетевой сбор (газ): ${formatTonAmount(fees.networkFee)} TON`,
    `Покупатель платит: ${formatTonAmount(fees.total)} TON`,
  ].join("\n");
}

// Telegram keeps the menu button it was given last (by BotFather or an older
// deployment, e.g. an ngrok URL). Set it explicitly per chat so it always
// points to the current production Mini App.
const menuButtonSynced = new Set<number>();
async function syncMenuButton(chatId: number) {
  if (!config.miniAppUrl || menuButtonSynced.has(chatId)) return;
  menuButtonSynced.add(chatId);
  await bot.api.setChatMenuButton({
    chat_id: chatId,
    menu_button: { type: "web_app", text: "Открыть OBRA GUARANT", web_app: { url: config.miniAppUrl } },
  }).catch(() => menuButtonSynced.delete(chatId));
}
bot.use(async (ctx, next) => {
  if (ctx.chat?.type === "private") void syncMenuButton(ctx.chat.id);
  await next();
});

function tonviewerUrl(address: string): string {
  const host = config.tonNetwork === "testnet" ? "https://testnet.tonviewer.com" : "https://tonviewer.com";
  return `${host}/${encodeURIComponent(address)}`;
}

function tonscanUrl(address: string): string {
  const host = config.tonNetwork === "testnet" ? "https://testnet.tonscan.org" : "https://tonscan.org";
  return `${host}/address/${encodeURIComponent(address)}`;
}

/**
 * Standard TON transfer URI. `amount` is in nanotons, so it is exactly the
 * value locked by the contract, not a rounded decimal value. Do not add a
 * `text`/comment parameter: the escrow accepts a plain TON transfer only.
 */
function tonPaymentUrl(deal: DealRow): string | null {
  if (!deal.contract_address) return null;
  return `ton://transfer/${encodeURIComponent(deal.contract_address)}?amount=${encodeURIComponent(depositFor(deal).total.toString())}`;
}

/** MyTonWallet's documented HTTPS invoice format for a direct TON transfer. */
function myTonWalletPaymentUrl(deal: DealRow): string | null {
  if (!deal.contract_address || config.tonNetwork !== "mainnet") return null;
  return `https://my.tt/transfer/${encodeURIComponent(deal.contract_address)}?amount=${encodeURIComponent(depositFor(deal).total.toString())}`;
}

function addPaymentButtons(keyboard: InlineKeyboard, deal: DealRow): InlineKeyboard {
  const tonUrl = tonPaymentUrl(deal);
  const myTonWalletUrl = myTonWalletPaymentUrl(deal);
  if (tonUrl) keyboard.url("Tonkeeper", tonUrl).icon(emoji.payment).row();
  if (myTonWalletUrl) keyboard.url("MyTonWallet", myTonWalletUrl).icon(emoji.payment).row();
  return keyboard;
}

function paymentKeyboard(deal: DealRow): InlineKeyboard {
  return addPaymentButtons(new InlineKeyboard(), deal);
}

function statusLabel(status: DealRow["status"]): string {
  const labels: Record<DealRow["status"], string> = {
    draft: "ожидает второго участника",
    awaiting_wallets: "ожидает адреса кошельков",
    setup_pending: "готовим escrow-адрес",
    deployed: "ожидает оплату покупателя",
    funded: "оплачена, ожидает подтверждение покупателя",
    disputed: "открыт спор",
    confirm_pending: "выплата отправлена в блокчейн",
    cancel_pending: "возврат отправлен в блокчейн",
    resolve_pending: "решение спора отправлено в блокчейн",
    completed: "завершена",
    cancelled: "отменена",
    resolved: "спор разрешён",
  };
  return labels[status];
}

function dealSummary(deal: DealRow): string {
  return [
    `Сделка #${deal.deal_id}`,
    `Статус: ${statusLabel(deal.status)}`,
    `Сумма сделки: ${formatDealAmount(deal)}`,
    `К оплате покупателем: ${formatDealTotal(deal)} (итого по условиям сделки)`,
    `Предмет сделки: ${escapeHtml(deal.description)}`,
    deal.contract_address ? `Escrow-адрес: ${monospace(deal.contract_address)}` : null,
    deal.contract_address ? `Проверить on-chain: ${tonviewerUrl(deal.contract_address)}` : null,
  ].filter(Boolean).join("\n");
}

type WizardStep = "wallet" | "role" | "counterparty" | "amount" | "fee_payer" | "description";
interface WizardState {
  step: WizardStep;
  role?: "buyer" | "seller";
  counterpartyUsername?: string | null;
  amountUnits?: bigint;
  feeFromSeller?: boolean;
}

const wizards = new Map<number, WizardState>();
const newDealCooldowns = new Map<number, number>();
let botUsernameCache: string | null = null;

export function setBotUsername(username: string) {
  botUsernameCache = username;
}

export async function botUsername(): Promise<string> {
  if (botUsernameCache) return botUsernameCache;
  const username = (await bot.api.getMe()).username;
  if (!username) throw new Error("У бота не задан username в BotFather");
  botUsernameCache = username;
  return username;
}

async function notifyParticipants(deal: DealRow, text: string) {
  const ids = [deal.buyer_tg_id, deal.seller_tg_id]
    .filter((id, index, all): id is number => id !== null && all.indexOf(id) === index);
  for (const id of ids) await bot.api.sendMessage(id, text).catch(() => undefined);
}

export async function tryAdvanceDeal(dealId: number) {
  const deal = getDeal(dealId);
  if (!deal || !["draft", "awaiting_wallets"].includes(deal.status)) return;
  if (!deal.buyer_tg_id || !deal.seller_tg_id) return;

  const buyerUser = getUser(deal.buyer_tg_id);
  const sellerUser = getUser(deal.seller_tg_id);
  if (!buyerUser?.wallet_address || !sellerUser?.wallet_address) {
    setDealStatus(dealId, "awaiting_wallets");
    return;
  }

  const buyer = parseAddress(buyerUser.wallet_address);
  const seller = parseAddress(sellerUser.wallet_address);
  if (!buyer || !seller) {
    setDealStatus(dealId, "awaiting_wallets");
    return;
  }
  if (buyer.equals(seller)) {
    setDealStatus(dealId, "awaiting_wallets");
    await notifyParticipants(deal, `Сделка #${dealId}: адреса покупателя и продавца совпадают. Одна из сторон должна изменить адрес через /wallet.`);
    return;
  }
  if (!claimDealSetup(dealId)) return;

  try {
    setDealAddresses(dealId, formatAddress(buyer), formatAddress(seller));
    const fees = depositFor(deal);
    const deployParams = {
      dealId, buyer, seller, amountUnits: BigInt(deal.amount_units),
      feeBps: fees.feeBps, feeFromSeller: fees.feeFromSeller, networkFeeUnits: fees.networkFee,
    };
    // We only calculate the deterministic future address here. The service
    // wallet does NOT deploy the contract. Buyer deploys + funds it in one TON
    // Connect transaction carrying StateInit from the Mini App.
    const predictedAddress = await computeEscrowAddress(deployParams);
    const formattedContract = formatAddress(predictedAddress);
    setDealContractAddress(dealId, formattedContract);
    setDealStatus(dealId, "deployed");

    const text =
      `✅ Сделка #${dealId} готова к оплате.\n\n` +
      `Escrow-адрес уже вычислен заранее:\n${monospace(formattedContract)}\n\n` +
      `${feeLines(deal)}\n\n` +
      "Контракт ещё не развёрнут: покупатель развернёт и профинансирует его одной транзакцией через Mini App. Служебный кошелёк для старта сделки не нужен.\n" +
      `Сеть: ${config.tonNetwork}.\n\n` +
      `Проверить адрес в Tonviewer:\n${tonviewerUrl(formattedContract)}`;
    await notifyParticipants({ ...deal, contract_address: formattedContract } as DealRow, text);

    if (deal.buyer_tg_id && config.miniAppUrl) {
      await bot.api.sendMessage(
        deal.buyer_tg_id,
        `💳 Для оплаты сделки #${dealId} откройте Mini App. Кнопка «Оплатить» отправит одну транзакцию: deploy escrow + депозит сделки.`,
        { reply_markup: new InlineKeyboard().webApp("Открыть Mini App и оплатить", config.miniAppUrl) }
      ).catch(() => undefined);
    }
  } catch (error) {
    setDealStatus(dealId, "awaiting_wallets");
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Deal #${dealId} setup failed: ${message}`);
    for (const tgId of [...config.arbiterTgIds, deal.creator_tg_id]) {
      await bot.api.sendMessage(tgId, `Не удалось подготовить сделку #${dealId}: ${message}`).catch(() => undefined);
    }
  }
}

async function saveWallet(ctx: Context, raw: string) {
  if (!ctx.from) return;
  const address = parseAddress(raw);
  if (!address) {
    await ctx.reply("Некорректный TON-адрес. Скопируйте адрес целиком из кошелька или нажмите «Закрыть ввод».");
    return;
  }
  upsertUser(ctx.from.id, ctx.from.username);
  const formatted = formatAddress(address);
  setWalletAddress(ctx.from.id, formatted);
  wizards.delete(ctx.from.id);
  await ctx.reply(`✅ Адрес сохранён:\n${monospace(formatted)}`, {
    parse_mode: "HTML",
    reply_markup: mainMenu(isArbiter(ctx.from.id)),
  });
  for (const deal of getPendingDealsForUser(ctx.from.id)) await tryAdvanceDeal(deal.deal_id);
}

function parseDealId(raw: string | undefined): number | null {
  const id = Number(raw?.trim());
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function readChainState(deal: DealRow): Promise<number | null> {
  if (!deal.contract_address) return null;
  try {
    return Number((await getDealOnChainState(parseAddress(deal.contract_address)!)).state);
  } catch {
    return null;
  }
}

function dealKeyboard(deal: DealRow, viewerId: number, chainState: number | null): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (deal.status === "deployed" && deal.buyer_tg_id === viewerId && config.miniAppUrl) {
    keyboard.webApp("💳 Оплатить через Mini App", config.miniAppUrl).row();
  }
  if (chainState === 1 && deal.buyer_tg_id === viewerId && config.miniAppUrl) {
    keyboard.webApp("✅ Подтвердить в Mini App", config.miniAppUrl).row();
  }
  if (chainState === 1 && isDealParticipant(deal, viewerId) && deal.status !== "disputed") keyboard.text("Открыть спор", `open_dispute:${deal.deal_id}`).icon(emoji.warning).row();
  if (["draft", "awaiting_wallets"].includes(deal.status) || (deal.status === "deployed" && chainState !== 1)) {
    keyboard.text("Отменить сделку", `cancel_request:${deal.deal_id}`).icon(emoji.cancel).danger().row();
  }
  if (isArbiter(viewerId) && deal.contract_address && ["deployed", "funded", "disputed"].includes(deal.status)) {
    keyboard.text("Админ-действия", `admin_actions:${deal.deal_id}`).icon(emoji.safety).row();
  }
  if (deal.contract_address) {
    keyboard
      .url("🔎 Tonviewer", tonviewerUrl(deal.contract_address))
      .url("🔎 Tonscan", tonscanUrl(deal.contract_address))
      .row();
  }
  keyboard
    .text("Обновить", `view_deal:${deal.deal_id}`)
    .text(isArbiter(viewerId) ? "К панели" : "К списку", isArbiter(viewerId) ? "admin_panel" : "list_deals");
  return keyboard;
}

async function showDeal(ctx: Context, dealId: number, edit: boolean) {
  if (!ctx.from) return;
  let deal = getDeal(dealId);
  if (!deal || (!isDealParticipant(deal, ctx.from.id) && !isArbiter(ctx.from.id))) {
    if (edit) await ctx.answerCallbackQuery({ text: "Сделка не найдена или нет доступа", show_alert: true });
    else await ctx.reply("Сделка не найдена или у вас нет к ней доступа.");
    return;
  }
  const chainState = await readChainState(deal);
  if (chainState === 1 && ["deployed", "setup_pending"].includes(deal.status)) {
    setDealStatus(dealId, "funded");
    deal = getDeal(dealId)!;
  }
  const chainLabels = ["Created", "Funded", "Completed", "Cancelled", "Resolved"];
  const chainText = deal.contract_address
    ? chainState === null ? "\nСтатус контракта временно недоступен" : `\nСтатус контракта: ${chainLabels[chainState] ?? chainState}`
    : "";
  const options = {
    reply_markup: dealKeyboard(deal, ctx.from.id, chainState),
    link_preview_options: { is_disabled: false },
    parse_mode: "HTML" as const,
  };
  if (edit) {
    await ctx.answerCallbackQuery().catch(() => undefined);
    await ctx.editMessageText(dealSummary(deal) + chainText, options).catch(() => undefined);
  } else {
    await ctx.reply(dealSummary(deal) + chainText, options);
  }
}

async function showDealList(ctx: Context, edit = false) {
  if (!ctx.from) return;
  const deals = getDealsForUser(ctx.from.id);
  if (!deals.length) {
    if (edit) await ctx.editMessageText("У вас пока нет сделок.").catch(() => undefined);
    else await ctx.reply("У вас пока нет сделок.", { reply_markup: mainMenu() });
    return;
  }
  const keyboard = new InlineKeyboard();
  for (const deal of deals) keyboard.text(`#${deal.deal_id} · ${formatDealAmount(deal)} · ${statusLabel(deal.status)}`, `view_deal:${deal.deal_id}`).row();
  if (edit) {
    await ctx.answerCallbackQuery().catch(() => undefined);
    await ctx.editMessageText("Ваши последние сделки:", { reply_markup: keyboard }).catch(() => undefined);
  } else await ctx.reply("Ваши последние сделки:", { reply_markup: keyboard });
}

async function showTransparency(ctx: Context) {
  const arbiter = await getArbiterWallet();
  const serviceAddress = formatAddress(arbiter.address);
  const codeHash = await getEscrowCodeHash();
  let balanceText = "временно недоступен";
  try {
    balanceText = `${formatTonAmount((await getServiceWalletInfo()).balance)} TON`;
  } catch {}
  const keyboard = new InlineKeyboard()
    .url("🔎 Service wallet в Tonviewer", tonviewerUrl(serviceAddress)).row()
    .url("Tonviewer", tonviewerUrl(serviceAddress))
    .url("Tonscan", tonscanUrl(serviceAddress));
  await ctx.reply(
    "🔎 Проверка прозрачности\n\n" +
    `Сеть: ${config.tonNetwork}\n` +
    `Комиссия платформы: ${feeGridText()}. Сетевой сбор: ${formatTonAmount(networkFeeUnits)} TON.\n` +
    `Служебный Wallet V4: ${serviceAddress}\n` +
    `Баланс газа: ${balanceText}\n` +
    `Отпечаток кода escrow:\n${codeHash}\n\n` +
    "Каждая сделка получает отдельный контракт. Покупатель, продавец и комиссии фиксируются при его создании. " +
    "Арбитр может подтвердить выплату, вернуть депозит покупателю или разделить сумму при споре, но не может указать произвольный адрес получателя.\n\n" +
    "Контракт пока не проходил независимый аудит — это mainnet MVP с ограниченными лимитами.\n\n" +
    `Проверить служебный кошелёк:\n${tonviewerUrl(serviceAddress)}`,
    { reply_markup: keyboard, link_preview_options: { is_disabled: false } }
  );
}

type AdminListMode = "disputes" | "funded" | "pending" | "recent";

function adminGuard(ctx: Context): boolean {
  return !!ctx.from && isArbiter(ctx.from.id);
}

async function showAdminPanel(ctx: Context, edit = false) {
  if (!adminGuard(ctx)) {
    if (edit) await ctx.answerCallbackQuery({ text: "Только для администратора", show_alert: true }).catch(() => undefined);
    else await ctx.reply("Команда доступна только администратору.");
    return;
  }
  const stats = getAdminStats();
  const text =
    "🛡 Админ-панель\n\n" +
    `Пользователей: ${stats.users}\n` +
    `Всего сделок: ${stats.total}\n` +
    `Активных: ${stats.active}\n` +
    `Оплачено, ждут решения: ${stats.funded}\n` +
    `Споров: ${stats.disputed}\n` +
    `Операций в блокчейне: ${stats.pendingOperations}\n` +
    `Завершено: ${stats.completed}\n` +
    `Отменено: ${stats.cancelled}\n` +
    `Разрешено арбитром: ${stats.resolved}\n` +
    `Сумма в оплаченных/pending: ${formatTonAmount(stats.lockedUnits)} TON`;
  const keyboard = new InlineKeyboard()
    .text("⚠️ Споры", "admin_list:disputes")
    .text("💰 Оплаченные", "admin_list:funded").row()
    .text("⏳ Операции", "admin_list:pending")
    .text("📋 Последние", "admin_list:recent").row()
    .text("👛 Служебный кошелёк", "admin_wallet").row()
    .text("🔄 Обновить", "admin_panel");
  if (edit) {
    await ctx.answerCallbackQuery().catch(() => undefined);
    await ctx.editMessageText(text, { reply_markup: keyboard }).catch(() => undefined);
  } else {
    await ctx.reply(text, { reply_markup: keyboard });
  }
}

async function showAdminDeals(ctx: Context, mode: AdminListMode) {
  if (!adminGuard(ctx)) return void (await ctx.answerCallbackQuery({ text: "Только для администратора", show_alert: true }));
  const modes: Record<Exclude<AdminListMode, "recent">, { title: string; statuses: DealStatus[] }> = {
    disputes: { title: "Споры", statuses: ["disputed"] },
    funded: { title: "Оплаченные сделки", statuses: ["funded"] },
    pending: { title: "Операции в блокчейне", statuses: ["setup_pending", "confirm_pending", "cancel_pending", "resolve_pending"] },
  };
  const title = mode === "recent" ? "Последние сделки" : modes[mode].title;
  const deals = mode === "recent" ? getRecentDeals(15) : getDealsByStatuses(modes[mode].statuses, 15);
  const keyboard = new InlineKeyboard();
  for (const deal of deals) {
    keyboard.text(`#${deal.deal_id} · ${formatDealAmount(deal)} · ${statusLabel(deal.status)}`, `view_deal:${deal.deal_id}`).row();
  }
  keyboard.text("← Админ-панель", "admin_panel");
  await ctx.answerCallbackQuery().catch(() => undefined);
  await ctx.editMessageText(deals.length ? `🛡 ${title}:` : `🛡 ${title}: список пуст`, { reply_markup: keyboard }).catch(() => undefined);
}

async function showAdminWallet(ctx: Context) {
  if (!adminGuard(ctx)) return void (await ctx.answerCallbackQuery({ text: "Только для администратора", show_alert: true }));
  await ctx.answerCallbackQuery({ text: "Проверяю TON RPC" }).catch(() => undefined);
  try {
    const service = await getServiceWalletInfo();
    const address = formatAddress(service.address);
    const keyboard = new InlineKeyboard()
      .url("Tonviewer", tonviewerUrl(address))
      .url("Tonscan", tonscanUrl(address)).row()
      .text("← Админ-панель", "admin_panel");
    await ctx.editMessageText(
      `👛 Служебный Wallet V4\n\nАдрес: ${address}\nБаланс: ${formatTonAmount(service.balance)} TON\nСостояние: ${service.state}\nСеть: ${config.tonNetwork}\n\n${tonviewerUrl(address)}`,
      { reply_markup: keyboard, link_preview_options: { is_disabled: false } }
    ).catch(() => undefined);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await ctx.editMessageText(`TON RPC временно недоступен: ${message}`, {
      reply_markup: new InlineKeyboard().text("← Админ-панель", "admin_panel"),
    }).catch(() => undefined);
  }
}

async function beginNewDeal(ctx: Context) {
  if (!ctx.from) return;
  upsertUser(ctx.from.id, ctx.from.username);
  const now = Date.now();
  if ((newDealCooldowns.get(ctx.from.id) ?? 0) > now) return void (await ctx.reply("Подождите несколько секунд перед повторным созданием сделки."));
  if (countActiveDealsForUser(ctx.from.id) >= config.maxActiveDealsPerUser) {
    return void (await ctx.reply(`Достигнут лимит активных сделок: ${config.maxActiveDealsPerUser}. Завершите или отмените старые сделки.`));
  }
  newDealCooldowns.set(ctx.from.id, now + 5000);
  wizards.set(ctx.from.id, { step: "role" });
  await ctx.reply("Кто вы в этой сделке?", {
    reply_markup: new InlineKeyboard()
      .text("Я покупатель", "role_buyer").icon(emoji.buyer)
      .text("Я продавец", "role_seller").icon(emoji.seller),
  });
}

async function cancelParticipantDeal(ctx: Context, dealId: number) {
  if (!ctx.from) return;
  let deal = getDeal(dealId);
  if (!deal || !isDealParticipant(deal, ctx.from.id)) return void (await ctx.reply("Сделка не найдена или у вас нет доступа."));
  if (["draft", "awaiting_wallets"].includes(deal.status) && !deal.contract_address) {
    if (!cancelDraftDeal(dealId, ctx.from.id)) return void (await ctx.reply("Статус сделки уже изменился. Обновите карточку."));
    deal = getDeal(dealId)!;
    await notifyParticipants(deal, `Сделка #${dealId} отменена до оплаты.`);
    return;
  }
  if (deal.status === "setup_pending") return void (await ctx.reply("Контракт сейчас разворачивается. Подождите около минуты и повторите отмену."));
  if (deal.status !== "deployed" || !deal.contract_address) {
    return void (await ctx.reply("Односторонняя отмена сейчас недоступна. После оплаты используйте спор; завершённую сделку отменить нельзя."));
  }
  const address = parseAddress(deal.contract_address)!;
  try {
    if (!(await isContractActive(address))) {
      setDealStatus(dealId, "cancelled");
      await notifyParticipants(deal, `Сделка #${dealId} отменена до on-chain оплаты. Escrow-контракт не был развёрнут, служебный кошелёк ничего не тратил.`);
      return;
    }
  } catch {
    return void (await ctx.reply("Не удалось проверить контракт. Деньги не тронуты; повторите позже."));
  }
  const state = await readChainState(deal);
  if (state === null) return void (await ctx.reply("Не удалось прочитать состояние контракта. Повторите позже."));
  if (state === 1) {
    setDealStatus(dealId, "funded");
    return void (await ctx.reply("Оплата уже поступила. Односторонняя отмена заблокирована — при проблеме откройте спор."));
  }
  if (state !== 0) return void (await ctx.reply("Контракт уже завершён или отменён. Обновите карточку сделки."));
  try {
    await sendCancel(parseAddress(deal.contract_address)!, dealId);
    setDealStatus(dealId, "cancel_pending");
    await notifyParticipants(deal, `Отмена сделки #${dealId} отправлена в блокчейн. Если платёж находился в пути и успел попасть в контракт, контракт вернёт его покупателю.`);
  } catch (error) {
    await ctx.reply(`Не удалось отправить отмену: ${error instanceof Error ? error.message : String(error)}`);
  }
}

bot.command("start", async (ctx) => {
  if (!ctx.from) return;
  upsertUser(ctx.from.id, ctx.from.username);
  const payload = ctx.match?.toString().trim();
  if (payload?.startsWith("join_")) {
    const deal = getDealByInviteToken(payload.slice("join_".length));
    if (!deal) return void (await ctx.reply("Ссылка недействительна или сделка не найдена.", { reply_markup: mainMenu(isArbiter(ctx.from.id)) }));
    if (deal.creator_tg_id === ctx.from.id) return void (await ctx.reply("Это ваша сделка. Перешлите ссылку второй стороне."));
    try {
      const joined = joinDeal(deal.deal_id, ctx.from.id, ctx.from.username);
      const role = joined.buyer_tg_id === ctx.from.id ? "покупатель" : "продавец";
      await ctx.reply(`✅ Вы присоединились к сделке #${joined.deal_id} как ${role}.\n` +
        (getUser(ctx.from.id)?.wallet_address ? "Ваш TON-адрес уже сохранён." : "Теперь нажмите «Кошелёк» и укажите адрес для этой роли."), { reply_markup: mainMenu(isArbiter(ctx.from.id)) });
      await tryAdvanceDeal(joined.deal_id);
    } catch (error) {
      await ctx.reply(error instanceof Error ? error.message : "Не удалось присоединиться к сделке");
    }
    return;
  }
  await ctx.reply("TON Escrow — безопасная сделка через отдельный смарт-контракт.\n\nСоздайте сделку, перешлите приглашение второй стороне и следуйте подсказкам. Не подтверждайте получение до фактической передачи товара или услуги.", { reply_markup: mainMenu(isArbiter(ctx.from.id)) });
});

bot.command("help", async (ctx) => {
  await ctx.reply(`Как пользоваться:
1. Сохраните свой TON-адрес через кнопку «Кошелёк».
2. Создайте сделку и отправьте приглашение второй стороне.
3. Комиссия платформы зависит от суммы сделки: ${feeGridText()}. Её можно добавить сверху покупателю или удержать из выплаты продавцу. Отдельно покупатель оплачивает фиксированный сетевой сбор ${formatTonAmount(networkFeeUnits)} TON.
4. После получения товара покупатель подтверждает сделку.

До оплаты сделку можно отменить. После оплаты при проблеме нужно открыть спор. Никому не сообщайте seed-фразу.

/transparency — проверить архитектуру, комиссию и on-chain адреса.`, { reply_markup: mainMenu(!!ctx.from && isArbiter(ctx.from.id)) });
});

bot.command("wallet", async (ctx) => {
  if (!ctx.from) return;
  const raw = ctx.match?.toString().trim();
  if (raw) return void (await saveWallet(ctx, raw));
  wizards.set(ctx.from.id, { step: "wallet" });
  const current = getUser(ctx.from.id)?.wallet_address;
  await ctx.reply(`${current ? `Текущий адрес:\n${current}\n\n` : ""}Отправьте новый TON-адрес одним сообщением.`, { reply_markup: new Keyboard().text(BTN_STOP).resized().oneTime() });
});

bot.command("newdeal", beginNewDeal);
bot.command("mydeals", (ctx) => showDealList(ctx));
bot.command("transparency", showTransparency);
bot.command("admin", (ctx) => showAdminPanel(ctx));
bot.command("status", async (ctx) => {
  const dealId = parseDealId(ctx.match?.toString());
  if (!dealId) return void (await ctx.reply("Использование: /status <id сделки>"));
  await showDeal(ctx, dealId, false);
});
bot.command("stop", async (ctx) => {
  if (ctx.from) wizards.delete(ctx.from.id);
  await ctx.reply("Ввод отменён.", { reply_markup: mainMenu() });
});
bot.command("consent", async (ctx) => {
  if (!ctx.from) return;
  const parts = (ctx.match?.toString() || "").trim().split(/\s+/);
  const dealId = parseDealId(parts[0]);
  const choice = parts[1]?.toLowerCase();
  if (!dealId || (choice !== "yes" && choice !== "no")) {
    return void (await ctx.reply("Использование: /consent <id сделки> yes|no — разрешить или запретить показывать ваш @username в публичной истории этой сделки."));
  }
  const deal = getDeal(dealId);
  if (!deal || !isDealParticipant(deal, ctx.from.id)) return void (await ctx.reply("Сделка не найдена или у вас нет доступа."));
  const ok = setDealConsent(dealId, ctx.from.id, choice === "yes");
  await ctx.reply(ok
    ? (choice === "yes" ? `Готово — по сделке #${dealId} ваш @username будет виден в публичной истории.` : `Готово — по сделке #${dealId} ваш @username скрыт из публичной истории.`)
    : "Не удалось изменить согласие для этой сделки.");
});
bot.command("canceldeal", async (ctx) => {
  const dealId = parseDealId(ctx.match?.toString());
  if (!dealId) return void (await ctx.reply("Использование: /canceldeal <id сделки>"));
  const deal = getDeal(dealId);
  if (!ctx.from || !deal || !isDealParticipant(deal, ctx.from.id)) return void (await ctx.reply("Сделка не найдена или у вас нет доступа."));
  await ctx.reply(`Отменить сделку #${dealId}? До оплаты отмена окончательная.`, { reply_markup: new InlineKeyboard().text("Да, отменить", `cancel_yes:${dealId}`).text("Нет", `view_deal:${dealId}`) });
});

bot.callbackQuery(["role_buyer", "role_seller"], async (ctx) => {
  const role = ctx.callbackQuery.data === "role_buyer" ? "buyer" : "seller";
  wizards.set(ctx.from.id, { step: "counterparty", role });
  await ctx.answerCallbackQuery();
  await ctx.editMessageText("Укажите @username второй стороны. Если username неизвестен, отправьте один дефис: -\nСсылку-приглашение всё равно нужно будет переслать вручную.");
});

bot.callbackQuery(["fee_payer_buyer", "fee_payer_seller"], async (ctx) => {
  const state = wizards.get(ctx.from.id);
  if (!state || state.step !== "fee_payer") return void (await ctx.answerCallbackQuery());
  state.feeFromSeller = ctx.callbackQuery.data === "fee_payer_seller";
  state.step = "description";
  wizards.set(ctx.from.id, state);
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(state.feeFromSeller ? "Выбрано: комиссия удерживается из суммы продавца." : "Выбрано: комиссию сверху платит покупатель.");
  await ctx.reply("Опишите товар или услугу и условия передачи:");
});

bot.callbackQuery(/^view_deal:(\d+)$/, (ctx) => showDeal(ctx, Number(ctx.match[1]), true));
bot.callbackQuery("list_deals", (ctx) => showDealList(ctx, true));
bot.callbackQuery("admin_panel", (ctx) => showAdminPanel(ctx, true));
bot.callbackQuery(/^admin_list:(disputes|funded|pending|recent)$/, (ctx) => showAdminDeals(ctx, ctx.match[1] as AdminListMode));
bot.callbackQuery("admin_wallet", showAdminWallet);
bot.callbackQuery(/^admin_actions:(\d+)$/, async (ctx) => {
  if (!isArbiter(ctx.from.id)) return void (await ctx.answerCallbackQuery({ text: "Только для администратора", show_alert: true }));
  const dealId = Number(ctx.match[1]);
  const deal = getDeal(dealId);
  if (!deal?.contract_address || !["deployed", "funded", "disputed"].includes(deal.status)) {
    return void (await ctx.answerCallbackQuery({ text: "Статус сделки изменился", show_alert: true }));
  }
  const keyboard = new InlineKeyboard().text("↩️ Возврат покупателю", `admin_cancel_prepare:${dealId}`).row();
  if (["funded", "disputed"].includes(deal.status)) {
    keyboard
      .text("0% продавцу", `admin_resolve_prepare:${dealId}:0`)
      .text("50/50", `admin_resolve_prepare:${dealId}:50`)
      .text("100% продавцу", `admin_resolve_prepare:${dealId}:100`).row();
  }
  keyboard.text("← К сделке", `view_deal:${dealId}`);
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(
    `🛡 Действия по сделке #${dealId}\n\nТекущий статус: ${statusLabel(deal.status)}\n` +
    "Каждое действие потребует ещё одного подтверждения. Для другого распределения используйте /resolve <id> <% продавцу>.",
    { reply_markup: keyboard }
  );
});
bot.callbackQuery(/^admin_cancel_prepare:(\d+)$/, async (ctx) => {
  if (!isArbiter(ctx.from.id)) return void (await ctx.answerCallbackQuery({ text: "Только для администратора", show_alert: true }));
  const dealId = Number(ctx.match[1]);
  const deal = getDeal(dealId);
  if (!deal?.contract_address || !["deployed", "funded", "disputed"].includes(deal.status)) {
    return void (await ctx.answerCallbackQuery({ text: "Статус сделки изменился", show_alert: true }));
  }
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(`Подтвердить возврат по сделке #${dealId} покупателю?`, {
    reply_markup: new InlineKeyboard().text("Да, отправить Cancel", `admin_cancel_yes:${dealId}`).text("Нет", `view_deal:${dealId}`),
  });
});
bot.callbackQuery(/^admin_resolve_prepare:(\d+):(0|50|100)$/, async (ctx) => {
  if (!isArbiter(ctx.from.id)) return void (await ctx.answerCallbackQuery({ text: "Только для администратора", show_alert: true }));
  const dealId = Number(ctx.match[1]);
  const sellerPercent = Number(ctx.match[2]);
  const deal = getDeal(dealId);
  if (!deal?.contract_address || !["funded", "disputed"].includes(deal.status)) {
    return void (await ctx.answerCallbackQuery({ text: "Статус сделки изменился", show_alert: true }));
  }
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(
    `Подтвердить решение по сделке #${dealId}: продавцу ${sellerPercent}%, покупателю ${100 - sellerPercent}% суммы сделки (комиссия платформы удерживается отдельно)?`,
    { reply_markup: new InlineKeyboard().text("Да, отправить Resolve", `admin_resolve_yes:${dealId}:${sellerPercent}`).text("Нет", `view_deal:${dealId}`) }
  );
});
bot.callbackQuery(/^cancel_request:(\d+)$/, async (ctx) => {
  const dealId = Number(ctx.match[1]);
  const deal = getDeal(dealId);
  if (!deal || !isDealParticipant(deal, ctx.from.id)) return void (await ctx.answerCallbackQuery({ text: "Нет доступа", show_alert: true }));
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(`Отменить сделку #${dealId}? До оплаты это действие окончательное.`, { reply_markup: new InlineKeyboard().text("Да, отменить", `cancel_yes:${dealId}`).text("Нет", `view_deal:${dealId}`) });
});
bot.callbackQuery(/^cancel_yes:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery({ text: "Проверяю состояние сделки" });
  await cancelParticipantDeal(ctx, Number(ctx.match[1]));
});

bot.callbackQuery(/^confirm_receipt:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery({ text: "Подтверждение теперь подписывает сам покупатель в Mini App" }).catch(() => undefined);
  if (config.miniAppUrl) {
    await ctx.reply("Откройте Mini App и нажмите «Подтвердить получение» в карточке сделки. Транзакцию подпишет ваш TON-кошелёк.", {
      reply_markup: new InlineKeyboard().webApp("Открыть Mini App", config.miniAppUrl),
    }).catch(() => undefined);
  }
});



export async function askDealConsent(dealId: number, tgId: number | null) {
  if (!tgId) return;
  markConsentAsked(dealId);
  const keyboard = new InlineKeyboard()
    .text("Да, можно", `consent_yes:${dealId}`)
    .text("Нет, скрыть", `consent_no:${dealId}`);
  await bot.api.sendMessage(
    tgId,
    `Сделка #${dealId} завершена. Разрешите показывать ваш @username в публичной истории сделок ` +
    "на странице «Почему это прозрачно»? Это поможет другим пользователям убедиться, что вы реальный участник, " +
    `и при желании расспросить вас о сделке. Согласие можно изменить позже: командой /consent ${dealId} yes|no ` +
    "или в разделе «Профиль» мини-приложения.",
    { reply_markup: keyboard }
  ).catch(() => undefined);
}

bot.callbackQuery(/^consent_(yes|no):(\d+)$/, async (ctx) => {
  const decision = ctx.match[1] === "yes";
  const dealId = Number(ctx.match[2]);
  const deal = getDeal(dealId);
  if (!deal || !isDealParticipant(deal, ctx.from.id)) return void (await ctx.answerCallbackQuery({ text: "Нет доступа", show_alert: true }));
  setDealConsent(dealId, ctx.from.id, decision);
  await ctx.answerCallbackQuery({ text: decision ? "Спасибо, username будет виден" : "Хорошо, username скрыт" });
  await ctx.editMessageText(
    decision
      ? `Готово — по сделке #${dealId} ваш @username будет виден в публичной истории.`
      : `Готово — по сделке #${dealId} ваш @username останется скрытым в публичной истории.`
  );
});

bot.callbackQuery(/^open_dispute:(\d+)$/, async (ctx) => {
  const dealId = Number(ctx.match[1]);
  const deal = getDeal(dealId);
  if (!deal || !isDealParticipant(deal, ctx.from.id)) return void (await ctx.answerCallbackQuery({ text: "У вас нет доступа к сделке", show_alert: true }));
  if (deal.status !== "funded") return void (await ctx.answerCallbackQuery({ text: "Спор нельзя открыть в текущем статусе", show_alert: true }));
  setDealStatus(dealId, "disputed");
  await ctx.answerCallbackQuery({ text: "Спор открыт" });
  await ctx.editMessageText(`По сделке #${dealId} открыт спор. Арбитр уведомлён.`);
  for (const adminId of config.arbiterTgIds) await bot.api.sendMessage(adminId, `⚠️ Спор по сделке #${dealId}. Используйте /resolve ${dealId} <% продавцу> или /cancel ${dealId}.`).catch(() => undefined);
});

bot.command("cancel", async (ctx) => adminAction(ctx, "cancel"));
bot.command("resolve", async (ctx) => adminAction(ctx, "resolve"));

async function adminAction(ctx: Context, action: "cancel" | "resolve") {
  if (!ctx.from) return;
  if (!isArbiter(ctx.from.id)) return void (await ctx.reply("Команда доступна только арбитру."));
  const parts = ctx.match?.toString().trim().split(/\s+/).filter(Boolean) ?? [];
  const dealId = Number(parts[0]);
  const deal = Number.isSafeInteger(dealId) ? getDeal(dealId) : undefined;
  if (!deal?.contract_address) return void (await ctx.reply("Сделка или контракт не найдены."));
  if (action === "cancel") {
    if (!["deployed", "funded", "disputed"].includes(deal.status)) return void (await ctx.reply("Сделку нельзя отменить в текущем статусе."));
    await ctx.reply(`Подтвердить возврат по сделке #${dealId} покупателю?`, {
      reply_markup: new InlineKeyboard().text("Да, отправить Cancel", `admin_cancel_yes:${dealId}`).text("Нет", `view_deal:${dealId}`),
    });
  } else {
    const sellerPercent = Number(parts[1]);
    if (!Number.isInteger(sellerPercent) || sellerPercent < 0 || sellerPercent > 100) return void (await ctx.reply("Использование: /resolve <id> <целый процент продавцу 0-100>"));
    if (!["funded", "disputed"].includes(deal.status)) return void (await ctx.reply("Разрешить спор нельзя в текущем статусе."));
    await ctx.reply(`Подтвердить решение по сделке #${dealId}: продавцу ${sellerPercent}%, покупателю ${100 - sellerPercent}% суммы сделки (комиссия платформы удерживается отдельно)?`, {
      reply_markup: new InlineKeyboard().text("Да, отправить Resolve", `admin_resolve_yes:${dealId}:${sellerPercent}`).text("Нет", `view_deal:${dealId}`),
    });
  }
}

bot.callbackQuery(/^admin_cancel_yes:(\d+)$/, async (ctx) => {
  if (!isArbiter(ctx.from.id)) return void (await ctx.answerCallbackQuery({ text: "Только для арбитра", show_alert: true }));
  const dealId = Number(ctx.match[1]);
  const deal = getDeal(dealId);
  if (!deal?.contract_address || !["deployed", "funded", "disputed"].includes(deal.status)) return void (await ctx.answerCallbackQuery({ text: "Статус сделки изменился", show_alert: true }));
  await ctx.answerCallbackQuery({ text: "Отправляю Cancel" });
  try {
    await sendCancel(parseAddress(deal.contract_address)!, dealId);
    setDealStatus(dealId, "cancel_pending");
    await ctx.editMessageText(`Возврат по сделке #${dealId} отправлен в блокчейн.`);
  } catch (error) {
    await ctx.reply(`Ошибка блокчейна: ${error instanceof Error ? error.message : String(error)}`);
  }
});

bot.callbackQuery(/^admin_resolve_yes:(\d+):(\d+)$/, async (ctx) => {
  if (!isArbiter(ctx.from.id)) return void (await ctx.answerCallbackQuery({ text: "Только для арбитра", show_alert: true }));
  const dealId = Number(ctx.match[1]);
  const sellerPercent = Number(ctx.match[2]);
  const deal = getDeal(dealId);
  if (!deal?.contract_address || !["funded", "disputed"].includes(deal.status)) return void (await ctx.answerCallbackQuery({ text: "Статус сделки изменился", show_alert: true }));
  await ctx.answerCallbackQuery({ text: "Отправляю Resolve" });
  try {
    await sendResolve(parseAddress(deal.contract_address)!, dealId, sellerPercent * 100);
    setDealStatus(dealId, "resolve_pending");
    await ctx.editMessageText(`Решение по сделке #${dealId} отправлено: продавцу ${sellerPercent}%, покупателю ${100 - sellerPercent}% суммы сделки.`);
  } catch (error) {
    await ctx.reply(`Ошибка блокчейна: ${error instanceof Error ? error.message : String(error)}`);
  }
});

bot.hears(BTN_NEW, beginNewDeal);
bot.hears(BTN_DEALS, (ctx) => showDealList(ctx));
bot.hears(BTN_WALLET, async (ctx) => {
  if (!ctx.from) return;
  wizards.set(ctx.from.id, { step: "wallet" });
  const current = getUser(ctx.from.id)?.wallet_address;
  await ctx.reply(`${current ? `Текущий адрес:\n${current}\n\n` : ""}Отправьте новый TON-адрес одним сообщением.`, { reply_markup: new Keyboard().text(BTN_STOP).resized().oneTime() });
});
bot.hears(BTN_HELP, async (ctx) => {
  if (!ctx.from) return;
  await ctx.reply("Откройте /help — там краткая инструкция и правила отмены.", { reply_markup: mainMenu(isArbiter(ctx.from.id)) });
});
bot.hears(BTN_VERIFY, showTransparency);
bot.hears(BTN_ADMIN, (ctx) => showAdminPanel(ctx));
bot.hears(BTN_STOP, async (ctx) => {
  if (!ctx.from) return;
  wizards.delete(ctx.from.id);
  await ctx.reply("Ввод отменён.", { reply_markup: mainMenu() });
});

bot.on("message:text", async (ctx, next) => {
  const state = wizards.get(ctx.from.id);
  if (!state) return next();
  const text = ctx.message.text.trim();
  if (state.step === "wallet") return void (await saveWallet(ctx, text));
  if (state.step === "counterparty") {
    const username = text === "-" ? null : text.replace(/^@/, "").trim();
    if (username !== null && !/^[A-Za-z0-9_]{5,32}$/.test(username)) return void (await ctx.reply("Введите корректный @username или один дефис: -"));
    if (username && username.toLowerCase() === ctx.from.username?.toLowerCase()) return void (await ctx.reply("Нельзя указать самого себя второй стороной."));
    state.counterpartyUsername = username;
    state.step = "amount";
    wizards.set(ctx.from.id, state);
    await ctx.reply(`Введите сумму сделки в TON от ${config.minDealTon} до ${config.maxDealTon} TON, например 2.5.\nКомиссия платформы зависит от суммы сделки: ${feeGridText()}. Фиксированный сетевой сбор ~${formatTonAmount(networkFeeUnits)} TON.`);
    return;
  }
  if (state.step === "amount") {
    try {
      const amount = parseTonAmount(text);
      if (amount < dealLimits.minUnits || amount > dealLimits.maxUnits) return void (await ctx.reply(`Допустимая сумма: от ${config.minDealTon} до ${config.maxDealTon} TON.`));
      state.amountUnits = amount;
      state.step = "fee_payer";
      wizards.set(ctx.from.id, state);
      const feeBps = feeBpsForAmount(amount);
      const feePercent = formatFeePercent(feeBps);
      const buyerOnTop = feeBreakdown(amount, feeBps, networkFeeUnits, false);
      const sellerDeducted = feeBreakdown(amount, feeBps, networkFeeUnits, true);
      await ctx.reply(
        `Для суммы ${formatTonAmount(amount)} TON действует комиссия платформы ${feePercent}% (${feeGridText()}).

` +
        `Кто платит комиссию платформы?

` +
        `«Покупатель сверху» — продавец получит полную сумму ${formatTonAmount(amount)} TON, покупатель заплатит ${formatTonAmount(buyerOnTop.total)} TON.
` +
        `«Из суммы продавца» — покупатель заплатит ${formatTonAmount(sellerDeducted.total)} TON, продавец получит ${formatTonAmount(sellerDeducted.sellerPayout)} TON.

` +
        `Сетевой сбор: ${formatTonAmount(networkFeeUnits)} TON.`,
        {
          reply_markup: new InlineKeyboard()
            .text("Покупатель сверху", "fee_payer_buyer")
            .text("Из суммы продавца", "fee_payer_seller"),
        }
      );
    } catch (error) {
      await ctx.reply(error instanceof Error ? error.message : "Некорректная сумма");
    }
    return;
  }
  if (state.step === "description") {
    if (text.length < 3 || text.length > 1000) return void (await ctx.reply("Описание должно содержать от 3 до 1000 символов."));
    if (countActiveDealsForUser(ctx.from.id) >= config.maxActiveDealsPerUser) {
      wizards.delete(ctx.from.id);
      return void (await ctx.reply("Лимит активных сделок уже достигнут. Ввод закрыт.", { reply_markup: mainMenu() }));
    }
    const deal = createDeal({
      creatorTgId: ctx.from.id, creatorRole: state.role!, counterpartyUsername: state.counterpartyUsername ?? null,
      amountUnits: state.amountUnits!, description: text, feeFromSeller: state.feeFromSeller ?? false,
    });
    wizards.delete(ctx.from.id);
    let username: string;
    try {
      username = await botUsername();
    } catch {
      await ctx.reply(`Сделка #${deal.deal_id} создана, но Telegram временно недоступен для генерации ссылки. Откройте /mydeals и повторите через минуту.`, { reply_markup: mainMenu() });
      return;
    }
    const link = `https://t.me/${username}?start=join_${deal.invite_token}`;
    await ctx.reply(`✅ Сделка #${deal.deal_id} создана.\n${feeLines(deal)}\nПредмет: ${deal.description}\n\nПерешлите второй стороне одноразовую ссылку:\n${link}\n\nОбе стороны должны сохранить свои TON-адреса через кнопку «Кошелёк».`, { reply_markup: mainMenu() });
    return;
  }
  return next();
});

bot.catch((error) => {
  const message = error.error instanceof Error ? error.error.message : "Unknown Telegram error";
  console.error(`Bot error while handling update ${error.ctx.update.update_id}: ${message}`);
});
