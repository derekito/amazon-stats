import "server-only";

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";

import { get, put } from "@vercel/blob";

import type { StoreId } from "@/lib/store";

const LEGACY_BLOB_PATH = "amazon-sales/sku-exclusions.json";

function blobPathForStore(storeId: StoreId): string {
  return `amazon-sales/${storeId}/sku-exclusions.json`;
}

function localFileName(storeId: StoreId): string {
  return storeId === "na" ? "sku-exclusions.json" : `sku-exclusions.${storeId}.json`;
}

function filePath(storeId: StoreId): string {
  return path.join(process.cwd(), "data", localFileName(storeId));
}

function blobEnabled(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

function normalizeList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    const out: string[] = [];
    for (const x of raw) {
      if (typeof x !== "string") continue;
      const s = x.trim();
      if (s.length > 0) out.push(s);
    }
    return [...new Set(out)].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return Object.keys(raw as Record<string, unknown>)
      .map((k) => k.trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }
  return [];
}

function parseJsonList(text: string): string[] {
  try {
    return normalizeList(JSON.parse(text) as unknown);
  } catch {
    return [];
  }
}

async function loadFromBlob(storeId: StoreId): Promise<string[]> {
  const pathname = blobPathForStore(storeId);
  let result = await get(pathname, { access: "private", useCache: false });
  if (storeId === "na" && (!result || result.statusCode !== 200 || !result.stream)) {
    result = await get(LEGACY_BLOB_PATH, { access: "private", useCache: false });
  }
  if (!result || result.statusCode !== 200 || !result.stream) return [];
  const text = await new Response(result.stream).text();
  return parseJsonList(text);
}

function loadFromFile(storeId: StoreId): string[] {
  const fp = filePath(storeId);
  if (!existsSync(fp)) return [];
  try {
    return parseJsonList(readFileSync(fp, "utf8"));
  } catch {
    return [];
  }
}

/** SKUs hidden on the dashboard and costs UI — from Blob (Vercel) or `data/sku-exclusions.<store>.json` (local). */
export async function loadSkuExclusionsList(storeId: StoreId = "na"): Promise<string[]> {
  if (blobEnabled()) {
    try {
      return await loadFromBlob(storeId);
    } catch {
      return [];
    }
  }
  return loadFromFile(storeId);
}

export async function loadSkuExclusionsSet(storeId: StoreId = "na"): Promise<Set<string>> {
  return new Set(await loadSkuExclusionsList(storeId));
}

export async function saveSkuExclusionsList(skus: string[], storeId: StoreId = "na"): Promise<void> {
  const unique = [
    ...new Set(skus.map((s) => s.trim()).filter((s) => s.length > 0)),
  ].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  const body = `${JSON.stringify(unique, null, 2)}\n`;

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
    writeFileSync(filePath(storeId), body, "utf8");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Cannot write SKU exclusions (${msg}). On Vercel, add a Blob store so BLOB_READ_WRITE_TOKEN is set (Project → Storage → Blob).`,
    );
  }
}
