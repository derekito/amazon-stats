import type { SalesPeriod } from "@/lib/sp/intervals";

export type DashboardMode = "live" | "mock";

export type SalesPoint = {
  label: string;
  unitCount: number;
  /** Per-interval ordered product sales from getOrderMetrics when present. */
  salesAmount: number | null;
  salesCurrency: string | null;
};

export type ProductAlert =
  | "stockout"
  | "low_days_cover"
  | "below_reorder"
  | "slow_mover"
  /** FBA ≤ replenish max units OR days of cover ≤ max (ship/replenish rule). */
  | "replenish";

/** Velocity tier: A = top third, B = middle, C = bottom third on this page (by units/day). */
export type VelocityTier = "A" | "B" | "C";

export type MetricsWindowTotals = {
  label: string;
  totalUnits: number;
  totalSalesAmount: number | null;
  totalSalesCurrency: string | null;
};

export type ProductRow = {
  sku: string;
  asin?: string;
  title: string;
  thumbnailUrl: string | null;
  quantityInStock: number;
  quantityOrdered: number;
  /** Same window as quantityOrdered (per-SKU Sales `Total` over the chart interval); null if not fetched. */
  salesAmount: number | null;
  salesCurrency: string | null;
  forecastDaysOfCover: number | null;
  /** Average units per day over the dashboard window (ordered ÷ window days). */
  velocityPerDay: number | null;
  /** Server-side flags from thresholds + optional `data/sku-thresholds.json`. */
  alerts: ProductAlert[];
  /** ABC-style tier from velocity rank on this page (not account-wide if table is paginated). */
  velocityTier: VelocityTier | null;
  /** From optional `data/sku-costs.json`; null if not set. */
  unitCost: number | null;
  unitCostCurrency: string | null;
  /** Rough: referral % × sales + flat FBA × units; null if no sales in window. */
  estimatedAmazonFees: number | null;
  estimatedCogs: number | null;
  /** When unit cost exists: sales − est. fees − COGS − est. ad spend; % of sales. */
  estimatedMargin: number | null;
  estimatedMarginPercent: number | null;
  /**
   * Allocated ad spend = sales × (feeAssumptions.estimatedAcosPercent / 100) when sales > 0.
   * Same account-level ACOS applied to each SKU’s sales in the window—not campaign-level data.
   */
  estimatedAdSpend: number | null;
  /**
   * Amazon Restock Inventory Recommendations report (`GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT`).
   * Null when disabled, no report, or SKU not listed in the file.
   */
  amazonRecommendedReplenishQty: number | null;
  /** Same report: raw recommended ship date string from Amazon, if present. */
  amazonRecommendedShipDate: string | null;
};

/** Server orders inventory before paging; Sales API has no SKU “leaderboard” without N per-SKU calls. */
export type ProductPagination = {
  page: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  sort: "fba_quantity_desc";
};

export type DashboardThresholds = {
  daysOfCoverWarnBelow: number;
  defaultReorderPoint: number;
  slowMoverMinStock: number;
  /** Slow-mover when ordered units in the window are ≤ this value. */
  slowMoverMaxOrdered: number;
  /** FBA qty ≤ this → replenish alert (default 2). */
  replenishMaxUnits: number;
  /** Days of cover ≤ this → replenish alert (default 30). */
  replenishMaxDaysCover: number;
  /** Weekly digest: include SKUs with ≤ this many days of cover (default 14). */
  digestDaysCoverWithin: number;
};

/** Shown with margin columns — rough assumptions, not settlement. */
export type FeeAssumptions = {
  referralFeePercent: number;
  fbaFlatPerUnit: number;
  /** Account-wide ACOS % applied to each SKU’s sales to estimate allocated ad spend. */
  estimatedAcosPercent: number;
};

export type DashboardPayload = {
  mode: DashboardMode;
  marketplaceId: string;
  period: SalesPeriod;
  rangeLabel: string;
  sales: {
    series: SalesPoint[];
    currentPeriod: MetricsWindowTotals;
    /** Same-length window immediately before current; null if the prior Sales call failed. */
    priorPeriod: MetricsWindowTotals | null;
  };
  products: ProductRow[];
  productPagination: ProductPagination;
  thresholds: DashboardThresholds;
  feeAssumptions: FeeAssumptions;
  /** Count of FBA SKUs omitted via `data/sku-exclusions.json`. */
  excludedSkuCount: number;
  /**
   * Present when a Restock report was loaded for this response (live mode).
   * `skuCountInReport` is rows parsed from the TSV (not limited to the current table page).
   */
  restockReport?: { asOf: string | null; skuCountInReport: number };
  /**
   * Live dashboard only: explains empty “Amz suggest qty” when reports are missing or unparsed.
   */
  amazonReplenishHint?: string;
  warning?: string;
};
