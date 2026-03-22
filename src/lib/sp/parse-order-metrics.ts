/**
 * getOrderMetrics returns `payload` as an **array** of intervals (see OrderMetricsList in sales.json).
 * The `amazon-sp-api` client unwraps `payload`, so we often receive a bare array — not `{ orderMetrics }`.
 * 204 → client yields `{ success: true }`.
 */
export type OrderMetricRow = {
  interval?: string;
  unitCount?: number | string;
};

function readNumericField(row: Record<string, unknown>, ...keys: string[]): number {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return 0;
}

/** Units sold in the interval (handles string decimals / snake_case from some payloads). */
export function metricUnitCount(row: OrderMetricRow): number {
  const r = row as Record<string, unknown>;
  return readNumericField(r, "unitCount", "unit_count");
}

/** Ordered product sales for the interval (`totalSales` on OrderMetricsInterval). */
export function metricTotalSalesFromRow(row: OrderMetricRow): {
  amount: number;
  currencyCode: string;
} | null {
  const r = row as Record<string, unknown>;
  const raw = r.totalSales ?? r.total_sales;
  if (!raw || typeof raw !== "object") return null;
  const o = raw as { amount?: string | number; currencyCode?: string };
  const amt = o.amount;
  const n = typeof amt === "number" ? amt : typeof amt === "string" ? Number(amt) : NaN;
  if (!Number.isFinite(n)) return null;
  const code = typeof o.currencyCode === "string" && o.currencyCode.length ? o.currencyCode : "USD";
  return { amount: n, currencyCode: code };
}

export function parseOrderMetricsPayload(payload: unknown): OrderMetricRow[] {
  if (payload === null || payload === undefined) return [];
  if (Array.isArray(payload)) return payload as OrderMetricRow[];
  if (typeof payload !== "object") return [];
  const p = payload as { orderMetrics?: OrderMetricRow[]; success?: boolean };
  if (p.success === true && !p.orderMetrics) return [];
  if (Array.isArray(p.orderMetrics)) return p.orderMetrics;
  return [];
}

/** Sum units and sales across all rows (aggregate marketplace request). */
export function sumOrderMetricsTotals(rows: OrderMetricRow[]): {
  totalUnits: number;
  totalSalesAmount: number | null;
  totalSalesCurrency: string | null;
} {
  let totalUnits = 0;
  let salesSum = 0;
  let currency: string | null = null;
  let hasSales = false;
  for (const r of rows) {
    totalUnits += metricUnitCount(r);
    const m = metricTotalSalesFromRow(r);
    if (m) {
      hasSales = true;
      salesSum += m.amount;
      currency = currency ?? m.currencyCode;
    }
  }
  return {
    totalUnits,
    totalSalesAmount: hasSales ? salesSum : null,
    totalSalesCurrency: currency,
  };
}
