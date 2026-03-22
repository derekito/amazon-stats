import { NextResponse } from "next/server";

import { getEnv } from "@/lib/env";
import { sendDigestEmail } from "@/lib/sp/inventory-digest";

export const dynamic = "force-dynamic";

/**
 * Sends a single test message via Resend (no Amazon / digest logic).
 * Same auth as `/api/cron/inventory-digest`: Bearer `SP_DIGEST_CRON_SECRET` or `CRON_SECRET`, or `?secret=`.
 */
export async function GET(req: Request) {
  const env = getEnv();
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  const url = new URL(req.url);
  const secretQ = url.searchParams.get("secret")?.trim() ?? "";
  const digestSecret = env.SP_DIGEST_CRON_SECRET?.trim() ?? "";
  const vercelCronSecret = process.env.CRON_SECRET?.trim() ?? "";
  const authorized =
    (digestSecret && (bearer === digestSecret || secretQ === digestSecret)) ||
    (vercelCronSecret.length > 0 && bearer === vercelCronSecret);
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!env.RESEND_API_KEY) {
    return NextResponse.json(
      { error: "Set RESEND_API_KEY in .env.local" },
      { status: 400 },
    );
  }
  if (!env.SP_DIGEST_EMAIL_TO) {
    return NextResponse.json(
      { error: "Set SP_DIGEST_EMAIL_TO in .env.local" },
      { status: 400 },
    );
  }

  const out = await sendDigestEmail(
    env,
    "Amazon sales app — Resend test",
    "<p>If you see this, <strong>Resend</strong> and <strong>SP_DIGEST_EMAIL_TO</strong> are configured correctly.</p><p>You can schedule <code>/api/cron/inventory-digest</code> next.</p>",
  );

  if (!out.ok) {
    return NextResponse.json(
      { ok: false, error: out.error ?? "Resend request failed" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    to: env.SP_DIGEST_EMAIL_TO,
    message: "Test email sent. Check inbox (and spam).",
  });
}
