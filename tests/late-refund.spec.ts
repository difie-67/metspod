import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Covers two fixes: (1) a deposit that lands on a deal already cancelled in the
// DB is refunded automatically; (2) OBR cashback is capped by the paid fee.
async function main() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'late-refund-'));
  Object.assign(process.env, { BOT_TOKEN: '123456789:test-only', ARBITER_TG_IDS: '999',
    ARBITER_MNEMONIC: Array(24).fill('test').join(' '), PLATFORM_ADDRESS: '0:' + '0'.repeat(64),
    DB_PATH: path.join(folder, 'test.sqlite'), OBR_CASHBACK_PERCENT: '5', OBR_MAX_FEE_SHARE_PERCENT: '50' });
  const db = require('../src/db');
  const { bot } = require('../src/bot');
  const sent: Array<{ chat: number; text: string }> = [];
  bot.api.config.use(async (_prev: any, method: string, payload: any) => {
    if (method === 'sendMessage') sent.push({ chat: payload.chat_id, text: payload.text });
    return { ok: true, result: true } as any;
  });

  // --- (1) late deposit on a DB-cancelled deal -------------------------------
  const deal = db.createDeal({ creatorTgId: 1, creatorRole: 'buyer', counterpartyUsername: null, amountUnits: 5_000_000_000n, description: 'Test item' });
  db.joinDeal(deal.deal_id, 2, 'seller_user');
  const address = 'EQ' + 'A'.repeat(46);
  db.setDealContractAddress(deal.deal_id, address);
  db.setDealStatus(deal.deal_id, 'cancelled'); // DB-only cancel, contract not deployed yet

  let chain = { active: false, state: 0 };
  const cancels: number[] = [];
  const fake: any = {
    parseAddress: (raw: string) => (raw === address ? { toString: () => address } : null),
    isContractActive: async () => chain.active,
    getDealOnChainState: async () => ({ state: BigInt(chain.state) }),
    sendCancel: async (_addr: unknown, id: number) => { cancels.push(id); },
  };
  const watcher = require('../src/watcher');
  const refundLateDeposits = () => watcher.refundLateDeposits(true, fake);

  await refundLateDeposits();
  assert.equal(cancels.length, 0, 'Undeployed contract: nothing to refund');

  chain = { active: true, state: 1 }; // the in-flight payment arrived
  await refundLateDeposits();
  assert.deepEqual(cancels, [deal.deal_id], 'Late deposit must trigger Cancel (refund)');
  assert.equal(db.getDeal(deal.deal_id).status, 'cancel_pending');
  assert.ok(sent.some((m) => m.chat === 1 && /автоматически отправил возврат/.test(m.text)), 'Buyer is told about the refund');
  assert.ok(sent.some((m) => m.chat === 999), 'Admin is told about the refund');

  // Failure path: admin is warned once, the bot retries on the next round.
  const deal2 = db.createDeal({ creatorTgId: 3, creatorRole: 'buyer', counterpartyUsername: null, amountUnits: 1_000_000_000n, description: 'Second item' });
  db.setDealContractAddress(deal2.deal_id, address);
  db.setDealStatus(deal2.deal_id, 'cancelled');
  db.setDealStatus(deal.deal_id, 'cancelled'); // keep only deal2 relevant below
  fake.sendCancel = async () => { throw new Error('low balance'); };
  sent.length = 0;
  await refundLateDeposits();
  await refundLateDeposits();
  const warnings = sent.filter((m) => m.chat === 999 && /Автовозврат не удался/.test(m.text));
  assert.equal(warnings.length, 2, 'One warning per deal (deal and deal2), not one per retry');
  assert.equal(db.getDeal(deal2.deal_id).status, 'cancelled', 'Failed refund keeps the deal in the retry list');

  // Old cancellations (outside the window) are no longer polled.
  db.db.prepare('UPDATE deals SET updated_at = 1').run();
  assert.equal(db.getRecentlyCancelledWithAddress(Math.floor(Date.now() / 1000) - 86400).length, 0);

  // --- (2) OBR cashback is capped by the service fee ------------------------
  // 100 TON deal, 0.6% tier → fee 0.6 TON = 600 OBR; cap 50% → 300 OBR total.
  const big = { amount_units: '100000000000', fee_bps: 60 };
  assert.equal(db.obrRewardMilliForDeal(big, 'buyer') + db.obrRewardMilliForDeal(big, 'seller'), 300_000);
  assert.equal(db.obrRewardMilliForDeal(big, 'buyer'), 240_000);
  assert.equal(db.obrRewardMilliForDeal(big, 'seller'), 60_000);
  // 1 TON deal at 2%: fee 20 OBR → cap 10 OBR, uncapped would be 50 + 12.5.
  const small = { amount_units: '1000000000', fee_bps: 200 };
  assert.equal(db.obrRewardMilliForDeal(small, 'buyer') + db.obrRewardMilliForDeal(small, 'seller'), 10_000);
  // Farming check across all tiers: OBR minted (at 1 TON = 1000 OBR) < TON fee paid.
  for (const [units, bps] of [['10000000', 200], ['3000000000', 130], ['20000000000', 90], ['100000000000', 60]] as const) {
    const terms = { amount_units: units, fee_bps: bps };
    const mintedMilli = db.obrRewardMilliForDeal(terms, 'buyer') + db.obrRewardMilliForDeal(terms, 'seller');
    const feeMilli = Number((BigInt(units) * BigInt(bps)) / 10000n / 1000n);
    assert.ok(mintedMilli < feeMilli || feeMilli === 0, `Cashback must stay below the paid fee (${units})`);
  }

  db.db.close();
  fs.rmSync(folder, { recursive: true, force: true });
  console.log('PASS: late deposit auto-refund, failure warning without spam, OBR fee cap');
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
