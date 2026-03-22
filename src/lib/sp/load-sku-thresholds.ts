import { existsSync, readFileSync } from "fs";
import path from "path";

export type SkuThresholdEntry = {
  reorderPoint?: number;
  /** Override env `SP_DASHBOARD_REPLENISH_MAX_UNITS` for this SKU. */
  replenishMaxUnits?: number;
  /** Override env `SP_DASHBOARD_REPLENISH_MAX_DAYS_COVER` for this SKU. */
  replenishMaxDaysCover?: number;
};

/** Optional `data/sku-thresholds.json`: `{ "MY-SKU": { "reorderPoint": 24, "replenishMaxUnits": 5 } }` */
export function loadSkuThresholdsMap(): Record<string, SkuThresholdEntry> {
  const filePath = path.join(process.cwd(), "data", "sku-thresholds.json");
  if (!existsSync(filePath)) return {};
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return raw as Record<string, SkuThresholdEntry>;
  } catch {
    return {};
  }
}
