# Amazon sales & inventory

A small [Next.js](https://nextjs.org) app that reads your **Selling Partner API (SP-API)** account to show:

- **Sales** — units sold over time via the [Sales API](https://developer-docs.amazon.com/sp-api/docs/sales-api-v1-reference) `getOrderMetrics` call. **Day** = **yesterday (UTC)** (one bar); **Week** = last **7** rolling days (daily bars); **Month** = last **30** rolling days (daily bars); **Quarter** = last **90** rolling days (weekly bars).
- **Inventory** — FBA fulfillable quantity, SKU, title, and (when available) a product image from the [FBA Inventory API](https://developer-docs.amazon.com/sp-api/docs/fba-inventory-api-v1-reference) and [Catalog Items API](https://developer-docs.amazon.com/sp-api/docs/catalog-items-api-v0-reference).
- **Ordered quantity** — units sold for each SKU over that **same** interval (per tab above), via `getOrderMetrics` with `granularity=Total` and `sku` (same window used for the simple forecast).
- **Forecast** — **days of cover**: current stock ÷ average daily units from that window (shown as “—” if velocity is negligible).
- **Sales overview** — Open **`/sales`** (or **Sales** in the nav) for **yesterday (UTC)** KPIs, a **10-day** daily bar chart (toggle **units** vs **ordered product sales**), and a **Top 10** table (thumbnail, SKU, FBA inventory, units & sales in the window, **vs prior 10 days** %). Top sellers are ranked among up to **`SP_SALES_OVERVIEW_MAX_SKU_SCAN`** SKUs (default **200**, highest FBA quantity first). Uses FBA inventory + per-SKU Sales + optional Catalog thumbnails (respects **`SP_API_MAX_ASIN_THUMBNAILS`**). **`/api/sales-overview`** uses **`SP_API_DASHBOARD_TIMEOUT_MS`** because many SKUs can mean many API calls.

Without credentials, the UI runs on **sample data** so you can develop the layout immediately.

## Prerequisites

1. [Register as a developer](https://developer-docs.amazon.com/sp-api/docs/registering-as-a-developer) and create an SP-API application.
2. Grant your app the roles needed for **Sales**, **FBA Inventory**, **Catalog**, **Orders** (for SKU-level metrics we use Sales with `sku`), and **Sellers** (marketplace list). Exact role names appear in Seller Central when you edit the app.
3. Obtain a **refresh token** ([self-authorization](https://developer-docs.amazon.com/sp-api/docs/self-authorization) is simplest for your own seller account).

### Why you won’t see “refresh token” in Developer Central

Amazon only shows **LWA client identifier** and **client secret** (and related app settings) in the developer console. A **refresh token** is issued *after* authorization—it is not a field you copy from a settings page. For your own seller account, use **[Self-authorization](https://developer-docs.amazon.com/sp-api/docs/self-authorization)** in Seller Central (Authorize app → you receive a refresh token). For other sellers, use the **[Website authorization workflow](https://developer-docs.amazon.com/sp-api/docs/website-authorization-workflow)** and exchange the `spapi_oauth_code` for tokens (this repo’s `amazon-sp-api` client supports `.exchange()` for that code).

## Setup

```bash
cp .env.example .env.local
# Fill in SELLING_PARTNER_APP_CLIENT_ID, SELLING_PARTNER_APP_CLIENT_SECRET, SP_API_REFRESH_TOKEN
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Optional site password (email + password)

To put a simple gate in front of the whole app (pages and `/api/*` except auth and cron), set **all three** in `.env.local`:

- **`SITE_ACCESS_EMAIL`** — allowed sign-in email (compared case-insensitively).
- **`SITE_ACCESS_PASSWORD`** — shared password (stored only in env; use a strong value).
- **`SITE_ACCESS_AUTH_SECRET`** — long random string used to sign the session cookie (e.g. `openssl rand -hex 32`).

Omit any one of them and the site stays **open** (no login). Signed-in sessions last **7 days** (`httpOnly` cookie). **`/api/cron/*`** stays reachable without that cookie so Vercel Cron + `Authorization: Bearer` still work. **`/login`** has no top nav.

## Deploy to GitHub and Vercel

### 1. Commit and push

From the project root:

```bash
git add -A
git status   # confirm .env.local is not listed (it must stay gitignored)
git commit -m "Initial commit"
```

Create a **new empty repository** on [GitHub](https://github.com/new) (no README/license if you already have files here), then:

```bash
git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
git branch -M main
git push -u origin main
```

Use SSH (`git@github.com:...`) instead if you prefer.

### 2. Import the repo in Vercel

1. Sign in at [vercel.com](https://vercel.com) → **Add New…** → **Project** → import the GitHub repository.
2. **Framework preset:** Next.js. **Build command:** `npm run build` (default). **Install command:** `npm install` (default).
3. **Environment variables:** open **Environment Variables** and add every key you use from `.env.local` (copy values from your machine—never commit them). Cross-check names against [`.env.example`](./.env.example). Required for live SP-API data: `SELLING_PARTNER_APP_CLIENT_ID`, `SELLING_PARTNER_APP_CLIENT_SECRET`, `SP_API_REFRESH_TOKEN`, `SP_API_REGION` (and optional `SP_API_MARKETPLACE_ID`, digest email keys, `SITE_ACCESS_*`, etc.).
4. Click **Deploy**. You’ll get a URL like `https://YOUR_PROJECT.vercel.app`.

Set **`SP_DEBUG=1`** in Vercel if you need **`/api/debug/sp-auth`** or **`/debug`** in production (they stay off by default).

### 3. Cron jobs (`vercel.json`)

This repo includes a sample weekly cron for **`/api/cron/inventory-digest`** in [`vercel.json`](./vercel.json). In the Vercel project, add **`CRON_SECRET`** (any long random string) under **Settings → Environment Variables**. [Vercel Cron](https://vercel.com/docs/cron-jobs) sends `Authorization: Bearer <CRON_SECRET>` on each run—you can rely on that and skip `SP_DIGEST_CRON_SECRET` for scheduled digests, or set both to the same value for consistency with manual `curl`.

### 4. OAuth redirect (only if you use the website authorization flow)

If your SP-API app has **Allowed return URLs**, add your production origin (e.g. `https://YOUR_PROJECT.vercel.app`) in Amazon Developer Central. Self-authorization for your own seller account does not need this.

### 5. `data/*.json` and serverless

On **Vercel**, create a **[Blob](https://vercel.com/docs/storage/vercel-blob)** store (**Storage → Create → Blob**). **`BLOB_READ_WRITE_TOKEN`** (injected by Vercel) enables durable storage for **SKU exclusions** and **unit costs (COGS)** in Blob (`amazon-sales/sku-exclusions.json` and `amazon-sales/sku-costs.json`). Without it, those `/costs` saves do not persist on serverless.

Locally, exclusions and costs still use **`data/sku-exclusions.json`** and **`data/sku-costs.json`**. **Per-SKU thresholds** (`data/sku-thresholds.json`) remain file-only; on Vercel they are still not durable unless you self-host or add separate storage later. **Google Sheet** sync (`SP_SKU_COSTS_SHEET_CSV_URL`) remains a good source of truth for costs and merges into whatever store is active.

**Still seeing `Unauthorized`?** Use the in-app **[/debug](http://localhost:3000/debug)** page (formatted JSON) or open [http://localhost:3000/api/debug/sp-auth](http://localhost:3000/api/debug/sp-auth) in the browser. Available when `NODE_ENV=development` or when **`SP_DEBUG=1`** is set in `.env.local` (needed for `next start` / production-like runs). The probe checks LWA, Sellers API, and Sales `getOrderMetrics`.

**If the JSON shows `lwaTokenRefresh.ok: true` but `sellersApi` fails with `Unauthorized`:** your client id / secret / refresh token are fine. The problem is **SP-API permissions on the app** (Developer Central → edit app → **API permissions**) and/or a **refresh token created before** those permissions were saved. Update roles → **Save** → **Authorize app** again → paste the **new** refresh token → restart dev.

**If `sellersApi` is OK but `salesApi` fails:** the dashboard loads **Sales API** (`getOrderMetrics`) right after Sellers. Enable the roles Amazon maps to that operation ([role mappings](https://developer-docs.amazon.com/sp-api/docs/role-mappings-for-sp-api-operations)), then authorize again for a new refresh token. The dashboard warning will now prefix the failing step, e.g. `Sales API (getOrderMetrics): …`.

- Set `SP_API_USE_MOCK=1` in `.env.local` to force sample data even when credentials exist.
- If Amazon returns errors (roles, throttling, sandbox), the API falls back to sample data and shows a warning banner.

### Merchant Token vs Marketplace ID

Seller Central’s **Settings → Merchant Token** page shows a **seller identifier** (often the same value next to each country). That is **not** the **Marketplace ID** SP-API expects in `marketplaceIds`. For API calls, use the ids from Amazon’s **[Marketplace IDs](https://developer-docs.amazon.com/sp-api/docs/marketplace-ids)** table (e.g. United States = **`ATVPDKIKX0DER`**, Brazil = **`A2Q3Y263D00KWC`**). Leave **`SP_API_MARKETPLACE_ID`** unset to auto-pick from Sellers API, or paste the correct id from that doc—not the Merchant Token.

### “The marketplaces you provided are not valid for region”

Your **`SP_API_REGION`** must match the **SP-API host** for each **`marketplaceId`**. Example: a European or Indian marketplace needs **`SP_API_REGION=eu`** (not `na`). See [SP-API endpoints](https://developer-docs.amazon.com/sp-api/docs/sp-api-endpoints) and [Marketplace IDs](https://developer-docs.amazon.com/sp-api/docs/marketplace-ids). After changing region, restart `npm run dev`.

If **`getMarketplaceParticipations`** returns several countries, the app **only picks a marketplace id that belongs to your `SP_API_REGION`** (e.g. with `na`, US/CA/MX/BR only, preferring **US** `ATVPDKIKX0DER` when you participate there). That avoids using a first row that isn’t valid on that host.

### `salesApi` Unauthorized but Sellers works

If debug JSON shows `marketplaceId` like **`amzn1.sp.solution....`**, that is **not** a marketplace id—it is an **application/solution** id. Remove **`SP_API_MARKETPLACE_ID`** from `.env.local` (or set a real id such as **`ATVPDKIKX0DER`** for the US marketplace). [Marketplace IDs](https://developer-docs.amazon.com/sp-api/docs/marketplace-ids) are short alphanumeric codes, not `amzn1.sp…`.

### “Access to requested resource is denied” / **`(Unauthorized)`**

**`Unauthorized`** almost always means **Login with Amazon (LWA)** rejected the request: the **refresh token**, **client ID**, and **client secret** are not a valid trio for the same SP-API application.

Checklist:

1. **Same app for all three** — Copy **LWA client identifier** and **client secret** from **Developer Central → your app → LWA credentials**. The **refresh token** must come from **Authorize app** for **that same app** (Manage authorizations). Do not mix tokens from an old app or a different region’s copy of the app.
2. **Re-authorize** — Click **Authorize app** again and paste the **new** refresh token. Old tokens stop working if you rotated the client secret or changed app state.
3. **No stray characters** — One line per value in `.env.local`, no spaces around `=`, no accidental quotes inside the token. Restart `npm run dev` after edits.
4. If you still see **`Unauthorized`** after that, regenerate the **client secret** in Developer Central (if Amazon offers it), update `.env.local`, then **Authorize app** again and use the **new** refresh token.

Then see **missing roles** below if the error changes to something other than `Unauthorized`.

### “Access to requested resource is denied” (roles)

Usually **missing SP-API roles** on your developer app, or a **refresh token issued before** you added those roles.

1. In **Developer Central**, open your app → **Edit** → **API permissions** (roles). Enable at least what this app calls: **Sellers** (marketplaces), **Sales**, **FBA Inventory**, **Catalog** (for images), and anything listed as required for those APIs in Amazon’s docs.
2. **Save**, then go back to **Manage authorizations** and click **Authorize app** again so Amazon issues a **new refresh token** tied to the updated roles.
3. Put the **new** refresh token in `SP_API_REFRESH_TOKEN` (old tokens do not gain new permissions).
4. Confirm `SELLING_PARTNER_APP_CLIENT_ID` / `SELLING_PARTNER_APP_CLIENT_SECRET` belong to **this same app**, and `SP_API_REGION` matches your marketplaces (`na` for US/CA/MX, etc.).

## Limits & notes

- **Sales API intervals** — `getOrderMetrics` uses **UTC** with the **second timestamp exclusive** (see Amazon’s Sales API reference). We send `granularityTimeZone=UTC` for granularities above Hour. Response **payload** is an **array** of metric rows (not a field named `orderMetrics`). Tab windows are **rolling** (except **Day**, which is the **previous UTC calendar day** only).
- **FBA** — Rows come from inventory summaries. **`totalQuantity`** is used when present; otherwise we sum fulfillable + inbound + reserved. Pagination is capped at **`SP_API_MAX_INVENTORY_PAGES`** (default **15**); raise if you need more pages (slower).
- **Per-SKU metrics** — for each **page** of the product table, the app calls `getOrderMetrics` once per SKU (up to **`SP_API_MAX_SKU_METRICS`** per request, default **25** in env) with **`granularity=Total`** over the **same interval** as the aggregate chart (Amazon requires `Total` when `sku` is set). Page size is **`SP_DASHBOARD_PRODUCT_PAGE_SIZE`** in `.env.local` (default **40**, max **50000**). Set it to **`0`** to disable pagination and return all inventory rows in one response (no Next/Previous UI). The client only sends **`productPage`**; page size is server-controlled.
- **Product table order** — rows are sorted by **FBA quantity (high first)** before paging. That is **not** the same as “top sellers by units sold”—the Sales API does not expose a SKU leaderboard without one call per SKU. Putting high-FBA SKUs first is a cheap proxy so the first page is usually your most active listings.
- **Inventory insights** — server flags per SKU: **low days of cover** (`SP_DASHBOARD_DAYS_OF_COVER_THRESHOLD`, default **14**), **below reorder** (`SP_DASHBOARD_DEFAULT_REORDER_POINT` or optional **`data/sku-thresholds.json`**), **stockout** (0 FBA qty), **slow mover** (FBA qty ≥ `SP_DASHBOARD_SLOW_MOVER_MIN_STOCK` and units ordered in the **same interval as the chart** ≤ `SP_DASHBOARD_SLOW_MOVER_MAX_ORDERED`; max ordered defaults to **0** so only **zero** orders qualify—set max to **2** to flag 0–2 sales in that window). **Units/day** = ordered ÷ window days.
- **Replenish rule** — **Ship** when **FBA ≤ `SP_DASHBOARD_REPLENISH_MAX_UNITS`** (default **2**) or **days of cover ≤ `SP_DASHBOARD_REPLENISH_MAX_DAYS_COVER`** (default **30**). Per-SKU overrides: `replenishMaxUnits` / `replenishMaxDaysCover` in **`data/sku-thresholds.json`** (alongside `reorderPoint`).
- **Velocity tier A/B/C** — Tertiles by **units/day on the current table page** (A = fastest movers on that page). With pagination, tiers are **not** account-wide—raise **`SP_DASHBOARD_PRODUCT_PAGE_SIZE`** or use **0** for a full-page tier view.
- **Weekly digest email** — Configure **`SP_DIGEST_EMAIL_TO`**, **`RESEND_API_KEY`**, and optional **`RESEND_FROM`** (verified domain in [Resend](https://resend.com)). **Auth:** (1) Put a long random string in **`SP_DIGEST_CRON_SECRET`** and call **`GET /api/cron/inventory-digest`** with **`Authorization: Bearer <that string>`** or **`?secret=<that string>`**; or (2) on **Vercel**, set **`CRON_SECRET`** in the project—**Vercel Cron** will send **`Authorization: Bearer`** automatically (no duplicate secret needed for scheduled runs). **Test Resend only (no Amazon calls):** `GET /api/cron/test-email` with the same Bearer / `?secret=` — sends one message to **`SP_DIGEST_EMAIL_TO`**. Digest lists SKUs that are **OOS**, match the **replenish** rule, or have **days of cover ≤ `SP_DIGEST_DAYS_COVER_WITHIN`** (default **14**). Metrics use **`SP_DIGEST_PERIOD`** (default **month**); **`SP_DIGEST_MAX_SKUS`** (default **500**) caps per-SKU Sales calls. **`vercel.json`** includes a sample **Monday 14:00 UTC** schedule.
- **SKU costs (persisted)** — Open **`/costs`** (or **SKU costs** in the top nav). **Unit costs** tab: edit **`data/sku-costs.json`**. **Excluded SKUs** tab: maintain **`data/sku-exclusions.json`** — those SKUs are **removed from the main dashboard product table** and from the unit-cost table (legacy COGS entries stay in the JSON until you delete them). Rows are built from **FBA inventory** (same **`SP_API_MAX_INVENTORY_PAGES`** cap) plus cost-only SKUs not in exclusions. **Google Sheet:** set **`SP_SKU_COSTS_SHEET_CSV_URL`** to either the normal spreadsheet link (`https://docs.google.com/spreadsheets/d/…/edit?usp=sharing`) or a **Publish to web → CSV** link. The server rewrites edit links to Google’s **`/export?format=csv&gid=…`** endpoint. The sheet must allow access without signing in (**Share → General access → Anyone with the link can view**). Optional **`SP_SKU_COSTS_SHEET_GID`** sets the tab (default **0**; copy `gid` from the sheet URL if needed). The importer skips comment junk, detects headers, and maps **sku** / **unitCost** / **Seller SKU** / **Unit cost** / etc. If there is no header, use **`sku, unit cost[, currency]`** or **`product title, sku, cost[, currency]`**. *Vercel:* exclusions and unit costs persist with **`BLOB_READ_WRITE_TOKEN`** (Blob); you can still use the **Google Sheet** as source of truth—see **§5** above.
- **Fees & margin (rough)** — the dashboard reads optional **`data/sku-costs.json`** (see above). **Est. fees** = `SP_DASHBOARD_REFERRAL_FEE_PERCENT` × per-SKU **sales** in the window (default **15**) + `SP_DASHBOARD_FBA_FEE_PER_UNIT` × **units ordered** (default **0**). **Est. COGS** = unit cost × units; **est. margin** = sales − fees − COGS − **est. ad spend** (ACOS × sales) when cost exists. **Est. ACOS** uses **`SP_DASHBOARD_ESTIMATED_ACOS_PERCENT`** (default **22**) as an **account-wide** rate: each SKU’s **est. ad spend** = that % × its sales in the window (not per-SKU advertising reports). This is **not** settlement-level accuracy—category/size-tier fees, promos, and inbound differ; use Amazon’s fee/settlement reports for books.
- **Period-over-period** — marketplace-level **units** and **sales** vs the **previous window of the same length** (second `getOrderMetrics` aggregate call). If that call fails, the comparison line is omitted.
- **SKU tags** — **browser-only** (localStorage): filter by **core / test / liquidate / seasonal** in the UI; not sent to Amazon.
- **Images** — Catalog Items is called for at most **`SP_API_MAX_ASIN_THUMBNAILS`** distinct ASINs **on the current page** (default **24**); other rows omit thumbnails. Missing images show a placeholder.
- **Amazon suggested replenish qty** — Loads the latest completed **DONE** files from the Reports API (tab- or comma-separated), in parallel: **`GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT`** (Seller Central **Restock Inventory** — phasing out in the UI) and **`GET_FBA_INVENTORY_PLANNING_DATA`** (**same `reportType` as Seller Central’s new “FBA Inventory” / Manage Inventory Health report**). Column names are matched flexibly (e.g. **Recommended replenishment qty**, **Recommended ship-in quantity**, **Recommended restock units**, ship dates). Rows are merged by seller SKU (Restock report wins when both list the same SKU). The first `getReports` call filters by marketplace; if nothing matches, we **retry without** `marketplaceIds`. Requires **Reports** + **Amazon Fulfillment** (Restock may also need **Pricing**). Request each report at least once under **Reports** → **Fulfillment by Amazon (FBA)** and wait until **Done**. Set **`SP_API_FETCH_RESTOCK_REPORT=0`** to skip. **`SP_API_RESTOCK_REPORT_MAX_AGE_HOURS`** (default **336**) prefers newer **DONE** documents but falls back to the newest available.
- **Timeouts** — live aggregation is bounded by **`SP_API_DASHBOARD_TIMEOUT_MS`** (default **300000** / 5 min, max **600000**). The browser waits **630s** before aborting. **`/api/debug/sp-auth`** runs **one** Sales call; **`/api/dashboard`** runs **many** SP-API calls (Sales + up to **N** FBA pages + optional Catalog + per-SKU), so debug can be green while the dashboard still needs a higher timeout or the fast path caps below. If you copied **`SP_API_DASHBOARD_TIMEOUT_MS=120000`** into `.env.local`, raise or remove it so the new default applies.
- **Fast path (avoid timeouts)** — Set **`SP_API_MAX_ASIN_THUMBNAILS=0`** and **`SP_API_MAX_SKU_METRICS=0`** to skip Catalog and per-SKU Sales calls. You still get **aggregate sales** (chart) and **FBA inventory** rows; thumbnails and per-SKU ordered / sales / forecast show placeholders until you raise the caps again.

## Scripts

| Command        | Description        |
| -------------- | ------------------ |
| `npm run dev`  | Development server |
| `npm run build` | Production build   |
| `npm run start` | Production server  |
| `npm run lint`  | ESLint             |

{

  "configured": true,

  "lwaTokenRefresh": {

    "ok": true

  },

  "sellersApi": {

    "ok": true

  },

  "salesApi": {

    "ok": true,

    "orderMetricsRows": 13,

    "unitCountSum": 1723,

    "intervalSample": "2025-03-01T00:00:00.000Z--2026-04-01T00:00:00.000Z",

    "firstIntervalSample": {

      "interval": "2025-03-01T00:00Z--2025-04-01T00:00Z",

      "unitCount": 167,

      "orderItemCount": 162,

      "orderCount": 160,

      "averageUnitPrice": {

        "amount": 73.76,

        "currencyCode": "USD"

      },

      "totalSales": {

        "amount": 12318.02,

        "currencyCode": "USD"

      }

    }

  },

  "marketplaceId": "ATVPDKIKX0DER",

  "region": "na",

  "message": "LWA + Sellers + Sales (getOrderMetrics) OK. If the dashboard still errors, check FBA Inventory or per-SKU Sales calls."

}

{

  "mode": "mock",

  "marketplaceId": "ATVPDKIKX0DER",

  "period": "month",

  "rangeLabel": "Sample data",

  "sales": {

    "series": [

      {

        "label": "M1",

        "unitCount": 360

      },

      {

        "label": "M2",

        "unitCount": 380

      },

      {

        "label": "M3",

        "unitCount": 400

      },

      {

        "label": "M4",

        "unitCount": 419

      },

      {

        "label": "M5",

        "unitCount": 439

      },

      {

        "label": "M6",

        "unitCount": 459

      },

      {

        "label": "M7",

        "unitCount": 479

      },

      {

        "label": "M8",

        "unitCount": 499

      },

      {

        "label": "M9",

        "unitCount": 518

      },

      {

        "label": "M10",

        "unitCount": 538

      },

      {

        "label": "M11",

        "unitCount": 558

      },

      {

        "label": "M12",

        "unitCount": 578

      }

    ],

    "totalUnits": 5627

  },

  "products": [

    {

      "sku": "SKU-ALPHA-01",

      "asin": "B08N5WRWNW",

      "title": "Example wireless earbuds (mock)",

      "thumbnailUrl": null,

      "quantityInStock": 142,

      "quantityOrdered": 38,

      "forecastDaysOfCover": 335

    },

    {

      "sku": "SKU-BRAVO-02",

      "asin": "B07ZPKBL9V",

      "title": "USB-C charging cable 6ft (mock)",

      "thumbnailUrl": null,

      "quantityInStock": 890,

      "quantityOrdered": 210,

      "forecastDaysOfCover": 381

    },

    {

      "sku": "SKU-CHARLIE-03",

      "asin": "B09V3KXJPB",

      "title": "Desk lamp LED adjustable (mock)",

      "thumbnailUrl": null,

      "quantityInStock": 56,

      "quantityOrdered": 44,

      "forecastDaysOfCover": 114

    }

  ],

  "warning": "Could not load live Amazon data (Live dashboard fetch timed out after 120s). Showing sample data instead."

}

Could not load live Amazon data (Live dashboard fetch timed out after 120s). Showing sample data instead.

Here’s what was going wrong and what we changed.

1. Duplicate SP_API_MAX_SKU_METRICS in .env.local
You had SP_API_MAX_SKU_METRICS=0 near the top (fast path) and SP_API_MAX_SKU_METRICS=50 later in the file. In .env files the last assignment wins, so the app was still doing 50 per-SKU Sales calls, which is slow and works against the fast path.

The later block (comment + =50) was removed so 0 is what actually applies.

2. SP_API_DASHBOARD_TIMEOUT_MS=120000
If that value is set anywhere, the server really does stop after 120s. In src/lib/env.ts, 120000 is now treated as 300000 (5 minutes) so the usual “2 minute” copy-paste doesn’t keep breaking the dashboard. Any other value is unchanged (including your 500000).

Restart npm run dev and reload the app so the server picks up the updated env.

Security note: Your .env.local contains live LWA/refresh values. Don’t commit it to git or paste it in chats; rotate credentials in Amazon if it may have leaked.

what should these be set at:



.env.local (13-18)
 

Here’s a practical way to set those lines.

SP_API_MARKETPLACE_ID
ATVPDKIKX0DER — US marketplace. Keep this if your main business is Amazon.com (US).
Omit it only if you want the app to auto-pick from Sellers API (still usually US for na).

SP_API_DASHBOARD_TIMEOUT_MS
500000 (500s) is fine for local dev with a big catalog.
Defaults in code are 300000 (5 min) if unset; max 600000 (10 min).
Use higher if you still see timeouts after lowering the caps below.

SP_API_MAX_INVENTORY_PAGES
Each value = one FBA getInventorySummaries call.
10 is a reasonable balance; use 5–15 if you want faster loads; raise only if you need more inventory rows in the table.

SP_API_MAX_ASIN_THUMBNAILS
0 — no Catalog image calls (fastest; no thumbnails).
6–12 — if you want some images without many API calls.
24 or more — more thumbnails, slower.

SP_API_MAX_SKU_METRICS
0 — no per-SKU Sales calls; ordered, sales, and days of cover stay at 0 / —; chart still uses aggregate Sales.
10–25 — lighter enrichment.
50 — heavier (many getOrderMetrics calls); only use if you need per-SKU rows and timeouts are acceptable.

SP_API_FETCH_RESTOCK_REPORT
Default on (omit or any value except `0`, `false`, `no`). Set to **`0`** to skip Reports list + Restock TSV download.

SP_API_RESTOCK_REPORT_MAX_AGE_HOURS
Default **336** (14 days). The dashboard prefers a **DONE** Restock report created within this window; if none, it uses the newest **DONE** report anyway.