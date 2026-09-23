import fs from "fs";
import path from "path";
import crypto from "crypto";
import { APP_BUILD_ID } from "./version";
import { config } from "./config";
import { getRuntimeLogs } from "./logger";
import { formatAddress, getEscrowCodeHash, getServiceWalletInfo } from "./ton";

const STARTED_AT = new Date().toISOString();

function fileCandidatePaths(relativePath: string): string[] {
  return [
    path.resolve(process.cwd(), relativePath),
    path.resolve(__dirname, "..", relativePath),
    path.resolve(__dirname, "..", "..", relativePath),
  ];
}

function findExistingFile(relativePath: string): string | null {
  for (const candidate of fileCandidatePaths(relativePath)) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function sha256File(relativePath: string): string | null {
  const found = findExistingFile(relativePath);
  if (!found) return null;
  const buffer = fs.readFileSync(found);
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function shortHash(value: string | null): string {
  return value ? `${value.slice(0, 12)}…${value.slice(-10)}` : "—";
}

function readBuildNotes(): string | null {
  const found = findExistingFile("BUILD_VERSION.txt");
  if (!found) return null;
  return fs.readFileSync(found, "utf-8").trim();
}

export async function getAdminDiagnostics() {
  const service = await getServiceWalletInfo();
  const serviceAddress = formatAddress(service.address);
  const tonviewer = `https://${config.tonNetwork === "testnet" ? "testnet.tonviewer.com" : "tonviewer.com"}/${serviceAddress}`;
  const tonscan = `https://${config.tonNetwork === "testnet" ? "testnet.tonscan.org" : "tonscan.org"}/address/${serviceAddress}`;
  const codeHash = await getEscrowCodeHash();
  const sourceHashes = {
    escrowTact: sha256File("contracts/escrow.tact"),
    wrapperTs: sha256File("contracts/wrappers/Escrow.ts"),
    tactConfig: sha256File("tact.config.json"),
    packageJson: sha256File("package.json"),
  };
  return {
    buildId: APP_BUILD_ID,
    startedAt: STARTED_AT,
    network: config.tonNetwork,
    miniAppUrl: config.miniAppUrl,
    tonEndpoint: config.tonEndpoint,
    supportUsername: config.supportUsername,
    verifierUrl: config.verifierUrl,
    serviceWallet: {
      address: serviceAddress,
      state: service.state,
      balanceTon: (Number(service.balance) / 1e9).toFixed(6).replace(/0+$/, "").replace(/\.$/, ""),
      explorers: { tonviewer, tonscan },
    },
    platformAddress: config.platformAddress,
    contract: {
      codeHash,
      codeHashShort: shortHash(codeHash),
      sourceHashes,
      sourceHashesShort: Object.fromEntries(Object.entries(sourceHashes).map(([k, v]) => [k, shortHash(v)])),
    },
    buildNotes: readBuildNotes(),
    logs: getRuntimeLogs(90),
  };
}
