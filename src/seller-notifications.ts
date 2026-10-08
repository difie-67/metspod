import { db, getDeal } from './db';
import { getListing, getListingRequest } from './listings';

/** SQLite outbox: retry failed deliveries after restarts as well as in-process. */
export function createSellerNotifier(send: (dealId: number, sellerId: number) => Promise<unknown>) {
  const inFlight = new Set<number>();
  let timer: ReturnType<typeof setInterval> | undefined;
  async function notify(dealId: number): Promise<void> {
    if (inFlight.has(dealId)) return;
    const now = Math.floor(Date.now() / 1000);
    const row = db.prepare('SELECT * FROM community_seller_notifications WHERE deal_id=?').get(dealId) as any;
    const deal = getDeal(dealId), request = getListingRequest(dealId);
    if (!row || row.delivered_at || (row.last_attempt_at && now - row.last_attempt_at < 15) || !deal ||
        !request || request.accepted || deal.status !== 'draft' || now - request.created_at >= 1800 ||
        getListing(request.token)?.status !== 'active') return;
    inFlight.add(dealId);
    try {
      db.prepare('UPDATE community_seller_notifications SET attempts=attempts+1,last_attempt_at=? WHERE deal_id=?').run(now,dealId);
      console.info('[seller-notice] sending', { deal_id: dealId, seller_id: request.seller_tg_id, attempt: row.attempts + 1 });
      await send(dealId,request.seller_tg_id);
      db.prepare('UPDATE community_seller_notifications SET delivered_at=? WHERE deal_id=?').run(Math.floor(Date.now()/1000),dealId);
      console.info('[seller-notice] delivered', { deal_id: dealId, seller_id: request.seller_tg_id });
    } catch (error) {
      console.warn('[seller-notice] delivery_failed', { deal_id: dealId, seller_id: request.seller_tg_id,
        error: error instanceof Error ? error.message : 'Unknown error' });
    } finally { inFlight.delete(dealId); }
  }
  async function retryPending() {
    const now = Math.floor(Date.now()/1000);
    const rows = db.prepare(`SELECT n.deal_id FROM community_seller_notifications n
      JOIN community_requests r ON r.deal_id=n.deal_id JOIN deals d ON d.deal_id=n.deal_id
      JOIN community_listings l ON l.token=r.token
      WHERE n.delivered_at IS NULL AND (n.last_attempt_at IS NULL OR n.last_attempt_at<=?)
      AND r.accepted=0 AND r.created_at>? AND d.status='draft' AND l.status='active'
      ORDER BY r.created_at LIMIT 20`).all(now-15,now-1800) as any[];
    await Promise.all(rows.map(row => notify(row.deal_id)));
  }
  function start() {
    if (timer) return;
    const run = () => void retryPending().catch(error => console.error('[seller-notice] retry_failed', error));
    run();
    timer = setInterval(run, 15000);
  }
  function stop() { if (timer) clearInterval(timer); timer = undefined; }
  return { notify, retryPending, start, stop };
}
