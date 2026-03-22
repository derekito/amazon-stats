import "server-only";

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";

import { get, put } from "@vercel/blob";

const FILE = "sku-exclusions.json";

/** Stable pathname in the Vercel Blob store (private). */
const BLOB_PATHNAME = "amazon-sales/sku-exclusions.json";

function filePath(): string {
  return path.join(process.cwd(), "data", FILE);
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

async function loadFromBlob(): Promise<string[]> {
  const result = await get(BLOB_PATHNAME, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200 || !result.stream) return [];
  const text = await new Response(result.stream).text();
  return parseJsonList(text);
}

function loadFromFile(): string[] {
  const fp = filePath();
  if (!existsSync(fp)) return [];
  try {
    return parseJsonList(readFileSync(fp, "utf8"));
  } catch {
    return [];
  }
}

/** SKUs hidden on the dashboard and costs UI — from Blob (Vercel) or `data/sku-exclusions.json` (local). */
export async function loadSkuExclusionsList(): Promise<string[]> {
  if (blobEnabled()) {
    try {
      return await loadFromBlob();
    } catch {
      return [];
    }
  }
  return loadFromFile();
}

export async function loadSkuExclusionsSet(): Promise<Set<string>> {
  return new Set(await loadSkuExclusionsList());
}

export async function saveSkuExclusionsList(skus: string[]): Promise<void> {
  const unique = [
    ...new Set(skus.map((s) => s.trim()).filter((s) => s.length > 0)),
  ].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  const body = `${JSON.stringify(unique, null, 2)}\n`;

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
    writeFileSync(filePath(), body, "utf8");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Cannot write SKU exclusions (${msg}). On Vercel, add a Blob store so BLOB_READ_WRITE_TOKEN is set (Project → Storage → Blob).`,
    );
  }
}
