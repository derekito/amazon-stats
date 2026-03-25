import { parseISO, subDays } from "date-fns";

export type SalesPeriod = "day" | "week" | "month" | "quarter";

/**
 * SP-API Sales `interval`: first date inclusive, second date exclusive (see getOrderMetrics).
 * Use UTC; `granularityTimeZone` must be UTC when the interval uses Z.
 */
export function toSpInterval(startInclusive: Date, endExclusive: Date): string {
  return `${startInclusive.toISOString()}--${endExclusive.toISOString()}`;
}

function utcStartOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

/** Exclusive end for “through end of this UTC day” (next midnight UTC). */
function utcStartOfNextDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0));
}

/**
 * Calendar days between SP-API interval bounds (start inclusive, end exclusive).
 * Used for per-SKU velocity and days-of-cover when granularity is `Total` over that interval.
 */
export function intervalSpanDays(intervalStr: string): number {
  const sep = "--";
  const idx = intervalStr.indexOf(sep);
  if (idx === -1) return 1;
  const start = parseISO(intervalStr.slice(0, idx).trim());
  const end = parseISO(intervalStr.slice(idx + sep.length).trim());
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 1;
  const ms = end.getTime() - start.getTime();
  return Math.max(1, Math.round(ms / 86_400_000));
}

/**
 * Date range + chart granularity for each dashboard tab.
 * Day = one full UTC calendar day (yesterday, complete data).
 * Week / month / quarter = rolling windows aligned with per-SKU `Total` over the same interval.
 */
export function getOrderMetricsRange(period: SalesPeriod, now = new Date()) {
  switch (period) {
    case "day": {
      const start = utcStartOfDay(subDays(now, 1));
      const endExclusive = utcStartOfDay(now);
      return {
        interval: toSpInterval(start, endExclusive),
        granularity: "Day" as const,
        label: "Yesterday (UTC)",
      };
    }
    case "week": {
      const start = utcStartOfDay(subDays(now, 6));
      const endExclusive = utcStartOfNextDay(now);
      return {
        interval: toSpInterval(start, endExclusive),
        granularity: "Day" as const,
        label: "Last 7 days",
      };
    }
    case "month": {
      const start = utcStartOfDay(subDays(now, 29));
      const endExclusive = utcStartOfNextDay(now);
      return {
        interval: toSpInterval(start, endExclusive),
        granularity: "Day" as const,
        label: "Last 30 days",
      };
    }
    case "quarter": {
      const start = utcStartOfDay(subDays(now, 89));
      const endExclusive = utcStartOfNextDay(now);
      return {
        interval: toSpInterval(start, endExclusive),
        granularity: "Week" as const,
        label: "Last 90 days",
      };
    }
  }
}

/**
 * Same length as `getOrderMetricsRange(period)` but shifted immediately before it (for PoP comparison).
 */
/**
 * Rolling **10** UTC calendar days ending “now” (same pattern as Week: start = 9 days back 00:00 UTC,
 * end = start of tomorrow UTC) — for Sales API daily buckets.
 */
export function getTenDayOrderMetricsRange(now = new Date()) {
  const start = utcStartOfDay(subDays(now, 9));
  const endExclusive = utcStartOfNextDay(now);
  return {
    interval: toSpInterval(start, endExclusive),
    granularity: "Day" as const,
    label: "Last 10 days",
  };
}

/** The 10-day window immediately before `getTenDayOrderMetricsRange` (for PoP comparison). */
export function getPriorTenDayRange(now = new Date()) {
  const current = getTenDayOrderMetricsRange(now);
  const sep = "--";
  const idx = current.interval.indexOf(sep);
  const startStr = current.interval.slice(0, idx).trim();
  const endStr = current.interval.slice(idx + sep.length).trim();
  const start = parseISO(startStr);
  const endExclusive = parseISO(endStr);
  if (Number.isNaN(start.getTime()) || Number.isNaN(endExclusive.getTime())) {
    return current;
  }
  const priorEndExclusive = start;
  const priorStartInclusive = new Date(priorEndExclusive.getTime() - (endExclusive.getTime() - start.getTime()));
  return {
    interval: toSpInterval(priorStartInclusive, priorEndExclusive),
    granularity: "Day" as const,
    label: "Prior 10 days",
  };
}

export function getPriorOrderMetricsRange(period: SalesPeriod, now = new Date()) {
  const current = getOrderMetricsRange(period, now);
  const sep = "--";
  const idx = current.interval.indexOf(sep);
  const startStr = current.interval.slice(0, idx).trim();
  const endStr = current.interval.slice(idx + sep.length).trim();
  const start = parseISO(startStr);
  const endExclusive = parseISO(endStr);
  if (Number.isNaN(start.getTime()) || Number.isNaN(endExclusive.getTime())) {
    return current;
  }
  const priorEndExclusive = start;
  const priorStartInclusive = new Date(priorEndExclusive.getTime() - (endExclusive.getTime() - start.getTime()));
  return {
    interval: toSpInterval(priorStartInclusive, priorEndExclusive),
    granularity: current.granularity,
    label: `Prior ${current.label}`,
  };
}
