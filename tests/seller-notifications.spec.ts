import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function main() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'seller-notice-'));
  Object.assign(process.env, { BOT_TOKEN: '123456789:test-only', ARBITER_TG_IDS: '999',
    ARBITER_MNEMONIC: Array(24).fill('test').join(' '), PLATFORM_ADDRESS: '0:'+'0'.repeat(64),
    DB_PATH: path.join(folder,'test.sqlite') });
  const { db } = require('../src/db');
  const { registerListing, publishListing, requestListing, decideListing } = require('../src/listings');
  const { createSellerNotifier } = require('../src/seller-notifications');
  const token = 'seller_notice_test_123456';
  registerListing({token,seller_tg_id:100,amount_units:'12000000000',description:'Gift #123',channel_id:'-100123',escrow_enabled:true});
  publishListing(token,{message_id:1,post_url:'https://t.me/channel/1'});
  const deal = requestListing(token,200);
  let calls = 0;
  const failed = createSellerNotifier(async () => { calls++; throw Error('403: seller has not started the bot'); });
  await failed.notify(deal.deal_id);
  assert.equal(calls,1);
  assert.equal(db.prepare('SELECT delivered_at FROM community_seller_notifications WHERE deal_id=?').get(deal.deal_id).delivered_at,null);
  await failed.notify(deal.deal_id);
  assert.equal(calls,1,'Repeated clicks must not cause a retry storm');
  db.prepare('UPDATE community_seller_notifications SET last_attempt_at=1 WHERE deal_id=?').run(deal.deal_id);
  // A new notifier simulates restarting the process: the pending row survives.
  const restarted = createSellerNotifier(async (id: number, sellerId: number) => {
    calls++; assert.equal(id,deal.deal_id); assert.equal(sellerId,100);
  });
  await restarted.retryPending();
  assert.equal(calls,2);
  assert.ok(db.prepare('SELECT delivered_at FROM community_seller_notifications WHERE deal_id=?').get(deal.deal_id).delivered_at);
  await restarted.notify(deal.deal_id);
  await restarted.retryPending();
  assert.equal(calls,2,'Successfully delivered notices must not be resent');
  const other = requestListing(token,201);
  db.prepare('UPDATE community_requests SET created_at=1 WHERE deal_id=?').run(other.deal_id);
  await restarted.notify(other.deal_id);
  assert.equal(calls,2,'Expired requests must not send seller notifications');
  decideListing(deal.invite_token,100,'seller',true);
  await restarted.notify(deal.deal_id);
  assert.equal(calls,2);
  db.close(); fs.rmSync(folder,{recursive:true,force:true});
  console.log('PASS: seller outbox, failure retry, restart recovery, delivery deduplication and expired/accepted requests');
}
main().catch(error => { console.error(error); process.exitCode=1; });
