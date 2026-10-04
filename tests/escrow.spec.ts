import assert from "node:assert/strict";
import { Blockchain } from "@ton/sandbox";
import { toNano } from "@ton/core";
import { Escrow } from "../contracts/wrappers/Escrow";
import { feeBpsForAmount, feeBreakdown } from "../src/fees";

const FEE_BPS = 100n; // 1% service fee
const NETWORK_FEE = toNano("0.06"); // fixed gas reimbursement shown to users

async function setup(id: bigint, amount: bigint, feeFromSeller = false) {
  const chain = await Blockchain.create();
  const arbiter = await chain.treasury(`arbiter-${id}`);
  const buyer = await chain.treasury(`buyer-${id}`);
  const seller = await chain.treasury(`seller-${id}`);
  const platform = await chain.treasury(`platform-${id}`);
  const stranger = await chain.treasury(`stranger-${id}`);
  const escrow = chain.openContract(await Escrow.fromInit(
    id, buyer.address, seller.address, arbiter.address, platform.address, amount, FEE_BPS, feeFromSeller, NETWORK_FEE
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

function assertPayment(transactions: any[], from: any, to: any, amount: bigint) {
  const transfers = transactions.filter(tx => tx.inMessage?.info?.type === "internal" &&
    tx.inMessage.info.src.equals(from) && tx.inMessage.info.dest.equals(to));
  assert.equal(transfers.length, 1, "recipient must receive one escrow transfer");
  assert.equal(transfers[0].inMessage.info.value.coins, amount, "escrow must send the exact agreed payout");
}

async function testTonDeal() {
  const amount = toNano("2");
  const { chain, arbiter, buyer, seller, platform, stranger, escrow } = await setup(1n, amount);
  const fees = feeBreakdown(amount, 100, NETWORK_FEE);
  assert.equal(fees.serviceFee, toNano("0.02"), "service fee must be exactly 1%");
  assert.equal(fees.total, amount + toNano("0.02") + NETWORK_FEE, "buyer pays amount + 1% + network fee");
  assert.equal(escrow.init?.code.hash().toString("hex").length, 64, "escrow code hash must be available for public verification");

  await escrow.send(arbiter.getSender(), { value: toNano("0.025") }, { $$type: "Deploy", queryId: 1n });
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
  const result = await escrow.send(arbiter.getSender(), { value: toNano("0.02") }, { $$type: "Confirm", dealId: 1n });
  assertAllOk(result.transactions as any, "confirm");
  assert.equal(Number((await escrow.getDealInfo()).state), 2, "confirmation must complete a deal");
  const sellerDelta = (await seller.getBalance()) - sellerBefore;
  const platformDelta = (await platform.getBalance()) - platformBefore;
  // Wallet balance changes include recipient storage/compute fees; verify the transfer itself exactly.
  assertPayment(result.transactions as any, escrow.address, seller.address, amount);
  assertPayment(result.transactions as any, escrow.address, platform.address, fees.serviceFee);
  near(sellerDelta, amount, "seller balance after receipt");
  near(platformDelta, fees.serviceFee, "platform gets the service fee; gas excess goes to the arbiter");
  assert((await chain.getContract(escrow.address)).balance < toNano("0.02"), "escrow must keep a tiny storage reserve");
}
async function testFundedCancellation() {
  const amount = toNano("2");
  const { chain, arbiter, buyer, stranger, escrow } = await setup(2n, amount);
  const fees = feeBreakdown(amount, 100, NETWORK_FEE);

  await escrow.send(arbiter.getSender(), { value: toNano("0.025") }, { $$type: "Deploy", queryId: 2n });
  await escrow.send(buyer.getSender(), { value: fees.total }, null);
  assert.equal(Number((await escrow.getDealInfo()).state), 1);

  await escrow.send(stranger.getSender(), { value: toNano("0.02") }, { $$type: "Cancel", dealId: 2n });
  assert.equal(Number((await escrow.getDealInfo()).state), 1, "only the arbiter may cancel");

  const buyerBefore = await buyer.getBalance();
  const result = await escrow.send(arbiter.getSender(), { value: toNano("0.02") }, { $$type: "Cancel", dealId: 2n });
  assertAllOk(result.transactions as any, "cancel");
  assert.equal(Number((await escrow.getDealInfo()).state), 3, "cancel must finalize the contract");
  const refund = (await buyer.getBalance()) - buyerBefore;
  near(refund, amount + fees.serviceFee, "buyer must get amount + service fee back");
  assert((await chain.getContract(escrow.address)).balance < toNano("0.02"), "escrow must keep only a tiny storage reserve");
}

async function testUnfundedCancellation() {
  const amount = toNano("1");
  const { chain, arbiter, escrow } = await setup(3n, amount);
  await escrow.send(arbiter.getSender(), { value: toNano("0.025") }, { $$type: "Deploy", queryId: 3n });
  await escrow.send(arbiter.getSender(), { value: toNano("0.02") }, { $$type: "Cancel", dealId: 3n });
  assert.equal(Number((await escrow.getDealInfo()).state), 3, "unfunded deal can be cancelled");
  assert((await chain.getContract(escrow.address)).balance < toNano("0.02"));
}

async function testResolve() {
  const amount = toNano("4");
  const { chain, arbiter, buyer, seller, platform, escrow } = await setup(4n, amount);
  const fees = feeBreakdown(amount, 100, NETWORK_FEE);
  await escrow.send(arbiter.getSender(), { value: toNano("0.025") }, { $$type: "Deploy", queryId: 4n });
  await escrow.send(buyer.getSender(), { value: fees.total }, null);

  const sellerBefore = await seller.getBalance();
  const buyerBefore = await buyer.getBalance();
  const platformBefore = await platform.getBalance();
  const result = await escrow.send(arbiter.getSender(), { value: toNano("0.02") }, { $$type: "Resolve", dealId: 4n, sellerBps: 2500n });
  assertAllOk(result.transactions as any, "resolve");
  assert.equal(Number((await escrow.getDealInfo()).state), 4);
  const sellerDelta = (await seller.getBalance()) - sellerBefore;
  assertPayment(result.transactions as any, escrow.address, seller.address, toNano("1"));
  near(sellerDelta, toNano("1"), "seller gets 25% of the agreed price");
  near((await buyer.getBalance()) - buyerBefore, toNano("3"), "buyer gets the other 75% of the amount");
  near((await platform.getBalance()) - platformBefore, fees.serviceFee, "platform keeps the 1% service fee");
  assert((await chain.getContract(escrow.address)).balance < toNano("0.02"));
}

async function testFeeFromSeller() {
  const amount = toNano("2");
  const { chain, arbiter, buyer, seller, platform, escrow } = await setup(5n, amount, true);
  const fees = feeBreakdown(amount, 100, NETWORK_FEE, true);
  assert.equal(fees.total, amount + NETWORK_FEE, "buyer pays amount + network fee only, no service fee on top");
  assert.equal(fees.sellerPayout, amount - fees.serviceFee, "seller payout must be amount minus the 1% service fee");

  await escrow.send(arbiter.getSender(), { value: toNano("0.025") }, { $$type: "Deploy", queryId: 5n });
  assert.equal(await escrow.getTotalDue(), fees.total, "on-chain total due must match feeFromSeller pricing");
  await escrow.send(buyer.getSender(), { value: fees.total - 1n }, null);
  assert.equal(Number((await escrow.getDealInfo()).state), 0, "partial payment must not fund a deal");
  await escrow.send(buyer.getSender(), { value: fees.total }, null);
  assert.equal(Number((await escrow.getDealInfo()).state), 1, "exact buyer payment must fund a deal");

  const sellerBefore = await seller.getBalance();
  const platformBefore = await platform.getBalance();
  const result = await escrow.send(arbiter.getSender(), { value: toNano("0.02") }, { $$type: "Confirm", dealId: 5n });
  assertAllOk(result.transactions as any, "confirm (feeFromSeller)");
  assert.equal(Number((await escrow.getDealInfo()).state), 2);
  const sellerDelta = (await seller.getBalance()) - sellerBefore;
  const platformDelta = (await platform.getBalance()) - platformBefore;
  assertPayment(result.transactions as any, escrow.address, seller.address, fees.sellerPayout);
  near(sellerDelta, fees.sellerPayout, "seller gets price minus fee");
  near(platformDelta, fees.serviceFee, "platform must still receive the full 1% fee");
  assert((await chain.getContract(escrow.address)).balance < toNano("0.02"));
}

function testFeeThresholdRule() {
  assert.equal(feeBpsForAmount(toNano("0.01")), 200);
  assert.equal(feeBpsForAmount(toNano("1.999999999")), 200);
  assert.equal(feeBpsForAmount(toNano("2")), 130);
  assert.equal(feeBpsForAmount(toNano("9.999999999")), 130);
  assert.equal(feeBpsForAmount(toNano("10")), 90);
  assert.equal(feeBpsForAmount(toNano("34.999999999")), 90);
  assert.equal(feeBpsForAmount(toNano("35")), 60);
}

async function testCancelWithInitRejectsLateDeposit() {
  const { arbiter, buyer, escrow } = await setup(6n, toNano("2"));
  // Exactly the init+Cancel used by the arbiter when an unpaid listing's address was already issued.
  const cancelled = await escrow.send(arbiter.getSender(), { value: toNano("0.05") }, { $$type: "Cancel", dealId: 6n });
  assertAllOk(cancelled.transactions as any, "init+cancel");
  assert.equal(Number((await escrow.getDealInfo()).state), 3, "unpaid escrow must deploy as cancelled");
  await escrow.send(buyer.getSender(), { value: feeBreakdown(toNano("2"), 100, NETWORK_FEE).total }, null);
  assert.equal(Number((await escrow.getDealInfo()).state), 3, "a late deposit must not reopen a cancelled listing escrow");
}

async function main() {
  testFeeThresholdRule();
  await testCancelWithInitRejectsLateDeposit();
  await testTonDeal();
  await testFundedCancellation();
  await testUnfundedCancellation();
  await testResolve();
  await testFeeFromSeller();
  console.log("Escrow contract tests passed");
}

main().catch((error) => { console.error(error); process.exit(1); });
