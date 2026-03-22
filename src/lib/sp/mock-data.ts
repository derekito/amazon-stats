import { forecastDaysOfCover } from "@/lib/sp/forecast";
import {
  getOrderMetricsRange,
  getPriorOrderMetricsRange,
  intervalSpanDays,
  type SalesPeriod,
} from "@/lib/sp/intervals";
import { estimateRoughMargin } from "@/lib/sp/margin-estimate";
import { loadSkuExclusionsSet } from "@/lib/sp/load-sku-exclusions";
import { computeProductAlerts, velocityUnitsPerDay } from "@/lib/sp/product-insights";
import type { DashboardPayload, DashboardThresholds, ProductPagination, ProductRow } from "@/lib/sp/types";
import { assignVelocityTiers } from "@/lib/sp/velocity-tier";

/** Baseline window for mock ordered/sales scalars (matches former 90d copy). */
const MOCK_BASELINE_DAYS = 90;

const MOCK_THRESHOLDS: DashboardThresholds = {
  daysOfCoverWarnBelow: 14,
  defaultReorderPoint: 0,
  slowMoverMinStock: 30,
  slowMoverMaxOrdered: 0,
  replenishMaxUnits: 2,
  replenishMaxDaysCover: 30,
  digestDaysCoverWithin: 14,
};

/** Sample fee knobs for mock margin columns (live uses env). */
const MOCK_FEE_ASSUMPTIONS = {
  referralFeePercent: 15,
  fbaFlatPerUnit: 2,
  estimatedAcosPercent: 22,
} as const;

type MockSkuSeed = {
  sku: string;
  asin?: string;
  title: string;
  thumbnailUrl: string | null;
  quantityInStock: number;
  quantityOrdered: number;
  salesAmount: number | null;
  salesCurrency: string | null;
  /** Landed unit cost for rough margin demo. */
  unitCost?: number;
};

const baseProducts: MockSkuSeed[] = [
  {
    sku: "SKU-ALPHA-01",
    asin: "B08N5WRWNW",
    title: "Example wireless earbuds (mock)",
    thumbnailUrl: null,
    quantityInStock: 142,
    quantityOrdered: 38,
    salesAmount: 949.99,
    salesCurrency: "USD",
    unitCost: 22,
  },
  {
    sku: "SKU-BRAVO-02",
    asin: "B07ZPKBL9V",
    title: "USB-C charging cable 6ft (mock)",
    thumbnailUrl: null,
    quantityInStock: 890,
    quantityOrdered: 210,
    salesAmount: 1679.4,
    salesCurrency: "USD",
    unitCost: 5.2,
  },
  {
    sku: "SKU-CHARLIE-03",
    asin: "B09V3KXJPB",
    title: "Desk lamp LED adjustable (mock)",
    thumbnailUrl: null,
    quantityInStock: 56,
    quantityOrdered: 44,
    salesAmount: 1319.56,
    salesCurrency: "USD",
    unitCost: 18.5,
  },
  {
    sku: "SKU-DEAD-99",
    asin: "B0DEADMOCK",
    title: "Slow mover — high stock, no sales (mock)",
    thumbnailUrl: null,
    quantityInStock: 120,
    quantityOrdered: 0,
    salesAmount: null,
    salesCurrency: null,
  },
  {
    sku: "SKU-OUT-00",
    asin: "B0STOCKOUT",
    title: "Out of stock sample (mock)",
    thumbnailUrl: null,
    quantityInStock: 0,
    quantityOrdered: 12,
    salesAmount: 199.99,
    salesCurrency: "USD",
    unitCost: 11,
  },
];

function pointSalesFromUnits(unitCount: number): { salesAmount: number; salesCurrency: string } {
  return {
    salesAmount: Math.round(unitCount * 14.25 * 100) / 100,
    salesCurrency: "USD",
  };
}

function salesSeries(period: SalesPeriod) {
  const mult = period === "day" ? 1 : period === "week" ? 1.2 : period === "month" ? 0.9 : 1.1;
  if (period === "day") {
    const unitCount = Math.round((20 + 3) * mult);
    return [
      {
        label: "1d",
        unitCount,
        ...pointSalesFromUnits(unitCount),
      },
    ];
  }
  if (period === "week") {
    return Array.from({ length: 7 }, (_, i) => {
      const unitCount = Math.round((18 + (i % 5) * 3) * mult);
      return {
        label: `D${i + 1}`,
        unitCount,
        ...pointSalesFromUnits(unitCount),
      };
    });
  }
  if (period === "month") {
    return Array.from({ length: 30 }, (_, i) => {
      const unitCount = Math.round((12 + (i % 7) * 2) * mult);
      return {
        label: `d${i + 1}`,
        unitCount,
        ...pointSalesFromUnits(unitCount),
      };
    });
  }
  return Array.from({ length: 13 }, (_, i) => {
    const unitCount = Math.round((80 + i * 5) * mult);
    return {
      label: `W${i + 1}`,
      unitCount,
      ...pointSalesFromUnits(unitCount),
    };
  });
}

function mockProductPagination(
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

export function getMockDashboard(
  period: SalesPeriod,
  options?: { productPage?: number; productPageSize?: number },
): DashboardPayload {
  const requestedSize = options?.productPageSize ?? 40;
  const unlimited = requestedSize <= 0;
  const pageSizeCap = 50_000;
  const range = getOrderMetricsRange(period);
  const priorRange = getPriorOrderMetricsRange(period);
  const days = intervalSpanDays(range.interval);
  const scale = days / MOCK_BASELINE_DAYS;
  const series = salesSeries(period);
  const currentTotalUnits = series.reduce((s, p) => s + p.unitCount, 0);
  const priorTotalUnits = Math.max(0, Math.round(currentTotalUnits * 0.91));
  const currentSales = Math.round(currentTotalUnits * 14.25 * 100) / 100;
  const priorSales = Math.round(priorTotalUnits * 13.9 * 100) / 100;

  const skuExcluded = loadSkuExclusionsSet();
  const excludedSkuCount = baseProducts.filter((p) => skuExcluded.has(p.sku)).length;
  const baseFiltered = baseProducts.filter((p) => !skuExcluded.has(p.sku));

  const scaled: ProductRow[] = baseFiltered.map((p) => {
    const ordered = Math.max(0, Math.round(p.quantityOrdered * scale));
    const salesAmount =
      p.salesAmount == null ? null : Math.round(p.salesAmount * scale * 100) / 100;
    const foc = forecastDaysOfCover(p.quantityInStock, ordered, days);
    const alerts = computeProductAlerts({
      quantityInStock: p.quantityInStock,
      quantityOrdered: ordered,
      forecastDaysOfCover: foc,
      daysOfCoverThreshold: MOCK_THRESHOLDS.daysOfCoverWarnBelow,
      defaultReorderPoint: MOCK_THRESHOLDS.defaultReorderPoint,
      slowMoverMinStock: MOCK_THRESHOLDS.slowMoverMinStock,
      slowMoverMaxOrdered: MOCK_THRESHOLDS.slowMoverMaxOrdered,
      replenish: {
        replenishMaxUnits: MOCK_THRESHOLDS.replenishMaxUnits,
        replenishMaxDaysCover: MOCK_THRESHOLDS.replenishMaxDaysCover,
      },
    });
    const unitCost = p.unitCost ?? null;
    const unitCostCurrency =
      unitCost != null ? (p.salesCurrency ?? "USD") : null;
    let estimatedAmazonFees: number | null = null;
    let estimatedCogs: number | null = null;
    let estimatedMargin: number | null = null;
    let estimatedMarginPercent: number | null = null;
    let estimatedAdSpend: number | null = null;
    if (salesAmount != null && salesAmount > 0) {
      estimatedAdSpend =
        Math.round(
          salesAmount * (MOCK_FEE_ASSUMPTIONS.estimatedAcosPercent / 100) * 100,
        ) / 100;
    }
    if (salesAmount != null && ordered > 0) {
      const est = estimateRoughMargin({
        salesAmount,
        quantityOrdered: ordered,
        unitCost,
        referralFeePercent: MOCK_FEE_ASSUMPTIONS.referralFeePercent,
        fbaFlatPerUnit: MOCK_FEE_ASSUMPTIONS.fbaFlatPerUnit,
        estimatedAdSpend: estimatedAdSpend ?? 0,
      });
      estimatedAmazonFees = est.estimatedAmazonFees;
      estimatedCogs = est.estimatedCogs;
      estimatedMargin = est.estimatedMargin;
      estimatedMarginPercent = est.estimatedMarginPercent;
    }
    return {
      sku: p.sku,
      asin: p.asin,
      title: p.title,
      thumbnailUrl: p.thumbnailUrl,
      quantityInStock: p.quantityInStock,
      quantityOrdered: ordered,
      salesAmount,
      salesCurrency: p.salesCurrency,
      forecastDaysOfCover: foc,
      velocityPerDay: velocityUnitsPerDay(ordered, days),
      alerts,
      unitCost,
      unitCostCurrency,
      estimatedAmazonFees,
      estimatedCogs,
      estimatedMargin,
      estimatedMarginPercent,
      estimatedAdSpend,
      velocityTier: null,
      amazonRecommendedReplenishQty:
        p.sku === "SKU-OUT-00" ? 48 : p.sku === "SKU-DEAD-99" ? 0 : Math.max(0, 24 - (p.quantityInStock % 40)),
      amazonRecommendedShipDate: p.sku === "SKU-OUT-00" ? "2026-03-25" : null,
    };
  });

  const sorted = [...scaled].sort((a, b) => b.quantityInStock - a.quantityInStock);
  const totalRows = sorted.length;

  let products: ProductRow[];
  let productPagination: ProductPagination;
  if (unlimited) {
    products = assignVelocityTiers(sorted);
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
    const pageSize = Math.min(Math.max(1, requestedSize), pageSizeCap);
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    const page = Math.min(Math.max(1, options?.productPage ?? 1), totalPages);
    const start = (page - 1) * pageSize;
    products = assignVelocityTiers(sorted.slice(start, start + pageSize));
    productPagination = mockProductPagination(page, pageSize, totalRows);
  }

  return {
    mode: "mock",
    marketplaceId: "ATVPDKIKX0DER",
    period,
    rangeLabel: `${range.label} · sample`,
    sales: {
      series,
      currentPeriod: {
        label: range.label,
        totalUnits: currentTotalUnits,
        totalSalesAmount: currentSales,
        totalSalesCurrency: "USD",
      },
      priorPeriod: {
        label: priorRange.label,
        totalUnits: priorTotalUnits,
        totalSalesAmount: priorSales,
        totalSalesCurrency: "USD",
      },
    },
    products,
    productPagination,
    thresholds: MOCK_THRESHOLDS,
    feeAssumptions: {
      referralFeePercent: MOCK_FEE_ASSUMPTIONS.referralFeePercent,
      fbaFlatPerUnit: MOCK_FEE_ASSUMPTIONS.fbaFlatPerUnit,
      estimatedAcosPercent: MOCK_FEE_ASSUMPTIONS.estimatedAcosPercent,
    },
    excludedSkuCount,
    restockReport: {
      asOf: new Date().toISOString(),
      skuCountInReport: baseFiltered.length,
    },
  };
}
