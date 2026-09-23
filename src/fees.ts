/**
 * Fee model. Whoever pays the amount's `serviceFee` (our commission) is chosen
 * per deal when it is created:
 *
 *   feeFromSeller = false (default) -> buyer pays amount + serviceFee + networkFee,
 *                                       seller receives the full amount
 *   feeFromSeller = true            -> buyer pays amount + networkFee only,
 *                                       seller receives amount - serviceFee
 *
 *   serviceFee   = amount * feeBps / 10000  -> platform commission by tier
 *   networkFee   = deploy + action gas budget, pre-paid by the buyer either way
 *   total        = amount + buyer's surcharge -> exact buyer deposit
 *   sellerPayout = amount - (feeFromSeller ? serviceFee : 0)
 *
 * The configured networkFee is a gas budget / reimbursement. Any balance left
 * after settlement is returned by the contract to the platform address. It is
 * separate from the percentage service fee.
 *
 * This file must not import config, so tests can use it without env vars.
 */
const TON = 1_000_000_000n;

export interface FeeTier {
  key: string;
  minUnits: bigint;
  maxUnitsExclusive: bigint | null;
  feeBps: number;
  title: string;
  shortLabel: string;
}

export const FEE_SCHEDULE: FeeTier[] = [
  {
    key: "lt2",
    minUnits: 0n,
    maxUnitsExclusive: 2n * TON,
    feeBps: 200,
    title: "Сделки меньше 2 TON",
    shortLabel: "до 2 TON",
  },
  {
    key: "2to10",
    minUnits: 2n * TON,
    maxUnitsExclusive: 10n * TON,
    feeBps: 130,
    title: "Сделки от 2 до 10 TON",
    shortLabel: "2–10 TON",
  },
  {
    key: "10to35",
    minUnits: 10n * TON,
    maxUnitsExclusive: 35n * TON,
    feeBps: 90,
    title: "Сделки от 10 до 35 TON",
    shortLabel: "10–35 TON",
  },
  {
    key: "35plus",
    minUnits: 35n * TON,
    maxUnitsExclusive: null,
    feeBps: 60,
    title: "Сделки от 35 TON и выше",
    shortLabel: "от 35 TON",
  },
];

export function formatFeePercent(feeBps: number): string {
  return (feeBps / 100).toFixed(feeBps % 100 === 0 ? 0 : 1);
}

export function feeTierForAmount(amount: bigint, schedule: FeeTier[] = FEE_SCHEDULE): FeeTier {
  const tier = schedule.find((item) => amount >= item.minUnits && (item.maxUnitsExclusive === null || amount < item.maxUnitsExclusive));
  return tier || schedule[schedule.length - 1];
}

export function feeBpsForAmount(amount: bigint, schedule: FeeTier[] = FEE_SCHEDULE): number {
  return feeTierForAmount(amount, schedule).feeBps;
}

export interface FeeBreakdown {
  amount: bigint;
  serviceFee: bigint;
  networkFee: bigint;
  feeFromSeller: boolean;
  /** What the buyer deposits in total. */
  total: bigint;
  /** What the seller actually receives once the deal completes. */
  sellerPayout: bigint;
}

export function feeBreakdown(amount: bigint, feeBps: number | bigint, networkFee: bigint, feeFromSeller = false): FeeBreakdown {
  const serviceFee = (amount * BigInt(feeBps)) / 10000n; // same floor division as the contract
  const buyerSurcharge = (feeFromSeller ? 0n : serviceFee) + networkFee;
  const sellerPayout = amount - (feeFromSeller ? serviceFee : 0n);
  return { amount, serviceFee, networkFee, feeFromSeller, total: amount + buyerSurcharge, sellerPayout };
}

/** Minimal shape of a deal row needed to compute its fees. */
export interface DealFeeTerms {
  amount_units: string;
  fee_bps: number | null;
  fee_from_seller: number | null;
  network_fee_units: string | null;
}

/** Fee terms frozen for a deal; falls back to the given defaults for legacy rows. */
export function dealFees(deal: DealFeeTerms, defaults: { feeBps: number; networkFee: bigint }): FeeBreakdown & { feeBps: number } {
  const feeBps = deal.fee_bps ?? defaults.feeBps;
  const networkFee = deal.network_fee_units !== null ? BigInt(deal.network_fee_units) : defaults.networkFee;
  const feeFromSeller = deal.fee_from_seller === 1;
  return { ...feeBreakdown(BigInt(deal.amount_units), feeBps, networkFee, feeFromSeller), feeBps };
}
