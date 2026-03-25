import { z } from "zod";

/** Treat blank / whitespace-only env values as unset (common in .env.local placeholders). */
function emptyEnvToUndefined(v: unknown): unknown {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") return v;
  const t = v.trim();
  return t === "" ? undefined : t;
}

const optionalNonEmptyString = z.preprocess(emptyEnvToUndefined, z.string().min(1).optional());

const envSchema = z.object({
  SP_API_REGION: z.enum(["na", "eu", "fe"]).default("na"),
  SP_API_REFRESH_TOKEN: optionalNonEmptyString,
  SELLING_PARTNER_APP_CLIENT_ID: optionalNonEmptyString,
  SELLING_PARTNER_APP_CLIENT_SECRET: optionalNonEmptyString,
  SP_API_MARKETPLACE_ID: optionalNonEmptyString,
  SP_API_USE_MOCK: z
    .string()
    .default("")
    .transform((v) => v === "1" || v === "true"),
  /** 0 = skip per-SKU Sales calls (fast; ordered qty & forecast show 0). */
  SP_API_MAX_SKU_METRICS: z
    .preprocess(
      (v) => (v === undefined || v === "" ? 25 : Number(v)),
      z.number().int().min(0).max(200),
    ),
  /** Max FBA getInventorySummaries pages (each page is one API call). Lower = faster dashboard. */
  SP_API_MAX_INVENTORY_PAGES: z
    .preprocess(
      (v) => (v === undefined || v === "" ? 15 : Number(v)),
      z.number().int().positive().max(500),
    ),
  /** Max catalog image lookups (one per ASIN). 0 = skip Catalog API entirely (fast). */
  SP_API_MAX_ASIN_THUMBNAILS: z
    .preprocess(
      (v) => (v === undefined || v === "" ? 24 : Number(v)),
      z.number().int().min(0).max(500),
    ),
  /**
   * `/sales` “Top 10” ranks by units sold in the last 10 days among **this many** FBA SKUs
   * (highest inventory first). Higher = more accurate account-wide top sellers, slower. 0 = skip table.
   */
  SP_SALES_OVERVIEW_MAX_SKU_SCAN: z
    .preprocess(
      (v) => (v === undefined || v === "" ? 200 : Number(v)),
      z.number().int().min(0).max(2000),
    ),
  /**
   * When live dashboard loads, fetch latest completed `GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT`
   * and show Amazon’s recommended replenishment qty per SKU. Set to 0/false to skip (faster; no Reports calls).
   */
  SP_API_FETCH_RESTOCK_REPORT: z
    .string()
    .default("")
    .transform((v) => v !== "0" && v !== "false" && v !== "no"),
  /** Prefer Restock reports newer than this many hours; if none, falls back to newest DONE report. Default 336 (14d). */
  SP_API_RESTOCK_REPORT_MAX_AGE_HOURS: z
    .preprocess(
      (v) => (v === undefined || v === "" ? 336 : Number(v)),
      z.number().int().min(0).max(24 * 365),
    ),
  /** Server-side ceiling for live dashboard aggregation (ms). Default 5m; debug probe is one call, dashboard is many. */
  SP_API_DASHBOARD_TIMEOUT_MS: z
    .preprocess((v) => {
      if (v === undefined || v === "" || v === null) return 300_000;
      const n = Number(v);
      if (Number.isNaN(n)) return 300_000;
      // Common copy-paste (2m) is too short for Sales + FBA + optional enrichment; treat as 5m.
      if (n === 120_000) return 300_000;
      return n;
    }, z.number().int().positive().max(600_000)),
  /** Flag products when days of cover is below this (requires velocity). Default 14. */
  SP_DASHBOARD_DAYS_OF_COVER_THRESHOLD: z
    .preprocess(
      (v) => (v === undefined || v === "" ? 14 : Number(v)),
      z.number().int().min(0).max(365),
    ),
  /** Global reorder point: flag FBA qty below this. 0 = disabled (use per-SKU JSON only). */
  SP_DASHBOARD_DEFAULT_REORDER_POINT: z
    .preprocess(
      (v) => (v === undefined || v === "" ? 0 : Number(v)),
      z.number().int().min(0).max(1_000_000),
    ),
  /** Min FBA units before a SKU can be flagged slow-mover (with low orders in the window). Default 30. */
  SP_DASHBOARD_SLOW_MOVER_MIN_STOCK: z
    .preprocess(
      (v) => (v === undefined || v === "" ? 30 : Number(v)),
      z.number().int().min(0).max(1_000_000),
    ),
  /** Slow-mover if units ordered in the selected window are ≤ this (e.g. 2 = 0–2 sales). Default 0 (zero orders only). */
  SP_DASHBOARD_SLOW_MOVER_MAX_ORDERED: z
    .preprocess(
      (v) => (v === undefined || v === "" ? 0 : Number(v)),
      z.number().int().min(0).max(10_000),
    ),
  /**
   * Product table page size on the dashboard. **0** = no pagination (all SKUs in one response, up to 50k rows).
   * Ignores the client; only `productPage` is read from the request when paginated. Default 40.
   */
  SP_DASHBOARD_PRODUCT_PAGE_SIZE: z
    .preprocess(
      (v) => (v === undefined || v === "" ? 40 : Number(v)),
      z.number().int().min(0).max(50_000),
    ),
  /** Replenish alert when FBA qty ≤ this (default 2). Override per SKU in `data/sku-thresholds.json`. */
  SP_DASHBOARD_REPLENISH_MAX_UNITS: z
    .preprocess(
      (v) => (v === undefined || v === "" ? 2 : Number(v)),
      z.number().int().min(0).max(1_000_000),
    ),
  /** Replenish alert when days of cover ≤ this (default 30). */
  SP_DASHBOARD_REPLENISH_MAX_DAYS_COVER: z
    .preprocess(
      (v) => (v === undefined || v === "" ? 30 : Number(v)),
      z.number().int().min(1).max(365),
    ),
  /** Weekly digest recipient. Requires `RESEND_API_KEY` (or configure SMTP later). */
  SP_DIGEST_EMAIL_TO: z.preprocess(emptyEnvToUndefined, z.string().email().optional()),
  /** Bearer token for `GET /api/cron/inventory-digest`. Required to run the digest. */
  SP_DIGEST_CRON_SECRET: optionalNonEmptyString,
  /** Max SKUs to evaluate per digest run (per-SKU Sales calls). Default 500. */
  SP_DIGEST_MAX_SKUS: z
    .preprocess(
      (v) => (v === undefined || v === "" ? 500 : Number(v)),
      z.number().int().min(1).max(5000),
    ),
  /** Digest includes SKUs with days of cover ≤ this (default 14). */
  SP_DIGEST_DAYS_COVER_WITHIN: z
    .preprocess(
      (v) => (v === undefined || v === "" ? 14 : Number(v)),
      z.number().int().min(0).max(365),
    ),
  /** Sales window for digest metrics (same as dashboard period). Default month. */
  SP_DIGEST_PERIOD: z.enum(["day", "week", "month", "quarter"]).default("month"),
  /** Resend.com API key for digest email. */
  RESEND_API_KEY: optionalNonEmptyString,
  /** From address (must be a verified domain in Resend, or use onboarding sender for tests). */
  RESEND_FROM: optionalNonEmptyString,
  /** Rough referral fee % of item sales (not settlement). Default 15. */
  SP_DASHBOARD_REFERRAL_FEE_PERCENT: z
    .preprocess(
      (v) => (v === undefined || v === "" ? 15 : Number(v)),
      z.number().min(0).max(50),
    ),
  /** Rough flat FBA fulfillment estimate per unit sold in window (same currency as sales). Default 0. */
  SP_DASHBOARD_FBA_FEE_PER_UNIT: z
    .preprocess(
      (v) => (v === undefined || v === "" ? 0 : Number(v)),
      z.number().min(0).max(500),
    ),
  /**
   * Account-wide ACOS % (ad spend ÷ sales). Applied to each SKU’s Sales API total in the window
   * to estimate allocated ad spend—not per-SKU advertising reports.
   */
  SP_DASHBOARD_ESTIMATED_ACOS_PERCENT: z
    .preprocess(
      (v) => (v === undefined || v === "" ? 22 : Number(v)),
      z.number().min(0).max(100),
    ),
  /**
   * Optional CSV URL for “Sync Google Sheet” on /costs (publish sheet to web as CSV, or a raw CSV link).
   * Fetched server-side only.
   */
  SP_SKU_COSTS_SHEET_CSV_URL: optionalNonEmptyString,
  /** Tab id for CSV export when using a spreadsheet URL (from sheet URL ?gid=…). Default 0 = first tab. */
  SP_SKU_COSTS_SHEET_GID: optionalNonEmptyString,
  /**
   * Optional site gate: set all three to require email/password before any page or API (except
   * `/login`, `/api/auth/*`, and `/api/cron/*`). Use a long random `SITE_ACCESS_AUTH_SECRET`.
   */
  SITE_ACCESS_EMAIL: optionalNonEmptyString,
  SITE_ACCESS_PASSWORD: optionalNonEmptyString,
  SITE_ACCESS_AUTH_SECRET: optionalNonEmptyString,
});

export type AppEnv = z.infer<typeof envSchema>;

export function getEnv(): AppEnv {
  return envSchema.parse({
    SP_API_REGION: process.env.SP_API_REGION,
    SP_API_REFRESH_TOKEN: process.env.SP_API_REFRESH_TOKEN,
    SELLING_PARTNER_APP_CLIENT_ID: process.env.SELLING_PARTNER_APP_CLIENT_ID,
    SELLING_PARTNER_APP_CLIENT_SECRET: process.env.SELLING_PARTNER_APP_CLIENT_SECRET,
    SP_API_MARKETPLACE_ID: process.env.SP_API_MARKETPLACE_ID,
    SP_API_USE_MOCK: process.env.SP_API_USE_MOCK,
    SP_API_MAX_SKU_METRICS: process.env.SP_API_MAX_SKU_METRICS,
    SP_API_MAX_INVENTORY_PAGES: process.env.SP_API_MAX_INVENTORY_PAGES,
    SP_API_MAX_ASIN_THUMBNAILS: process.env.SP_API_MAX_ASIN_THUMBNAILS,
    SP_SALES_OVERVIEW_MAX_SKU_SCAN: process.env.SP_SALES_OVERVIEW_MAX_SKU_SCAN,
    SP_API_FETCH_RESTOCK_REPORT: process.env.SP_API_FETCH_RESTOCK_REPORT,
    SP_API_RESTOCK_REPORT_MAX_AGE_HOURS: process.env.SP_API_RESTOCK_REPORT_MAX_AGE_HOURS,
    SP_API_DASHBOARD_TIMEOUT_MS: process.env.SP_API_DASHBOARD_TIMEOUT_MS,
    SP_DASHBOARD_DAYS_OF_COVER_THRESHOLD: process.env.SP_DASHBOARD_DAYS_OF_COVER_THRESHOLD,
    SP_DASHBOARD_DEFAULT_REORDER_POINT: process.env.SP_DASHBOARD_DEFAULT_REORDER_POINT,
    SP_DASHBOARD_SLOW_MOVER_MIN_STOCK: process.env.SP_DASHBOARD_SLOW_MOVER_MIN_STOCK,
    SP_DASHBOARD_SLOW_MOVER_MAX_ORDERED: process.env.SP_DASHBOARD_SLOW_MOVER_MAX_ORDERED,
    SP_DASHBOARD_PRODUCT_PAGE_SIZE: process.env.SP_DASHBOARD_PRODUCT_PAGE_SIZE,
    SP_DASHBOARD_REPLENISH_MAX_UNITS: process.env.SP_DASHBOARD_REPLENISH_MAX_UNITS,
    SP_DASHBOARD_REPLENISH_MAX_DAYS_COVER: process.env.SP_DASHBOARD_REPLENISH_MAX_DAYS_COVER,
    SP_DIGEST_EMAIL_TO: process.env.SP_DIGEST_EMAIL_TO,
    SP_DIGEST_CRON_SECRET: process.env.SP_DIGEST_CRON_SECRET,
    SP_DIGEST_MAX_SKUS: process.env.SP_DIGEST_MAX_SKUS,
    SP_DIGEST_DAYS_COVER_WITHIN: process.env.SP_DIGEST_DAYS_COVER_WITHIN,
    SP_DIGEST_PERIOD: process.env.SP_DIGEST_PERIOD,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_FROM: process.env.RESEND_FROM,
    SP_DASHBOARD_REFERRAL_FEE_PERCENT: process.env.SP_DASHBOARD_REFERRAL_FEE_PERCENT,
    SP_DASHBOARD_FBA_FEE_PER_UNIT: process.env.SP_DASHBOARD_FBA_FEE_PER_UNIT,
    SP_DASHBOARD_ESTIMATED_ACOS_PERCENT: process.env.SP_DASHBOARD_ESTIMATED_ACOS_PERCENT,
    SP_SKU_COSTS_SHEET_CSV_URL: process.env.SP_SKU_COSTS_SHEET_CSV_URL,
    SP_SKU_COSTS_SHEET_GID: process.env.SP_SKU_COSTS_SHEET_GID,
    SITE_ACCESS_EMAIL: process.env.SITE_ACCESS_EMAIL,
    SITE_ACCESS_PASSWORD: process.env.SITE_ACCESS_PASSWORD,
    SITE_ACCESS_AUTH_SECRET: process.env.SITE_ACCESS_AUTH_SECRET,
  });
}

export function hasSpApiCredentials(env: AppEnv): boolean {
  return Boolean(
    env.SP_API_REFRESH_TOKEN &&
      env.SELLING_PARTNER_APP_CLIENT_ID &&
      env.SELLING_PARTNER_APP_CLIENT_SECRET,
  );
}
