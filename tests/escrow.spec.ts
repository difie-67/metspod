import assert from "node:assert/strict";
import { Blockchain } from "@ton/sandbox";
import { toNano } from "@ton/core";
import { Escrow } from "../contracts/wrappers/Escrow";
import { feeBreakdown } from "../src/fees";

const FEE_BPS = 100n; // 1% service fee
const NETWORK_FEE = toNano("0.11"); // reimburses deploy + action gas

async function setup(id: bigint, amount: bigint) {
  const chain = await Blockchain.create();
  const arbiter = await chain.treasury(`arbiter-${id}`);
  const buyer = await chain.treasury(`buyer-${id}`);
  const seller = await chain.treasury(`seller-${id}`);
  const platform = await chain.treasury(`platform-${id}`);
  const stranger = await chain.treasury(`stranger-${id}`);
  const escrow = chain.openContract(await Escrow.fromInit(
    id, buyer.address, seller.address, arbiter.address, platform.address, amount, FEE_BPS, NETWORK_FEE
  ));
  return { chain, arbiter, buyer, seller, platform, stranger, escrow };
}

// Treasury balances also include tiny storage/forwarding costs, so compare with tolerance.
function near(actual: bigint, expected: bigint, label: string) {
  const diff = actual > expected ? actual - expected : expected - actual;
  assert(diff <= toNano("0.0005"), `${label}: expected ~${expected}, got ${actual}`);
}

function assertAllOk(transactions: Array<{ description: any }>, label: string) {
  for (const tx of transactions) {
    const d = tx.description;
    if (d.type !== "generic") continue;
    assert(d.computePhase.type !== "vm" || d.computePhase.success, `${label}: compute phase failed`);
    assert(!d.actionPhase || d.actionPhase.success, `${label}: action phase failed`);
  }
}

async function testTonDeal() {
  const amount = toNano("2");
  const { chain, arbiter, buyer, seller, platform, stranger, escrow } = await setup(1n, amount);
  const fees = feeBreakdown(amount, 100, NETWORK_FEE);
  assert.equal(fees.serviceFee, toNano("0.02"), "service fee must be exactly 1%");
  assert.equal(fees.total, amount + toNano("0.02") + NETWORK_FEE, "buyer pays amount + 1% + network fee");
  assert.equal(escrow.init?.code.hash().toString("hex").length, 64, "escrow code hash must be available for public verification");

  await escrow.send(arbiter.getSender(), { value: toNano("0.04") }, { $$type: "Deploy", queryId: 1n });
  assert.equal(Number((await escrow.getDealInfo()).state), 0, "deploy gas must not fund a deal");
  assert.equal(await escrow.getTotalDue(), fees.total, "on-chain total due must match the bot calculation");

  await escrow.send(stranger.getSender(), { value: fees.total }, null);
  assert.equal(Number((await escrow.getDealInfo()).state), 0, "a stranger must not fund a deal");
  await escrow.send(buyer.getSender(), { value: amount }, null);
  assert.equal(Number((await escrow.getDealInfo()).state), 0, "amount without fees must not fund a deal");
  await escrow.send(buyer.getSender(), { value: fees.total - 1n }, null);
  assert.equal(Number((await escrow.getDealInfo()).state), 0, "partial payment must not fund a deal");

  await escrow.send(buyer.getSender(), { value: fees.total }, null);
  assert.equal(Number((await escrow.getDealInfo()).state), 1, "exact buyer payment must fund a deal");

  const sellerBefore = await seller.getBalance();
  const platformBefore = await platform.getBalance();
  const arbiterBefore = await arbiter.getBalance();
  const result = await escrow.send(arbiter.getSender(), { value: toNano("0.05") }, { $$type: "Confirm", dealId: 1n });
  assertAllOk(result.transactions as any, "confirm");
  assert.equal(Number((await escrow.getDealInfo()).state), 2, "confirmation must complete a deal");
  const sellerDelta = (await seller.getBalance()) - sellerBefore;
  const platformDelta = (await platform.getBalance()) - platformBefore;
  near(sellerDelta, amount, "seller must receive the full amount");
  near(platformDelta, toNano("0.02"), "platform must receive 1%");
  const arbiterDelta = (await arbiter.getBalance()) - arbiterBefore;
  assert(arbiterDelta > toNano("0.05"), `service wallet must get the network fee back on top of unused gas, got ${arbiterDelta}`);
  assert((await chain.getContract(escrow.address)).balance < toNano("0.02"), "escrow must keep only a tiny storage reserve");
}

async function testFundedCancellation() {
  const amount = toNano("2");
  const { chain, arbiter, buyer, stranger, escrow } = await setup(2n, amount);
  const fees = feeBreakdown(amount, 100, NETWORK_FEE);

  await escrow.send(arbiter.getSender(), { value: toNano("0.04") }, { $$type: "Deploy", queryId: 2n });
  await escrow.send(buyer.getSender(), { value: fees.total }, null);
  assert.equal(Number((await escrow.getDealInfo()).state), 1);

  await escrow.send(stranger.getSender(), { value: toNano("0.05") }, { $$type: "Cancel", dealId: 2n });
  assert.equal(Number((await escrow.getDealInfo()).state), 1, "only the arbiter may cancel");

  const buyerBefore = await buyer.getBalance();
  const result = await escrow.send(arbiter.getSender(), { value: toNano("0.05") }, { $$type: "Cancel", dealId: 2n });
  assertAllOk(result.transactions as any, "cancel");
  assert.equal(Number((await escrow.getDealInfo()).state), 3, "cancel must finalize the contract");
  const refund = (await buyer.getBalance()) - buyerBefore;
  near(refund, amount + fees.serviceFee, "buyer must get amount + service fee back");
  assert((await chain.getContract(escrow.address)).balance < toNano("0.02"), "network fee and unused gas must go to the service wallet");
}

async function testUnfundedCancellation() {
  const amount = toNano("1");
  const { chain, arbiter, escrow } = await setup(3n, amount);
  await escrow.send(arbiter.getSender(), { value: toNano("0.04") }, { $$type: "Deploy", queryId: 3n });
  await escrow.send(arbiter.getSender(), { value: toNano("0.05") }, { $$type: "Cancel", dealId: 3n });
  assert.equal(Number((await escrow.getDealInfo()).state), 3, "unfunded deal can be cancelled");
  assert((await chain.getContract(escrow.address)).balance < toNano("0.02"));
}

async function testResolve() {
  const amount = toNano("4");
  const { chain, arbiter, buyer, seller, platform, escrow } = await setup(4n, amount);
  const fees = feeBreakdown(amount, 100, NETWORK_FEE);
  await escrow.send(arbiter.getSender(), { value: toNano("0.04") }, { $$type: "Deploy", queryId: 4n });
  await escrow.send(buyer.getSender(), { value: fees.total }, null);

  const sellerBefore = await seller.getBalance();
  const buyerBefore = await buyer.getBalance();
  const platformBefore = await platform.getBalance();
  const result = await escrow.send(arbiter.getSender(), { value: toNano("0.05") }, { $$type: "Resolve", dealId: 4n, sellerBps: 2500n });
  assertAllOk(result.transactions as any, "resolve");
  assert.equal(Number((await escrow.getDealInfo()).state), 4);
  near((await seller.getBalance()) - sellerBefore, toNano("1"), "seller gets 25% of the amount");
  near((await buyer.getBalance()) - buyerBefore, toNano("3"), "buyer gets the other 75% of the amount");
  near((await platform.getBalance()) - platformBefore, fees.serviceFee, "platform keeps the 1% service fee");
  assert((await chain.getContract(escrow.address)).balance < toNano("0.02"));
}

async function main() {
  await testTonDeal();
  await testFundedCancellation();
  await testUnfundedCancellation();
  await testResolve();
  console.log("Escrow contract tests passed");
}

main().catch((error) => { console.error(error); process.exit(1); });
