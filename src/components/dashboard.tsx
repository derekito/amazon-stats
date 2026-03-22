"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { DashboardPayload, ProductAlert, ProductRow } from "@/lib/sp/types";
import type { SalesPeriod } from "@/lib/sp/intervals";

const PERIODS: { id: SalesPeriod; label: string }[] = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "quarter", label: "Quarter" },
];

const CHART_TRACK_PX = 160;

function formatProductSales(amount: number | null, currency: string | null): string {
  if (amount == null || currency == null) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatMarginPercent(p: number | null): string {
  if (p == null) return "—";
  const rounded = Math.round(p * 10) / 10;
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded}%`;
}

function formatAcosPercent(p: number): string {
  const rounded = Math.round(p * 10) / 10;
  return `${rounded}%`;
}

/** Monotonic id so stale fetches (period change, Strict Mode) never leave loading stuck. */
let dashboardFetchSeq = 0;

/**
 * Must exceed server `SP_API_DASHBOARD_TIMEOUT_MS` (max 600s in env). Keep a buffer so the
 * browser doesn’t abort before `/api/dashboard` returns.
 */
const FETCH_TIMEOUT_MS = 630_000;

type SalesFilter = "all" | "withSales" | "withoutSales";

type InsightFilter = "all" | "low_stock" | "slow_mover" | "any_alert" | "replenish";

const TAG_PRESETS = ["core", "test", "liquidate", "seasonal"] as const;
type TagFilter = "all" | (typeof TAG_PRESETS)[number];

const TAG_STORAGE_KEY = "amazon-sales-sku-tags";

type SortKey = keyof Pick<
  ProductRow,
  | "title"
  | "sku"
  | "quantityInStock"
  | "quantityOrdered"
  | "salesAmount"
  | "forecastDaysOfCover"
  | "velocityPerDay"
  | "velocityTier"
  | "unitCost"
  | "estimatedAmazonFees"
  | "estimatedCogs"
  | "estimatedMargin"
  | "estimatedAdSpend"
  | "amazonRecommendedReplenishQty"
>;

const ALERT_BADGE: Record<
  ProductAlert,
  { short: string; className: string }
> = {
  stockout: {
    short: "OOS",
    className:
      "bg-red-100 text-red-900 dark:bg-red-950/60 dark:text-red-200",
  },
  low_days_cover: {
    short: "Cover",
    className:
      "bg-amber-100 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100",
  },
  below_reorder: {
    short: "Reorder",
    className:
      "bg-orange-100 text-orange-950 dark:bg-orange-950/40 dark:text-orange-100",
  },
  slow_mover: {
    short: "Slow",
    className:
      "bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100",
  },
  replenish: {
    short: "Ship",
    className:
      "bg-sky-100 text-sky-950 dark:bg-sky-950/50 dark:text-sky-100",
  },
};

function hasLowStockTypeAlert(alerts: ProductAlert[]): boolean {
  return alerts.some(
    (a) => a === "stockout" || a === "low_days_cover" || a === "below_reorder",
  );
}

function matchesTitleOrSkuSearch(row: ProductRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    row.title.toLowerCase().includes(q) ||
    row.sku.toLowerCase().includes(q)
  );
}

/** Optional min/max on FBA quantity; empty strings = no bound. Invalid numbers ignored. */
function matchesInStockRange(row: ProductRow, minStr: string, maxStr: string): boolean {
  const parse = (s: string): number | null => {
    const t = s.trim();
    if (t === "") return null;
    const n = Number.parseInt(t, 10);
    if (!Number.isFinite(n) || n < 0) return null;
    return n;
  };
  const min = parse(minStr);
  const max = parse(maxStr);
  const q = row.quantityInStock;
  if (min != null && q < min) return false;
  if (max != null && q > max) return false;
  return true;
}

function formatPercentDelta(current: number, prior: number): string {
  if (prior === 0) return current === 0 ? "0%" : "—";
  const pct = ((current - prior) / prior) * 100;
  const rounded = Math.round(pct * 10) / 10;
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded}%`;
}

function formatSignedUnits(delta: number): string {
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta.toLocaleString()}`;
}

function hasProductSales(row: ProductRow): boolean {
  if (row.quantityOrdered > 0) return true;
  if (row.salesAmount != null && row.salesAmount > 0) return true;
  return false;
}

function compareRows(a: ProductRow, b: ProductRow, key: SortKey, dir: 1 | -1): number {
  const sign = dir;
  switch (key) {
    case "title":
      return a.title.localeCompare(b.title, undefined, { sensitivity: "base" }) * sign;
    case "sku":
      return a.sku.localeCompare(b.sku, undefined, { sensitivity: "base" }) * sign;
    case "quantityInStock":
      return (a.quantityInStock - b.quantityInStock) * sign;
    case "quantityOrdered":
      return (a.quantityOrdered - b.quantityOrdered) * sign;
    case "salesAmount": {
      const av = a.salesAmount ?? 0;
      const bv = b.salesAmount ?? 0;
      return (av - bv) * sign;
    }
    case "forecastDaysOfCover": {
      if (a.forecastDaysOfCover == null && b.forecastDaysOfCover == null) return 0;
      if (a.forecastDaysOfCover == null) return 1;
      if (b.forecastDaysOfCover == null) return -1;
      return (a.forecastDaysOfCover - b.forecastDaysOfCover) * sign;
    }
    case "velocityPerDay": {
      const av = a.velocityPerDay ?? 0;
      const bv = b.velocityPerDay ?? 0;
      return (av - bv) * sign;
    }
    case "velocityTier": {
      const rank = (t: ProductRow["velocityTier"]) =>
        t === "A" ? 0 : t === "B" ? 1 : t === "C" ? 2 : 3;
      return (rank(a.velocityTier) - rank(b.velocityTier)) * sign;
    }
    case "unitCost": {
      const av = a.unitCost ?? 0;
      const bv = b.unitCost ?? 0;
      if (a.unitCost == null && b.unitCost == null) return 0;
      if (a.unitCost == null) return 1;
      if (b.unitCost == null) return -1;
      return (av - bv) * sign;
    }
    case "estimatedAmazonFees": {
      const av = a.estimatedAmazonFees ?? 0;
      const bv = b.estimatedAmazonFees ?? 0;
      if (a.estimatedAmazonFees == null && b.estimatedAmazonFees == null) return 0;
      if (a.estimatedAmazonFees == null) return 1;
      if (b.estimatedAmazonFees == null) return -1;
      return (av - bv) * sign;
    }
    case "estimatedCogs": {
      const av = a.estimatedCogs ?? 0;
      const bv = b.estimatedCogs ?? 0;
      if (a.estimatedCogs == null && b.estimatedCogs == null) return 0;
      if (a.estimatedCogs == null) return 1;
      if (b.estimatedCogs == null) return -1;
      return (av - bv) * sign;
    }
    case "estimatedMargin": {
      const av = a.estimatedMargin ?? 0;
      const bv = b.estimatedMargin ?? 0;
      if (a.estimatedMargin == null && b.estimatedMargin == null) return 0;
      if (a.estimatedMargin == null) return 1;
      if (b.estimatedMargin == null) return -1;
      return (av - bv) * sign;
    }
    case "estimatedAdSpend": {
      const av = a.estimatedAdSpend ?? 0;
      const bv = b.estimatedAdSpend ?? 0;
      if (a.estimatedAdSpend == null && b.estimatedAdSpend == null) return 0;
      if (a.estimatedAdSpend == null) return 1;
      if (b.estimatedAdSpend == null) return -1;
      return (av - bv) * sign;
    }
    case "amazonRecommendedReplenishQty": {
      const av = a.amazonRecommendedReplenishQty ?? 0;
      const bv = b.amazonRecommendedReplenishQty ?? 0;
      if (
        a.amazonRecommendedReplenishQty == null &&
        b.amazonRecommendedReplenishQty == null
      )
        return 0;
      if (a.amazonRecommendedReplenishQty == null) return 1;
      if (b.amazonRecommendedReplenishQty == null) return -1;
      return (av - bv) * sign;
    }
    default:
      return 0;
  }
}

const SALES_FILTERS: { id: SalesFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "withSales", label: "With sales" },
  { id: "withoutSales", label: "Without sales" },
];

const INSIGHT_FILTERS: { id: InsightFilter; label: string }[] = [
  { id: "all", label: "All rows" },
  { id: "low_stock", label: "Low / OOS / reorder" },
  { id: "replenish", label: "Replenish (ship)" },
  { id: "slow_mover", label: "Slow movers" },
  { id: "any_alert", label: "Any server flag" },
];

function formatSeriesSalesLabel(amount: number, currency: string, dense: boolean): string {
  const rounded = Math.round(amount);
  if (dense) {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      notation: "compact",
      compactDisplay: "short",
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    }).format(rounded);
  }
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(rounded);
}

function seriesPointTooltip(
  point: DashboardPayload["sales"]["series"][number],
  fallbackCurrency: string | null,
): string {
  const cur = point.salesCurrency ?? fallbackCurrency;
  const sales =
    point.salesAmount != null && cur
      ? new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: cur,
          maximumFractionDigits: 0,
          minimumFractionDigits: 0,
        }).format(Math.round(point.salesAmount))
      : null;
  const base = `${point.label}: ${point.unitCount} units`;
  return sales ? `${base} · ${sales}` : base;
}

function SalesChart({
  series,
  fallbackCurrency,
}: {
  series: DashboardPayload["sales"]["series"];
  fallbackCurrency: string | null;
}) {
  const max = Math.max(...series.map((s) => s.unitCount), 1);
  const n = series.length;
  /** Many buckets (e.g. 30 days): narrow bars + tight gaps so labels don’t force overflow. */
  const dense = n > 14;
  const gapClass = dense ? "gap-px sm:gap-0.5" : "gap-1 sm:gap-2";
  const barClass = dense
    ? "w-[6px] shrink-0 sm:w-2"
    : "w-full max-w-[2.5rem]";
  const showSalesRow = series.some((p) => p.salesAmount != null);

  return (
    <div className="overflow-x-auto pb-1">
      <div className={`flex min-h-56 min-w-0 items-end ${gapClass}`}>
        {series.map((point, i) => {
          const barPx = Math.max(4, (point.unitCount / max) * CHART_TRACK_PX);
          const cur = point.salesCurrency ?? fallbackCurrency;
          const salesLabel =
            showSalesRow && point.salesAmount != null && cur
              ? formatSeriesSalesLabel(point.salesAmount, cur, dense)
              : null;
          return (
            <div
              key={`${point.label}-${i}`}
              className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-end gap-0.5"
            >
              <div
                className={`${barClass} rounded-t-md bg-zinc-700 transition-all dark:bg-zinc-200`}
                style={{ height: `${barPx}px` }}
                title={seriesPointTooltip(point, fallbackCurrency)}
              />
              <span
                className={`w-full truncate text-center leading-tight text-zinc-500 ${
                  dense ? "text-[8px] sm:text-[9px]" : "text-[10px] sm:text-xs"
                }`}
                title={point.label}
              >
                {point.label}
              </span>
              {showSalesRow && (
                <span
                  className={`w-full truncate text-center font-semibold leading-tight text-zinc-600 tabular-nums dark:text-zinc-300 ${
                    dense ? "text-[10px] sm:text-xs" : "text-xs sm:text-sm"
                  }`}
                  title={seriesPointTooltip(point, fallbackCurrency)}
                >
                  {salesLabel ?? "—"}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Dashboard() {
  const [period, setPeriod] = useState<SalesPeriod>("month");
  const [productPage, setProductPage] = useState(1);
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [salesFilter, setSalesFilter] = useState<SalesFilter>("all");
  const [insightFilter, setInsightFilter] = useState<InsightFilter>("all");
  const [tagFilter, setTagFilter] = useState<TagFilter>("all");
  const [skuTags, setSkuTags] = useState<Record<string, string[]>>({});
  const [sortKey, setSortKey] = useState<SortKey>("quantityOrdered");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [productTextSearch, setProductTextSearch] = useState("");
  const [stockMin, setStockMin] = useState("");
  const [stockMax, setStockMax] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** True while the latest request is in flight. Starts false so SSR + first client paint match (avoids hydration mismatch). */
  const [loading, setLoading] = useState(false);
  /** Only the active fetch may clear loading (avoids Strict Mode / overlapping requests leaving loading stuck). */
  const fetchAbortRef = useRef<AbortController | null>(null);

  const load = useCallback(async (p: SalesPeriod, page: number) => {
    fetchAbortRef.current?.abort();
    const controller = new AbortController();
    fetchAbortRef.current = controller;

    const id = ++dashboardFetchSeq;
    setLoading(true);
    setError(null);

    const timeoutId = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const qs = new URLSearchParams({
        period: p,
        productPage: String(page),
      });
      const res = await fetch(`/api/dashboard?${qs.toString()}`, {
        signal: controller.signal,
        cache: "no-store",
      });
      if (id !== dashboardFetchSeq) return;
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? res.statusText);
      }
      const json = (await res.json()) as DashboardPayload;
      if (id !== dashboardFetchSeq) return;
      setData(json);
    } catch (e) {
      if (id !== dashboardFetchSeq) return;
      const aborted =
        (e instanceof DOMException || e instanceof Error) && e.name === "AbortError";
      if (aborted) {
        if (fetchAbortRef.current !== controller) return;
        setError(
          "Request timed out (~10.5 min). Set SP_API_MAX_ASIN_THUMBNAILS=0 and SP_API_MAX_SKU_METRICS=0 for a fast path, lower SP_API_MAX_INVENTORY_PAGES, or raise SP_API_DASHBOARD_TIMEOUT_MS (server max 600s).",
        );
        setData(null);
      } else {
        setError(e instanceof Error ? e.message : "Failed to load");
        setData(null);
      }
    } finally {
      window.clearTimeout(timeoutId);
      if (fetchAbortRef.current === controller) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void load(period, productPage);
  }, [load, period, productPage]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(TAG_STORAGE_KEY);
      if (raw) setSkuTags(JSON.parse(raw) as Record<string, string[]>);
    } catch {
      /* ignore */
    }
  }, []);

  const persistSkuTags = useCallback((next: Record<string, string[]>) => {
    setSkuTags(next);
    try {
      localStorage.setItem(TAG_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  const toggleSkuTag = useCallback(
    (sku: string, tag: string) => {
      if (!sku) return;
      const cur = skuTags[sku] ?? [];
      const has = cur.includes(tag);
      const nextList = has ? cur.filter((t) => t !== tag) : [...cur, tag];
      const next = { ...skuTags };
      if (nextList.length === 0) delete next[sku];
      else next[sku] = nextList;
      persistSkuTags(next);
    },
    [skuTags, persistSkuTags],
  );

  const tableRows = useMemo(() => {
    if (!data) return [];
    let list = [...data.products];
    if (salesFilter === "withSales") list = list.filter(hasProductSales);
    if (salesFilter === "withoutSales") list = list.filter((r) => !hasProductSales(r));
    if (insightFilter === "low_stock") list = list.filter((r) => hasLowStockTypeAlert(r.alerts));
    if (insightFilter === "replenish") list = list.filter((r) => r.alerts.includes("replenish"));
    if (insightFilter === "slow_mover") list = list.filter((r) => r.alerts.includes("slow_mover"));
    if (insightFilter === "any_alert") list = list.filter((r) => r.alerts.length > 0);
    if (tagFilter !== "all") {
      list = list.filter((r) => (skuTags[r.sku] ?? []).includes(tagFilter));
    }
    list = list.filter(
      (r) =>
        matchesTitleOrSkuSearch(r, productTextSearch) &&
        matchesInStockRange(r, stockMin, stockMax),
    );
    const d = sortDir === "asc" ? 1 : -1;
    list.sort((a, b) => compareRows(a, b, sortKey, d));
    return list;
  }, [
    data,
    salesFilter,
    insightFilter,
    tagFilter,
    skuTags,
    sortKey,
    sortDir,
    productTextSearch,
    stockMin,
    stockMax,
  ]);

  const onSortHeader = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(
        key === "title" || key === "sku" || key === "velocityTier" ? "asc" : "desc",
      );
    }
  };

  const sortIndicator = (key: SortKey) =>
    sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  return (
    <div className="mx-auto flex min-w-0 w-full max-w-full flex-col gap-10 px-4 py-10 sm:px-6 lg:px-8">
      <header className="border-b border-zinc-200 pb-8 dark:border-zinc-800">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">
              Amazon Seller
            </p>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Amazon Analysis
            </h1>
            <div className="mt-3 flex flex-wrap gap-2">
              {PERIODS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setPeriod(p.id);
                    setProductPage(1);
                  }}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                    period === p.id
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          {data && (
            <div className="flex max-w-md flex-col items-end gap-2 text-right text-sm text-zinc-500">
              {loading && (
                <span className="text-xs text-zinc-400">Updating…</span>
              )}
              <span className="rounded-full bg-zinc-100 px-3 py-1 font-mono text-xs dark:bg-zinc-800">
                {data.mode === "live" ? "Live SP-API" : "Sample data"}
              </span>
              {data?.mode === "mock" && !data.warning && (
                <p className="text-xs leading-snug text-zinc-500 dark:text-zinc-400">
                  Add <span className="font-mono">SP_API_REFRESH_TOKEN</span>,{" "}
                  <span className="font-mono">SELLING_PARTNER_APP_CLIENT_ID</span>, and{" "}
                  <span className="font-mono">SELLING_PARTNER_APP_CLIENT_SECRET</span> to{" "}
                  <span className="font-mono">.env.local</span>, ensure{" "}
                  <span className="font-mono">SP_API_USE_MOCK</span> is not set, then restart{" "}
                  <span className="font-mono">npm run dev</span>.
                </p>
              )}
            </div>
          )}
        </div>
      </header>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      )}

      {data?.warning && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
          {data.warning}
        </div>
      )}

      {loading && !data && (
        <div className="text-sm text-zinc-500">Loading dashboard…</div>
      )}

      {data && (
        <>
          <section className="min-w-0 rounded-2xl border border-zinc-200/80 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/50">
            <div className="mb-6 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
              <div>
                <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-50">Units sold</h2>
                {data.sales.priorPeriod && (
                  <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                    <span className="font-medium text-zinc-700 dark:text-zinc-300">
                      vs {data.sales.priorPeriod.label}
                    </span>
                    {": "}
                    <span className="tabular-nums">
                      {formatSignedUnits(
                        data.sales.currentPeriod.totalUnits - data.sales.priorPeriod.totalUnits,
                      )}{" "}
                      units (
                      {formatPercentDelta(
                        data.sales.currentPeriod.totalUnits,
                        data.sales.priorPeriod.totalUnits,
                      )}
                      )
                    </span>
                    {data.sales.currentPeriod.totalSalesAmount != null &&
                    data.sales.priorPeriod.totalSalesAmount != null &&
                    data.sales.currentPeriod.totalSalesCurrency != null ? (
                      <>
                        {" · "}
                        <span className="tabular-nums">
                          {formatProductSales(
                            data.sales.currentPeriod.totalSalesAmount -
                              data.sales.priorPeriod.totalSalesAmount,
                            data.sales.currentPeriod.totalSalesCurrency,
                          )}{" "}
                          sales (
                          {formatPercentDelta(
                            data.sales.currentPeriod.totalSalesAmount,
                            data.sales.priorPeriod.totalSalesAmount,
                          )}
                          )
                        </span>
                      </>
                    ) : null}
                  </p>
                )}
              </div>
              <p className="text-sm text-zinc-500 sm:text-right">
                {data.rangeLabel} ·{" "}
                {data.sales.currentPeriod.totalUnits.toLocaleString()} units total
                {data.sales.currentPeriod.totalSalesAmount != null &&
                data.sales.currentPeriod.totalSalesCurrency != null && (
                  <>
                    {" · "}
                    {formatProductSales(
                      data.sales.currentPeriod.totalSalesAmount,
                      data.sales.currentPeriod.totalSalesCurrency,
                    )}
                  </>
                )}
              </p>
            </div>
            <SalesChart
              series={data.sales.series}
              fallbackCurrency={data.sales.currentPeriod.totalSalesCurrency}
            />
          </section>

          <section className="rounded-2xl border border-zinc-200/80 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950/50">
            <div className="border-b border-zinc-100 px-6 py-4 dark:border-zinc-800">
              <h2 className="text-center text-lg font-medium text-zinc-900 dark:text-zinc-50">
                Products
              </h2>
              <p className="mx-auto mt-2 max-w-3xl text-center text-xs leading-relaxed text-zinc-500">
                <strong className="font-medium text-zinc-600 dark:text-zinc-400">Replenish</strong> when
                FBA ≤ {data.thresholds.replenishMaxUnits} units or days of cover ≤{" "}
                {data.thresholds.replenishMaxDaysCover} (
                <span className="font-mono">SP_DASHBOARD_REPLENISH_*</span>, overrides in{" "}
                <span className="font-mono">data/sku-thresholds.json</span>).{" "}
                <strong className="font-medium text-zinc-600 dark:text-zinc-400">Tier A/B/C</strong> is
                velocity rank on <em>this page</em> only. Weekly digest emails SKUs with cover ≤{" "}
                {data.thresholds.digestDaysCoverWithin}d (plus replenish rule) —{" "}
                <span className="font-mono">SP_DIGEST_*</span> + <span className="font-mono">RESEND_API_KEY</span>.
              </p>
              {data.amazonReplenishHint ? (
                <p className="mx-auto mt-3 max-w-3xl rounded-lg border border-amber-200/90 bg-amber-50 px-3 py-2 text-center text-xs leading-snug text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/35 dark:text-amber-100">
                  {data.amazonReplenishHint}
                </p>
              ) : null}

              <div className="mt-4 flex flex-wrap items-end justify-center gap-x-8 gap-y-4">
                <div className="shrink-0">
                  <span className="block text-center text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Sales
                  </span>
                  <div className="mt-1 flex flex-wrap justify-center gap-1.5">
                    {SALES_FILTERS.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setSalesFilter(f.id)}
                        className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                          salesFilter === f.id
                            ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                            : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="shrink-0">
                  <span className="block text-center text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Insights
                  </span>
                  <div className="mt-1 flex flex-wrap justify-center gap-1.5">
                    {INSIGHT_FILTERS.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setInsightFilter(f.id)}
                        className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                          insightFilter === f.id
                            ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                            : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="min-w-0 shrink-0">
                  <label
                    htmlFor="product-tag-filter"
                    className="block text-center text-xs font-medium uppercase tracking-wide text-zinc-500"
                  >
                    Tag filter
                  </label>
                  <select
                    id="product-tag-filter"
                    value={tagFilter}
                    onChange={(e) => setTagFilter(e.target.value as TagFilter)}
                    className="mt-1 mx-auto block w-full min-w-[10rem] rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 sm:w-auto"
                  >
                    <option value="all">All tags</option>
                    {TAG_PRESETS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="mt-4 flex flex-col items-center gap-3 border-t border-zinc-100 pt-4 dark:border-zinc-800 sm:flex-row sm:flex-wrap sm:justify-center sm:items-end">
                <div className="w-full min-w-0 max-w-md sm:w-auto sm:min-w-[min(100%,20rem)]">
                  <label
                    htmlFor="product-table-search"
                    className="block text-center text-xs font-medium uppercase tracking-wide text-zinc-500"
                  >
                    Search title / SKU
                  </label>
                  <input
                    id="product-table-search"
                    type="search"
                    value={productTextSearch}
                    onChange={(e) => setProductTextSearch(e.target.value)}
                    placeholder="Type to filter this page…"
                    className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                    autoComplete="off"
                  />
                </div>
                <div className="flex flex-wrap items-end justify-center gap-4">
                  <div>
                    <label
                      htmlFor="product-stock-min"
                      className="block text-center text-xs font-medium uppercase tracking-wide text-zinc-500"
                    >
                      Min in stock
                    </label>
                    <input
                      id="product-stock-min"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={stockMin}
                      onChange={(e) => setStockMin(e.target.value)}
                      placeholder="—"
                      className="mt-1 w-[6.5rem] rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm tabular-nums text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="product-stock-max"
                      className="block text-center text-xs font-medium uppercase tracking-wide text-zinc-500"
                    >
                      Max in stock
                    </label>
                    <input
                      id="product-stock-max"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={stockMax}
                      onChange={(e) => setStockMax(e.target.value)}
                      placeholder="—"
                      className="mt-1 w-[6.5rem] rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm tabular-nums text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                    />
                  </div>
                  {(productTextSearch.trim() !== "" ||
                    stockMin.trim() !== "" ||
                    stockMax.trim() !== "") && (
                    <button
                      type="button"
                      onClick={() => {
                        setProductTextSearch("");
                        setStockMin("");
                        setStockMax("");
                      }}
                      className="self-end rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
                    >
                      Clear search
                    </button>
                  )}
                </div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1650px] text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                    <th className="px-3 py-3">Flags</th>
                    <th className="px-6 py-3">
                      <button
                        type="button"
                        onClick={() => onSortHeader("title")}
                        className="inline-flex items-baseline gap-0.5 text-left font-medium uppercase tracking-wide text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                      >
                        Product
                        <span className="font-normal normal-case text-zinc-400" aria-hidden>
                          {sortIndicator("title")}
                        </span>
                      </button>
                    </th>
                    <th className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => onSortHeader("sku")}
                        className="inline-flex items-baseline gap-0.5 font-medium uppercase tracking-wide text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                      >
                        SKU
                        <span className="font-normal normal-case text-zinc-400" aria-hidden>
                          {sortIndicator("sku")}
                        </span>
                      </button>
                    </th>
                    <th className="w-[4.25rem] min-w-[4.25rem] max-w-[5rem] px-1.5 py-3 text-center">
                      <button
                        type="button"
                        onClick={() => onSortHeader("quantityInStock")}
                        className="inline-flex w-full flex-col items-center gap-0.5 font-medium uppercase tracking-wide text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                      >
                        <span className="leading-tight">In stock</span>
                        <span className="font-normal normal-case text-zinc-400" aria-hidden>
                          {sortIndicator("quantityInStock")}
                        </span>
                      </button>
                    </th>
                    <th
                      className="w-[5rem] min-w-[5rem] max-w-[6rem] px-1.5 py-3 text-center"
                      title={`Ordered units — ${data.rangeLabel}`}
                    >
                      <button
                        type="button"
                        onClick={() => onSortHeader("quantityOrdered")}
                        className="inline-flex w-full flex-col items-center gap-0.5 font-medium uppercase tracking-wide text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                      >
                        <span className="leading-tight">Ordered</span>
                        <span className="line-clamp-2 max-w-[5.5rem] text-[10px] font-normal normal-case leading-tight text-zinc-400">
                          {data.rangeLabel}
                        </span>
                        <span className="font-normal normal-case text-zinc-400" aria-hidden>
                          {sortIndicator("quantityOrdered")}
                        </span>
                      </button>
                    </th>
                    <th
                      className="w-[4rem] min-w-[4rem] max-w-[4.5rem] px-1.5 py-3 text-center"
                      title="Units per day (ordered ÷ length of selected period)"
                    >
                      <button
                        type="button"
                        onClick={() => onSortHeader("velocityPerDay")}
                        className="inline-flex w-full flex-col items-center gap-0.5 font-medium uppercase tracking-wide text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                      >
                        <span className="leading-tight">U/day</span>
                        <span className="font-normal normal-case text-zinc-400" aria-hidden>
                          {sortIndicator("velocityPerDay")}
                        </span>
                      </button>
                    </th>
                    <th
                      className="px-3 py-3 text-center"
                      title="A/B/C by velocity rank on this page only (not whole catalog when paginated)"
                    >
                      <button
                        type="button"
                        onClick={() => onSortHeader("velocityTier")}
                        className="inline-flex w-full items-baseline justify-center gap-0.5 font-medium uppercase tracking-wide text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                      >
                        Tier
                        <span className="font-normal normal-case text-zinc-400" aria-hidden>
                          {sortIndicator("velocityTier")}
                        </span>
                      </button>
                    </th>
                    <th className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => onSortHeader("salesAmount")}
                        className="inline-flex w-full items-baseline justify-end gap-0.5 font-medium uppercase tracking-wide text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                      >
                        Sales ({data.rangeLabel})
                        <span className="font-normal normal-case text-zinc-400" aria-hidden>
                          {sortIndicator("salesAmount")}
                        </span>
                      </button>
                    </th>
                    <th
                      className="px-4 py-3 text-right"
                      title={`Account ACOS ${formatAcosPercent(data.feeAssumptions.estimatedAcosPercent)} of this SKU’s sales → estimated spend (sorts by $)`}
                    >
                      <button
                        type="button"
                        onClick={() => onSortHeader("estimatedAdSpend")}
                        className="inline-flex w-full items-baseline justify-end gap-0.5 font-medium uppercase tracking-wide text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                      >
                        Est. ACOS
                        <span className="font-normal normal-case text-zinc-400" aria-hidden>
                          {sortIndicator("estimatedAdSpend")}
                        </span>
                      </button>
                    </th>
                    <th
                      className="px-4 py-3 text-right"
                      title="Your landed cost from data/sku-costs.json (optional)"
                    >
                      <button
                        type="button"
                        onClick={() => onSortHeader("unitCost")}
                        className="inline-flex w-full items-baseline justify-end gap-0.5 font-medium uppercase tracking-wide text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                      >
                        Unit cost
                        <span className="font-normal normal-case text-zinc-400" aria-hidden>
                          {sortIndicator("unitCost")}
                        </span>
                      </button>
                    </th>
                    <th
                      className="px-4 py-3 text-right"
                      title="Rough: referral % × sales + flat FBA × units sold (see note above)"
                    >
                      <button
                        type="button"
                        onClick={() => onSortHeader("estimatedAmazonFees")}
                        className="inline-flex w-full items-baseline justify-end gap-0.5 font-medium uppercase tracking-wide text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                      >
                        Est. fees
                        <span className="font-normal normal-case text-zinc-400" aria-hidden>
                          {sortIndicator("estimatedAmazonFees")}
                        </span>
                      </button>
                    </th>
                    <th className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => onSortHeader("estimatedCogs")}
                        className="inline-flex w-full items-baseline justify-end gap-0.5 font-medium uppercase tracking-wide text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                      >
                        Est. COGS
                        <span className="font-normal normal-case text-zinc-400" aria-hidden>
                          {sortIndicator("estimatedCogs")}
                        </span>
                      </button>
                    </th>
                    <th
                      className="px-4 py-3 text-right"
                      title="Sales − est. fees − COGS − est. ad spend when cost is known"
                    >
                      <button
                        type="button"
                        onClick={() => onSortHeader("estimatedMargin")}
                        className="inline-flex w-full items-baseline justify-end gap-0.5 font-medium uppercase tracking-wide text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                      >
                        Est. margin
                        <span className="font-normal normal-case text-zinc-400" aria-hidden>
                          {sortIndicator("estimatedMargin")}
                        </span>
                      </button>
                    </th>
                    <th className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => onSortHeader("forecastDaysOfCover")}
                        className="inline-flex w-full items-baseline justify-end gap-0.5 font-medium uppercase tracking-wide text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                      >
                        Days of cover
                        <span className="font-normal normal-case text-zinc-400" aria-hidden>
                          {sortIndicator("forecastDaysOfCover")}
                        </span>
                      </button>
                    </th>
                    <th
                      className="px-4 py-3 text-right"
                      title={
                        data.restockReport?.asOf
                          ? `From Amazon FBA reports (newest document ${data.restockReport.asOf}). ${data.restockReport.skuCountInReport.toLocaleString()} SKUs in merged file.`
                          : "Amazon Restock + FBA Inventory (GET_FBA_INVENTORY_PLANNING_DATA) — suggested qty (live) or sample (mock)."
                      }
                    >
                      <button
                        type="button"
                        onClick={() => onSortHeader("amazonRecommendedReplenishQty")}
                        className="inline-flex w-full items-baseline justify-end gap-0.5 font-medium uppercase tracking-wide text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                      >
                        Amz suggest qty
                        <span className="font-normal normal-case text-zinc-400" aria-hidden>
                          {sortIndicator("amazonRecommendedReplenishQty")}
                        </span>
                      </button>
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
                      Tags (local)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.products.length === 0 ? (
                    <tr>
                      <td colSpan={16} className="px-6 py-10 text-center text-zinc-500">
                        No inventory rows returned. Connect FBA inventory or check API roles.
                      </td>
                    </tr>
                  ) : tableRows.length === 0 ? (
                    <tr>
                      <td colSpan={16} className="px-6 py-10 text-center text-zinc-500">
                        No products match this filter for {data.rangeLabel}. Try &quot;All&quot; or the
                        other sales view.
                      </td>
                    </tr>
                  ) : (
                    tableRows.map((row, i) => (
                      <tr
                        key={`${row.sku}-${row.asin ?? i}`}
                        className="border-b border-zinc-50 last:border-0 dark:border-zinc-900"
                      >
                        <td className="px-3 py-4 align-top">
                          <div className="flex max-w-[7rem] flex-wrap gap-0.5">
                            {row.alerts.length === 0 ? (
                              <span className="text-xs text-zinc-400">—</span>
                            ) : (
                              row.alerts.map((a) => (
                                <span
                                  key={a}
                                  title={a}
                                  className={`rounded px-1 py-0.5 text-[10px] font-medium ${ALERT_BADGE[a].className}`}
                                >
                                  {ALERT_BADGE[a].short}
                                </span>
                              ))
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md bg-zinc-100 dark:bg-zinc-800">
                              {row.thumbnailUrl ? (
                                <Image
                                  src={row.thumbnailUrl}
                                  alt=""
                                  fill
                                  className="object-cover"
                                  sizes="48px"
                                  unoptimized
                                />
                              ) : (
                                <span className="flex h-full w-full items-center justify-center text-[10px] text-zinc-400">
                                  No img
                                </span>
                              )}
                            </div>
                            <span className="line-clamp-2 font-medium text-zinc-900 dark:text-zinc-100">
                              {row.title}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-4 font-mono text-xs text-zinc-600 dark:text-zinc-400">
                          {row.sku || "—"}
                        </td>
                        <td className="px-1.5 py-4 text-center tabular-nums">
                          {row.quantityInStock.toLocaleString()}
                        </td>
                        <td className="px-1.5 py-4 text-center tabular-nums">
                          {row.quantityOrdered.toLocaleString()}
                        </td>
                        <td className="px-1.5 py-4 text-center tabular-nums text-zinc-700 dark:text-zinc-300">
                          {row.velocityPerDay == null ? "—" : row.velocityPerDay.toLocaleString()}
                        </td>
                        <td className="px-3 py-4 text-center">
                          {row.velocityTier ? (
                            <span
                              className={`inline-block min-w-[1.5rem] rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums ${
                                row.velocityTier === "A"
                                  ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100"
                                  : row.velocityTier === "B"
                                    ? "bg-amber-100 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100"
                                    : "bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100"
                              }`}
                              title="Velocity tier on this table page (A fastest → C slowest)"
                            >
                              {row.velocityTier}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-4 py-4 text-right tabular-nums text-zinc-800 dark:text-zinc-200">
                          {formatProductSales(row.salesAmount, row.salesCurrency)}
                        </td>
                        <td className="px-4 py-4 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                          {row.estimatedAdSpend != null ? (
                            <div className="flex flex-col items-end gap-0.5">
                              <span className="text-zinc-800 dark:text-zinc-200">
                                {formatAcosPercent(data.feeAssumptions.estimatedAcosPercent)}
                              </span>
                              <span className="text-[11px] font-normal normal-case text-zinc-500">
                                {formatProductSales(row.estimatedAdSpend, row.salesCurrency)}
                              </span>
                            </div>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-4 py-4 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                          {formatProductSales(
                            row.unitCost,
                            row.unitCostCurrency ?? row.salesCurrency,
                          )}
                        </td>
                        <td className="px-4 py-4 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                          {formatProductSales(row.estimatedAmazonFees, row.salesCurrency)}
                        </td>
                        <td className="px-4 py-4 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                          {formatProductSales(row.estimatedCogs, row.salesCurrency)}
                        </td>
                        <td className="px-4 py-4 text-right tabular-nums">
                          {row.estimatedMargin != null ? (
                            <div className="flex flex-col items-end gap-0.5">
                              <span
                                className={
                                  row.estimatedMargin < 0
                                    ? "text-red-600 dark:text-red-400"
                                    : "text-zinc-800 dark:text-zinc-200"
                                }
                              >
                                {formatProductSales(row.estimatedMargin, row.salesCurrency)}
                              </span>
                              <span className="text-[11px] font-normal normal-case text-zinc-500">
                                {formatMarginPercent(row.estimatedMarginPercent)}
                              </span>
                            </div>
                          ) : (
                            <span
                              className="text-zinc-400"
                              title={
                                row.unitCost == null && row.estimatedAmazonFees != null
                                  ? "Add unit cost in data/sku-costs.json to estimate margin"
                                  : undefined
                              }
                            >
                              —
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-4 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
                          {row.forecastDaysOfCover == null ? "—" : `${row.forecastDaysOfCover} d`}
                        </td>
                        <td
                          className="px-4 py-4 text-right tabular-nums text-zinc-700 dark:text-zinc-300"
                          title={
                            row.amazonRecommendedShipDate
                              ? `Recommended ship date (Amazon): ${row.amazonRecommendedShipDate}`
                              : row.amazonRecommendedReplenishQty != null
                                ? "No ship date in report for this SKU"
                                : undefined
                          }
                        >
                          {row.amazonRecommendedReplenishQty == null ? (
                            "—"
                          ) : (
                            <span className="inline-flex flex-col items-end gap-0.5">
                              <span>{row.amazonRecommendedReplenishQty.toLocaleString()}</span>
                              {row.amazonRecommendedShipDate ? (
                                <span className="text-[11px] font-normal normal-case text-zinc-500">
                                  ship {row.amazonRecommendedShipDate}
                                </span>
                              ) : null}
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 align-top">
                          <div className="flex max-w-[14rem] flex-col gap-1">
                            <div className="flex flex-wrap gap-1">
                              {TAG_PRESETS.map((tag) => {
                                const on = (skuTags[row.sku] ?? []).includes(tag);
                                return (
                                  <button
                                    key={tag}
                                    type="button"
                                    disabled={!row.sku}
                                    onClick={() => toggleSkuTag(row.sku, tag)}
                                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
                                      on
                                        ? "bg-amber-600 text-white dark:bg-amber-500"
                                        : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
                                    }`}
                                  >
                                    {tag}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {data.productPagination.totalRows > 0 && data.productPagination.totalPages > 1 && (
              <div className="flex flex-col gap-3 border-t border-zinc-100 px-6 py-4 sm:flex-row sm:items-center sm:justify-between dark:border-zinc-800">
                <p className="text-xs text-zinc-500 sm:max-w-xl">
                  {data.productPagination.pageSize.toLocaleString()} SKUs per page · deeper pages load
                  on demand (same chart; new Catalog + Sales calls for that slice). Set{" "}
                  <span className="font-mono">SP_DASHBOARD_PRODUCT_PAGE_SIZE=0</span> in{" "}
                  <span className="font-mono">.env.local</span> to load all SKUs at once (no pagination).
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={!data.productPagination.hasPrevPage || loading}
                    onClick={() => setProductPage((x) => Math.max(1, x - 1))}
                    className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                  >
                    Previous
                  </button>
                  <span className="text-sm tabular-nums text-zinc-600 dark:text-zinc-400">
                    {data.productPagination.page} / {data.productPagination.totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={!data.productPagination.hasNextPage || loading}
                    onClick={() => setProductPage((x) => x + 1)}
                    className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
