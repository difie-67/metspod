import { Address, fromNano, OpenedContract, TonClient, WalletContractV4, toNano } from "@ton/ton";
import { mnemonicToPrivateKey } from "@ton/crypto";
import { config } from "./config";
import { Escrow } from "../contracts/wrappers/Escrow";

let clientSingleton: TonClient | null = null;
let arbiterSingleton: {
  wallet: OpenedContract<WalletContractV4>;
  sender: ReturnType<OpenedContract<WalletContractV4>["sender"]>;
  address: Address;
} | null = null;
let walletQueue: Promise<void> = Promise.resolve();
let escrowCodeHashCache: string | null = null;

function safeRpcError(error: unknown): string {
  const value = error as { code?: string; message?: string; response?: { status?: number } };
  const status = value?.response?.status;
  const code = value?.code;
  if (status) return `HTTP ${status}`;
  if (code) return code;
  return value?.message || "unknown error";
}

function isRetryableRpcError(error: unknown): boolean {
  const value = error as { code?: string; response?: { status?: number } };
  return ["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EAI_AGAIN"].includes(value?.code || "") ||
    (value?.response?.status !== undefined && value.response.status >= 500);
}

async function rpcRead<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= config.rpcRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryableRpcError(error) || attempt === config.rpcRetries) break;
      await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    }
  }
  throw new Error(`TON RPC недоступен после ${config.rpcRetries} попыток: ${safeRpcError(lastError)}`);
}

function withWalletLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = walletQueue.then(operation, operation);
  walletQueue = result.then(() => undefined, () => undefined);
  return result;
}

export function getClient(): TonClient {
  if (!clientSingleton) {
    clientSingleton = new TonClient({
      endpoint: config.tonEndpoint,
      apiKey: config.tonApiKey || undefined,
      timeout: config.rpcTimeoutMs,
    });
  }
  return clientSingleton;
}

export async function getArbiterWallet() {
  if (arbiterSingleton) return arbiterSingleton;
  const keyPair = await mnemonicToPrivateKey(config.arbiterMnemonic);
  const wallet = WalletContractV4.create({ workchain: 0, publicKey: keyPair.publicKey });
  if (config.expectedServiceWalletAddress) {
    const expected = parseAddress(config.expectedServiceWalletAddress);
    if (!expected) throw new Error("EXPECTED_SERVICE_WALLET_ADDRESS is not a valid TON address");
    if (!wallet.address.equals(expected)) {
      throw new Error(
        `ARBITER_MNEMONIC does not match EXPECTED_SERVICE_WALLET_ADDRESS. Derived V4: ${formatAddress(wallet.address)}`
      );
    }
  }
  const opened = getClient().open(wallet);
  arbiterSingleton = { wallet: opened, sender: opened.sender(keyPair.secretKey), address: wallet.address };
  return arbiterSingleton;
}

export async function getServiceWalletInfo() {
  const arbiter = await getArbiterWallet();
  const state = await rpcRead(() => getClient().getContractState(arbiter.address));
  return { address: arbiter.address, balance: state.balance, state: state.state };
}

export function parseAddress(raw: string): Address | null {
  try { return Address.parse(raw.trim()); } catch { return null; }
}

/** Formats a user-facing address for the selected TON network. */
export function formatAddress(address: Address): string {
  return address.toString({
    bounceable: true,
    testOnly: config.tonNetwork === "testnet",
  });
}

async function makeEscrow(params: { dealId: number; buyer: Address; seller: Address; amountUnits: bigint }) {
  const arbiter = await getArbiterWallet();
  return Escrow.fromInit(
    BigInt(params.dealId), params.buyer, params.seller, arbiter.address,
    Address.parse(config.platformAddress), params.amountUnits, BigInt(config.feeBps)
  );
}

async function waitForSeqno(wallet: OpenedContract<WalletContractV4>, previous: number) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if ((await rpcRead(() => wallet.getSeqno())) > previous) return;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error("Timed out waiting for arbiter wallet transaction");
}

async function sendFromArbiter(
  transferValue: bigint,
  operation: string,
  send: (arbiter: Awaited<ReturnType<typeof getArbiterWallet>>) => Promise<void>
) {
  return withWalletLock(async () => {
    const arbiter = await getArbiterWallet();
    const balance = await rpcRead(() => arbiter.wallet.getBalance());
    const required = transferValue + toNano(config.walletFeeReserveTon);
    if (balance < required) {
      throw new Error(
        `Недостаточно TON на служебном V4-кошельке для операции «${operation}»: ` +
        `баланс ${fromNano(balance)} TON, требуется минимум ${fromNano(required)} TON. ` +
        `Адрес: ${formatAddress(arbiter.address)}`
      );
    }
    const seqno = await rpcRead(() => arbiter.wallet.getSeqno());
    await send(arbiter);
    await waitForSeqno(arbiter.wallet, seqno);
  });
}

async function waitForContract(address: Address) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      if (await isContractActive(address)) return await getDealOnChainState(address);
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error("Escrow-контракт не появился в сети за 90 секунд");
}

export async function isContractActive(address: Address): Promise<boolean> {
  return (await rpcRead(() => getClient().getContractState(address))).state === "active";
}

export async function computeEscrowAddress(params: { dealId: number; buyer: Address; seller: Address; amountUnits: bigint }) {
  return (await makeEscrow(params)).address;
}

export async function getEscrowCodeHash(): Promise<string> {
  if (escrowCodeHashCache) return escrowCodeHashCache;
  const arbiter = await getArbiterWallet();
  const sample = await Escrow.fromInit(
    0n,
    arbiter.address,
    arbiter.address,
    arbiter.address,
    Address.parse(config.platformAddress),
    1n,
    BigInt(config.feeBps)
  );
  if (!sample.init) throw new Error("Escrow init code is unavailable");
  escrowCodeHashCache = sample.init.code.hash().toString("hex");
  return escrowCodeHashCache;
}

export async function deployEscrow(params: { dealId: number; buyer: Address; seller: Address; amountUnits: bigint }) {
  const init = await makeEscrow(params);
  const contract = getClient().open(init);
  if (await isContractActive(init.address)) return init.address;

  const deployValue = toNano(config.escrowGasTon);
  await sendFromArbiter(deployValue, "развёртывание escrow", async (arbiter) => {
    await contract.send(
      arbiter.sender,
      { value: deployValue },
      { $$type: "Deploy", queryId: BigInt(params.dealId) }
    );
  });
  await waitForContract(init.address);
  return init.address;
}

function openEscrow(address: Address) { return getClient().open(Escrow.fromAddress(address)); }

export async function getDealOnChainState(address: Address) {
  return rpcRead(() => openEscrow(address).getDealInfo());
}

export async function sendConfirm(address: Address, dealId: number) {
  const value = toNano(config.actionGasTon);
  await sendFromArbiter(value, "подтверждение сделки", async (arbiter) => {
    await openEscrow(address).send(arbiter.sender, { value }, { $$type: "Confirm", dealId: BigInt(dealId) });
  });
}

export async function sendCancel(address: Address, dealId: number) {
  const value = toNano(config.actionGasTon);
  await sendFromArbiter(value, "отмена сделки", async (arbiter) => {
    await openEscrow(address).send(arbiter.sender, { value }, { $$type: "Cancel", dealId: BigInt(dealId) });
  });
}

export async function sendResolve(address: Address, dealId: number, sellerBps: number) {
  const value = toNano(config.actionGasTon);
  await sendFromArbiter(value, "разрешение спора", async (arbiter) => {
    await openEscrow(address).send(
      arbiter.sender, { value },
      { $$type: "Resolve", dealId: BigInt(dealId), sellerBps: BigInt(sellerBps) }
    );
  });
}
