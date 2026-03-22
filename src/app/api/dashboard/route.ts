import { NextResponse } from "next/server";

import { getEnv, hasSpApiCredentials } from "@/lib/env";
import { createSellingPartner } from "@/lib/sp/client";
import { fetchLiveDashboard } from "@/lib/sp/fetch-dashboard";
import { formatSpApiError } from "@/lib/sp/error-message";
import { getMockDashboard } from "@/lib/sp/mock-data";
import type { SalesPeriod } from "@/lib/sp/intervals";

export const dynamic = "force-dynamic";

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms / 1000}s`));
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function parsePeriod(raw: string | null): SalesPeriod | null {
  if (!raw) return "month";
  if (raw === "day" || raw === "week" || raw === "month" || raw === "quarter") return raw;
  return null;
}

function parsePositiveInt(raw: string | null, fallback: number, min: number, max: number): number {
  if (raw === null || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const period = parsePeriod(searchParams.get("period"));
  if (!period) {
    return NextResponse.json({ error: "Invalid period" }, { status: 400 });
  }

  const env = getEnv();
  const configuredPageSize = env.SP_DASHBOARD_PRODUCT_PAGE_SIZE;
  /** 0 = unlimited single page (server-side); otherwise env page size (1–50k). */
  const productPageSize = configuredPageSize <= 0 ? 0 : configuredPageSize;
  const productPage = parsePositiveInt(searchParams.get("productPage"), 1, 1, 10_000);
  if (env.SP_API_USE_MOCK || !hasSpApiCredentials(env)) {
    return NextResponse.json(getMockDashboard(period, { productPage, productPageSize }));
  }

  try {
    const sp = createSellingPartner(env);
    const data = await withTimeout(
      fetchLiveDashboard(sp, env, period, { productPage, productPageSize }),
      env.SP_API_DASHBOARD_TIMEOUT_MS,
      "Live dashboard fetch",
    );
    return NextResponse.json(data);
  } catch (e) {
    const message = formatSpApiError(e);
    return NextResponse.json({
      ...getMockDashboard(period, { productPage, productPageSize }),
      mode: "mock",
      warning: `Could not load live Amazon data (${message}). Showing sample data instead.`,
    });
  }
}
