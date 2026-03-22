import "server-only";

import { parseISO } from "date-fns";
import type { SellingPartner } from "amazon-sp-api";

import { forecastDaysOfCover } from "@/lib/sp/forecast";
import {
  getOrderMetricsRange,
  getPriorOrderMetricsRange,
  intervalSpanDays,
  type SalesPeriod,
} from "@/lib/sp/intervals";
import { loadSkuCostsMap } from "@/lib/sp/load-sku-costs";
import { loadSkuExclusionsSet } from "@/lib/sp/load-sku-exclusions";
import { loadSkuThresholdsMap } from "@/lib/sp/load-sku-thresholds";
import { estimateRoughMargin } from "@/lib/sp/margin-estimate";
import { computeProductAlerts, velocityUnitsPerDay } from "@/lib/sp/product-insights";
import {
  fetchAllInventorySummaries,
  inventoryDisplayQuantity,
  sortInventoryByFbaQuantity,
  type InventorySummaryRow,
} from "@/lib/sp/inventory-summaries";
import { resolveMarketplaceId } from "@/lib/sp/marketplace";
import {
  metricTotalSalesFromRow,
  metricUnitCount,
  parseOrderMetricsPayload,
  sumOrderMetricsTotals,
} from "@/lib/sp/parse-order-metrics";
import {
  fetchRestockRecommendationsBySku,
  type RestockReportLoadResult,
} from "@/lib/sp/restock-recommendations";
import { runSpStep } from "@/lib/sp/sp-step";
import { assignVelocityTiers } from "@/lib/sp/velocity-tier";
import type {
  DashboardPayload,
  DashboardThresholds,
  FeeAssumptions,
  MetricsWindowTotals,
  ProductPagination,
  ProductRow,
  SalesPoint,
} from "@/lib/sp/types";
import type { AppEnv } from "@/lib/env";

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

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Compact UTC date per bucket (SP-API intervals use Z); unique per day/week start. */
function shortLabelFromInterval(interval: string | undefined, index: number): string {
  if (!interval) return String(index + 1);
  const start = parseISO(interval.split("--")[0]?.trim() ?? "");
  if (Number.isNaN(start.getTime())) return String(index + 1);
  const m = start.getUTCMonth() + 1;
  const d = start.getUTCDate();
  const y = String(start.getUTCFullYear()).slice(2);
  return `${m}/${d}/${y}`;
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

export type DashboardProductPageOptions = {
  productPage: number;
  productPageSize: number;
};

function buildProductPagination(
  page: number,
  pageSize: number,
  totalRows: number,
): ProductPagination {
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  return {
    page,
    pageSize,
    totalRows,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
    sort: "fba_quantity_desc",
  };
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
    /** Required for granularity > Hour when using Z intervals (Sales API reference). */
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

export async function fetchLiveDashboard(
  sp: SellingPartner,
  env: AppEnv,
  period: SalesPeriod,
  pageOptions: DashboardProductPageOptions = { productPage: 1, productPageSize: 40 },
): Promise<DashboardPayload> {
  const marketplaceId = await runSpStep("Sellers API (marketplace)", () =>
    resolveMarketplaceId(sp, env),
  );
  const range = getOrderMetricsRange(period);
  const priorRange = getPriorOrderMetricsRange(period);
  const forecastWindowDays = intervalSpanDays(range.interval);
  const skuThresholds = loadSkuThresholdsMap();
  const skuCosts = await loadSkuCostsMap();
  const skuExcluded = await loadSkuExclusionsSet();
  const referralFeePercent = env.SP_DASHBOARD_REFERRAL_FEE_PERCENT;
  const fbaFeePerUnit = env.SP_DASHBOARD_FBA_FEE_PER_UNIT;
  const estimatedAcosPercent = env.SP_DASHBOARD_ESTIMATED_ACOS_PERCENT;

  const thresholds: DashboardThresholds = {
    daysOfCoverWarnBelow: env.SP_DASHBOARD_DAYS_OF_COVER_THRESHOLD,
    defaultReorderPoint: env.SP_DASHBOARD_DEFAULT_REORDER_POINT,
    slowMoverMinStock: env.SP_DASHBOARD_SLOW_MOVER_MIN_STOCK,
    slowMoverMaxOrdered: env.SP_DASHBOARD_SLOW_MOVER_MAX_ORDERED,
    replenishMaxUnits: env.SP_DASHBOARD_REPLENISH_MAX_UNITS,
    replenishMaxDaysCover: env.SP_DASHBOARD_REPLENISH_MAX_DAYS_COVER,
    digestDaysCoverWithin: env.SP_DIGEST_DAYS_COVER_WITHIN,
  };

  const feeAssumptions: FeeAssumptions = {
    referralFeePercent,
    fbaFlatPerUnit: fbaFeePerUnit,
    estimatedAcosPercent,
  };

  const [metricsPayload, invWrap, priorPayload, restockLoad] = await Promise.all([
    runSpStep("Sales API (getOrderMetrics)", () =>
      fetchOrderMetrics(sp, marketplaceId, range.interval, range.granularity),
    ),
    (async () => {
      try {
        return await runSpStep("FBA Inventory API (getInventorySummaries)", () =>
          fetchAllInventorySummaries(sp, marketplaceId, env.SP_API_MAX_INVENTORY_PAGES),
        );
      } catch {
        return { summaries: [] as InventorySummaryRow[], truncated: false };
      }
    })(),
    (async () => {
      try {
        return await fetchOrderMetrics(
          sp,
          marketplaceId,
          priorRange.interval,
          priorRange.granularity,
        );
      } catch {
        return null;
      }
    })(),
    (async (): Promise<RestockReportLoadResult> => {
      if (!env.SP_API_FETCH_RESTOCK_REPORT) {
        return { bySku: new Map(), asOf: null, loadedFromAmazon: false };
      }
      try {
        return await fetchRestockRecommendationsBySku(
          sp,
          marketplaceId,
          env.SP_API_RESTOCK_REPORT_MAX_AGE_HOURS,
        );
      } catch {
        return { bySku: new Map(), asOf: null, loadedFromAmazon: false };
      }
    })(),
  ]);

  const rows = parseOrderMetricsPayload(metricsPayload);
  const series: SalesPoint[] = rows.map((row, i) => {
    const sales = metricTotalSalesFromRow(row);
    return {
      label: shortLabelFromInterval(row.interval, i),
      unitCount: metricUnitCount(row),
      salesAmount: sales?.amount ?? null,
      salesCurrency: sales?.currencyCode ?? null,
    };
  });

  const currentAgg = sumOrderMetricsTotals(rows);
  const currentPeriod: MetricsWindowTotals = {
    label: range.label,
    totalUnits: currentAgg.totalUnits,
    totalSalesAmount: currentAgg.totalSalesAmount,
    totalSalesCurrency: currentAgg.totalSalesCurrency,
  };

  let priorPeriod: MetricsWindowTotals | null = null;
  if (priorPayload != null) {
    const priorRows = parseOrderMetricsPayload(priorPayload);
    const priorAgg = sumOrderMetricsTotals(priorRows);
    priorPeriod = {
      label: priorRange.label,
      totalUnits: priorAgg.totalUnits,
      totalSalesAmount: priorAgg.totalSalesAmount,
      totalSalesCurrency: priorAgg.totalSalesCurrency,
    };
  }

  const inventoryRaw = invWrap.summaries;
  const inventoryTruncated = invWrap.truncated;
  const excludedSkuCount = inventoryRaw.filter((r) => {
    const s = r.sellerSku?.trim() ?? "";
    return s.length > 0 && skuExcluded.has(s);
  }).length;
  const inventory = filterExcludedInventory(inventoryRaw, skuExcluded);

  const inventorySorted = sortInventoryByFbaQuantity(inventory);
  const totalRows = inventory.length;
  const unlimited = pageOptions.productPageSize <= 0;
  const pageSizeCap = 50_000;
  let pageRows: InventorySummaryRow[];
  let productPagination: ProductPagination;
  if (unlimited) {
    pageRows = inventorySorted;
    productPagination = {
      page: 1,
      pageSize: totalRows,
      totalRows,
      totalPages: 1,
      hasNextPage: false,
      hasPrevPage: false,
      sort: "fba_quantity_desc",
    };
  } else {
    const pageSize = Math.min(Math.max(1, pageOptions.productPageSize), pageSizeCap);
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    const page = Math.min(Math.max(1, pageOptions.productPage), totalPages);
    const pageStart = (page - 1) * pageSize;
    pageRows = inventorySorted.slice(pageStart, pageStart + pageSize);
    productPagination = buildProductPagination(page, pageSize, totalRows);
  }

  const asinsOrdered: string[] = [];
  const asinSeen = new Set<string>();
  for (const row of pageRows) {
    if (!row.asin || asinSeen.has(row.asin)) continue;
    if (asinsOrdered.length >= env.SP_API_MAX_ASIN_THUMBNAILS) break;
    asinSeen.add(row.asin);
    asinsOrdered.push(row.asin);
  }
  const asinsTruncated =
    env.SP_API_MAX_ASIN_THUMBNAILS > 0 &&
    [...new Set(pageRows.map((r) => r.asin).filter(Boolean))].length > asinsOrdered.length;

  const skusOrdered: string[] = [];
  for (const row of pageRows) {
    if (!row.sellerSku) continue;
    if (skusOrdered.length >= env.SP_API_MAX_SKU_METRICS) break;
    skusOrdered.push(row.sellerSku);
  }
  const skuCountOnPage = pageRows.filter((r) => r.sellerSku).length;
  const skuMetricsCapped =
    env.SP_API_MAX_SKU_METRICS > 0 && skusOrdered.length < skuCountOnPage;

  /** Catalog + per-SKU Sales are independent — run in parallel to cut wall time before the server timeout. */
  const [imageByAsin, skuMetricsBySku] = await Promise.all([
    (async () => {
      const map = new Map<string, string | null>();
      const ASIN_CONCURRENCY = 4;
      for (let i = 0; i < asinsOrdered.length; i += ASIN_CONCURRENCY) {
        const chunk = asinsOrdered.slice(i, i + ASIN_CONCURRENCY);
        const results = await Promise.all(
          chunk.map(async (asin) => {
            const url = await fetchThumbnailForAsin(sp, marketplaceId, asin);
            return { asin, url };
          }),
        );
        for (const { asin, url } of results) map.set(asin, url);
        if (i + ASIN_CONCURRENCY < asinsOrdered.length) await delay(150);
      }
      return map;
    })(),
    (async () => {
      const map = new Map<
        string,
        { units: number; salesAmount: number | null; salesCurrency: string | null }
      >();
      const SKU_BATCH = 5;
      for (let i = 0; i < skusOrdered.length; i += SKU_BATCH) {
        const chunk = skusOrdered.slice(i, i + SKU_BATCH);
        await Promise.all(
          chunk.map(async (sku) => {
            try {
              const p = await fetchOrderMetrics(sp, marketplaceId, range.interval, "Total", sku);
              const skuRows = parseOrderMetricsPayload(p);
              let units = 0;
              let salesSum = 0;
              let salesCurrency: string | null = null;
              let hasSales = false;
              for (const r of skuRows) {
                units += metricUnitCount(r);
                const money = metricTotalSalesFromRow(r);
                if (money) {
                  hasSales = true;
                  salesSum += money.amount;
                  salesCurrency = salesCurrency ?? money.currencyCode;
                }
              }
              map.set(sku, {
                units,
                salesAmount: hasSales ? salesSum : null,
                salesCurrency,
              });
            } catch {
              map.set(sku, { units: 0, salesAmount: null, salesCurrency: null });
            }
          }),
        );
        if (i + SKU_BATCH < skusOrdered.length) await delay(250);
      }
      return map;
    })(),
  ]);

  const products: ProductRow[] = assignVelocityTiers(
    pageRows.map((row) => {
    const sku = row.sellerSku ?? "";
    const qty = inventoryDisplayQuantity(row);
    const m = skuMetricsBySku.get(sku);
    const ordered = m?.units ?? 0;
    const salesAmount = m?.salesAmount ?? null;
    const salesCurrency = m?.salesCurrency ?? null;
    const thumb = row.asin ? imageByAsin.get(row.asin) ?? null : null;
    const foc = forecastDaysOfCover(qty, ordered, forecastWindowDays);
    const th = sku ? skuThresholds[sku] : undefined;
    const alerts = computeProductAlerts({
      quantityInStock: qty,
      quantityOrdered: ordered,
      forecastDaysOfCover: foc,
      daysOfCoverThreshold: env.SP_DASHBOARD_DAYS_OF_COVER_THRESHOLD,
      defaultReorderPoint: env.SP_DASHBOARD_DEFAULT_REORDER_POINT,
      skuReorderPoint: th?.reorderPoint,
      slowMoverMinStock: env.SP_DASHBOARD_SLOW_MOVER_MIN_STOCK,
      slowMoverMaxOrdered: env.SP_DASHBOARD_SLOW_MOVER_MAX_ORDERED,
      replenish: {
        replenishMaxUnits: env.SP_DASHBOARD_REPLENISH_MAX_UNITS,
        replenishMaxDaysCover: env.SP_DASHBOARD_REPLENISH_MAX_DAYS_COVER,
        skuReplenishMaxUnits: th?.replenishMaxUnits,
        skuReplenishMaxDaysCover: th?.replenishMaxDaysCover,
      },
    });
    const restockRec = sku ? restockLoad.bySku.get(sku) : undefined;
    const costEntry = sku ? skuCosts[sku] : undefined;
    const unitCost = costEntry?.unitCost ?? null;
    const unitCostCurrency =
      unitCost != null ? (costEntry?.currency ?? salesCurrency) : null;
    let estimatedAmazonFees: number | null = null;
    let estimatedCogs: number | null = null;
    let estimatedMargin: number | null = null;
    let estimatedMarginPercent: number | null = null;
    let estimatedAdSpend: number | null = null;
    if (salesAmount != null && salesAmount > 0) {
      estimatedAdSpend =
        Math.round(salesAmount * (estimatedAcosPercent / 100) * 100) / 100;
    }
    if (salesAmount != null && ordered > 0) {
      const adForMargin = estimatedAdSpend ?? 0;
      const est = estimateRoughMargin({
        salesAmount,
        quantityOrdered: ordered,
        unitCost,
        referralFeePercent,
        fbaFlatPerUnit: fbaFeePerUnit,
        estimatedAdSpend: adForMargin,
      });
      estimatedAmazonFees = est.estimatedAmazonFees;
      estimatedCogs = est.estimatedCogs;
      estimatedMargin = est.estimatedMargin;
      estimatedMarginPercent = est.estimatedMarginPercent;
    }
    return {
      sku,
      asin: row.asin,
      title: row.productName ?? (sku || "Unknown"),
      thumbnailUrl: thumb,
      quantityInStock: qty,
      quantityOrdered: ordered,
      salesAmount,
      salesCurrency,
      forecastDaysOfCover: foc,
      velocityPerDay: velocityUnitsPerDay(ordered, forecastWindowDays),
      alerts,
      unitCost,
      unitCostCurrency,
      estimatedAmazonFees,
      estimatedCogs,
      estimatedMargin,
      estimatedMarginPercent,
      estimatedAdSpend,
      velocityTier: null,
      amazonRecommendedReplenishQty: restockRec?.recommendedQty ?? null,
      amazonRecommendedShipDate: restockRec?.recommendedShipDate ?? null,
    };
    }),
  );

  const warningParts: string[] = [];
  if (inventory.length === 0) {
    warningParts.push(
      "No FBA inventory summaries returned. MFN-only or empty FBA inventory will show an empty table.",
    );
  }
  if (inventoryTruncated) {
    warningParts.push(
      `FBA inventory list truncated after ${env.SP_API_MAX_INVENTORY_PAGES} pages (SP_API_MAX_INVENTORY_PAGES). Increase if you need all SKUs.`,
    );
  }
  if (env.SP_API_MAX_ASIN_THUMBNAILS === 0) {
    warningParts.push(
      "Catalog thumbnails disabled (SP_API_MAX_ASIN_THUMBNAILS=0). Set a positive value to load images.",
    );
  } else if (asinsTruncated) {
    warningParts.push(
      `Catalog thumbnails on this page limited to ${env.SP_API_MAX_ASIN_THUMBNAILS} ASINs (SP_API_MAX_ASIN_THUMBNAILS).`,
    );
  }
  if (env.SP_API_MAX_SKU_METRICS === 0) {
    warningParts.push(
      "Per-SKU order metrics disabled (SP_API_MAX_SKU_METRICS=0). Ordered qty, sales $, and forecast use 0 or —.",
    );
  } else if (skuMetricsCapped) {
    warningParts.push(
      `Per-SKU order metrics on this page capped at ${env.SP_API_MAX_SKU_METRICS} SKUs (SP_API_MAX_SKU_METRICS); remaining rows show 0 / —.`,
    );
  }

  const restockReport =
    env.SP_API_FETCH_RESTOCK_REPORT &&
    (restockLoad.loadedFromAmazon || restockLoad.bySku.size > 0)
      ? {
          asOf: restockLoad.asOf,
          skuCountInReport: restockLoad.bySku.size,
        }
      : undefined;

  let amazonReplenishHint: string | undefined;
  if (env.SP_API_FETCH_RESTOCK_REPORT) {
    if (!restockLoad.loadedFromAmazon) {
      amazonReplenishHint =
        "Amz suggest qty needs a completed report from Amazon. In Seller Central: Reports → Fulfillment by Amazon (FBA) — request the new “FBA Inventory” report and/or “Restock Inventory” (legacy), wait until status is Done, then refresh. In the Reports API these map to GET_FBA_INVENTORY_PLANNING_DATA and GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT.";
    } else if (restockLoad.bySku.size === 0) {
      amazonReplenishHint =
        "Amazon returned a report file, but no SKU rows were parsed (column headers may have changed).";
    }
  }

  return {
    mode: "live",
    marketplaceId,
    period,
    rangeLabel: range.label,
    sales: { series, currentPeriod, priorPeriod },
    products,
    productPagination,
    thresholds,
    feeAssumptions,
    excludedSkuCount,
    ...(restockReport ? { restockReport } : {}),
    ...(amazonReplenishHint ? { amazonReplenishHint } : {}),
    ...(warningParts.length ? { warning: warningParts.join(" ") } : {}),
  };
}
