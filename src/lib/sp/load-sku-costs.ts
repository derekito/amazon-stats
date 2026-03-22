import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";

export type SkuCostEntry = {
  unitCost: number;
  /** Defaults to marketplace sales currency when omitted. */
  currency?: string;
};

const SKU_COSTS_FILE = "sku-costs.json";

function skuCostsFilePath(): string {
  return path.join(process.cwd(), "data", SKU_COSTS_FILE);
}

/** Optional `data/sku-costs.json`: `{ "MY-SKU": { "unitCost": 8.5, "currency": "USD" } }` */
export function loadSkuCostsMap(): Record<string, SkuCostEntry> {
  const filePath = skuCostsFilePath();
  if (!existsSync(filePath)) return {};
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: Record<string, SkuCostEntry> = {};
    for (const [sku, v] of Object.entries(raw)) {
      if (!v || typeof v !== "object") continue;
      const o = v as { unitCost?: unknown; currency?: unknown };
      const n = typeof o.unitCost === "number" ? o.unitCost : Number(o.unitCost);
      if (!Number.isFinite(n) || n < 0) continue;
      const currency =
        typeof o.currency === "string" && o.currency.length > 0 ? o.currency : undefined;
      out[sku] = { unitCost: n, ...(currency ? { currency } : {}) };
    }
    return out;
  } catch {
    return {};
  }
}

/** Writes `data/sku-costs.json` (creates `data/` if needed). */
export function saveSkuCostsMap(map: Record<string, SkuCostEntry>): void {
  const dir = path.join(process.cwd(), "data");
  mkdirSync(dir, { recursive: true });
  writeFileSync(skuCostsFilePath(), `${JSON.stringify(map, null, 2)}\n`, "utf8");
}
