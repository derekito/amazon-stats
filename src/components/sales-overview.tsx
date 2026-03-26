"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { SalesOverviewPayload, SalesOverviewTopProductRow } from "@/lib/sp/types";

const CHART_TRACK_PX = 160;
/** Must exceed server timeout when many SKUs are scanned for the top table. */
const FETCH_TIMEOUT_MS = 630_000;

type TopSortKey = "sku" | "inventory" | "unitsSold" | "salesTotal" | "unitsDelta" | "salesDelta";

function numericSortValue(row: SalesOverviewTopProductRow, key: TopSortKey): number {
  switch (key) {
    case "inventory":
      return row.inventory;
    case "unitsSold":
      return row.unitsSold;
    case "salesTotal":
      return row.salesTotal ?? Number.NaN;
    case "unitsDelta":
      if (row.unitsDeltaPct != null) return row.unitsDeltaPct;
      if (row.unitsDeltaFromZero) return Number.POSITIVE_INFINITY;
      return Number.NaN;
    case "salesDelta":
      if (row.salesDeltaPct != null) return row.salesDeltaPct;
      if (row.salesDeltaFromZero) return Number.POSITIVE_INFINITY;
      return Number.NaN;
    default:
      return Number.NaN;
  }
}

function sortTopProductRows(
  rows: SalesOverviewTopProductRow[],
  key: TopSortKey,
  dir: "asc" | "desc",
): SalesOverviewTopProductRow[] {
  const out = [...rows];
  if (key === "sku") {
    out.sort((a, b) => {
      const cmp = a.sku.localeCompare(b.sku, undefined, { sensitivity: "base" });
      return dir === "asc" ? cmp : -cmp;
    });
    return out;
  }
  out.sort((a, b) => {
    const va = numericSortValue(a, key);
    const vb = numericSortValue(b, key);
    const na = Number.isNaN(va);
    const nb = Number.isNaN(vb);
    if (na && nb) return 0;
    if (na) return 1;
    if (nb) return -1;
    const cmp = va - vb;
    return dir === "asc" ? cmp : -cmp;
  });
  return out;
}

function SortableTh({
  label,
  colKey,
  activeKey,
  dir,
  onSort,
  align = "left",
}: {
  label: string;
  colKey: TopSortKey;
  activeKey: TopSortKey;
  dir: "asc" | "desc";
  onSort: (k: TopSortKey) => void;
  align?: "left" | "right";
}) {
  const active = activeKey === colKey;
  return (
    <th
      scope="col"
      className={`px-3 py-3 sm:px-4 ${align === "right" ? "text-right" : "text-left"}`}
    >
      <button
        type="button"
        onClick={() => onSort(colKey)}
        className={`group inline-flex items-center gap-1 rounded-md text-xs font-medium uppercase tracking-wide text-zinc-500 hover:text-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:text-zinc-400 dark:hover:text-zinc-100 ${
          align === "right" ? "w-full justify-end" : ""
        }`}
      >
        <span>{label}</span>
        <span className="select-none tabular-nums text-[10px] text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-300">
          {active ? (dir === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </button>
    </th>
  );
}

let salesOverviewFetchSeq = 0;

type ChartMetric = "units" | "sales";

function formatCompactCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    notation: "compact",
    compactDisplay: "short",
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
  }).format(amount);
}

function formatFullCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(Math.round(amount));
}

function pctChange(current: number, prior: number): number | null {
  if (prior <= 0) return null;
  return ((current - prior) / prior) * 100;
}

function deltaClass(p: number | null): string {
  if (p == null) return "text-zinc-500 dark:text-zinc-400";
  if (p > 0) return "text-emerald-700 dark:text-emerald-400";
  if (p < 0) return "text-red-700 dark:text-red-400";
  return "text-zinc-600 dark:text-zinc-300";
}

function formatPctDelta(p: number | null): string {
  if (p == null) return "—";
  return `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`;
}

function TopSkuDeltaCell({
  pct,
  fromZero,
}: {
  pct: number | null;
  fromZero?: boolean;
}) {
  if (fromZero) {
    return (
      <span
        className="cursor-help font-medium text-emerald-700 underline decoration-dotted decoration-emerald-600/50 underline-offset-2 dark:text-emerald-400 dark:decoration-emerald-400/50"
        title="Prior 10 UTC days had 0 here; this period has sales. This is not ‘unchanged’—see 0.0% when the two periods match."
      >
        New
      </span>
    );
  }
  if (pct == null) {
    return <span className="text-zinc-500 dark:text-zinc-400">—</span>;
  }
  return (
    <span className={`font-medium tabular-nums ${deltaClass(pct)}`}>{formatPctDelta(pct)}</span>
  );
}

function TenDayChart({
  series,
  metric,
  fallbackCurrency,
}: {
  series: SalesOverviewPayload["tenDay"]["series"];
  metric: ChartMetric;
  fallbackCurrency: string | null;
}) {
  const values = useMemo(() => {
    if (metric === "units") return series.map((s) => s.unitCount);
    return series.map((s) => s.salesAmount ?? 0);
  }, [series, metric]);
  const max = Math.max(...values, 1);
  const gapClass = "gap-1 sm:gap-2";
  const barClass = "w-full max-w-[2.5rem]";

  return (
    <div className="overflow-x-auto pb-1">
      <div className={`flex min-h-56 min-w-0 items-end ${gapClass}`}>
        {series.map((point, i) => {
          const v = values[i] ?? 0;
          const barPx = Math.max(4, (v / max) * CHART_TRACK_PX);
          const cur = point.salesCurrency ?? fallbackCurrency;
          const salesLabel =
            metric === "sales" && point.salesAmount != null && cur
              ? formatCompactCurrency(point.salesAmount, cur)
              : null;
          const title =
            metric === "units"
              ? `${point.label}: ${point.unitCount} units`
              : `${point.label}: ${point.salesAmount != null && cur ? formatFullCurrency(point.salesAmount, cur) : "—"}`;
          return (
            <div
              key={`${point.label}-${i}`}
              className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-end gap-0.5"
            >
              <div
                className={`${barClass} rounded-t-md bg-emerald-700 transition-all dark:bg-emerald-400/90`}
                style={{ height: `${barPx}px` }}
                title={title}
              />
              <span
                className="w-full truncate text-center text-[10px] leading-tight text-zinc-500 sm:text-xs"
                title={point.label}
              >
                {point.label}
              </span>
              {metric === "sales" && (
                <span
                  className="w-full truncate text-center text-xs font-semibold tabular-nums text-zinc-600 dark:text-zinc-300"
                  title={title}
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

export function SalesOverview() {
  const [data, setData] = useState<SalesOverviewPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chartMetric, setChartMetric] = useState<ChartMetric>("units");
  const [topSortKey, setTopSortKey] = useState<TopSortKey>("unitsSold");
  const [topSortDir, setTopSortDir] = useState<"asc" | "desc">("desc");
  const fetchAbortRef = useRef<AbortController | null>(null);

  const handleTopSort = useCallback((key: TopSortKey) => {
    if (key === topSortKey) {
      setTopSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setTopSortKey(key);
      setTopSortDir(key === "sku" ? "asc" : "desc");
    }
  }, [topSortKey]);

  const load = useCallback(async () => {
    const seq = ++salesOverviewFetchSeq;
    fetchAbortRef.current?.abort();
    const ac = new AbortController();
    fetchAbortRef.current = ac;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/sales-overview", {
        cache: "no-store",
        signal: ac.signal,
      });
      const j = (await res.json()) as SalesOverviewPayload & { error?: string };
      if (!res.ok) throw new Error(j.error ?? res.statusText);
      if (seq !== salesOverviewFetchSeq) return;
      setData(j);
    } catch (e) {
      if (ac.signal.aborted) return;
      setError(e instanceof Error ? e.message : "Load failed");
      setData(null);
    } finally {
      if (seq === salesOverviewFetchSeq) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => fetchAbortRef.current?.abort(), FETCH_TIMEOUT_MS);
    void load();
    return () => {
      clearTimeout(t);
      fetchAbortRef.current?.abort();
    };
  }, [load]);

  const fallbackCurrency =
    data?.yesterday.totalSalesCurrency ?? data?.tenDay.totals.totalSalesCurrency ?? null;
  const hasAnySales = data?.tenDay.series.some((p) => p.salesAmount != null) ?? false;

  const unitsDeltaPct = useMemo(() => {
    if (!data?.priorTenDay) return null;
    return pctChange(data.tenDay.totals.totalUnits, data.priorTenDay.totalUnits);
  }, [data]);

  const salesDeltaPct = useMemo(() => {
    if (!data?.priorTenDay) return null;
    const c = data.tenDay.totals.totalSalesAmount;
    const p = data.priorTenDay.totalSalesAmount;
    if (c == null || p == null) return null;
    return pctChange(c, p);
  }, [data]);

  const sortedTopProducts = useMemo(() => {
    if (!data?.topProducts.length) return [];
    return sortTopProductRows(data.topProducts, topSortKey, topSortDir);
  }, [data?.topProducts, topSortKey, topSortDir]);

  return (
    <div className="mx-auto flex min-w-0 w-full max-w-6xl flex-col gap-10 px-4 py-10 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-2 border-b border-zinc-200 pb-8 dark:border-zinc-800">
        <p className="text-sm font-medium uppercase tracking-wide text-emerald-800 dark:text-emerald-400">
          Amazon Seller
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Sales overview
        </h1>
        <p className="max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
          Yesterday (UTC) totals and the last 10 rolling UTC days (daily bars). Toggle the chart between
          units and ordered product sales when Amazon returns sales amounts.
        </p>
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
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading sales…</p>
      )}

      {data && (
        <>
          <section className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              {data.yesterday.label}
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/40">
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Units sold</p>
                <p className="mt-1 text-3xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                  {data.yesterday.totalUnits.toLocaleString()}
                </p>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/40">
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Ordered product sales
                </p>
                <p className="mt-1 text-3xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                  {data.yesterday.totalSalesAmount != null && data.yesterday.totalSalesCurrency
                    ? formatFullCurrency(
                        data.yesterday.totalSalesAmount,
                        data.yesterday.totalSalesCurrency,
                      )
                    : "—"}
                </p>
              </div>
            </div>
          </section>

          <section className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                {data.tenDay.rangeLabel}
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-zinc-500">Chart:</span>
                <div className="inline-flex rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-700">
                  <button
                    type="button"
                    onClick={() => setChartMetric("units")}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                      chartMetric === "units"
                        ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                        : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                    }`}
                  >
                    Units
                  </button>
                  <button
                    type="button"
                    onClick={() => setChartMetric("sales")}
                    disabled={!hasAnySales}
                    title={!hasAnySales ? "No sales amounts in this window" : undefined}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                      chartMetric === "sales"
                        ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                        : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                    } disabled:cursor-not-allowed disabled:opacity-40`}
                  >
                    Sales $
                  </button>
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border border-zinc-200 bg-zinc-50/80 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/30">
                <p className="text-xs text-zinc-500">Total units</p>
                <p className="text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                  {data.tenDay.totals.totalUnits.toLocaleString()}
                </p>
              </div>
              <div className="rounded-lg border border-zinc-200 bg-zinc-50/80 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/30">
                <p className="text-xs text-zinc-500">Total sales</p>
                <p className="text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                  {data.tenDay.totals.totalSalesAmount != null && data.tenDay.totals.totalSalesCurrency
                    ? formatFullCurrency(
                        data.tenDay.totals.totalSalesAmount,
                        data.tenDay.totals.totalSalesCurrency,
                      )
                    : "—"}
                </p>
              </div>
              <div className="rounded-lg border border-zinc-200 bg-zinc-50/80 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/30">
                <p className="text-xs text-zinc-500">Avg units / day</p>
                <p className="text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                  {data.tenDay.avgUnitsPerDay.toLocaleString(undefined, {
                    maximumFractionDigits: 1,
                    minimumFractionDigits: 0,
                  })}
                </p>
              </div>
              <div className="rounded-lg border border-zinc-200 bg-zinc-50/80 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/30">
                <p className="text-xs text-zinc-500">vs prior 10 days (units)</p>
                <p className="text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                  {unitsDeltaPct == null
                    ? "—"
                    : `${unitsDeltaPct >= 0 ? "+" : ""}${unitsDeltaPct.toFixed(1)}%`}
                </p>
              </div>
            </div>
            {data.priorTenDay && data.tenDay.totals.totalSalesAmount != null && salesDeltaPct != null && (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Sales vs prior 10 days:{" "}
                <span className="font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
                  {salesDeltaPct >= 0 ? "+" : ""}
                  {salesDeltaPct.toFixed(1)}%
                </span>
              </p>
            )}

            <TenDayChart
              series={data.tenDay.series}
              metric={chartMetric}
              fallbackCurrency={fallbackCurrency}
            />
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              Top 20 selling products
            </h2>
            <p className="max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
              Ranked by units sold in the last 10 UTC days (per-SKU Sales API); click a column header to sort
              ascending or descending. “vs prior 10d” compares the same SKU to the <strong>previous</strong>{" "}
              10 UTC days.{" "}
              <span className="text-emerald-600 dark:text-emerald-400">New</span> means that column had{" "}
              <strong>zero</strong> in the prior window and <strong>some</strong> in the current window (not
              “unchanged”). <strong>0.0%</strong> means the two windows match when the prior window was already
              above zero. Negative % (red) means fewer units or sales than the prior window.
            </p>
            {data.topProductsHint && (
              <p className="text-sm text-amber-800 dark:text-amber-200/90">{data.topProductsHint}</p>
            )}
            {data.topProducts.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                No top products (set SP_SALES_OVERVIEW_MAX_SKU_SCAN to a positive number to enable, or
                check FBA inventory).
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900/40">
                <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
                  <thead>
                    <tr className="text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
                      <th className="px-3 py-3 sm:px-4">Thumbnail</th>
                      <SortableTh
                        label="SKU"
                        colKey="sku"
                        activeKey={topSortKey}
                        dir={topSortDir}
                        onSort={handleTopSort}
                      />
                      <SortableTh
                        label="Inventory"
                        colKey="inventory"
                        activeKey={topSortKey}
                        dir={topSortDir}
                        onSort={handleTopSort}
                        align="right"
                      />
                      <SortableTh
                        label="Units (10d)"
                        colKey="unitsSold"
                        activeKey={topSortKey}
                        dir={topSortDir}
                        onSort={handleTopSort}
                        align="right"
                      />
                      <SortableTh
                        label="Sales (10d)"
                        colKey="salesTotal"
                        activeKey={topSortKey}
                        dir={topSortDir}
                        onSort={handleTopSort}
                        align="right"
                      />
                      <SortableTh
                        label="Units vs prior 10d"
                        colKey="unitsDelta"
                        activeKey={topSortKey}
                        dir={topSortDir}
                        onSort={handleTopSort}
                        align="right"
                      />
                      <SortableTh
                        label="Sales vs prior 10d"
                        colKey="salesDelta"
                        activeKey={topSortKey}
                        dir={topSortDir}
                        onSort={handleTopSort}
                        align="right"
                      />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {sortedTopProducts.map((row) => {
                      const cur = row.salesCurrency ?? fallbackCurrency;
                      return (
                        <tr key={row.sku} className="text-zinc-900 dark:text-zinc-100">
                          <td className="px-3 py-2 sm:px-4">
                            <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-md bg-zinc-100 dark:bg-zinc-800">
                              {row.thumbnailUrl ? (
                                <Image
                                  src={row.thumbnailUrl}
                                  alt=""
                                  fill
                                  className="object-cover"
                                  sizes="44px"
                                  unoptimized
                                />
                              ) : (
                                <span className="flex h-full w-full items-center justify-center text-[9px] text-zinc-400">
                                  —
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="max-w-[10rem] px-3 py-2 font-mono text-xs sm:max-w-xs sm:px-4">
                            <span className="block truncate" title={row.title}>
                              {row.sku}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums sm:px-4">
                            {row.inventory.toLocaleString()}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums sm:px-4">
                            {row.unitsSold.toLocaleString()}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums sm:px-4">
                            {row.salesTotal != null && cur
                              ? formatFullCurrency(row.salesTotal, cur)
                              : "—"}
                          </td>
                          <td className="px-3 py-2 text-right text-sm sm:px-4">
                            <TopSkuDeltaCell
                              pct={row.unitsDeltaPct}
                              fromZero={row.unitsDeltaFromZero}
                            />
                          </td>
                          <td className="px-3 py-2 text-right text-sm sm:px-4">
                            <TopSkuDeltaCell
                              pct={row.salesDeltaPct}
                              fromZero={row.salesDeltaFromZero}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <p className="text-xs text-zinc-400 dark:text-zinc-500">
            Marketplace: {data.marketplaceId} · All intervals use UTC (Amazon Sales API).
          </p>
        </>
      )}
    </div>
  );
}
