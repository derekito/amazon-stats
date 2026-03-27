import { NextResponse } from "next/server";

import { getEnv, hasSpApiCredentials } from "@/lib/env";
import { resolveStoreId } from "@/lib/resolve-store";
import { createSellingPartner } from "@/lib/sp/client";
import { spApiErrorDetails } from "@/lib/sp/error-details";
import { resolveMarketplaceId } from "@/lib/sp/marketplace";
import { metricUnitCount, parseOrderMetricsPayload } from "@/lib/sp/parse-order-metrics";
import { getOrderMetricsRange } from "@/lib/sp/intervals";

/**
 * LWA + Sellers + Sales probe. Available when `NODE_ENV=development` or `SP_DEBUG=1` in `.env.local`.
 * Open in the browser or use the `/debug` page.
 */
export async function GET() {
  const allow =
    process.env.NODE_ENV === "development" || process.env.SP_DEBUG === "1";
  if (!allow) {
    return NextResponse.json(
      { error: "Set SP_DEBUG=1 in .env.local or run next dev to use this endpoint." },
      { status: 404 },
    );
  }

  const storeId = await resolveStoreId();
  const env = getEnv(storeId);
  if (!hasSpApiCredentials(env)) {
    return NextResponse.json({
      configured: false,
      message: "Set SP_API_REFRESH_TOKEN, SELLING_PARTNER_APP_CLIENT_ID, SELLING_PARTNER_APP_CLIENT_SECRET",
    });
  }

  let sp;
  try {
    sp = createSellingPartner(env);
  } catch (e) {
    return NextResponse.json({ configured: true, client: spApiErrorDetails(e) }, { status: 200 });
  }

  try {
    await sp.refreshAccessToken();
  } catch (e) {
    return NextResponse.json({
      configured: true,
      lwaTokenRefresh: { ok: false, ...spApiErrorDetails(e) },
      hint: "Login with Amazon rejected this refresh token + client id + secret combo. Re-copy LWA credentials from Developer Central, authorize again for a new refresh token, restart dev.",
    });
  }

  try {
    await sp.callAPI({
      operation: "getMarketplaceParticipations",
      endpoint: "sellers",
    });
  } catch (e) {
    return NextResponse.json({
      configured: true,
      lwaTokenRefresh: { ok: true },
      sellersApi: { ok: false, ...spApiErrorDetails(e) },
      hint: "LWA works. SP-API denied this call—usually missing API roles on the app, or you need a new refresh token after changing roles.",
    });
  }

  let marketplaceId: string;
  try {
    marketplaceId = await resolveMarketplaceId(sp, env);
  } catch (e) {
    return NextResponse.json({
      configured: true,
      lwaTokenRefresh: { ok: true },
      sellersApi: { ok: true },
      marketplaceId: { ok: false, ...spApiErrorDetails(e) },
      hint: "Could not resolve marketplace id. Set SP_API_MARKETPLACE_ID in .env.local if needed.",
    });
  }

  const range = getOrderMetricsRange("month");
  let salesMetrics: ReturnType<typeof parseOrderMetricsPayload> = [];
  try {
    const salesRes = await sp.callAPI({
      operation: "getOrderMetrics",
      endpoint: "sales",
      query: {
        marketplaceIds: [marketplaceId],
        interval: range.interval,
        granularity: range.granularity,
        granularityTimeZone: "UTC",
        ...(range.granularity === "Week" ? { firstDayOfWeek: "Monday" } : {}),
      },
    });
    salesMetrics = parseOrderMetricsPayload(salesRes);
  } catch (e) {
    const err = spApiErrorDetails(e);
    const regionMismatch =
      err.details?.toLowerCase().includes("not valid for region") ||
      err.message?.toLowerCase().includes("not valid for region");
    return NextResponse.json({
      configured: true,
      lwaTokenRefresh: { ok: true },
      sellersApi: { ok: true },
      marketplaceId,
      currentRegion: env.SP_API_REGION,
      salesApi: { ok: false, ...err },
      hint: regionMismatch
        ? `SP_API_REGION is "${env.SP_API_REGION}" but marketplace "${marketplaceId}" must use the SP-API host for that marketplace’s selling region. Set SP_API_REGION=na for US/CA/MX/BR, eu for Europe (UK, DE, TR, IN, AE, …), fe for JP/AU/SG. See SP-API endpoints: https://developer-docs.amazon.com/sp-api/docs/sp-api-endpoints — then restart npm run dev.`
        : "Same call the dashboard uses first. Enable roles for Sales API / getOrderMetrics (often Selling Partner Insights; confirm in Amazon role mappings), save the app, authorize again, new refresh token.",
    });
  }

  const unitsFromSales = salesMetrics.reduce((s, r) => s + metricUnitCount(r), 0);
  const firstRow = salesMetrics[0];
  return NextResponse.json({
    configured: true,
    lwaTokenRefresh: { ok: true },
    sellersApi: { ok: true },
    salesApi: {
      ok: true,
      orderMetricsRows: salesMetrics.length,
      unitCountSum: unitsFromSales,
      intervalSample: range.interval.slice(0, 80),
      /** Raw shape of the first interval (verify `unitCount` vs your Seller Central sales for this marketplace only). */
      firstIntervalSample: firstRow ?? null,
    },
    marketplaceId,
    region: env.SP_API_REGION,
    message:
      unitsFromSales === 0 && salesMetrics.length === 0
        ? "Sales call succeeded but returned no orderMetrics rows (often 204/no data for this interval, or check UTC interval). Dashboard uses the same month range."
        : unitsFromSales === 0 && salesMetrics.length > 0
          ? "Sales API returned monthly rows but unitCount is 0 for each period. That usually means no shipped orders in this marketplace for those months (metrics are per marketplace). Compare with Seller Central → Canada only, or set SP_API_MARKETPLACE_ID=ATVPDKIKX0DER to pin the US marketplace if your volume is US."
          : "LWA + Sellers + Sales (getOrderMetrics) OK. If the dashboard still errors, check FBA Inventory or per-SKU Sales calls.",
  });
}
