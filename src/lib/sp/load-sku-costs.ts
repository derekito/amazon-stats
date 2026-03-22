import "server-only";

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";

import { get, put } from "@vercel/blob";

export type SkuCostEntry = {
  unitCost: number;
  /** Defaults to marketplace sales currency when omitted. */
  currency?: string;
};

const SKU_COSTS_FILE = "sku-costs.json";

/** Stable pathname in the Vercel Blob store (private). */
const BLOB_PATHNAME = "amazon-sales/sku-costs.json";

function skuCostsFilePath(): string {
  return path.join(process.cwd(), "data", SKU_COSTS_FILE);
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

async function loadFromBlob(): Promise<Record<string, SkuCostEntry>> {
  const result = await get(BLOB_PATHNAME, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200 || !result.stream) return {};
  const text = await new Response(result.stream).text();
  try {
    return parseSkuCostsRecord(JSON.parse(text) as unknown);
  } catch {
    return {};
  }
}

function loadFromFile(): Record<string, SkuCostEntry> {
  const filePath = skuCostsFilePath();
  if (!existsSync(filePath)) return {};
  try {
    return parseSkuCostsRecord(JSON.parse(readFileSync(filePath, "utf8")) as unknown);
  } catch {
    return {};
  }
}

/** Optional unit costs — from Blob (Vercel) or `data/sku-costs.json` (local). */
export async function loadSkuCostsMap(): Promise<Record<string, SkuCostEntry>> {
  if (blobEnabled()) {
    try {
      return await loadFromBlob();
    } catch {
      return {};
    }
  }
  return loadFromFile();
}

/** Writes unit costs to Blob or `data/sku-costs.json`. */
export async function saveSkuCostsMap(map: Record<string, SkuCostEntry>): Promise<void> {
  const body = `${JSON.stringify(map, null, 2)}\n`;

  if (blobEnabled()) {
    await put(BLOB_PATHNAME, body, {
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
    writeFileSync(skuCostsFilePath(), body, "utf8");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Cannot write SKU costs (${msg}). On Vercel, add a Blob store so BLOB_READ_WRITE_TOKEN is set (Project → Storage → Blob).`,
    );
  }
}
