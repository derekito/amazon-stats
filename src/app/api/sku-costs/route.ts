import { NextResponse } from "next/server";

import { getEnv } from "@/lib/env";
import { resolveStoreId } from "@/lib/resolve-store";
import { loadSkuCostsMap, saveSkuCostsMap, type SkuCostEntry } from "@/lib/sp/load-sku-costs";

export const dynamic = "force-dynamic";

function normalizeCostsBody(raw: unknown): Record<string, SkuCostEntry> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const costs = (raw as { costs?: unknown }).costs;
  if (!costs || typeof costs !== "object" || Array.isArray(costs)) return null;
  const out: Record<string, SkuCostEntry> = {};
  for (const [sku, v] of Object.entries(costs)) {
    const key = sku.trim();
    if (!key) continue;
    if (!v || typeof v !== "object") continue;
    const o = v as { unitCost?: unknown; currency?: unknown };
    const n = typeof o.unitCost === "number" ? o.unitCost : Number(o.unitCost);
    if (!Number.isFinite(n) || n < 0) continue;
    const currency =
      typeof o.currency === "string" && o.currency.trim().length > 0
        ? o.currency.trim().toUpperCase()
        : undefined;
    out[key] = { unitCost: n, ...(currency ? { currency } : {}) };
  }
  return out;
}

export async function GET() {
  const storeId = await resolveStoreId();
  const env = getEnv(storeId);
  const costs = await loadSkuCostsMap(storeId);
  return NextResponse.json({
    costs,
    sheetSyncConfigured: Boolean(env.SP_SKU_COSTS_SHEET_CSV_URL),
  });
}

export async function PUT(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const costs = normalizeCostsBody(body);
  if (costs == null) {
    return NextResponse.json({ error: "Expected body { costs: { [sku]: { unitCost, currency? } } }" }, { status: 400 });
  }
  try {
    const storeId = await resolveStoreId();
    await saveSkuCostsMap(costs, storeId);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Save failed";
    return NextResponse.json({ error: message }, { status: 503 });
  }
  return NextResponse.json({ ok: true, count: Object.keys(costs).length });
}
