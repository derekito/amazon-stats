import "server-only";

import { parseISO } from "date-fns";
import type { SellingPartner } from "amazon-sp-api";

import type { AppEnv } from "@/lib/env";
import {
  getOrderMetricsRange,
  getTenDayOrderMetricsRange,
  getPriorTenDayRange,
} from "@/lib/sp/intervals";
import {
  fetchAllInventorySummaries,
  inventoryDisplayQuantity,
  sortInventoryByFbaQuantity,
  type InventorySummaryRow,
} from "@/lib/sp/inventory-summaries";
import { loadSkuExclusionsSet } from "@/lib/sp/load-sku-exclusions";
import {
  metricTotalSalesFromRow,
  metricUnitCount,
  parseOrderMetricsPayload,
  sumOrderMetricsTotals,
} from "@/lib/sp/parse-order-metrics";
import { resolveMarketplaceId } from "@/lib/sp/marketplace";
import { computeSalesDelta, computeUnitsDelta } from "@/lib/sp/sales-top-delta";
import { runSpStep } from "@/lib/sp/sp-step";
import type {
  MetricsWindowTotals,
  SalesOverviewPayload,
  SalesOverviewTopProductRow,
  SalesPoint,
} from "@/lib/sp/types";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function shortLabelFromInterval(interval: string | undefined, index: number): string {
  if (!interval) return String(index + 1);
  const start = parseISO(interval.split("--")[0]?.trim() ?? "");
  if (Number.isNaN(start.getTime())) return String(index + 1);
  const m = start.getUTCMonth() + 1;
  const d = start.getUTCDate();
  const y = String(start.getUTCFullYear()).slice(2);
  return `${m}/${d}/${y}`;
}

function filterExcludedInventory(
  rows: InventorySummaryRow[],
  excluded: Set<string>,
): InventorySummaryRow[] {
  return rows.filter((r) => {
    const sku = r.sellerSku?.trim() ?? "";
    if (!sku) return true;
    return !excluded.has(sku);
  });
}

function pickImageUrl(catalog: unknown): string | null {
  if (!catalog || typeof catalog !== "object") return null;
  const images = (catalog as { images?: { images?: { link?: string }[] }[] }).images;
  const first = images?.[0]?.images?.[0]?.link;
  return typeof first === "string" ? first : null;
}

async function fetchThumbnailForAsin(
  sp: SellingPartner,
  marketplaceId: string,
  asin: string,
): Promise<string | null> {
  try {
    const item = await sp.callAPI({
      operation: "catalogItems.getCatalogItem",
      path: { asin },
      query: {
        marketplaceIds: [marketplaceId],
        includedData: ["images", "summaries"],
      },
      options: { version: "2022-04-01" },
    });
    return pickImageUrl(item);
  } catch {
    return null;
  }
}

async function fetchOrderMetrics(
  sp: SellingPartner,
  marketplaceId: string,
  interval: string,
  granularity: string,
  sku?: string,
) {
  const query: Record<string, unknown> = {
    marketplaceIds: [marketplaceId],
    interval,
    granularity,
    ...(granularity !== "Hour" ? { granularityTimeZone: "UTC" } : {}),
    ...(granularity === "Week" ? { firstDayOfWeek: "Monday" } : {}),
    ...(sku ? { sku } : {}),
  };
  return sp.callAPI({
    operation: "getOrderMetrics",
    endpoint: "sales",
    query,
  });
}

function parseSkuWindowMetrics(payload: unknown): {
  units: number;
  salesAmount: number | null;
  salesCurrency: string | null;
} {
  const rows = parseOrderMetricsPayload(payload);
  let units = 0;
  let salesSum = 0;
  let salesCurrency: string | null = null;
  let hasSales = false;
  for (const r of rows) {
    units += metricUnitCount(r);
    const money = metricTotalSalesFromRow(r);
    if (money) {
      hasSales = true;
      salesSum += money.amount;
      salesCurrency = salesCurrency ?? money.currencyCode;
    }
  }
  return {
    units,
    salesAmount: hasSales ? salesSum : null,
    salesCurrency,
  };
}

function rowsToSeries(rows: ReturnType<typeof parseOrderMetricsPayload>): SalesPoint[] {
  return rows.map((row, i) => {
    const sales = metricTotalSalesFromRow(row);
    return {
      label: shortLabelFromInterval(row.interval, i),
      unitCount: metricUnitCount(row),
      salesAmount: sales?.amount ?? null,
      salesCurrency: sales?.currencyCode ?? null,
    };
  });
}

async function buildTopProducts(
  sp: SellingPartner,
  marketplaceId: string,
  env: AppEnv,
  tenInterval: string,
  priorInterval: string,
  skuExcluded: Set<string>,
): Promise<{ topProducts: SalesOverviewTopProductRow[]; topProductsHint?: string }> {
  const maxScan = env.SP_SALES_OVERVIEW_MAX_SKU_SCAN;
  if (maxScan <= 0) {
    return { topProducts: [] };
  }

  const invWrap = await runSpStep("FBA Inventory (sales top)", () =>
    fetchAllInventorySummaries(sp, marketplaceId, env.SP_API_MAX_INVENTORY_PAGES),
  );
  const inventory = filterExcludedInventory(invWrap.summaries, skuExcluded);
  const sorted = sortInventoryByFbaQuantity(inventory);
  const candidates = sorted.slice(0, maxScan);

  const hints: string[] = [];
  if (invWrap.truncated) {
    hints.push(
      `Inventory list truncated after ${env.SP_API_MAX_INVENTORY_PAGES} pages — top sellers only reflect loaded SKUs.`,
    );
  }
  if (inventory.length > maxScan) {
    hints.push(
      `Ranking uses the top ${maxScan} SKUs by FBA quantity (SP_SALES_OVERVIEW_MAX_SKU_SCAN), not all ASINs.`,
    );
  }

  type Cand = {
    row: InventorySummaryRow;
    sku: string;
    units: number;
    salesAmount: number | null;
    salesCurrency: string | null;
  };

  const metrics: Cand[] = [];
  const SKU_BATCH = 5;
  for (let i = 0; i < candidates.length; i += SKU_BATCH) {
    const chunk = candidates.slice(i, i + SKU_BATCH);
    await Promise.all(
      chunk.map(async (row) => {
        const sku = row.sellerSku?.trim() ?? "";
        if (!sku) return;
        try {
          const p = await fetchOrderMetrics(sp, marketplaceId, tenInterval, "Total", sku);
          const m = parseSkuWindowMetrics(p);
          metrics.push({
            row,
            sku,
            units: m.units,
            salesAmount: m.salesAmount,
            salesCurrency: m.salesCurrency,
          });
        } catch {
          metrics.push({
            row,
            sku,
            units: 0,
            salesAmount: null,
            salesCurrency: null,
          });
        }
      }),
    );
    if (i + SKU_BATCH < candidates.length) await delay(250);
  }

  metrics.sort((a, b) => b.units - a.units);
  const top10 = metrics.slice(0, 10);

  const priorBySku = new Map<string, { units: number; salesAmount: number | null; salesCurrency: string | null }>();
  for (let i = 0; i < top10.length; i += SKU_BATCH) {
    const chunk = top10.slice(i, i + SKU_BATCH);
    await Promise.all(
      chunk.map(async (c) => {
        try {
          const p = await fetchOrderMetrics(sp, marketplaceId, priorInterval, "Total", c.sku);
          const m = parseSkuWindowMetrics(p);
          priorBySku.set(c.sku, {
            units: m.units,
            salesAmount: m.salesAmount,
            salesCurrency: m.salesCurrency,
          });
        } catch {
          priorBySku.set(c.sku, { units: 0, salesAmount: null, salesCurrency: null });
        }
      }),
    );
    if (i + SKU_BATCH < top10.length) await delay(250);
  }

  const thumbCap = env.SP_API_MAX_ASIN_THUMBNAILS;
  const imageByAsin = new Map<string, string | null>();
  if (thumbCap > 0) {
    const asins = [...new Set(top10.map((c) => c.row.asin).filter(Boolean))] as string[];
    const toFetch = asins.slice(0, Math.min(10, thumbCap));
    const ASIN_CONCURRENCY = 4;
    for (let i = 0; i < toFetch.length; i += ASIN_CONCURRENCY) {
      const chunk = toFetch.slice(i, i + ASIN_CONCURRENCY);
      const results = await Promise.all(
        chunk.map(async (asin) => {
          const url = await fetchThumbnailForAsin(sp, marketplaceId, asin);
          return { asin, url };
        }),
      );
      for (const { asin, url } of results) imageByAsin.set(asin, url);
      if (i + ASIN_CONCURRENCY < toFetch.length) await delay(150);
    }
  }

  const topProducts: SalesOverviewTopProductRow[] = top10.map((c) => {
    const qty = inventoryDisplayQuantity(c.row);
    const prior = priorBySku.get(c.sku) ?? {
      units: 0,
      salesAmount: null,
      salesCurrency: null,
    };
    const asin = c.row.asin?.trim() || null;
    const thumb = asin ? imageByAsin.get(asin) ?? null : null;
    const u = computeUnitsDelta(c.units, prior.units);
    const s = computeSalesDelta(c.salesAmount, prior.salesAmount);
    return {
      sku: c.sku,
      asin,
      title: c.row.productName?.trim() || c.sku,
      thumbnailUrl: thumb,
      inventory: qty,
      unitsSold: c.units,
      salesTotal: c.salesAmount,
      salesCurrency: c.salesCurrency,
      priorUnitsSold: prior.units,
      priorSalesTotal: prior.salesAmount,
      unitsDeltaPct: u.pct,
      ...(u.fromZero ? { unitsDeltaFromZero: true } : {}),
      salesDeltaPct: s.pct,
      ...(s.fromZero ? { salesDeltaFromZero: true } : {}),
    };
  });

  return {
    topProducts,
    topProductsHint: hints.length > 0 ? hints.join(" ") : undefined,
  };
}

export async function fetchLiveSalesOverview(
  sp: SellingPartner,
  env: AppEnv,
): Promise<SalesOverviewPayload> {
  const [marketplaceId, skuExcluded] = await Promise.all([
    runSpStep("Sellers API (marketplace)", () => resolveMarketplaceId(sp, env)),
    loadSkuExclusionsSet(),
  ]);

  const yRange = getOrderMetricsRange("day");
  const tenRange = getTenDayOrderMetricsRange();
  const priorRange = getPriorTenDayRange();

  const [yPayload, tenPayload, priorPayload] = await Promise.all([
    runSpStep("Sales API (yesterday)", () =>
      fetchOrderMetrics(sp, marketplaceId, yRange.interval, yRange.granularity),
    ),
    runSpStep("Sales API (10-day)", () =>
      fetchOrderMetrics(sp, marketplaceId, tenRange.interval, tenRange.granularity),
    ),
    (async () => {
      try {
        return await runSpStep("Sales API (prior 10-day)", () =>
          fetchOrderMetrics(sp, marketplaceId, priorRange.interval, priorRange.granularity),
        );
      } catch {
        return null;
      }
    })(),
  ]);

  const yRows = parseOrderMetricsPayload(yPayload);
  const yAgg = sumOrderMetricsTotals(yRows);
  const yesterday: MetricsWindowTotals = {
    label: yRange.label,
    totalUnits: yAgg.totalUnits,
    totalSalesAmount: yAgg.totalSalesAmount,
    totalSalesCurrency: yAgg.totalSalesCurrency,
  };

  const tenRows = parseOrderMetricsPayload(tenPayload);
  const series = rowsToSeries(tenRows);
  const tenAgg = sumOrderMetricsTotals(tenRows);
  const spanDays = 10;
  const avgUnitsPerDay = tenAgg.totalUnits / spanDays;
  const avgSalesPerDay =
    tenAgg.totalSalesAmount != null ? tenAgg.totalSalesAmount / spanDays : null;

  let priorTenDay: MetricsWindowTotals | null = null;
  if (priorPayload != null) {
    const priorRows = parseOrderMetricsPayload(priorPayload);
    const priorAgg = sumOrderMetricsTotals(priorRows);
    priorTenDay = {
      label: priorRange.label,
      totalUnits: priorAgg.totalUnits,
      totalSalesAmount: priorAgg.totalSalesAmount,
      totalSalesCurrency: priorAgg.totalSalesCurrency,
    };
  }

  let topProducts: SalesOverviewTopProductRow[] = [];
  let topProductsHint: string | undefined;
  try {
    const built = await buildTopProducts(
      sp,
      marketplaceId,
      env,
      tenRange.interval,
      priorRange.interval,
      skuExcluded,
    );
    topProducts = built.topProducts;
    topProductsHint = built.topProductsHint;
  } catch {
    topProducts = [];
  }

  return {
    mode: "live",
    marketplaceId,
    yesterday,
    tenDay: {
      rangeLabel: tenRange.label,
      series,
      totals: {
        label: tenRange.label,
        totalUnits: tenAgg.totalUnits,
        totalSalesAmount: tenAgg.totalSalesAmount,
        totalSalesCurrency: tenAgg.totalSalesCurrency,
      },
      avgUnitsPerDay,
      avgSalesPerDay,
      avgSalesCurrency: tenAgg.totalSalesCurrency,
    },
    priorTenDay,
    topProducts,
    topProductsHint,
  };
}
