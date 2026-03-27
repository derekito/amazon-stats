import "server-only";

import type { SellingPartner } from "amazon-sp-api";

import type { AppEnv } from "@/lib/env";
import { forecastDaysOfCover } from "@/lib/sp/forecast";
import {
  getOrderMetricsRange,
  intervalSpanDays,
  type SalesPeriod,
} from "@/lib/sp/intervals";
import {
  fetchAllInventorySummaries,
  inventoryDisplayQuantity,
  sortInventoryByFbaQuantity,
  type InventorySummaryRow,
} from "@/lib/sp/inventory-summaries";
import { loadSkuExclusionsSet } from "@/lib/sp/load-sku-exclusions";
import { loadSkuThresholdsMap } from "@/lib/sp/load-sku-thresholds";
import { resolveMarketplaceId } from "@/lib/sp/marketplace";
import {
  metricUnitCount,
  parseOrderMetricsPayload,
} from "@/lib/sp/parse-order-metrics";
import { computeProductAlerts, velocityUnitsPerDay } from "@/lib/sp/product-insights";
import { runSpStep } from "@/lib/sp/sp-step";

function filterExcludedInventory(
  rows: InventorySummaryRow[],
  excluded: Set<string>,
): InventorySummaryRow[] {
  return rows.filter((r) => {
    const sku = r.sellerSku?.trim() ?? "";
    if (!sku) return true;
    return !excluded.has(sku);
  });
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchOrderMetricsForSku(
  sp: SellingPartner,
  marketplaceId: string,
  interval: string,
  sku: string,
) {
  const query: Record<string, unknown> = {
    marketplaceIds: [marketplaceId],
    interval,
    granularity: "Total",
    granularityTimeZone: "UTC",
    sku,
  };
  return sp.callAPI({
    operation: "getOrderMetrics",
    endpoint: "sales",
    query,
  });
}

export type DigestRow = {
  sku: string;
  title: string;
  quantityInStock: number;
  forecastDaysOfCover: number | null;
  velocityPerDay: number | null;
  reasons: string[];
};

/**
 * Build digest rows (SKUs to watch) using the same rules as the dashboard + “within N days” cover.
 */
export async function buildInventoryDigestRows(
  sp: SellingPartner,
  env: AppEnv,
  marketplaceId: string,
): Promise<{ rangeLabel: string; rows: DigestRow[]; evaluatedSkus: number }> {
  const period = env.SP_DIGEST_PERIOD as SalesPeriod;
  const range = getOrderMetricsRange(period);
  const forecastWindowDays = intervalSpanDays(range.interval);
  const skuExcluded = await loadSkuExclusionsSet("na");
  const skuThresholds = loadSkuThresholdsMap();

  const invWrap = await runSpStep("FBA Inventory (digest)", () =>
    fetchAllInventorySummaries(sp, marketplaceId, env.SP_API_MAX_INVENTORY_PAGES),
  );
  const inventory = filterExcludedInventory(invWrap.summaries, skuExcluded);
  const sorted = sortInventoryByFbaQuantity(inventory);
  const cap = env.SP_DIGEST_MAX_SKUS;
  const slice = sorted.slice(0, cap);

  const SKU_BATCH = 5;
  const unitsBySku = new Map<string, number>();
  const skus = slice.map((r) => r.sellerSku).filter(Boolean) as string[];

  for (let i = 0; i < skus.length; i += SKU_BATCH) {
    const chunk = skus.slice(i, i + SKU_BATCH);
    await Promise.all(
      chunk.map(async (sku) => {
        try {
          const p = await fetchOrderMetricsForSku(sp, marketplaceId, range.interval, sku);
          const skuRows = parseOrderMetricsPayload(p);
          let units = 0;
          for (const r of skuRows) units += metricUnitCount(r);
          unitsBySku.set(sku, units);
        } catch {
          unitsBySku.set(sku, 0);
        }
      }),
    );
    if (i + SKU_BATCH < skus.length) await delay(250);
  }

  const digestDays = env.SP_DIGEST_DAYS_COVER_WITHIN;
  const rows: DigestRow[] = [];

  for (const row of slice) {
    const sku = row.sellerSku ?? "";
    if (!sku) continue;
    const qty = inventoryDisplayQuantity(row);
    const ordered = unitsBySku.get(sku) ?? 0;
    const foc = forecastDaysOfCover(qty, ordered, forecastWindowDays);
    const th = skuThresholds[sku];
    const alerts = computeProductAlerts({
      quantityInStock: qty,
      quantityOrdered: ordered,
      forecastDaysOfCover: foc,
      daysOfCoverThreshold: env.SP_DASHBOARD_DAYS_OF_COVER_THRESHOLD,
      defaultReorderPoint: env.SP_DASHBOARD_DEFAULT_REORDER_POINT,
      skuReorderPoint: th?.reorderPoint,
      slowMoverMinStock: env.SP_DASHBOARD_SLOW_MOVER_MIN_STOCK,
      slowMoverMaxOrdered: env.SP_DASHBOARD_SLOW_MOVER_MAX_ORDERED,
      replenish: {
        replenishMaxUnits: env.SP_DASHBOARD_REPLENISH_MAX_UNITS,
        replenishMaxDaysCover: env.SP_DASHBOARD_REPLENISH_MAX_DAYS_COVER,
        skuReplenishMaxUnits: th?.replenishMaxUnits,
        skuReplenishMaxDaysCover: th?.replenishMaxDaysCover,
      },
    });

    const reasons: string[] = [];
    if (alerts.includes("stockout")) reasons.push("Out of stock");
    if (alerts.includes("replenish")) reasons.push("Replenish rule (FBA ≤ max units or cover ≤ max days)");
    if (foc != null && foc <= digestDays) reasons.push(`≤${digestDays} days cover`);

    const include =
      alerts.includes("stockout") ||
      alerts.includes("replenish") ||
      (foc != null && foc <= digestDays && qty > 0);

    if (!include) continue;

    rows.push({
      sku,
      title: row.productName ?? sku,
      quantityInStock: qty,
      forecastDaysOfCover: foc,
      velocityPerDay: velocityUnitsPerDay(ordered, forecastWindowDays),
      reasons: [...new Set(reasons)],
    });
  }

  rows.sort((a, b) => {
    const fa = a.forecastDaysOfCover ?? 9999;
    const fb = b.forecastDaysOfCover ?? 9999;
    return fa - fb;
  });

  return {
    rangeLabel: range.label,
    rows,
    evaluatedSkus: skus.length,
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildDigestEmailHtml(
  rows: DigestRow[],
  rangeLabel: string,
): string {
  if (rows.length === 0) {
    return `<p>No SKUs matched the digest rules for window <strong>${escapeHtml(rangeLabel)}</strong>.</p>`;
  }
  const tableRows = rows
    .map(
      (r) =>
        `<tr><td style="padding:6px;border:1px solid #ccc;font-family:monospace;font-size:12px">${escapeHtml(r.sku)}</td>` +
        `<td style="padding:6px;border:1px solid #ccc;font-size:12px">${escapeHtml(r.title.slice(0, 80))}${r.title.length > 80 ? "…" : ""}</td>` +
        `<td style="padding:6px;border:1px solid #ccc;text-align:right">${r.quantityInStock}</td>` +
        `<td style="padding:6px;border:1px solid #ccc;text-align:right">${r.forecastDaysOfCover ?? "—"}</td>` +
        `<td style="padding:6px;border:1px solid #ccc;text-align:right">${r.velocityPerDay ?? "—"}</td>` +
        `<td style="padding:6px;border:1px solid #ccc;font-size:11px">${escapeHtml(r.reasons.join("; "))}</td></tr>`,
    )
    .join("");
  return (
    `<p>SKUs to review (replenish rule, out of stock, or ≤ digest days of cover). Sales window: <strong>${escapeHtml(rangeLabel)}</strong>.</p>` +
    `<table style="border-collapse:collapse;width:100%;max-width:900px"><thead><tr>` +
    `<th style="text-align:left;padding:6px;border:1px solid #999">SKU</th>` +
    `<th style="text-align:left;padding:6px;border:1px solid #999">Product</th>` +
    `<th style="text-align:right;padding:6px;border:1px solid #999">FBA</th>` +
    `<th style="text-align:right;padding:6px;border:1px solid #999">Days cover</th>` +
    `<th style="text-align:right;padding:6px;border:1px solid #999">Units/day</th>` +
    `<th style="text-align:left;padding:6px;border:1px solid #999">Why</th>` +
    `</tr></thead><tbody>${tableRows}</tbody></table>`
  );
}

export async function runInventoryDigest(sp: SellingPartner, env: AppEnv): Promise<{
  rangeLabel: string;
  rows: DigestRow[];
  evaluatedSkus: number;
  html: string;
  subject: string;
  email: { ok: boolean; error?: string };
}> {
  const marketplaceId = await runSpStep("Sellers API (digest marketplace)", () =>
    resolveMarketplaceId(sp, env),
  );
  const { rangeLabel, rows, evaluatedSkus } = await buildInventoryDigestRows(
    sp,
    env,
    marketplaceId,
  );
  const html = buildDigestEmailHtml(rows, rangeLabel);
  const subject = `Amazon FBA digest — ${rows.length} SKU(s) · ${rangeLabel}`;
  const email = await sendDigestEmail(env, subject, html);
  return { rangeLabel, rows, evaluatedSkus, html, subject, email };
}

export async function sendDigestEmail(
  env: AppEnv,
  subject: string,
  html: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!env.RESEND_API_KEY || !env.SP_DIGEST_EMAIL_TO) {
    return { ok: false, error: "RESEND_API_KEY or SP_DIGEST_EMAIL_TO not set" };
  }
  const from =
    env.RESEND_FROM ?? "Amazon inventory digest <onboarding@resend.dev>";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [env.SP_DIGEST_EMAIL_TO],
      subject,
      html,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    return { ok: false, error: t || res.statusText };
  }
  return { ok: true };
}
