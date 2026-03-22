import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

import { SITE_AUTH_COOKIE, signSiteSession } from "@/lib/site-auth-cookie";
import { getSiteAccessGate } from "@/lib/site-access";

const MAX_AGE_SEC = 60 * 60 * 24 * 7;

function safeEqualString(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export async function POST(req: Request) {
  const gate = getSiteAccessGate();
  if (!gate) {
    return NextResponse.json(
      { error: "Site login is not configured (set SITE_ACCESS_* in .env.local)." },
      { status: 503 },
    );
  }

  let body: { email?: string; password?: string };
  try {
    body = (await req.json()) as { email?: string; password?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (
    email.toLowerCase() !== gate.email.toLowerCase() ||
    !safeEqualString(password, gate.password)
  ) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  const token = await signSiteSession(gate.email, gate.secret, MAX_AGE_SEC);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SITE_AUTH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SEC,
  });
  return res;
}
