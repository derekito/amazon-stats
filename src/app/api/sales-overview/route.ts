import { NextResponse } from "next/server";

import { getEnv, hasSpApiCredentials } from "@/lib/env";
import { createSellingPartner } from "@/lib/sp/client";
import { fetchLiveSalesOverview } from "@/lib/sp/fetch-sales-overview";
import { formatSpApiError } from "@/lib/sp/error-message";
import { getMockSalesOverview } from "@/lib/sp/mock-data";

export const dynamic = "force-dynamic";

const SALES_OVERVIEW_TIMEOUT_MS = 120_000;

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

export async function GET() {
  const env = getEnv();
  if (env.SP_API_USE_MOCK || !hasSpApiCredentials(env)) {
    return NextResponse.json(getMockSalesOverview());
  }

  try {
    const sp = createSellingPartner(env);
    const data = await withTimeout(
      fetchLiveSalesOverview(sp, env),
      SALES_OVERVIEW_TIMEOUT_MS,
      "Sales overview fetch",
    );
    return NextResponse.json(data);
  } catch (e) {
    const message = formatSpApiError(e);
    return NextResponse.json({
      ...getMockSalesOverview(),
      mode: "mock" as const,
      warning: `Could not load live Amazon data (${message}). Showing sample data instead.`,
    });
  }
}
