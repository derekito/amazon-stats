import "server-only";

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";

import { get, put } from "@vercel/blob";

import type { StoreId } from "@/lib/store";

export type SkuCostEntry = {
  unitCost: number;
  /** Defaults to marketplace sales currency when omitted. */
  currency?: string;
};

const LEGACY_BLOB_PATH = "amazon-sales/sku-costs.json";

function blobPathForStore(storeId: StoreId): string {
  return `amazon-sales/${storeId}/sku-costs.json`;
}

function localFileName(storeId: StoreId): string {
  return storeId === "na" ? "sku-costs.json" : `sku-costs.${storeId}.json`;
}

function skuCostsFilePath(storeId: StoreId): string {
  return path.join(process.cwd(), "data", localFileName(storeId));
}

function blobEnabled(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

function parseSkuCostsRecord(raw: unknown): Record<string, SkuCostEntry> {
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
}

async function loadFromBlob(storeId: StoreId): Promise<Record<string, SkuCostEntry>> {
  const pathname = blobPathForStore(storeId);
  let result = await get(pathname, { access: "private", useCache: false });
  if (storeId === "na" && (!result || result.statusCode !== 200 || !result.stream)) {
    result = await get(LEGACY_BLOB_PATH, { access: "private", useCache: false });
  }
  if (!result || result.statusCode !== 200 || !result.stream) return {};
  const text = await new Response(result.stream).text();
  try {
    return parseSkuCostsRecord(JSON.parse(text) as unknown);
  } catch {
    return {};
  }
}

function loadFromFile(storeId: StoreId): Record<string, SkuCostEntry> {
  const filePath = skuCostsFilePath(storeId);
  if (!existsSync(filePath)) return {};
  try {
    return parseSkuCostsRecord(JSON.parse(readFileSync(filePath, "utf8")) as unknown);
  } catch {
    return {};
  }
}

/** Optional unit costs — from Blob (Vercel) or `data/sku-costs.json` (local, per store). */
export async function loadSkuCostsMap(storeId: StoreId = "na"): Promise<Record<string, SkuCostEntry>> {
  if (blobEnabled()) {
    try {
      return await loadFromBlob(storeId);
    } catch {
      return {};
    }
  }
  return loadFromFile(storeId);
}

/** Writes unit costs to Blob or `data/sku-costs.<store>.json`. */
export async function saveSkuCostsMap(
  map: Record<string, SkuCostEntry>,
  storeId: StoreId = "na",
): Promise<void> {
  const body = `${JSON.stringify(map, null, 2)}\n`;

  if (blobEnabled()) {
    await put(blobPathForStore(storeId), body, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
    return;
  }

  try {
    const dir = path.join(process.cwd(), "data");
    mkdirSync(dir, { recursive: true });
    writeFileSync(skuCostsFilePath(storeId), body, "utf8");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Cannot write SKU costs (${msg}). On Vercel, add a Blob store so BLOB_READ_WRITE_TOKEN is set (Project → Storage → Blob).`,
    );
  }
}
