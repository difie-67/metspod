import "dotenv/config";
import path from "path";
import { parseTonAmount } from "./amounts";
import { toNano } from "@ton/core";

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(`Missing required env var: ${name}. Check your .env file (see .env.example).`);
  }
  return v.trim();
}

const tonNetwork = process.env.TON_NETWORK || "testnet";
if (tonNetwork !== "testnet" && tonNetwork !== "mainnet") {
  throw new Error("TON_NETWORK must be either testnet or mainnet");
}

const defaultEndpoint = tonNetwork === "mainnet"
  ? "https://toncenter.com/api/v2/jsonRPC"
  : "https://testnet.toncenter.com/api/v2/jsonRPC";
const tonEndpoint = (process.env.TON_ENDPOINT || defaultEndpoint).trim();

function publicHttpsUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/, "");
  if (!normalized) return "";
  return /^https?:\/\//i.test(normalized) ? normalized : `https://${normalized}`;
}

// On Railway its generated domain is the canonical Mini App address. This
// intentionally takes precedence over MINI_APP_URL so a stale local/ngrok URL
// can never be published back to Telegram after a production redeploy.
const railwayPublicDomain = publicHttpsUrl(process.env.RAILWAY_PUBLIC_DOMAIN || process.env.RAILWAY_STATIC_URL || "");
const isTunnelUrl = (url: string) => /ngrok|localtunnel|loca\.lt|trycloudflare/i.test(url);
const envMiniAppUrl = publicHttpsUrl(process.env.MINI_APP_URL || "");
if (envMiniAppUrl && isTunnelUrl(envMiniAppUrl)) {
  console.warn(`MINI_APP_URL points to a development tunnel (${envMiniAppUrl}); ignoring it. Set it to your Railway domain or remove it.`);
}
const miniAppUrl = railwayPublicDomain || (isTunnelUrl(envMiniAppUrl) ? "" : envMiniAppUrl);

if (tonNetwork === "mainnet" && /testnet/i.test(tonEndpoint)) {
  throw new Error("TON_NETWORK=mainnet cannot use a testnet TON_ENDPOINT");
}
if (tonNetwork === "testnet" && !/testnet/i.test(tonEndpoint)) {
  throw new Error("TON_NETWORK=testnet requires a testnet TON_ENDPOINT");
}

export const config = {
  botToken: required("BOT_TOKEN"),

  arbiterTgIds: required("ARBITER_TG_IDS")
    .split(/[\s,;]+/)
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isSafeInteger(n) && n > 0),

  tonNetwork: tonNetwork as "testnet" | "mainnet",
  tonEndpoint,
  tonApiKey: process.env.TON_API_KEY || "",

  arbiterMnemonic: required("ARBITER_MNEMONIC").split(/\s+/),
  expectedServiceWalletAddress: (process.env.EXPECTED_SERVICE_WALLET_ADDRESS || "").trim(),

  platformAddress: required("PLATFORM_ADDRESS").trim(),
  // Legacy default used only when reading extremely old rows without frozen
  // fee_bps. New deals calculate fee_bps from the tier grid in src/fees.ts.
  feeBps: Number(process.env.FEE_BPS || "130"),
  // Real TON gas is charged by the blockchain, not by the platform. We freeze
  // a single user-facing reimbursement amount so both sides always know it in advance.
  escrowGasTon: process.env.ESCROW_GAS_TON || "0.02",
  actionGasTon: process.env.ACTION_GAS_TON || "0.03",
  walletFeeReserveTon: process.env.WALLET_FEE_RESERVE_TON || "0.01",
  // Fixed gas reimbursement shown in UI and frozen into every new deal.
  networkFeeTon: (process.env.NETWORK_FEE_TON || "0.06").trim(),
  rpcTimeoutMs: Number(process.env.RPC_TIMEOUT_MS || "12000"),
  rpcRetries: Number(process.env.RPC_RETRIES || "3"),

  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS || "20000"),

  minDealTon: process.env.MIN_DEAL_TON || "0.01",
  maxDealTon: process.env.MAX_DEAL_TON || "100",
  maxActiveDealsPerUser: Number(process.env.MAX_ACTIVE_DEALS_PER_USER || "10"),

  miniAppUrl,
  // Railway injects PORT dynamically. MINI_APP_PORT remains useful locally.
  miniAppPort: Number(process.env.PORT || process.env.MINI_APP_PORT || "3000"),
  miniAppAuthMaxAgeSeconds: Number(process.env.MINI_APP_AUTH_MAX_AGE_SECONDS || "86400"),
  supportUsername: (process.env.SUPPORT_USERNAME || "admssupport_bot").trim().replace(/^@/, ""),

  dbPath: process.env.DB_PATH || path.join(__dirname, "..", "data", "escrow.sqlite"),

  // TON Verifier (verifier.ton.org) confirms the escrow contract's published
  // source compiles to exactly the bytecode deployed on-chain. Override via
  // env if the arbiter/service wallet address changes.
  // Contract v2 has different bytecode. Do not reuse the old verifier link;
  // publish VERIFIER_URL_V2 only after the new code is verified.
  verifierUrl: (process.env.VERIFIER_URL_V2 || "").trim(),
  gasInfoUrl: (process.env.GAS_INFO_URL || "https://docs.ton.org/contracts/techniques/gas").trim(),
};

if (!Number.isInteger(config.feeBps) || config.feeBps < 0 || config.feeBps > 10000) {
  throw new Error("FEE_BPS must be an integer between 0 and 10000");
}

if (config.arbiterTgIds.length === 0) {
  throw new Error("ARBITER_TG_IDS must contain at least one numeric Telegram id");
}
if (config.arbiterMnemonic.length !== 24) {
  throw new Error("ARBITER_MNEMONIC must contain exactly 24 words");
}
if (!Number.isInteger(config.rpcTimeoutMs) || config.rpcTimeoutMs < 3000 || config.rpcTimeoutMs > 60000) {
  throw new Error("RPC_TIMEOUT_MS must be an integer between 3000 and 60000");
}
if (!Number.isInteger(config.rpcRetries) || config.rpcRetries < 1 || config.rpcRetries > 5) {
  throw new Error("RPC_RETRIES must be an integer between 1 and 5");
}

/** Network fee (nanotons) that is frozen into every new deal. */
export const networkFeeUnits: bigint = config.networkFeeTon
  ? parseTonAmount(config.networkFeeTon)
  : toNano(config.escrowGasTon) + toNano(config.actionGasTon) + toNano(config.walletFeeReserveTon);

if (networkFeeUnits < 0n || networkFeeUnits > 5_000_000_000n) {
  throw new Error("NETWORK_FEE_TON must be between 0 and 5 TON");
}
export const dealLimits = {
  minUnits: parseTonAmount(config.minDealTon),
  maxUnits: parseTonAmount(config.maxDealTon),
};

if (dealLimits.minUnits > dealLimits.maxUnits) {
  throw new Error("MIN_DEAL_TON cannot be greater than MAX_DEAL_TON");
}
if (!Number.isInteger(config.maxActiveDealsPerUser) || config.maxActiveDealsPerUser < 1 || config.maxActiveDealsPerUser > 100) {
  throw new Error("MAX_ACTIVE_DEALS_PER_USER must be an integer between 1 and 100");
}
if (!Number.isInteger(config.miniAppPort) || config.miniAppPort < 1 || config.miniAppPort > 65535) {
  throw new Error("MINI_APP_PORT must be an integer between 1 and 65535");
}
if (!Number.isInteger(config.miniAppAuthMaxAgeSeconds) || config.miniAppAuthMaxAgeSeconds < 60) {
  throw new Error("MINI_APP_AUTH_MAX_AGE_SECONDS must be at least 60");
}
if (config.miniAppUrl && !/^https:\/\//i.test(config.miniAppUrl)) {
  throw new Error("MINI_APP_URL must use https:// (leave it empty for local development)");
}
