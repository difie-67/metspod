import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function main() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'startup-link-'));
  Object.assign(process.env, {
    BOT_TOKEN: '123456789:test-only', ARBITER_TG_IDS: '999',
    ARBITER_MNEMONIC: Array(24).fill('test').join(' '),
    PLATFORM_ADDRESS: '0:' + '0'.repeat(64), DB_PATH: path.join(folder, 'test.sqlite'),
  });
  const { bot, sellerNotifier, listingEntryQueue } = require('../src/bot');
  listingEntryQueue.start=() => {};
  sellerNotifier.start = () => {}; // No live timer or deliveries during this startup test.
  const ton = require('../src/ton');
  const watcher = require('../src/watcher');
  const miniapp = require('../src/miniapp');
  const hanging = () => new Promise(() => {});
  let polling = false, menus = false, tonCheck = false, http = false, watching = false;
  bot.start = () => { polling = true; return hanging(); };
  bot.api.setMyCommands = () => { menus = true; return hanging(); };
  // tsx exposes TS exports as getters: replace the cached export object rather
  // than assigning to a read-only getter, so no live HTTP/RPC calls can occur.
  require.cache[require.resolve('../src/ton')]!.exports = { ...ton,
    getArbiterWallet: () => { tonCheck = true; return hanging(); } };
  require.cache[require.resolve('../src/watcher')]!.exports = { ...watcher,
    startWatcher: () => { watching = true; } };
  require.cache[require.resolve('../src/miniapp')]!.exports = { ...miniapp,
    startMiniAppServer: () => { http = true; } };
  require('../src/index');
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(http && watching && menus && tonCheck);
  assert.ok(polling, 'Polling must start while TON and optional Telegram menus are still waiting');
  require('../src/db').db.close();
  fs.rmSync(folder, { recursive: true, force: true });
  console.log('PASS: polling starts despite hanging TON startup and Telegram menu configuration');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
