/** Community listings. All ownership checks use Telegram IDs; URL tokens are public locators. */
import crypto from 'node:crypto';
import { db, createDeal, getDeal, getDealByInviteToken, countActiveDealsForUser, upsertUser, DealRow } from './db';
import { config, dealLimits } from './config';

export const integrationKey = () => (process.env.COMMUNITY_INTEGRATION_KEY || '').trim();
export function integrationAuthorized(header: string | string[] | undefined): boolean {
  const key = integrationKey();
  if (key.length < 32 || typeof header !== 'string') return false;
  const expected = Buffer.from(`Bearer ${key}`), actual = Buffer.from(header);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export interface Listing {
  token: string; seller_tg_id: number; description: string; amount_units: string;
  channel_id: string; message_id: number | null; post_url: string | null;
  status: 'pending' | 'active' | 'reserved' | 'sold' | 'inactive' | 'review';
  reserved_deal_id: number | null; created_at: number;
}
export function getListing(token: string): Listing | undefined {
  return db.prepare('SELECT * FROM community_listings WHERE token = ?').get(token) as unknown as Listing;
}
export function getListingRequest(dealId: number): { token: string; seller_tg_id: number; accepted: number; created_at: number } | undefined {
  return db.prepare('SELECT * FROM community_requests WHERE deal_id = ?').get(dealId) as any;
}
export function registerListing(body: Record<string, unknown>): Listing {
  const token = String(body.token || '');
  const seller = Number(body.seller_tg_id);
  const description = String(body.description || '').trim();
  const units = String(body.amount_units || '');
  const channel = String(body.channel_id || '');
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token) || !Number.isSafeInteger(seller) || seller <= 0 ||
      description.length < 3 || description.length > 850 || !/^\d{1,24}$/.test(units) || !/^-?\d+$/.test(channel)) {
    throw new Error('Некорректные данные лота');
  }
  if (body.escrow_enabled !== true) throw new Error('Нужно согласие продавца');
  const amount = BigInt(units);
  if (amount < dealLimits.minUnits || amount > dealLimits.maxUnits) throw new Error('Цена вне лимитов гаранта');
  const existing = getListing(token);
  if (existing) {
    if (existing.seller_tg_id !== seller || existing.amount_units !== units || existing.description !== description || existing.channel_id !== channel) {
      throw new Error('Токен уже зарегистрирован с другими условиями');
    }
    console.info('[community-listing] registered_existing', { token_suffix: token.slice(-6), status: existing.status });
    return existing;
  }
  db.prepare(`INSERT INTO community_listings(token,seller_tg_id,description,amount_units,channel_id,status,created_at)
              VALUES(?,?,?,?,?,'pending',?)`).run(token,seller,description,units,channel,Math.floor(Date.now()/1000));
  console.info('[community-listing] registered', { token_suffix: token.slice(-6), status: 'pending' });
  return getListing(token)!;
}
export function publishListing(token: string, body: Record<string, unknown>): Listing {
  const listing = getListing(token);
  if (!listing) throw new Error('Лот не найден');
  const message = Number(body.message_id);
  const postUrl = String(body.post_url || '');
  if (!Number.isSafeInteger(message) || message <= 0 || !/^https:\/\/t\.me\//.test(postUrl) || postUrl.length > 250) throw new Error('Некорректная публикация');
  if (listing.message_id && (listing.message_id !== message || listing.post_url !== postUrl)) throw new Error('Лот уже связан с публикацией');
  db.prepare(`UPDATE community_listings SET message_id=?,post_url=?,status=CASE WHEN status='pending' THEN 'active' ELSE status END WHERE token=?`).run(message,postUrl,token);
  console.info('[community-listing] published', { token_suffix: token.slice(-6), status: getListing(token)!.status, message_id: message });
  return getListing(token)!;
}
export function setListingActive(token: string, active: boolean): Listing {
  const listing = getListing(token);
  if (!listing || !['active','inactive'].includes(listing.status)) throw new Error('Лот занят, продан или требует проверки. Актуальность менять нельзя');
  db.prepare('UPDATE community_listings SET status=? WHERE token=?').run(active?'active':'inactive',token);
  db.prepare(`INSERT INTO community_events(kind,token,deal_id,target_tg_id,payload,created_at) VALUES('listing_updated',?,0,?,'{}',?)`).run(token,listing.seller_tg_id,Math.floor(Date.now()/1000));
  return getListing(token)!;
}
export function expireListingRequests() {
  const now = Math.floor(Date.now()/1000);
  db.prepare(`UPDATE deals SET status='cancelled',updated_at=? WHERE status='draft' AND contract_address IS NULL
    AND deal_id IN (SELECT deal_id FROM community_requests WHERE accepted=0 AND created_at < ?)`).run(now,now-1800);
}
export function requestListing(token: string, buyerId: number, username?: string): DealRow {
  const now = Math.floor(Date.now()/1000);
  expireListingRequests();
  const listing = getListing(token);
  if (!listing || listing.status !== 'active') throw new Error('Лот недоступен для покупки');
  if (listing.seller_tg_id === buyerId) throw new Error('Нельзя купить свой лот');
  const existing = db.prepare(`SELECT d.deal_id FROM deals d JOIN community_requests r ON r.deal_id=d.deal_id
    WHERE r.token=? AND d.buyer_tg_id=? AND d.status NOT IN ('completed','cancelled','resolved')`).get(token,buyerId) as any;
  if (existing) return getDeal(existing.deal_id)!;
  if (countActiveDealsForUser(buyerId) >= config.maxActiveDealsPerUser) throw new Error('Достигнут лимит активных сделок');
  const recent = db.prepare('SELECT count(*) AS n FROM community_requests r JOIN deals d ON d.deal_id=r.deal_id WHERE d.buyer_tg_id=? AND r.created_at>?').get(buyerId,now-60) as any;
  if (recent.n >= 2) throw new Error('Слишком много запросов. Подождите минуту');
  const pending = db.prepare(`SELECT count(*) AS n FROM community_requests r JOIN deals d ON d.deal_id=r.deal_id WHERE r.token=? AND r.accepted=0 AND d.status='draft'`).get(token) as any;
  if (pending.n >= 10) throw new Error('Продавец уже получил несколько запросов. Попробуйте позже');
  upsertUser(buyerId,username);
  db.exec('BEGIN IMMEDIATE');
  try {
    if (getListing(token)?.status !== "active") throw new Error("Лот уже недоступен");
    const description = `${listing.description}\nОбъявление: ${listing.post_url}`;
    const deal = createDeal({ creatorTgId:buyerId,creatorRole:'buyer',counterpartyUsername:null,
      amountUnits:BigInt(listing.amount_units),description,feeFromSeller:false });
    db.prepare('INSERT INTO community_requests(deal_id,token,seller_tg_id,accepted,created_at) VALUES(?,?,?,0,?)').run(deal.deal_id,token,listing.seller_tg_id,now);
    db.prepare(`INSERT INTO community_events(kind,token,deal_id,target_tg_id,payload,created_at) VALUES('request',?,?,?,?,?)`).run(
      token,deal.deal_id,listing.seller_tg_id,JSON.stringify({invite_token:deal.invite_token,amount_units:listing.amount_units,description:listing.description,buyer_tg_id:buyerId}),now);
    db.exec('COMMIT'); return deal;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
export function decideListing(token: string, sellerId: number, username: string | undefined, accept: boolean): DealRow {
  const deal = getDealByInviteToken(token);
  const request = deal && getListingRequest(deal.deal_id);
  if (!deal || !request || request.seller_tg_id !== sellerId) throw new Error('Запрос предназначен другому продавцу');
  if (request.accepted && accept && !['cancelled','completed','resolved'].includes(deal.status)) return deal;
  if (deal.status !== 'draft' || request.accepted || Math.floor(Date.now()/1000)-request.created_at > 1800) throw new Error('Запрос закрыт или истек. Покупатель может создать новый');
  if (accept && countActiveDealsForUser(sellerId) >= config.maxActiveDealsPerUser) throw new Error('Достигнут лимит активных сделок продавца');
  db.exec('BEGIN IMMEDIATE');
  try {
    const now = Math.floor(Date.now()/1000);
    if (accept) {
      const claimed = db.prepare(`UPDATE community_listings SET status='reserved',reserved_deal_id=? WHERE token=? AND status='active'`).run(deal.deal_id,request.token);
      if (claimed.changes !== 1) throw new Error('Лот уже занят или снят с продажи');
      upsertUser(sellerId,username);
      db.prepare('UPDATE community_requests SET accepted=1 WHERE deal_id=?').run(deal.deal_id);
      db.prepare('UPDATE deals SET seller_tg_id=?,updated_at=? WHERE deal_id=?').run(sellerId,now,deal.deal_id);
      db.prepare(`INSERT INTO community_events(kind,token,deal_id,target_tg_id,payload,created_at) VALUES('reserved',?,?,?,'{}',?)`).run(request.token,deal.deal_id,sellerId,now);
      // Other unaccepted requests cannot buy an already reserved item.
      db.prepare(`UPDATE deals SET status='cancelled',updated_at=? WHERE status='draft' AND deal_id IN
        (SELECT deal_id FROM community_requests WHERE token=? AND accepted=0)`).run(now,request.token);
    } else {
      db.prepare("UPDATE deals SET status='cancelled',updated_at=? WHERE deal_id=?").run(now,deal.deal_id);
    }
    db.exec('COMMIT'); return getDeal(deal.deal_id)!;
  } catch(error) { db.exec('ROLLBACK'); throw error; }
}
export function listingEvents(after: number) {
  expireListingRequests();
  return db.prepare('SELECT * FROM community_events WHERE id>? ORDER BY id LIMIT 100').all(after).map((event: any) => ({ ...event, listing: getListing(event.token), deal_status: getDeal(event.deal_id)?.status, accepted: getListingRequest(event.deal_id)?.accepted }));
}
