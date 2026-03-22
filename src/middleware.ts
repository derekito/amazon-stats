import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { SITE_AUTH_COOKIE, verifySiteSession } from "@/lib/site-auth-cookie";

function gate() {
  const email = process.env.SITE_ACCESS_EMAIL?.trim();
  const password = process.env.SITE_ACCESS_PASSWORD;
  const secret = process.env.SITE_ACCESS_AUTH_SECRET;
  if (!email || !password || !secret) return null;
  return { email, password, secret };
}

/** Lets the root layout hide `SiteNav` on `/login` (server layout cannot read pathname otherwise). */
function nextWithPathname(request: NextRequest, pathname: string) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", pathname);
  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const g = gate();
  if (!g) {
    return nextWithPathname(request, pathname);
  }

  if (pathname === "/login" || pathname.startsWith("/api/auth/")) {
    return nextWithPathname(request, pathname);
  }

  if (pathname.startsWith("/api/cron/")) {
    return nextWithPathname(request, pathname);
  }

  const token = request.cookies.get(SITE_AUTH_COOKIE)?.value;
  if (token) {
    const session = await verifySiteSession(token, g.secret, g.email);
    if (session) return nextWithPathname(request, pathname);
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const login = new URL("/login", request.url);
  login.searchParams.set("from", pathname + request.nextUrl.search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
