/**
 * Fee model (buyer pays everything on top of the deal amount):
 *
 *   serviceFee = amount * feeBps / 10000          -> platform (our 1%)
 *   networkFee = deploy + action gas budget       -> service wallet
 *   total      = amount + serviceFee + networkFee -> exact buyer deposit
 *
 * The seller always receives exactly `amount`. Whatever the blockchain returns
 * from the gas that was really spent (unused deploy/action gas) also stays with
 * the service wallet, so the wallet refills itself from every deal and no
 * longer depends on manual top-ups to keep deals moving.
 *
 * This file must not import config, so tests can use it without env vars.
 */
export interface FeeBreakdown {
  amount: bigint;
  serviceFee: bigint;
  networkFee: bigint;
  total: bigint;
}

export function feeBreakdown(amount: bigint, feeBps: number | bigint, networkFee: bigint): FeeBreakdown {
  const serviceFee = (amount * BigInt(feeBps)) / 10000n; // same floor division as the contract
  return { amount, serviceFee, networkFee, total: amount + serviceFee + networkFee };
}

/** Minimal shape of a deal row needed to compute its fees. */
export interface DealFeeTerms {
  amount_units: string;
  fee_bps: number | null;
  network_fee_units: string | null;
}

/** Fee terms frozen for a deal; falls back to the given defaults for legacy rows. */
export function dealFees(deal: DealFeeTerms, defaults: { feeBps: number; networkFee: bigint }): FeeBreakdown & { feeBps: number } {
  const feeBps = deal.fee_bps ?? defaults.feeBps;
  const networkFee = deal.network_fee_units !== null ? BigInt(deal.network_fee_units) : defaults.networkFee;
  return { ...feeBreakdown(BigInt(deal.amount_units), feeBps, networkFee), feeBps };
}
