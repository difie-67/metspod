import { DatabaseSync } from "node:sqlite";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { config } from "./config";

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new DatabaseSync(config.dbPath);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  tg_id INTEGER PRIMARY KEY,
  username TEXT,
  wallet_address TEXT
);

CREATE TABLE IF NOT EXISTS deals (
  deal_id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL DEFAULT 'draft',
  creator_tg_id INTEGER NOT NULL,
  buyer_tg_id INTEGER,
  seller_tg_id INTEGER,
  buyer_address TEXT,
  seller_address TEXT,
  amount_units TEXT NOT NULL,
  description TEXT NOT NULL,
  expected_counterparty_username TEXT,
  invite_token TEXT NOT NULL UNIQUE,
  contract_address TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_deals_status ON deals(status);
CREATE INDEX IF NOT EXISTS idx_deals_buyer ON deals(buyer_tg_id);
CREATE INDEX IF NOT EXISTS idx_deals_seller ON deals(seller_tg_id);
`);

export type DealStatus =
  | "draft"
  | "awaiting_wallets"
  | "setup_pending"
  | "deployed"
  | "funded"
  | "disputed"
  | "confirm_pending"
  | "cancel_pending"
  | "resolve_pending"
  | "completed"
  | "cancelled"
  | "resolved";

export interface DealRow {
  deal_id: number;
  status: DealStatus;
  creator_tg_id: number;
  buyer_tg_id: number | null;
  seller_tg_id: number | null;
  buyer_address: string | null;
  seller_address: string | null;
  amount_units: string;
  description: string;
  expected_counterparty_username: string | null;
  invite_token: string;
  contract_address: string | null;
  created_at: number;
  updated_at: number;
}

export interface UserRow {
  tg_id: number;
  username: string | null;
  wallet_address: string | null;
}

export function upsertUser(tgId: number, username: string | undefined | null) {
  db.prepare(
    `INSERT INTO users (tg_id, username) VALUES (?, ?)
     ON CONFLICT(tg_id) DO UPDATE SET username = excluded.username`
  ).run(tgId, username ?? null);
}

export function setWalletAddress(tgId: number, address: string) {
  db.prepare(`UPDATE users SET wallet_address = ? WHERE tg_id = ?`).run(address, tgId);
}

export function getUser(tgId: number): UserRow | undefined {
  return db.prepare(`SELECT * FROM users WHERE tg_id = ?`).get(tgId) as unknown as UserRow | undefined;
}

export function createDeal(params: {
  creatorTgId: number;
  creatorRole: "buyer" | "seller";
  counterpartyUsername: string | null;
  amountUnits: bigint;
  description: string;
}): DealRow {
  const now = Math.floor(Date.now() / 1000);
  const buyerTgId = params.creatorRole === "buyer" ? params.creatorTgId : null;
  const sellerTgId = params.creatorRole === "seller" ? params.creatorTgId : null;
  const inviteToken = crypto.randomBytes(18).toString("base64url");

  const info = db.prepare(
    `INSERT INTO deals (
      status, creator_tg_id, buyer_tg_id, seller_tg_id, amount_units,
      description, expected_counterparty_username, invite_token, created_at, updated_at
    ) VALUES ('draft', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    params.creatorTgId,
    buyerTgId,
    sellerTgId,
    params.amountUnits.toString(),
    params.description,
    params.counterpartyUsername?.toLowerCase() ?? null,
    inviteToken,
    now,
    now
  );

  return getDeal(Number(info.lastInsertRowid))!;
}

export function getDeal(dealId: number): DealRow | undefined {
  return db.prepare(`SELECT * FROM deals WHERE deal_id = ?`).get(dealId) as unknown as DealRow | undefined;
}

export function getDealByInviteToken(token: string): DealRow | undefined {
  return db.prepare(`SELECT * FROM deals WHERE invite_token = ?`).get(token) as unknown as DealRow | undefined;
}

export function joinDeal(dealId: number, tgId: number, username: string | undefined | null): DealRow {
  db.exec("BEGIN IMMEDIATE;");
  try {
    const deal = getDeal(dealId);
    if (!deal) throw new Error("Сделка не найдена");
    if (deal.buyer_tg_id === tgId || deal.seller_tg_id === tgId) {
      db.exec("COMMIT;");
      return deal;
    }
    if (deal.status !== "draft") throw new Error("Приглашение уже использовано или сделка закрыта");
    if (deal.buyer_tg_id && deal.seller_tg_id) throw new Error("В сделке уже есть обе стороны");

    const actualUsername = username?.toLowerCase() ?? null;
    if (deal.expected_counterparty_username && actualUsername !== deal.expected_counterparty_username) {
      throw new Error("Эта ссылка предназначена другому Telegram-пользователю");
    }

    upsertUser(tgId, username);
    const now = Math.floor(Date.now() / 1000);
    if (!deal.buyer_tg_id) {
      db.prepare(`UPDATE deals SET buyer_tg_id = ?, updated_at = ? WHERE deal_id = ? AND buyer_tg_id IS NULL`)
        .run(tgId, now, dealId);
    } else {
      db.prepare(`UPDATE deals SET seller_tg_id = ?, updated_at = ? WHERE deal_id = ? AND seller_tg_id IS NULL`)
        .run(tgId, now, dealId);
    }
    const updated = getDeal(dealId)!;
    db.exec("COMMIT;");
    return updated;
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

export function setDealAddresses(dealId: number, buyerAddress: string, sellerAddress: string) {
  db.prepare(
    `UPDATE deals SET buyer_address = ?, seller_address = ?, updated_at = ? WHERE deal_id = ?`
  ).run(buyerAddress, sellerAddress, Math.floor(Date.now() / 1000), dealId);
}

export function setDealStatus(dealId: number, status: DealStatus) {
  db.prepare(`UPDATE deals SET status = ?, updated_at = ? WHERE deal_id = ?`)
    .run(status, Math.floor(Date.now() / 1000), dealId);
}

export function cancelDraftDeal(dealId: number, tgId: number): boolean {
  const result = db.prepare(
    `UPDATE deals SET status = 'cancelled', updated_at = ?
     WHERE deal_id = ?
       AND (buyer_tg_id = ? OR seller_tg_id = ? OR creator_tg_id = ?)
       AND status IN ('draft', 'awaiting_wallets')
       AND contract_address IS NULL`
  ).run(Math.floor(Date.now() / 1000), dealId, tgId, tgId, tgId);
  return result.changes === 1;
}

export function claimDealSetup(dealId: number): boolean {
  const result = db.prepare(
    `UPDATE deals SET status = 'setup_pending', updated_at = ?
     WHERE deal_id = ? AND status IN ('draft', 'awaiting_wallets')`
  ).run(Math.floor(Date.now() / 1000), dealId);
  return result.changes === 1;
}

export function setDealContractAddress(dealId: number, address: string) {
  db.prepare(`UPDATE deals SET contract_address = ?, updated_at = ? WHERE deal_id = ?`)
    .run(address, Math.floor(Date.now() / 1000), dealId);
}

export function getDealsForWatcher(): DealRow[] {
  return db.prepare(
    `SELECT * FROM deals
     WHERE contract_address IS NOT NULL
       AND status IN ('setup_pending', 'deployed', 'funded', 'disputed', 'confirm_pending', 'cancel_pending', 'resolve_pending')`
  ).all() as unknown as DealRow[];
}

export function getPendingDealsForUser(tgId: number): DealRow[] {
  return db.prepare(
    `SELECT * FROM deals
     WHERE (buyer_tg_id = ? OR seller_tg_id = ?)
       AND status IN ('draft', 'awaiting_wallets')`
  ).all(tgId, tgId) as unknown as DealRow[];
}

export function getDealsForUser(tgId: number): DealRow[] {
  return db.prepare(
    `SELECT * FROM deals
     WHERE buyer_tg_id = ? OR seller_tg_id = ? OR creator_tg_id = ?
     ORDER BY deal_id DESC LIMIT 20`
  ).all(tgId, tgId, tgId) as unknown as DealRow[];
}

export function getDealsByStatuses(statuses: DealStatus[], limit = 20): DealRow[] {
  if (statuses.length === 0) return [];
  const safeLimit = Math.max(1, Math.min(50, Math.trunc(limit)));
  const placeholders = statuses.map(() => "?").join(", ");
  return db.prepare(
    `SELECT * FROM deals WHERE status IN (${placeholders}) ORDER BY deal_id DESC LIMIT ${safeLimit}`
  ).all(...statuses) as unknown as DealRow[];
}

export function getRecentDeals(limit = 20): DealRow[] {
  const safeLimit = Math.max(1, Math.min(50, Math.trunc(limit)));
  return db.prepare(`SELECT * FROM deals ORDER BY deal_id DESC LIMIT ${safeLimit}`)
    .all() as unknown as DealRow[];
}

export interface AdminStats {
  users: number;
  total: number;
  active: number;
  funded: number;
  disputed: number;
  pendingOperations: number;
  completed: number;
  cancelled: number;
  resolved: number;
  lockedUnits: bigint;
}

export function getAdminStats(): AdminStats {
  const userRow = db.prepare(`SELECT COUNT(*) AS count FROM users`).get() as { count: number };
  const rows = db.prepare(`SELECT status, amount_units FROM deals`).all() as unknown as Array<{
    status: DealStatus;
    amount_units: string;
  }>;
  const count = (status: DealStatus) => rows.filter((row) => row.status === status).length;
  const pendingStatuses: DealStatus[] = ["confirm_pending", "cancel_pending", "resolve_pending"];
  const finalStatuses: DealStatus[] = ["completed", "cancelled", "resolved"];
  const lockedStatuses: DealStatus[] = ["funded", "disputed", ...pendingStatuses];
  return {
    users: Number(userRow.count),
    total: rows.length,
    active: rows.filter((row) => !finalStatuses.includes(row.status)).length,
    funded: count("funded"),
    disputed: count("disputed"),
    pendingOperations: rows.filter((row) => pendingStatuses.includes(row.status)).length,
    completed: count("completed"),
    cancelled: count("cancelled"),
    resolved: count("resolved"),
    lockedUnits: rows
      .filter((row) => lockedStatuses.includes(row.status))
      .reduce((sum, row) => sum + BigInt(row.amount_units), 0n),
  };
}

export function countActiveDealsForUser(tgId: number): number {
  const row = db.prepare(
    `SELECT COUNT(*) AS count FROM deals
     WHERE (buyer_tg_id = ? OR seller_tg_id = ? OR creator_tg_id = ?)
       AND status NOT IN ('completed', 'cancelled', 'resolved')`
  ).get(tgId, tgId, tgId) as { count: number };
  return Number(row.count);
}

export function isDealParticipant(deal: DealRow, tgId: number): boolean {
  return deal.buyer_tg_id === tgId || deal.seller_tg_id === tgId || deal.creator_tg_id === tgId;
}
