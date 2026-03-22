import { NextResponse } from "next/server";

import {
  loadSkuExclusionsList,
  saveSkuExclusionsList,
} from "@/lib/sp/load-sku-exclusions";

export const dynamic = "force-dynamic";

export async function GET() {
  const excluded = await loadSkuExclusionsList();
  return NextResponse.json({ excluded });
}

export async function PUT(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const raw = (body as { excluded?: unknown }).excluded;
  if (!Array.isArray(raw)) {
    return NextResponse.json({ error: "Expected { excluded: string[] }" }, { status: 400 });
  }
  const list = raw
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  try {
    await saveSkuExclusionsList(list);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Save failed";
    return NextResponse.json({ error: message }, { status: 503 });
  }
  return NextResponse.json({ ok: true, count: list.length });
}
