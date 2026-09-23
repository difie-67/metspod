import crypto from "node:crypto";
import fs from "node:fs";
import http, { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { URL } from "node:url";
import { config, dealLimits, networkFeeUnits } from "./config";
import {
  cancelDraftDeal,
  countActiveDealsForUser,
  countPublicDeals,
  createDeal,
  DealRow,
  getAdminStats,
  getDeal,
  getDealByInviteToken,
  getDealsForUser,
  getPendingDealsForUser,
  getPublicDeals,
  getRecentDeals,
  getUser,
  isDealParticipant,
  joinDeal,
  setDealConsent,
  setDealStatus,
  setWalletAddress,
  upsertUser,
} from "./db";
import { formatTonAmount, parseTonAmount } from "./amounts";
import { FEE_SCHEDULE, formatFeePercent } from "./fees";
import { APP_BUILD_ID } from "./version";
import { getAdminDiagnostics } from "./diagnostics";
import { bot, botUsername, tryAdvanceDeal } from "./bot";
import {
  formatAddress,
  getDealOnChainState,
  getEscrowCodeHash,
  depositFor,
  getEscrowDeploymentData,
  getServiceWalletInfo,
  isContractActive,
  makeConfirmPayload,
  parseAddress,
  sendCancel,
  sendResolve,
} from "./ton";

interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

interface AuthenticatedRequest extends IncomingMessage {
  telegramUser?: TelegramUser;
}

const STATUS_LABELS: Record<DealRow["status"], string> = {
  draft: "Ожидает второго участника",
  awaiting_wallets: "Ожидает адреса кошельков",
  setup_pending: "Готовим escrow-адрес",
  deployed: "Ожидает оплату",
  funded: "Оплачено — ожидает подтверждение",
  disputed: "Открыт спор",
  confirm_pending: "Выплата отправлена",
  cancel_pending: "Возврат отправлен",
  resolve_pending: "Решение спора отправлено",
  completed: "Завершена",
  cancelled: "Отменена",
  resolved: "Спор разрешён",
};

const writeRate = new Map<number, { startedAt: number; count: number }>();

function json(res: ServerResponse, status: number, data: unknown) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

function fail(res: ServerResponse, status: number, message: string) {
  json(res, status, { ok: false, error: message });
}

function safeEqualHex(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  return crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

/** Validates Telegram WebApp initData exactly as required by the Bot API docs. */
function validateInitData(raw: string): TelegramUser | null {
  if (!raw || raw.length > 16_384) return null;
  const params = new URLSearchParams(raw);
  const receivedHash = params.get("hash") || "";
  const authDate = Number(params.get("auth_date"));
  const userJson = params.get("user");
  if (!receivedHash || !Number.isSafeInteger(authDate) || !userJson) return null;
  const age = Math.floor(Date.now() / 1000) - authDate;
  if (age < -60 || age > config.miniAppAuthMaxAgeSeconds) return null;

  const checkString = [...params.entries()]
    .filter(([key]) => key !== "hash")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(config.botToken).digest();
  const expectedHash = crypto.createHmac("sha256", secret).update(checkString).digest("hex");
  if (!safeEqualHex(receivedHash, expectedHash)) return null;

  try {
    const user = JSON.parse(userJson) as TelegramUser;
    if (!Number.isSafeInteger(user.id) || user.id <= 0 || typeof user.first_name !== "string") return null;
    return user;
  } catch {
    return null;
  }
}

function authenticate(req: AuthenticatedRequest, res: ServerResponse): TelegramUser | null {
  const raw = req.headers["x-telegram-init-data"];
  const user = validateInitData(Array.isArray(raw) ? raw[0] : raw || "");
  if (!user) {
    fail(res, 401, "Откройте Mini App из Telegram — сессия недействительна или устарела.");
    return null;
  }
  req.telegramUser = user;
  upsertUser(user.id, user.username);
  return user;
}

function consumeWriteLimit(tgId: number): boolean {
  const now = Date.now();
  const current = writeRate.get(tgId);
  if (!current || now - current.startedAt >= 60_000) {
    writeRate.set(tgId, { startedAt: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= 20;
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 64 * 1024) throw new Error("Запрос слишком большой");
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error("Некорректный JSON");
  }
}

function explorerUrls(address: string) {
  const testnet = config.tonNetwork === "testnet";
  return {
    tonviewer: `${testnet ? "https://testnet.tonviewer.com" : "https://tonviewer.com"}/${encodeURIComponent(address)}`,
    tonscan: `${testnet ? "https://testnet.tonscan.org" : "https://tonscan.org"}/address/${encodeURIComponent(address)}`,
  };
}

function serializeDeal(deal: DealRow, viewerId: number, chainState: number | null = null) {
  const buyer = deal.buyer_tg_id ? getUser(deal.buyer_tg_id) : undefined;
  const seller = deal.seller_tg_id ? getUser(deal.seller_tg_id) : undefined;
  const address = deal.contract_address ? parseAddress(deal.contract_address) : null;
  const fees = depositFor(deal);
  return {
    id: deal.deal_id,
    status: deal.status,
    statusLabel: STATUS_LABELS[deal.status],
    amountTon: formatTonAmount(deal.amount_units),
    amountUnits: deal.amount_units,
    fees: {
      feePercent: fees.feeBps / 100,
      feeFromSeller: fees.feeFromSeller,
      serviceFeeTon: formatTonAmount(fees.serviceFee),
      networkFeeTon: formatTonAmount(fees.networkFee),
      totalTon: formatTonAmount(fees.total),
      totalUnits: fees.total.toString(),
      sellerPayoutTon: formatTonAmount(fees.sellerPayout),
    },
    description: deal.description,
    createdAt: deal.created_at,
    updatedAt: deal.updated_at,
    role: deal.buyer_tg_id === viewerId ? "buyer" : deal.seller_tg_id === viewerId ? "seller" : "admin",
    buyer: deal.buyer_tg_id ? { id: deal.buyer_tg_id, username: buyer?.username || null } : null,
    seller: deal.seller_tg_id ? { id: deal.seller_tg_id, username: seller?.username || null } : null,
    buyerAddress: deal.buyer_address,
    buyerAddressRaw: deal.buyer_address ? parseAddress(deal.buyer_address)?.toRawString() || null : null,
    sellerAddress: deal.seller_address,
    contractAddress: deal.contract_address,
    contractAddressRaw: address?.toRawString() || null,
    inviteToken: deal.creator_tg_id === viewerId && deal.status === "draft" ? deal.invite_token : null,
    chainState,
    explorers: deal.contract_address ? explorerUrls(deal.contract_address) : null,
    myConsent: deal.buyer_tg_id === viewerId ? deal.buyer_consent : deal.seller_tg_id === viewerId ? deal.seller_consent : null,
    consentEligible: ["completed", "resolved"].includes(deal.status),
  };
}

// Public deal history: shown to every mini-app user, regardless of who
// created the deal (bot chat or mini app — both are stored the same way).
// Never includes wallet addresses beyond the contract's own on-chain
// address (already public on any explorer); usernames are included only
// when that participant explicitly opted in.
function serializePublicDeal(deal: DealRow) {
  const buyer = deal.buyer_tg_id ? getUser(deal.buyer_tg_id) : undefined;
  const seller = deal.seller_tg_id ? getUser(deal.seller_tg_id) : undefined;
  const address = deal.contract_address ? parseAddress(deal.contract_address) : null;
  const fees = depositFor(deal);
  return {
    id: deal.deal_id,
    status: deal.status,
    statusLabel: STATUS_LABELS[deal.status],
    amountTon: formatTonAmount(deal.amount_units),
    fees: {
      feePercent: fees.feeBps / 100,
      feeFromSeller: fees.feeFromSeller,
      totalTon: formatTonAmount(fees.total),
      sellerPayoutTon: formatTonAmount(fees.sellerPayout),
    },
    description: deal.description,
    createdAt: deal.created_at,
    updatedAt: deal.updated_at,
    buyerUsername: deal.buyer_consent === 1 ? buyer?.username || null : null,
    sellerUsername: deal.seller_consent === 1 ? seller?.username || null : null,
    contractAddress: deal.contract_address,
    contractAddressRaw: address?.toRawString() || null,
    explorers: deal.contract_address ? explorerUrls(deal.contract_address) : null,
  };
}

async function chainStateFor(deal: DealRow): Promise<number | null> {
  if (!deal.contract_address) return null;
  const address = parseAddress(deal.contract_address);
  if (!address) return null;
  try {
    const state = Number((await getDealOnChainState(address)).state);
    if (state === 1 && ["deployed", "setup_pending"].includes(deal.status)) setDealStatus(deal.deal_id, "funded");
    return state;
  } catch {
    return null;
  }
}

async function notify(ids: Array<number | null>, text: string) {
  const unique = ids.filter((id, index, all): id is number => id !== null && all.indexOf(id) === index);
  for (const id of unique) await bot.api.sendMessage(id, text).catch(() => undefined);
}

function assertParticipant(deal: DealRow | undefined, tgId: number): DealRow {
  if (!deal || (!isDealParticipant(deal, tgId) && !config.arbiterTgIds.includes(tgId))) {
    throw new Error("Сделка не найдена или у вас нет доступа");
  }
  return deal;
}

async function buyerDeploymentData(deal: DealRow) {
  if (!deal.buyer_address || !deal.seller_address || !deal.contract_address) {
    throw new Error("Сделка ещё не готова к on-chain оплате");
  }
  const buyer = parseAddress(deal.buyer_address);
  const seller = parseAddress(deal.seller_address);
  if (!buyer || !seller) throw new Error("Некорректные адреса участников");
  const fees = depositFor(deal);
  const deployment = await getEscrowDeploymentData({
    dealId: deal.deal_id,
    buyer,
    seller,
    amountUnits: BigInt(deal.amount_units),
    feeBps: fees.feeBps,
    feeFromSeller: fees.feeFromSeller,
    networkFeeUnits: fees.networkFee,
  });
  if (formatAddress(deployment.address) !== deal.contract_address) {
    throw new Error("Параметры escrow изменились; пересоздайте сделку");
  }
  return deployment;
}

async function handleAction(deal: DealRow, user: TelegramUser, action: string, body: Record<string, unknown>) {
  const isAdmin = config.arbiterTgIds.includes(user.id);
  if (action === "confirm") {
    throw new Error("Подтверждение подписывается TON-кошельком покупателя через Mini App");
  } else if (action === "dispute") {
    if (!isDealParticipant(deal, user.id) || deal.status !== "funded") throw new Error("Спор нельзя открыть в текущем статусе");
    setDealStatus(deal.deal_id, "disputed");
    await notify([...config.arbiterTgIds, deal.buyer_tg_id, deal.seller_tg_id], `⚠️ По сделке #${deal.deal_id} открыт спор.`);
  } else if (action === "cancel") {
    if (!isDealParticipant(deal, user.id)) throw new Error("У вас нет доступа к сделке");
    if (["draft", "awaiting_wallets"].includes(deal.status) && !deal.contract_address) {
      if (!cancelDraftDeal(deal.deal_id, user.id)) throw new Error("Статус сделки уже изменился");
    } else {
      if (deal.status !== "deployed" || !deal.contract_address) throw new Error("Отмена недоступна; после оплаты откройте спор");
      const address = parseAddress(deal.contract_address)!;
      if (!(await isContractActive(address))) {
        setDealStatus(deal.deal_id, "cancelled");
        await notify([deal.buyer_tg_id, deal.seller_tg_id], `Сделка #${deal.deal_id} отменена до on-chain оплаты; escrow-контракт не разворачивался.`);
        return getDeal(deal.deal_id)!;
      }
      const state = await chainStateFor(deal);
      if (state !== 0) throw new Error(state === 1 ? "Оплата уже поступила — откройте спор" : "Контракт уже завершён");
      await sendCancel(address, deal.deal_id);
      setDealStatus(deal.deal_id, "cancel_pending");
    }
    await notify([deal.buyer_tg_id, deal.seller_tg_id], `Отмена сделки #${deal.deal_id} отправлена.`);
  } else if (action === "admin_cancel") {
    if (!isAdmin || !deal.contract_address || !["deployed", "funded", "disputed"].includes(deal.status)) throw new Error("Действие администратора недоступно");
    await sendCancel(parseAddress(deal.contract_address)!, deal.deal_id);
    setDealStatus(deal.deal_id, "cancel_pending");
  } else if (action === "admin_resolve") {
    const sellerPercent = Number(body.sellerPercent);
    if (!isAdmin || !deal.contract_address || !["funded", "disputed"].includes(deal.status)) throw new Error("Разрешение спора недоступно");
    if (!Number.isInteger(sellerPercent) || sellerPercent < 0 || sellerPercent > 100) throw new Error("Процент продавцу должен быть от 0 до 100");
    await sendResolve(parseAddress(deal.contract_address)!, deal.deal_id, sellerPercent * 100);
    setDealStatus(deal.deal_id, "resolve_pending");
  } else {
    throw new Error("Неизвестное действие");
  }
  return getDeal(deal.deal_id)!;
}

async function handleApi(req: AuthenticatedRequest, res: ServerResponse, url: URL) {
  const user = authenticate(req, res);
  if (!user) return;
  const isAdmin = config.arbiterTgIds.includes(user.id);
  const method = req.method || "GET";

  if (method !== "GET" && !consumeWriteLimit(user.id)) return fail(res, 429, "Слишком много действий. Подождите минуту.");

  if (method === "GET" && url.pathname === "/api/bootstrap") {
    const current = getUser(user.id);
    const serviceAddress = config.expectedServiceWalletAddress || formatAddress((await getServiceWalletInfo()).address);
    const username = await botUsername();
    const stats = isAdmin ? getAdminStats() : null;
    const diagnostics = isAdmin ? await getAdminDiagnostics() : null;
    return json(res, 200, {
      ok: true,
      user: { ...user, walletAddress: current?.wallet_address || null, isAdmin },
      config: {
        brand: "OBRA GUARANT",
        slogan: "Безопасные сделки в TON",
        network: config.tonNetwork,
        feeSchedule: FEE_SCHEDULE.map((tier) => ({
          key: tier.key,
          title: tier.title,
          shortLabel: tier.shortLabel,
          minTon: formatTonAmount(tier.minUnits),
          maxTonExclusive: tier.maxUnitsExclusive === null ? null : formatTonAmount(tier.maxUnitsExclusive),
          feeBps: tier.feeBps,
          feePercent: Number(formatFeePercent(tier.feeBps)),
          feePercentText: formatFeePercent(tier.feeBps),
        })),
        networkFeeTon: formatTonAmount(networkFeeUnits),
        buyerActionTon: config.actionGasTon,
        gasInfoUrl: config.gasInfoUrl,
        minDealTon: config.minDealTon,
        maxDealTon: config.maxDealTon,
        supportUsername: config.supportUsername,
        botUsername: username,
        serviceAddress,
        verifierUrl: config.verifierUrl,
      },
      deals: getDealsForUser(user.id).map((deal) => serializeDeal(deal, user.id)),
      admin: isAdmin && stats ? {
        stats: { ...stats, lockedUnits: stats.lockedUnits.toString(), lockedTon: formatTonAmount(stats.lockedUnits) },
        recent: getRecentDeals(20).map((deal) => serializeDeal(deal, user.id)),
        diagnostics,
      } : null,
    });
  }

  const dealMatch = url.pathname.match(/^\/api\/deals\/(\d+)$/);
  if (method === "GET" && dealMatch) {
    let deal = assertParticipant(getDeal(Number(dealMatch[1])), user.id);
    const chainState = await chainStateFor(deal);
    deal = getDeal(deal.deal_id)!;
    return json(res, 200, { ok: true, deal: serializeDeal(deal, user.id, chainState) });
  }

  const deploymentMatch = url.pathname.match(/^\/api\/deals\/(\d+)\/deployment$/);
  if (method === "GET" && deploymentMatch) {
    const deal = assertParticipant(getDeal(Number(deploymentMatch[1])), user.id);
    if (deal.buyer_tg_id !== user.id) return fail(res, 403, "Оплатить сделку может только покупатель");
    if (deal.status !== "deployed") return fail(res, 409, "Сделка сейчас не ожидает оплату");
    if (deal.contract_address) {
      const address = parseAddress(deal.contract_address);
      if (address && await isContractActive(address)) return fail(res, 409, "Escrow уже развёрнут; обновите карточку сделки");
    }
    const deployment = await buyerDeploymentData(deal);
    return json(res, 200, {
      ok: true,
      address: formatAddress(deployment.address),
      stateInit: deployment.stateInit,
      amountUnits: depositFor(deal).total.toString(),
    });
  }

  const confirmTxMatch = url.pathname.match(/^\/api\/deals\/(\d+)\/confirm-transaction$/);
  if (method === "GET" && confirmTxMatch) {
    const deal = assertParticipant(getDeal(Number(confirmTxMatch[1])), user.id);
    if (deal.buyer_tg_id !== user.id) return fail(res, 403, "Подтвердить получение может только покупатель");
    if (deal.status !== "funded" || !deal.contract_address) return fail(res, 409, "Сделка ещё не готова к подтверждению");
    const confirmAddress = parseAddress(deal.contract_address);
    if (!confirmAddress || !(await isContractActive(confirmAddress))) return fail(res, 409, "Escrow-контракт ещё не активен");
    const chain = await getDealOnChainState(confirmAddress);
    if (Number(chain.state) !== 1) return fail(res, 409, "Escrow уже не ожидает подтверждение");
    return json(res, 200, {
      ok: true,
      address: deal.contract_address,
      amountUnits: parseTonAmount(config.actionGasTon).toString(),
      payload: makeConfirmPayload(deal.deal_id),
    });
  }

  if (method === "GET" && url.pathname === "/api/public-deals") {
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 100));
    return json(res, 200, {
      ok: true,
      total: countPublicDeals(),
      deals: getPublicDeals(limit).map(serializePublicDeal),
    });
  }

  try {
    const body = await readBody(req);
    if (method === "POST" && url.pathname === "/api/wallet") {
      const parsed = parseAddress(String(body.address || ""));
      if (!parsed) throw new Error("Некорректный TON-адрес");
      const address = formatAddress(parsed);
      setWalletAddress(user.id, address);
      for (const deal of getPendingDealsForUser(user.id)) void tryAdvanceDeal(deal.deal_id);
      return json(res, 200, { ok: true, walletAddress: address });
    }

    if (method === "POST" && url.pathname === "/api/deals") {
      if (countActiveDealsForUser(user.id) >= config.maxActiveDealsPerUser) throw new Error("Достигнут лимит активных сделок");
      const role = body.role === "buyer" || body.role === "seller" ? body.role : null;
      if (!role) throw new Error("Выберите роль");
      const amount = parseTonAmount(String(body.amountTon || ""));
      if (amount < dealLimits.minUnits || amount > dealLimits.maxUnits) throw new Error(`Сумма должна быть от ${config.minDealTon} до ${config.maxDealTon} TON`);
      const description = String(body.description || "").trim();
      if (description.length < 3 || description.length > 1000) throw new Error("Описание должно содержать от 3 до 1000 символов");
      const rawUsername = String(body.counterpartyUsername || "").trim().replace(/^@/, "");
      if (rawUsername && !/^[A-Za-z0-9_]{5,32}$/.test(rawUsername)) throw new Error("Некорректный username второй стороны");
      if (rawUsername && rawUsername.toLowerCase() === user.username?.toLowerCase()) throw new Error("Нельзя указать себя второй стороной");
      const feeFromSeller = body.feeFromSeller === true || body.feeFromSeller === "true";
      const deal = createDeal({ creatorTgId: user.id, creatorRole: role, counterpartyUsername: rawUsername || null, amountUnits: amount, description, feeFromSeller });
      const username = await botUsername();
      return json(res, 201, { ok: true, deal: serializeDeal(deal, user.id), inviteUrl: `https://t.me/${username}?start=join_${deal.invite_token}` });
    }

    if (method === "POST" && url.pathname === "/api/join") {
      const token = String(body.token || "").trim();
      const found = getDealByInviteToken(token);
      if (!found || found.creator_tg_id === user.id) throw new Error("Приглашение недействительно или принадлежит вам");
      const deal = joinDeal(found.deal_id, user.id, user.username);
      void tryAdvanceDeal(deal.deal_id);
      return json(res, 200, { ok: true, deal: serializeDeal(deal, user.id) });
    }

    const actionMatch = url.pathname.match(/^\/api\/deals\/(\d+)\/action$/);
    if (method === "POST" && actionMatch) {
      const deal = assertParticipant(getDeal(Number(actionMatch[1])), user.id);
      const updated = await handleAction(deal, user, String(body.action || ""), body);
      return json(res, 200, { ok: true, deal: serializeDeal(updated, user.id) });
    }

    const consentMatch = url.pathname.match(/^\/api\/deals\/(\d+)\/consent$/);
    if (method === "POST" && consentMatch) {
      const deal = assertParticipant(getDeal(Number(consentMatch[1])), user.id);
      if (!["completed", "resolved"].includes(deal.status)) throw new Error("Согласие доступно только для завершённых сделок");
      if (!setDealConsent(deal.deal_id, user.id, Boolean(body.consent))) throw new Error("Не удалось сохранить согласие");
      return json(res, 200, { ok: true, deal: serializeDeal(getDeal(deal.deal_id)!, user.id) });
    }


    if (method === "GET" && url.pathname === "/api/admin/diagnostics") {
      if (!isAdmin) return fail(res, 403, "Доступно только администраторам");
      return json(res, 200, { ok: true, diagnostics: await getAdminDiagnostics() });
    }

    if (method === "GET" && url.pathname === "/api/transparency") {
      const service = await getServiceWalletInfo();
      return json(res, 200, {
        ok: true,
        network: config.tonNetwork,
        feeSchedule: FEE_SCHEDULE.map((tier) => ({
          key: tier.key,
          title: tier.title,
          shortLabel: tier.shortLabel,
          minTon: formatTonAmount(tier.minUnits),
          maxTonExclusive: tier.maxUnitsExclusive === null ? null : formatTonAmount(tier.maxUnitsExclusive),
          feeBps: tier.feeBps,
          feePercent: Number(formatFeePercent(tier.feeBps)),
          feePercentText: formatFeePercent(tier.feeBps),
        })),
        networkFeeTon: formatTonAmount(networkFeeUnits),
        buyerActionTon: config.actionGasTon,
        gasInfoUrl: config.gasInfoUrl,
        serviceAddress: formatAddress(service.address),
        serviceBalanceTon: formatTonAmount(service.balance),
        serviceState: service.state,
        codeHash: await getEscrowCodeHash(),
        explorers: explorerUrls(formatAddress(service.address)),
        verifierUrl: config.verifierUrl,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось выполнить действие";
    return fail(res, 400, message);
  }

  fail(res, 404, "Маршрут не найден");
}

function staticRoot(): string {
  // Support both tsx/dev and compiled Railway layouts. process.cwd() is the
  // project root in the normal Railway/Nixpacks start command, while __dirname
  // points at src/ or dist/src depending on how the app is launched.
  const candidates = [
    path.resolve(process.cwd(), "miniapp"),
    path.resolve(__dirname, "..", "..", "miniapp"),
    path.resolve(__dirname, "..", "miniapp"),
  ];
  const found = candidates.find((candidate) => fs.existsSync(path.join(candidate, "index.html")));
  if (!found) {
    console.error(`Mini App static directory not found. Checked: ${candidates.join(", ")}`);
    return candidates[0];
  }
  return found;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

function serveStatic(res: ServerResponse, pathname: string) {
  const root = staticRoot();
  // Telegram/BotFather setups often keep the Mini App URL as /miniapp or
  // /miniapp/. Treat both aliases exactly like the site root instead of trying
  // to open the directory itself (which previously returned { ok:false,
  // error:"Not found" }).
  const isMiniAppIndex = pathname === "/" || pathname === "/miniapp" || pathname === "/miniapp/";
  const relative = isMiniAppIndex ? "index.html" : pathname.replace(/^\/miniapp\//, "").replace(/^\//, "");
  const target = path.resolve(root, relative);
  if (!target.startsWith(root + path.sep) && target !== path.join(root, "index.html")) return fail(res, 403, "Forbidden");
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return fail(res, 404, "Not found");
  const stat = fs.statSync(target);
  res.writeHead(200, {
    "content-type": MIME[path.extname(target)] || "application/octet-stream",
    "content-length": stat.size,
    "cache-control": [".html", ".css", ".js"].includes(path.extname(target)) ? "no-store, max-age=0" : "public, max-age=3600",
    "x-content-type-options": "nosniff",
    "x-obra-build": APP_BUILD_ID,
    "referrer-policy": "no-referrer",
    "content-security-policy": "default-src 'self'; script-src 'self' https://telegram.org https://unpkg.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https: wss:; frame-src https:; base-uri 'none'; form-action 'self'",
  });
  fs.createReadStream(target).pipe(res);
}

export function startMiniAppServer() {
  const server = http.createServer(async (req: AuthenticatedRequest, res) => {
    try {
      const host = req.headers.host || `localhost:${config.miniAppPort}`;
      const url = new URL(req.url || "/", `http://${host}`);
      if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
      if (url.pathname === "/version") return json(res, 200, { ok: true, build: APP_BUILD_ID, service: "obra-guarant" });
      if (url.pathname === "/health") return json(res, 200, { ok: true, service: "obra-guarant", network: config.tonNetwork, build: APP_BUILD_ID });
      if (url.pathname === "/tonconnect-manifest.json") {
        const base = config.miniAppUrl || `https://${host}`;
        return json(res, 200, {
          url: base,
          name: "OBRA GUARANT",
          iconUrl: `${base}/miniapp/logo.png`,
          termsOfUseUrl: `${base}/#terms`,
          privacyPolicyUrl: `${base}/#privacy`,
        });
      }
      serveStatic(res, url.pathname);
    } catch (error) {
      console.error("Mini App request failed:", error);
      if (!res.headersSent) fail(res, 500, "Внутренняя ошибка сервера");
      else res.end();
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.listen(config.miniAppPort, "0.0.0.0", () => {
    console.log(`Mini App server: http://0.0.0.0:${config.miniAppPort}${config.miniAppUrl ? ` (public: ${config.miniAppUrl})` : " (local preview)"}`);
  });
  return server;
}
