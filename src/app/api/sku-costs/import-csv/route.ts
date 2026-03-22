import { NextResponse } from "next/server";

import { loadSkuCostsMap, saveSkuCostsMap } from "@/lib/sp/load-sku-costs";
import { parseSkuCostsCsv } from "@/lib/sp/parse-sku-costs-csv";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const csv = (body as { csv?: unknown }).csv;
  const merge = (body as { merge?: unknown }).merge !== false;
  if (typeof csv !== "string" || csv.trim().length === 0) {
    return NextResponse.json({ error: "Expected { csv: string, merge?: boolean }" }, { status: 400 });
  }

  const imported = parseSkuCostsCsv(csv);
  const n = Object.keys(imported).length;
  if (n === 0) {
    return NextResponse.json({ error: "No valid rows (need sku + unitCost columns)" }, { status: 400 });
  }

  const next = merge ? { ...loadSkuCostsMap(), ...imported } : imported;
  saveSkuCostsMap(next);
  return NextResponse.json({ ok: true, importedRows: n, savedSkus: Object.keys(next).length });
}
