import { NextResponse } from "next/server";

import { parseStoreId, STORE_COOKIE_NAME, type StoreId } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const raw = body && typeof body === "object" ? (body as { storeId?: unknown }).storeId : undefined;
  const storeId: StoreId =
    raw === "bbs" || raw === "na" ? raw : parseStoreId(typeof raw === "string" ? raw : undefined);

  const res = NextResponse.json({ ok: true, storeId });
  res.cookies.set(STORE_COOKIE_NAME, storeId, {
    path: "/",
    maxAge: 60 * 60 * 24 * 400,
    sameSite: "lax",
    httpOnly: false,
  });
  return res;
}
