import "server-only";

import { parseISO } from "date-fns";
import type { SellingPartner } from "amazon-sp-api";

import type { AppEnv } from "@/lib/env";
import {
  getOrderMetricsRange,
  getTenDayOrderMetricsRange,
  getPriorTenDayRange,
} from "@/lib/sp/intervals";
import {
  metricTotalSalesFromRow,
  metricUnitCount,
  parseOrderMetricsPayload,
  sumOrderMetricsTotals,
} from "@/lib/sp/parse-order-metrics";
import { resolveMarketplaceId } from "@/lib/sp/marketplace";
import { runSpStep } from "@/lib/sp/sp-step";
import type { MetricsWindowTotals, SalesOverviewPayload, SalesPoint } from "@/lib/sp/types";

function shortLabelFromInterval(interval: string | undefined, index: number): string {
  if (!interval) return String(index + 1);
  const start = parseISO(interval.split("--")[0]?.trim() ?? "");
  if (Number.isNaN(start.getTime())) return String(index + 1);
  const m = start.getUTCMonth() + 1;
  const d = start.getUTCDate();
  const y = String(start.getUTCFullYear()).slice(2);
  return `${m}/${d}/${y}`;
}

async function fetchOrderMetrics(
  sp: SellingPartner,
  marketplaceId: string,
  interval: string,
  granularity: string,
) {
  const query: Record<string, unknown> = {
    marketplaceIds: [marketplaceId],
    interval,
    granularity,
    ...(granularity !== "Hour" ? { granularityTimeZone: "UTC" } : {}),
    ...(granularity === "Week" ? { firstDayOfWeek: "Monday" } : {}),
  };
  return sp.callAPI({
    operation: "getOrderMetrics",
    endpoint: "sales",
    query,
  });
}

function rowsToSeries(rows: ReturnType<typeof parseOrderMetricsPayload>): SalesPoint[] {
  return rows.map((row, i) => {
    const sales = metricTotalSalesFromRow(row);
    return {
      label: shortLabelFromInterval(row.interval, i),
      unitCount: metricUnitCount(row),
      salesAmount: sales?.amount ?? null,
      salesCurrency: sales?.currencyCode ?? null,
    };
  });
}

export async function fetchLiveSalesOverview(
  sp: SellingPartner,
  env: AppEnv,
): Promise<SalesOverviewPayload> {
  const marketplaceId = await runSpStep("Sellers API (marketplace)", () =>
    resolveMarketplaceId(sp, env),
  );

  const yRange = getOrderMetricsRange("day");
  const tenRange = getTenDayOrderMetricsRange();
  const priorRange = getPriorTenDayRange();

  const [yPayload, tenPayload, priorPayload] = await Promise.all([
    runSpStep("Sales API (yesterday)", () =>
      fetchOrderMetrics(sp, marketplaceId, yRange.interval, yRange.granularity),
    ),
    runSpStep("Sales API (10-day)", () =>
      fetchOrderMetrics(sp, marketplaceId, tenRange.interval, tenRange.granularity),
    ),
    (async () => {
      try {
        return await runSpStep("Sales API (prior 10-day)", () =>
          fetchOrderMetrics(sp, marketplaceId, priorRange.interval, priorRange.granularity),
        );
      } catch {
        return null;
      }
    })(),
  ]);

  const yRows = parseOrderMetricsPayload(yPayload);
  const yAgg = sumOrderMetricsTotals(yRows);
  const yesterday: MetricsWindowTotals = {
    label: yRange.label,
    totalUnits: yAgg.totalUnits,
    totalSalesAmount: yAgg.totalSalesAmount,
    totalSalesCurrency: yAgg.totalSalesCurrency,
  };

  const tenRows = parseOrderMetricsPayload(tenPayload);
  const series = rowsToSeries(tenRows);
  const tenAgg = sumOrderMetricsTotals(tenRows);
  const spanDays = 10;
  const avgUnitsPerDay = tenAgg.totalUnits / spanDays;
  const avgSalesPerDay =
    tenAgg.totalSalesAmount != null ? tenAgg.totalSalesAmount / spanDays : null;

  let priorTenDay: MetricsWindowTotals | null = null;
  if (priorPayload != null) {
    const priorRows = parseOrderMetricsPayload(priorPayload);
    const priorAgg = sumOrderMetricsTotals(priorRows);
    priorTenDay = {
      label: priorRange.label,
      totalUnits: priorAgg.totalUnits,
      totalSalesAmount: priorAgg.totalSalesAmount,
      totalSalesCurrency: priorAgg.totalSalesCurrency,
    };
  }

  return {
    mode: "live",
    marketplaceId,
    yesterday,
    tenDay: {
      rangeLabel: tenRange.label,
      series,
      totals: {
        label: tenRange.label,
        totalUnits: tenAgg.totalUnits,
        totalSalesAmount: tenAgg.totalSalesAmount,
        totalSalesCurrency: tenAgg.totalSalesCurrency,
      },
      avgUnitsPerDay,
      avgSalesPerDay,
      avgSalesCurrency: tenAgg.totalSalesCurrency,
    },
    priorTenDay,
  };
}
