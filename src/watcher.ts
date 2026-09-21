import { InlineKeyboard } from "grammy";
import { config } from "./config";
import { DealRow, getDealsForWatcher, setDealStatus } from "./db";
import { formatTonAmount } from "./amounts";
import { depositFor, getDealOnChainState, isContractActive, parseAddress } from "./ton";
import { bot } from "./bot";

function amount(deal: DealRow): string {
  return `${formatTonAmount(deal.amount_units)} TON`;
}

async function notify(ids: Array<number | null>, text: string) {
  const unique = ids.filter((value, index, all): value is number =>
    value !== null && all.indexOf(value) === index
  );
  for (const tgId of unique) {
    await bot.api.sendMessage(tgId, text).catch(() => undefined);
  }
}

async function onFunded(deal: DealRow) {
  setDealStatus(deal.deal_id, "funded");

  if (deal.buyer_tg_id) {
    const keyboard = new InlineKeyboard()
      .text("✅ Подтвердить получение", `confirm_receipt:${deal.deal_id}`)
      .row()
      .text("⚠️ Открыть спор", `open_dispute:${deal.deal_id}`);
    await bot.api.sendMessage(
      deal.buyer_tg_id,
      `Оплата ${formatTonAmount(depositFor(deal).total)} TON по сделке #${deal.deal_id} получена escrow-контрактом.\n` +
      "Нажмите подтверждение только после фактического получения товара или услуги.",
      { reply_markup: keyboard }
    ).catch(() => undefined);
  }

  if (deal.seller_tg_id) {
    const keyboard = new InlineKeyboard().text("⚠️ Открыть спор", `open_dispute:${deal.deal_id}`);
    await bot.api.sendMessage(
      deal.seller_tg_id,
      `Оплата по сделке #${deal.deal_id} получена. Можно передавать товар или оказывать услугу.\n` +
      `После подтверждения покупателем вы получите полную сумму сделки: ${amount(deal)}.`,
      { reply_markup: keyboard }
    ).catch(() => undefined);
  }
}

async function tick() {
  const deals = getDealsForWatcher();
  for (const deal of deals) {
    const address = deal.contract_address ? parseAddress(deal.contract_address) : null;
    if (!address) continue;

    try {
      if (!(await isContractActive(address))) {
        if (deal.status === "setup_pending" && Math.floor(Date.now() / 1000) - deal.updated_at > 120) {
          setDealStatus(deal.deal_id, "awaiting_wallets");
          await notify(
            [deal.creator_tg_id, ...config.arbiterTgIds],
            `Развёртывание сделки #${deal.deal_id} не подтвердилось. Проверьте баланс служебного кошелька и повторите /wallet.`
          );
        }
        continue;
      }

      const info = await getDealOnChainState(address);
      const state = Number(info.state);

      if (state === 0) {
        if (deal.status === "setup_pending") setDealStatus(deal.deal_id, "deployed");

        const pending = ["confirm_pending", "cancel_pending", "resolve_pending"].includes(deal.status);
        if (pending && Math.floor(Date.now() / 1000) - deal.updated_at > 180) {
          setDealStatus(deal.deal_id, "deployed");
          await notify(
            [deal.buyer_tg_id, deal.seller_tg_id, ...config.arbiterTgIds],
            `Операция по сделке #${deal.deal_id} не подтвердилась в блокчейне. Статус восстановлен.`
          );
        }
      } else if (state === 1) {
        if (["deployed", "setup_pending"].includes(deal.status)) {
          await onFunded(deal);
        } else if (
          ["confirm_pending", "cancel_pending", "resolve_pending"].includes(deal.status) &&
          Math.floor(Date.now() / 1000) - deal.updated_at > 180
        ) {
          setDealStatus(deal.deal_id, "funded");
          await notify(
            [deal.buyer_tg_id, deal.seller_tg_id, ...config.arbiterTgIds],
            `Операция по сделке #${deal.deal_id} не подтвердилась. Средства всё ещё в escrow.`
          );
        }
      } else if (state === 2 && deal.status !== "completed") {
        setDealStatus(deal.deal_id, "completed");
        await notify(
          [deal.buyer_tg_id, deal.seller_tg_id, ...config.arbiterTgIds],
          `✅ Сделка #${deal.deal_id} завершена: ${amount(deal)} отправлено продавцу, комиссия сервиса удержана.`
        );
      } else if (state === 3 && deal.status !== "cancelled") {
        setDealStatus(deal.deal_id, "cancelled");
        await notify(
          [deal.buyer_tg_id, deal.seller_tg_id, ...config.arbiterTgIds],
          `Сделка #${deal.deal_id} отменена. Если депозит был внесён, он отправлен покупателю.`
        );
      } else if (state === 4 && deal.status !== "resolved") {
        setDealStatus(deal.deal_id, "resolved");
        await notify(
          [deal.buyer_tg_id, deal.seller_tg_id, ...config.arbiterTgIds],
          `Спор по сделке #${deal.deal_id} разрешён, выплаты отправлены участникам.`
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Watcher: failed to check deal #${deal.deal_id}: ${message}`);
    }
  }
}

export function startWatcher() {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await tick(); } finally { running = false; }
  };
  void run();
  setInterval(() => void run(), config.pollIntervalMs);
}
