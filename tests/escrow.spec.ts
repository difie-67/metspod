import assert from "node:assert/strict";
import { Blockchain } from "@ton/sandbox";
import { toNano } from "@ton/core";
import { Escrow } from "../contracts/wrappers/Escrow";

async function testTonDeal() {
  const chain = await Blockchain.create();
  const arbiter = await chain.treasury("arbiter");
  const buyer = await chain.treasury("buyer");
  const seller = await chain.treasury("seller");
  const platform = await chain.treasury("platform");
  const stranger = await chain.treasury("stranger");
  const amount = toNano("2");

  const escrow = chain.openContract(await Escrow.fromInit(
    1n,
    buyer.address,
    seller.address,
    arbiter.address,
    platform.address,
    amount,
    200n
  ));
  assert.equal(escrow.init?.code.hash().toString("hex").length, 64, "escrow code hash must be available for public verification");

  await escrow.send(arbiter.getSender(), { value: toNano("0.04") }, { $$type: "Deploy", queryId: 1n });
  assert.equal(Number((await escrow.getDealInfo()).state), 0, "deploy gas must not fund a deal");

  await escrow.send(stranger.getSender(), { value: amount }, null);
  assert.equal(Number((await escrow.getDealInfo()).state), 0, "a stranger must not fund a deal");

  await escrow.send(buyer.getSender(), { value: toNano("1") }, null);
  assert.equal(Number((await escrow.getDealInfo()).state), 0, "partial payment must not fund a deal");

  await escrow.send(buyer.getSender(), { value: amount }, null);
  assert.equal(Number((await escrow.getDealInfo()).state), 1, "exact buyer payment must fund a deal");

  const sellerBefore = await seller.getBalance();
  const platformBefore = await platform.getBalance();
  await escrow.send(arbiter.getSender(), { value: toNano("0.05") }, { $$type: "Confirm", dealId: 1n });
  assert.equal(Number((await escrow.getDealInfo()).state), 2, "confirmation must complete a deal");
  const sellerDelta = (await seller.getBalance()) - sellerBefore;
  const platformDelta = (await platform.getBalance()) - platformBefore;
  assert(sellerDelta <= toNano("1.96") && sellerDelta > toNano("1.959"), "seller transfer must be 98% minus network storage fees");
  assert(platformDelta <= toNano("0.04") && platformDelta > toNano("0.039"), "platform transfer must be 2% minus network storage fees");
  const escrowBalance = (await chain.getContract(escrow.address)).balance;
  assert(escrowBalance < toNano("0.02"), "unused gas reserve must be returned to the service wallet");
}

async function testFundedCancellation() {
  const chain = await Blockchain.create();
  const arbiter = await chain.treasury("cancel-arbiter");
  const buyer = await chain.treasury("cancel-buyer");
  const seller = await chain.treasury("cancel-seller");
  const platform = await chain.treasury("cancel-platform");
  const stranger = await chain.treasury("cancel-stranger");
  const amount = toNano("2");
  const escrow = chain.openContract(await Escrow.fromInit(
    2n, buyer.address, seller.address, arbiter.address, platform.address, amount, 200n
  ));

  await escrow.send(arbiter.getSender(), { value: toNano("0.04") }, { $$type: "Deploy", queryId: 2n });
  await escrow.send(buyer.getSender(), { value: amount }, null);
  assert.equal(Number((await escrow.getDealInfo()).state), 1);

  await escrow.send(stranger.getSender(), { value: toNano("0.05") }, { $$type: "Cancel", dealId: 2n });
  assert.equal(Number((await escrow.getDealInfo()).state), 1, "only the arbiter may cancel");

  const buyerBefore = await buyer.getBalance();
  await escrow.send(arbiter.getSender(), { value: toNano("0.05") }, { $$type: "Cancel", dealId: 2n });
  assert.equal(Number((await escrow.getDealInfo()).state), 3, "cancel must finalize the contract");
  assert((await buyer.getBalance()) - buyerBefore > toNano("1.99"), "funded cancellation must refund the buyer");
  assert((await chain.getContract(escrow.address)).balance < toNano("0.02"), "unused action gas must return to arbiter");
}

async function testBuyerPaysFee() {
  const chain = await Blockchain.create();
  const arbiter = await chain.treasury("buyer-fee-arbiter");
  const buyer = await chain.treasury("buyer-fee-buyer");
  const seller = await chain.treasury("buyer-fee-seller");
  const platform = await chain.treasury("buyer-fee-platform");
  const amount = toNano("2");
  const fee = toNano("0.04");
  const payment = amount + fee;
  const escrow = chain.openContract(await Escrow.fromInit(
    3n, buyer.address, seller.address, arbiter.address, platform.address, amount, 32768n + 200n
  ));

  await escrow.send(arbiter.getSender(), { value: toNano("0.04") }, { $$type: "Deploy", queryId: 3n });
  await escrow.send(buyer.getSender(), { value: amount }, null);
  assert.equal(Number((await escrow.getDealInfo()).state), 0, "principal without buyer fee must not fund a buyer-pays deal");
  await escrow.send(buyer.getSender(), { value: payment }, null);
  assert.equal(Number((await escrow.getDealInfo()).state), 1, "principal plus fee must fund a buyer-pays deal");

  const sellerBefore = await seller.getBalance();
  const platformBefore = await platform.getBalance();
  await escrow.send(arbiter.getSender(), { value: toNano("0.05") }, { $$type: "Confirm", dealId: 3n });
  const sellerDelta = (await seller.getBalance()) - sellerBefore;
  const platformDelta = (await platform.getBalance()) - platformBefore;
  assert(sellerDelta <= amount && sellerDelta > toNano("1.999"), "seller must receive the full principal when buyer pays the fee");
  assert(platformDelta <= fee && platformDelta > toNano("0.039"), "platform must receive the buyer-paid fee");
}

async function testBuyerPaysFeeCancellation() {
  const chain = await Blockchain.create();
  const arbiter = await chain.treasury("buyer-fee-cancel-arbiter");
  const buyer = await chain.treasury("buyer-fee-cancel-buyer");
  const seller = await chain.treasury("buyer-fee-cancel-seller");
  const platform = await chain.treasury("buyer-fee-cancel-platform");
  const payment = toNano("2.04");
  const escrow = chain.openContract(await Escrow.fromInit(
    4n, buyer.address, seller.address, arbiter.address, platform.address, toNano("2"), 32768n + 200n
  ));
  await escrow.send(arbiter.getSender(), { value: toNano("0.04") }, { $$type: "Deploy", queryId: 4n });
  await escrow.send(buyer.getSender(), { value: payment }, null);
  const buyerBefore = await buyer.getBalance();
  await escrow.send(arbiter.getSender(), { value: toNano("0.05") }, { $$type: "Cancel", dealId: 4n });
  assert((await buyer.getBalance()) - buyerBefore > toNano("2.03"), "cancellation must refund principal and buyer-paid fee");
}

async function testBuyerPaysFeeDisputeSplit() {
  const chain = await Blockchain.create();
  const arbiter = await chain.treasury("buyer-fee-resolve-arbiter");
  const buyer = await chain.treasury("buyer-fee-resolve-buyer");
  const seller = await chain.treasury("buyer-fee-resolve-seller");
  const platform = await chain.treasury("buyer-fee-resolve-platform");
  const escrow = chain.openContract(await Escrow.fromInit(
    5n, buyer.address, seller.address, arbiter.address, platform.address, toNano("2"), 32768n + 200n
  ));
  await escrow.send(arbiter.getSender(), { value: toNano("0.04") }, { $$type: "Deploy", queryId: 5n });
  await escrow.send(buyer.getSender(), { value: toNano("2.04") }, null);
  const buyerBefore = await buyer.getBalance();
  const sellerBefore = await seller.getBalance();
  const platformBefore = await platform.getBalance();
  await escrow.send(arbiter.getSender(), { value: toNano("0.05") }, { $$type: "Resolve", dealId: 5n, sellerBps: 5000n });
  assert((await seller.getBalance()) - sellerBefore > toNano("0.999"), "50% of principal must go to seller");
  assert((await buyer.getBalance()) - buyerBefore > toNano("0.999"), "50% of principal must return to buyer");
  assert((await platform.getBalance()) - platformBefore > toNano("0.039"), "buyer-paid fee must stay outside the dispute split");
}

async function main() {
  await testTonDeal();
  await testFundedCancellation();
  await testBuyerPaysFee();
  await testBuyerPaysFeeCancellation();
  await testBuyerPaysFeeDisputeSplit();
  console.log("Escrow contract tests passed");
}

void main();
