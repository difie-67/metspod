import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

async function main() {
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'entry-queue-'));
  Object.assign(process.env,{BOT_TOKEN:'123456789:test-only',ARBITER_TG_IDS:'999',ARBITER_MNEMONIC:Array(24).fill('test').join(' '),
    PLATFORM_ADDRESS:'0:'+'0'.repeat(64),DB_PATH:path.join(folder,'test.sqlite')});
  const {db}=require('../src/db');
  const {registerListing,publishListing,setListingActive,requestListing}=require('../src/listings');
  const {createListingEntryQueue}=require('../src/listing-entry-queue');
  const token='queue_delayed_test_123456';
  const input={token,user_id:200,chat_id:200,kind:'open'};
  let progress=0;
  const delivered:any[]=[];
  const queue=createListingEntryQueue(async () => ++progress,async (job:any,listing:any) => delivered.push({job,listing}));
  const clearDelay=()=>db.prepare('UPDATE community_entry_jobs SET last_attempt_at=NULL').run();
  try {
    const first=await queue.enqueue(input);queue.stop();
    const repeated=await queue.enqueue(input);queue.stop();
    assert.equal(first,repeated); assert.equal(progress,1);
    clearDelay();await queue.processPending();
    assert.equal(delivered.length,0,'A missing row stays pending rather than emitting a false not-found');
    // More than the old 8s window has elapsed; the original click still works.
    db.prepare('UPDATE community_entry_jobs SET created_at=?').run(Math.floor(Date.now()/1000)-60);
    registerListing({token,seller_tg_id:100,amount_units:'12000000000',description:'Gift #123',channel_id:'-100123',escrow_enabled:true});
    clearDelay();await queue.processPending();assert.equal(delivered.length,0);
    const restarted=createListingEntryQueue(async () => { throw Error('Progress must not be duplicated after restart'); },
      async (job:any,listing:any) => delivered.push({job,listing}));
    publishListing(token,{message_id:1,post_url:'https://t.me/channel/1'});
    clearDelay();await restarted.processPending();
    assert.equal(delivered.length,1);assert.equal(delivered[0].job.id,first);
    assert.equal(delivered[0].listing.status,'active');
    await restarted.processPending();assert.equal(delivered.length,1);
    // A waiting purchase is executed once and retains the buyer from the click.
    const absent='queue_buyer_test_12345678';
    const buyerQueue=createListingEntryQueue(async () => ++progress,async (job:any,listing:any) => {
      assert.equal(job.kind,'buy');assert.equal(listing.status,'active');
      requestListing(job.token,job.user_id);
    });
    await buyerQueue.enqueue({token:absent,user_id:201,chat_id:201,kind:'buy'});buyerQueue.stop();
    registerListing({token:absent,seller_tg_id:100,amount_units:'12000000000',description:'Gift #124',channel_id:'-100123',escrow_enabled:true});
    publishListing(absent,{message_id:2,post_url:'https://t.me/channel/2'});
    clearDelay();await buyerQueue.processPending();await buyerQueue.processPending();
    assert.equal(db.prepare('SELECT count(*) AS n FROM deals WHERE buyer_tg_id=201').get().n,1);
    setListingActive(token,false);
    await queue.enqueue({...input,user_id:202});queue.stop();
    clearDelay();await queue.processPending();
    assert.equal(delivered.at(-1).listing.status,'inactive','An actual withdrawn status must be respected');
    await queue.enqueue({...input,token:'queue_timeout_test_123456',user_id:203});queue.stop();
    db.prepare('UPDATE community_entry_jobs SET expires_at=1 WHERE user_id=203').run();
    clearDelay();await queue.processPending();assert.equal(delivered.at(-1).listing,undefined);
    // Unsent progress messages are recovered too (crash just after inserting a job).
    db.prepare(`INSERT INTO community_entry_jobs(token,user_id,chat_id,kind,created_at,expires_at) VALUES(?,204,204,'open',?,?)`)
      .run(token,Math.floor(Date.now()/1000),Math.floor(Date.now()/1000)+1800);
    await queue.processPending();assert.equal(delivered.at(-1).job.user_id,204);
    let failedProgress=0;
    const retryProgress=createListingEntryQueue(async () => {
      if (++failedProgress===1) throw Error('Temporary Telegram failure');
      return 99;
    },async () => {});
    await retryProgress.enqueue({...input,user_id:205});retryProgress.stop();
    await retryProgress.processPending();
    assert.equal(failedProgress,2,'Failed progress delivery is retried using the original persisted click');
    const {acquireRuntimeOwnership}=require('../src/runtime-owner');
    acquireRuntimeOwnership();
    const child=execFileSync(process.execPath,['--import','tsx','-e',
      `try { require('./src/runtime-owner').acquireRuntimeOwnership(); process.exit(2); } catch(e) { console.log(e.message); }`],
      {cwd:path.resolve(__dirname,'..'),env:process.env,encoding:'utf8'});
    assert.match(child,/Другой процесс гаранта/);
  } finally { queue.stop();db.close();fs.rmSync(folder,{recursive:true,force:true}); }
  console.log('PASS: durable single-click queue, delayed data, restart recovery, purchase, real statuses, timeout and exclusive DB ownership');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
