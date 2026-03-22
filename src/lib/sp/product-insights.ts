import type { ProductAlert } from "@/lib/sp/types";

export type ReplenishThresholds = {
  /** Default from env; per-SKU overrides in `data/sku-thresholds.json`. */
  replenishMaxUnits: number;
  replenishMaxDaysCover: number;
  skuReplenishMaxUnits?: number;
  skuReplenishMaxDaysCover?: number;
};

export function computeProductAlerts(input: {
  quantityInStock: number;
  quantityOrdered: number;
  forecastDaysOfCover: number | null;
  daysOfCoverThreshold: number;
  defaultReorderPoint: number;
  skuReorderPoint?: number;
  slowMoverMinStock: number;
  /** Flag when units ordered in the window are at most this (inclusive). Default 0 = only zero orders. */
  slowMoverMaxOrdered: number;
  replenish: ReplenishThresholds;
}): ProductAlert[] {
  const alerts: ProductAlert[] = [];
  const reorder =
    input.skuReorderPoint ??
    (input.defaultReorderPoint > 0 ? input.defaultReorderPoint : undefined);

  const maxU =
    input.replenish.skuReplenishMaxUnits ?? input.replenish.replenishMaxUnits;
  const maxD =
    input.replenish.skuReplenishMaxDaysCover ?? input.replenish.replenishMaxDaysCover;

  if (input.quantityInStock === 0) {
    alerts.push("stockout");
  } else if (reorder !== undefined && input.quantityInStock < reorder) {
    alerts.push("below_reorder");
  }

  const needsReplenishByQty = input.quantityInStock <= maxU;
  const needsReplenishByCover =
    input.quantityInStock > 0 &&
    input.forecastDaysOfCover != null &&
    input.forecastDaysOfCover <= maxD;
  if (needsReplenishByQty || needsReplenishByCover) {
    alerts.push("replenish");
  }

  if (
    input.quantityInStock > 0 &&
    input.forecastDaysOfCover != null &&
    input.forecastDaysOfCover < input.daysOfCoverThreshold
  ) {
    alerts.push("low_days_cover");
  }

  if (
    input.quantityInStock >= input.slowMoverMinStock &&
    input.quantityOrdered <= input.slowMoverMaxOrdered
  ) {
    alerts.push("slow_mover");
  }

  return alerts;
}

export function velocityUnitsPerDay(ordered: number, windowDays: number): number | null {
  if (windowDays <= 0) return null;
  return Math.round((ordered / windowDays) * 100) / 100;
}
