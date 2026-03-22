import { NextResponse } from "next/server";

import { SITE_AUTH_COOKIE } from "@/lib/site-auth-cookie";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SITE_AUTH_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
