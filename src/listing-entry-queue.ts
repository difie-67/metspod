import { db } from './db';
import { getListing, Listing } from './listings';

export interface EntryJob {
  id: number; token: string; user_id: number; chat_id: number; username?: string;
  kind: 'open' | 'buy'; waiting_message_id: number; created_at: number; expires_at: number;
}
/** One click becomes a durable job. Absence of a record is not a business rejection. */
export function createListingEntryQueue(
  waiting: (job: EntryJob) => Promise<number>,
  deliver: (job: EntryJob, listing?: Listing) => Promise<void>,
) {
  const active = new Set<number>();
  let timer: ReturnType<typeof setInterval> | undefined;
  async function processPending() {
    const now = Math.floor(Date.now()/1000);
    const jobs = db.prepare(`SELECT * FROM community_entry_jobs WHERE completed_at IS NULL
      AND (last_attempt_at IS NULL OR last_attempt_at<=?)
      ORDER BY COALESCE(last_attempt_at,0),id LIMIT 20`).all(now-2) as unknown as EntryJob[];
    await Promise.all(jobs.map(async job => {
      if (active.has(job.id)) return;
      active.add(job.id);
      try {
        if (!job.waiting_message_id) {
          job.waiting_message_id=await waiting(job);
          db.prepare('UPDATE community_entry_jobs SET waiting_message_id=? WHERE id=?').run(job.waiting_message_id,job.id);
        }
        db.prepare('UPDATE community_entry_jobs SET last_attempt_at=?,attempts=attempts+1 WHERE id=?').run(now,job.id);
        const listing = getListing(job.token);
        if ((!listing || listing.status === 'pending') && now < job.expires_at) return;
        await deliver(job, listing?.status === 'pending' ? undefined : listing);
        db.prepare('UPDATE community_entry_jobs SET completed_at=? WHERE id=?').run(now,job.id);
        console.info('[listing-entry] completed', { job_id: job.id, kind: job.kind, status: listing?.status ?? 'unavailable', elapsed_ms: (now-job.created_at)*1000 });
      } catch (error) {
        db.prepare('UPDATE community_entry_jobs SET last_attempt_at=? WHERE id=?').run(now,job.id);
        console.warn('[listing-entry] retrying', { job_id: job.id, error: error instanceof Error ? error.message : 'Unknown error' });
      } finally { active.delete(job.id); }
    }));
  }
  function start() {
    if (timer) return;
    timer = setInterval(() => void processPending().catch(error => console.error('[listing-entry] worker_failed',error)),1000);
    void processPending().catch(error => console.error('[listing-entry] worker_failed',error));
  }
  function stop() { if (timer) clearInterval(timer); timer=undefined; }
  async function enqueue(input: {token:string;user_id:number;chat_id:number;username?:string;kind:'open'|'buy'}) {
    if (!/^[A-Za-z0-9_-]{20,40}$/.test(input.token)) throw new Error('Некорректный формат ссылки объявления');
    const now=Math.floor(Date.now()/1000);
    db.prepare(`INSERT OR IGNORE INTO community_entry_jobs(token,user_id,chat_id,username,kind,created_at,expires_at)
      VALUES(?,?,?,?,?,?,?)`).run(input.token,input.user_id,input.chat_id,input.username??null,input.kind,now,now+1800);
    const job=db.prepare(`SELECT * FROM community_entry_jobs WHERE token=? AND user_id=? AND chat_id=? AND kind=? AND completed_at IS NULL`)
      .get(input.token,input.user_id,input.chat_id,input.kind) as unknown as EntryJob;
    // Guard duplicate clicks while the initial progress message is in flight.
    if (!active.has(job.id) && !job.waiting_message_id) {
      active.add(job.id);
      try {
        const messageId=await waiting(job);
        db.prepare('UPDATE community_entry_jobs SET waiting_message_id=? WHERE id=?').run(messageId,job.id);
      } catch (error) {
        console.warn('[listing-entry] progress_retrying',{job_id:job.id,error:error instanceof Error?error.message:'Unknown error'});
      } finally { active.delete(job.id); }
    }
    console.info('[listing-entry] waiting', { job_id:job.id,kind:job.kind,token_suffix:job.token.slice(-6) });
    start();
    return job.id;
  }
  return { enqueue,processPending,start,stop };
}
