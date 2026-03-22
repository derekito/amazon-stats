/**
 * Rough margin only — not settlement data. Referral % + optional flat FBA per unit sold in window.
 * When `unitCost` is set, margin subtracts `estimatedAdSpend` (account-level ACOS × sales) as well.
 */
export function estimateRoughMargin(input: {
  salesAmount: number;
  quantityOrdered: number;
  unitCost: number | null;
  referralFeePercent: number;
  fbaFlatPerUnit: number;
  /** Allocated ad spend for this SKU in the window (same basis as dashboard ACOS column). */
  estimatedAdSpend: number;
}): {
  estimatedAmazonFees: number;
  estimatedCogs: number | null;
  estimatedMargin: number | null;
  estimatedMarginPercent: number | null;
} {
  const referral = input.salesAmount * (input.referralFeePercent / 100);
  const fba = input.fbaFlatPerUnit * input.quantityOrdered;
  const fees = Math.round((referral + fba) * 100) / 100;

  if (input.unitCost == null) {
    return {
      estimatedAmazonFees: fees,
      estimatedCogs: null,
      estimatedMargin: null,
      estimatedMarginPercent: null,
    };
  }

  const cogs = Math.round(input.unitCost * input.quantityOrdered * 100) / 100;
  const ads = Math.round(input.estimatedAdSpend * 100) / 100;
  const margin = Math.round((input.salesAmount - fees - cogs - ads) * 100) / 100;
  const pct =
    input.salesAmount > 0
      ? Math.round((margin / input.salesAmount) * 1000) / 10
      : null;

  return {
    estimatedAmazonFees: fees,
    estimatedCogs: cogs,
    estimatedMargin: margin,
    estimatedMarginPercent: pct,
  };
}
