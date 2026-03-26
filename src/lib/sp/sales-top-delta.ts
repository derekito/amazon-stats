export type SkuDelta = { pct: number | null; fromZero: boolean };

/** Per-SKU units: % when prior window had sales; negative % when units dropped; “fromZero” when prior was 0 and current is positive. */
export function computeUnitsDelta(current: number, prior: number): SkuDelta {
  if (prior > 0) {
    return { pct: ((current - prior) / prior) * 100, fromZero: false };
  }
  if (prior === 0 && current > 0) {
    return { pct: null, fromZero: true };
  }
  if (prior === 0 && current === 0) {
    return { pct: 0, fromZero: false };
  }
  return { pct: null, fromZero: false };
}

/**
 * Per-SKU ordered sales: missing prior $ treated as 0 so declines show negative % (e.g. -100% when prior had sales and current is 0).
 * Both amounts absent → null pct.
 */
export function computeSalesDelta(current: number | null, prior: number | null): SkuDelta {
  if (current == null && prior == null) {
    return { pct: null, fromZero: false };
  }
  const c = current ?? 0;
  const p = prior ?? 0;
  if (p > 0) {
    return { pct: ((c - p) / p) * 100, fromZero: false };
  }
  if (p === 0 && c > 0) {
    return { pct: null, fromZero: true };
  }
  if (p === 0 && c === 0) {
    return { pct: 0, fromZero: false };
  }
  return { pct: null, fromZero: false };
}
