import "dotenv/config";
import path from "path";
import { parseTonAmount } from "./amounts";

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
  feeBps: Number(process.env.FEE_BPS || "200"),
  escrowGasTon: process.env.ESCROW_GAS_TON || "0.04",
  actionGasTon: process.env.ACTION_GAS_TON || "0.05",
  walletFeeReserveTon: process.env.WALLET_FEE_RESERVE_TON || "0.02",
  rpcTimeoutMs: Number(process.env.RPC_TIMEOUT_MS || "12000"),
  rpcRetries: Number(process.env.RPC_RETRIES || "3"),

  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS || "20000"),

  minDealTon: process.env.MIN_DEAL_TON || "0.01",
  maxDealTon: process.env.MAX_DEAL_TON || "100",
  maxActiveDealsPerUser: Number(process.env.MAX_ACTIVE_DEALS_PER_USER || "10"),

  miniAppUrl: (process.env.MINI_APP_URL || "").trim().replace(/\/$/, ""),
  miniAppPort: Number(process.env.MINI_APP_PORT || "3000"),
  miniAppAuthMaxAgeSeconds: Number(process.env.MINI_APP_AUTH_MAX_AGE_SECONDS || "86400"),
  supportUsername: (process.env.SUPPORT_USERNAME || "admssupport_bot").trim().replace(/^@/, ""),

  dbPath: process.env.DB_PATH || path.join(__dirname, "..", "data", "escrow.sqlite"),
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
