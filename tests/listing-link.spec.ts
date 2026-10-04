import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function main() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'listing-link-'));
  Object.assign(process.env, {
    BOT_TOKEN: '123456789:test-only', ARBITER_TG_IDS: '999',
    ARBITER_MNEMONIC: Array(24).fill('test').join(' '),
    PLATFORM_ADDRESS: '0:' + '0'.repeat(64), DB_PATH: path.join(folder, 'test.sqlite'),
  });
  const { resolveListingLink } = require('../src/listing-link');
  const { registerListing, publishListing, getListing, setListingActive, decideListing } = require('../src/listings');
  const { db, getDealsForUser } = require('../src/db');
  const { bot } = require('../src/bot');
  const token = 'first_open_listing_123456';
  const input = { token, seller_tg_id: 100, amount_units: '12000000000',
    description: 'Gift #123', channel_id: '-100123', escrow_enabled: true };

  // Deterministic delayed registration/publication; one call observes both.
  let now = 0;
  let found: any;
  const states: string[] = [];
  const resolved = await resolveListingLink(token, () => found, {
    now: () => now, timeoutMs: 1000, intervalMs: 250,
    sleep: async (ms: number) => {
      now += ms;
      found = { ...input, status: now >= 500 ? 'active' : 'pending' };
    },
    onLookup: (row: any) => states.push(row?.status ?? 'not_found'),
  });
  assert.equal(resolved.status, 'active');
  assert.deepEqual(states, ['not_found', 'pending', 'active']);
  for (const status of ['active', 'reserved', 'sold', 'inactive', 'review']) {
    assert.equal((await resolveListingLink(token, () => ({ status }), {
      sleep: async () => { throw Error('Terminal status must not wait'); },
    })).status, status);
  }
  now = 0;
  assert.equal((await resolveListingLink(token, () => ({ status: 'pending' }), {
    now: () => now, timeoutMs: 500, sleep: async (ms: number) => { now += ms; },
  })).status, 'pending');
  assert.equal(now, 500);
  now = 0;
  assert.equal(await resolveListingLink(token, () => undefined, {
    now: () => now, timeoutMs: 500, sleep: async (ms: number) => { now += ms; },
  }), undefined);
  assert.equal(now, 500);
  assert.equal(await resolveListingLink('invalid', () => { throw Error('Invalid token queried'); }), undefined);

  // Exercise the actual grammY /start route. All Telegram calls are stubbed.
  bot.botInfo = { id: 123456789, is_bot: true, first_name: 'Test', username: 'test_bot',
    can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false };
  const sent: any[] = [];
  let ackMode = 'expired';
  let releaseAck: (() => void) | undefined;
  bot.api.config.use(async (_prev: any, method: string, payload: any) => {
    if (method === 'answerCallbackQuery') {
      if (ackMode === 'expired') return { ok: false, error_code: 400, description: 'Bad Request: query is too old and response timeout expired or query ID is invalid' };
      await new Promise<void>(resolve => { releaseAck = resolve; });
      return { ok: true, result: true };
    }
    if (method === 'sendMessage') {
      sent.push(payload);
      return { ok: true, result: { message_id: sent.length, date: Math.floor(Date.now() / 1000),
        chat: { id: payload.chat_id, type: 'private' }, text: payload.text } };
    }
    if (method === 'setChatMenuButton') return { ok: true, result: true };
    throw Error(`Unexpected Telegram API call: ${method}`);
  });
  let updateId = 0;
  const send = async (text: string, userId = 200) => bot.handleUpdate({
    update_id: ++updateId, message: {
      message_id: updateId, date: Math.floor(Date.now() / 1000),
      chat: { id: userId, type: 'private' }, from: { id: userId, is_bot: false, first_name: 'Buyer' },
      text, ...(text.startsWith('/') ? { entities: [{ offset: 0, length: text.split(' ')[0].length, type: 'bot_command' }] } : {}),
    },
  });
  const buy = async (userId = 200) => bot.handleUpdate({
    update_id: ++updateId, callback_query: {
      id: `callback_${updateId}`, chat_instance: 'test', data: `lotbuy:${token}`,
      from: { id: userId, is_bot: false, first_name: 'Buyer' },
      message: { message_id: 1, date: Math.floor(Date.now() / 1000), chat: { id: userId, type: 'private' }, text: 'Gift #123' },
    },
  });
  try {
    registerListing(input);
    const timer = setTimeout(() => publishListing(token, { message_id: 1, post_url: 'https://t.me/channel/1' }), 40);
    try { await send(`/start lot_${token}`); } finally { clearTimeout(timer); }
    assert.equal(sent.length, 1, 'First /start sends the preview without another click');
    assert.equal(sent[0].reply_markup.inline_keyboard[0][0].callback_data, `lotbuy:${token}`);
    assert.match(sent[0].text, /Gift #123/);
    assert.equal(getDealsForUser(200).length, 0, 'Opening a URL does not create or reserve a deal');
    await send('/wallet');
    await send(`/start@test_bot lot_${token}`);
    const before = sent.length;
    await send('hello');
    assert.equal(sent.length, before, 'A previous input wizard was cleared by /start');
    await send(`/start lot_${token}`, 100);
    assert.match(sent.at(-1).text, /ваше объявление/);
    await buy();
    assert.match(sent.at(-1).text, /Запрос #\d+ зарегистрирован/,
      'An expired callback must not suppress the confirmation on the first click');
    const firstDeal = getDealsForUser(200)[0].deal_id;
    await buy();
    assert.equal(getDealsForUser(200).length, 1, 'Repeated clicks must reuse the request');
    assert.match(sent.at(-1).text, new RegExp(`Запрос #${firstDeal} `));
    ackMode = 'slow';
    const inFlight = buy(201);
    await new Promise(resolve => setImmediate(resolve));
    assert.match(sent.at(-1).text, /Запрос #\d+ зарегистрирован/);
    assert.equal(sent.at(-1).chat_id, 201, 'Slow button acknowledgement must not delay the chat confirmation');
    assert.ok(releaseAck);
    releaseAck!();
    await inFlight;
    ackMode = 'expired';
    setListingActive(token, false);
    await buy(202);
    assert.match(sent.at(-1).text, /Объявление снято с продажи/);
    assert.equal(getDealsForUser(202).length, 0);
    await send(`/start lot_${token}`);
    assert.match(sent.at(-1).text, /сняли с продажи/);
    assert.equal(getListing(token).status, 'inactive', 'URL cannot reactivate a withdrawn listing');
    setListingActive(token, true);
    const first = getDealsForUser(200)[0];
    decideListing(first.invite_token,100,'seller',true);
    await buy(200);
    assert.match(sent.at(-1).text, /Продавец уже подтвердил ваш запрос/);
    assert.equal(sent.at(-1).reply_markup.inline_keyboard[0][0].callback_data, `view_deal:${first.deal_id}`);
    await send(`/start lot_${token}`, 200);
    assert.match(sent.at(-1).text, /уже оформлена ваша сделка/);
    await buy(202);
    assert.match(sent.at(-1).text, /Лот уже забронирован по другой сделке/);
    assert.ok(sent.some(message => message.chat_id === 100 && /Запрос на покупку/.test(message.text)),
      'The guarantor sends the seller a direct notification');
  } finally {
    db.close();
    fs.rmSync(folder, { recursive: true, force: true });
  }
  console.log('PASS: first-click preview and purchase, delayed activation, expired/slow callbacks, idempotency, status checks and input reset');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
