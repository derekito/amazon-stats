import { NextResponse } from "next/server";

import {
  loadSkuExclusionsList,
  saveSkuExclusionsList,
} from "@/lib/sp/load-sku-exclusions";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ excluded: loadSkuExclusionsList() });
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
  saveSkuExclusionsList(list);
  return NextResponse.json({ ok: true, count: list.length });
}
