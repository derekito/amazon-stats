import { NextResponse } from "next/server";

import { getEnv, hasSpApiCredentials } from "@/lib/env";
import { createSellingPartner } from "@/lib/sp/client";
import { runInventoryDigest } from "@/lib/sp/inventory-digest";

export const dynamic = "force-dynamic";

/**
 * Weekly inventory digest. Accepts any of:
 * - `Authorization: Bearer <SP_DIGEST_CRON_SECRET>` (you choose the secret in `.env.local`)
 * - `?secret=<SP_DIGEST_CRON_SECRET>` (for schedulers that cannot set headers)
 * - `Authorization: Bearer <CRON_SECRET>` — Vercel Cron sends this automatically when
 *   `CRON_SECRET` is set in the Vercel project (no need to duplicate in `SP_DIGEST_CRON_SECRET`).
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
    return NextResponse.json(
      {
        error: "Unauthorized",
        hint: "Set SP_DIGEST_CRON_SECRET (Bearer or ?secret=) or CRON_SECRET on Vercel for scheduled runs.",
      },
      { status: 401 },
    );
  }
  if (!env.SP_DIGEST_EMAIL_TO) {
    return NextResponse.json(
      { error: "Set SP_DIGEST_EMAIL_TO in .env.local" },
      { status: 400 },
    );
  }
  if (env.SP_API_USE_MOCK || !hasSpApiCredentials(env)) {
    return NextResponse.json(
      { error: "Digest requires live SP-API credentials (not mock mode)" },
      { status: 503 },
    );
  }

  try {
    const sp = createSellingPartner(env);
    const out = await runInventoryDigest(sp, env);
    return NextResponse.json({
      ok: true,
      subject: out.subject,
      candidateCount: out.rows.length,
      evaluatedSkus: out.evaluatedSkus,
      rangeLabel: out.rangeLabel,
      email: out.email,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Digest failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
