import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config';
import { db } from './db';

export const instanceId=crypto.randomUUID();
export const databaseId=String((db.prepare("SELECT value FROM runtime_identity WHERE key='database_id'").get() as any).value);
let owner: DatabaseSync | undefined;
/** OS-backed SQLite lock is released on process exit; stale PID files cannot block startup. */
export function acquireRuntimeOwnership() {
  if (owner) return;
  const lock=new DatabaseSync(`${path.resolve(config.dbPath)}.owner.sqlite`);
  try { lock.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE;'); }
  catch { lock.close(); throw new Error('Другой процесс гаранта уже использует эту базу. Оставьте один экземпляр бота.'); }
  owner=lock;
  console.info('[runtime-owner] acquired',{instance_id:instanceId,database_id:databaseId,db_path:path.resolve(config.dbPath)});
}
