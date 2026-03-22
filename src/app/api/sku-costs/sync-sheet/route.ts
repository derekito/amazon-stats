import { NextResponse } from "next/server";

import { getEnv } from "@/lib/env";
import {
  responseLooksLikeHtml,
  toGoogleSheetCsvExportUrl,
} from "@/lib/sp/google-sheet-csv-url";
import { loadSkuCostsMap, saveSkuCostsMap } from "@/lib/sp/load-sku-costs";
import { parseSkuCostsCsv } from "@/lib/sp/parse-sku-costs-csv";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const env = getEnv();
  const rawUrl = env.SP_SKU_COSTS_SHEET_CSV_URL;
  if (!rawUrl) {
    return NextResponse.json(
      {
        error:
          "Set SP_SKU_COSTS_SHEET_CSV_URL in .env.local to your sheet link or a CSV URL (see README).",
      },
      { status: 400 },
    );
  }

  const fetchUrl = toGoogleSheetCsvExportUrl(rawUrl, {
    gid: env.SP_SKU_COSTS_SHEET_GID,
  });

  let merge = true;
  try {
    const raw = await req.text();
    if (raw.trim()) {
      const body = JSON.parse(raw) as { merge?: unknown };
      if (body && typeof body === "object" && body.merge === false) merge = false;
    }
  } catch {
    /* ignore invalid body */
  }

  let text: string;
  try {
    const res = await fetch(fetchUrl, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Sheet fetch failed: ${res.status} ${res.statusText}` },
        { status: 502 },
      );
    }
    text = await res.text();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "fetch failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  if (responseLooksLikeHtml(text)) {
    return NextResponse.json(
      {
        error:
          "Google returned HTML instead of CSV. Open the sheet → Share → set “Anyone with the link” to Viewer (or publish), then sync again. You can paste the normal /edit… link in SP_SKU_COSTS_SHEET_CSV_URL.",
      },
      { status: 400 },
    );
  }

  const imported = parseSkuCostsCsv(text);
  const n = Object.keys(imported).length;
  if (n === 0) {
    return NextResponse.json(
      { error: "CSV had no valid sku + unitCost rows (first column sku, second cost)" },
      { status: 400 },
    );
  }

  const next = merge ? { ...loadSkuCostsMap(), ...imported } : imported;
  saveSkuCostsMap(next);
  return NextResponse.json({ ok: true, importedRows: n, savedSkus: Object.keys(next).length });
}
