import type { SellingPartner } from "amazon-sp-api";

export type InventorySummaryRow = {
  asin?: string;
  sellerSku?: string;
  productName?: string;
  /** Total units in the fulfillment network (prefer over fulfillable-only). */
  totalQuantity?: number;
  inventoryDetails?: {
    fulfillableQuantity?: number;
    inboundWorkingQuantity?: number;
    inboundShippedQuantity?: number;
    inboundReceivingQuantity?: number;
    reservedQuantity?: number;
  };
};

export function inventoryDisplayQuantity(row: InventorySummaryRow): number {
  if (typeof row.totalQuantity === "number") return row.totalQuantity;
  const d = row.inventoryDetails;
  if (!d) return 0;
  return (
    (d.fulfillableQuantity ?? 0) +
    (d.inboundWorkingQuantity ?? 0) +
    (d.inboundShippedQuantity ?? 0) +
    (d.inboundReceivingQuantity ?? 0) +
    (d.reservedQuantity ?? 0)
  );
}

export async function fetchAllInventorySummaries(
  sp: SellingPartner,
  marketplaceId: string,
  maxPages: number,
): Promise<{ summaries: InventorySummaryRow[]; truncated: boolean }> {
  const out: InventorySummaryRow[] = [];
  let nextToken: string | undefined;
  let pages = 0;
  let truncated = false;
  do {
    const res = (await sp.callAPI({
      operation: "getInventorySummaries",
      endpoint: "fbaInventory",
      query: {
        details: true,
        granularityType: "Marketplace",
        granularityId: marketplaceId,
        marketplaceIds: [marketplaceId],
        ...(nextToken ? { nextToken } : {}),
      },
    })) as { inventorySummaries?: InventorySummaryRow[]; nextToken?: string };
    out.push(...(res.inventorySummaries ?? []));
    nextToken = res.nextToken;
    pages += 1;
    if (nextToken && pages >= maxPages) {
      truncated = true;
      break;
    }
  } while (nextToken);
  return { summaries: out, truncated };
}

export function sortInventoryByFbaQuantity(
  rows: InventorySummaryRow[],
): InventorySummaryRow[] {
  return [...rows].sort((a, b) => {
    const qa = inventoryDisplayQuantity(a);
    const qb = inventoryDisplayQuantity(b);
    if (qb !== qa) return qb - qa;
    return (a.sellerSku ?? "").localeCompare(b.sellerSku ?? "");
  });
}
