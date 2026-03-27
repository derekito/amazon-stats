import { NextResponse } from "next/server";

import { getEnv, hasSpApiCredentials } from "@/lib/env";
import { resolveStoreId } from "@/lib/resolve-store";
import { createSellingPartner } from "@/lib/sp/client";
import { formatSpApiError } from "@/lib/sp/error-message";
import {
  fetchAllInventorySummaries,
  inventoryDisplayQuantity,
  sortInventoryByFbaQuantity,
} from "@/lib/sp/inventory-summaries";
import { loadSkuExclusionsSet } from "@/lib/sp/load-sku-exclusions";
import { resolveMarketplaceId } from "@/lib/sp/marketplace";

export const dynamic = "force-dynamic";

const MOCK_INVENTORY_SKUS = [
  { sku: "SKU-ALPHA-01", title: "Example wireless earbuds (mock)", asin: "B08N5WRWNW", quantity: 142 },
  { sku: "SKU-BRAVO-02", title: "USB-C charging cable 6ft (mock)", asin: "B07ZPKBL9V", quantity: 890 },
  { sku: "SKU-CHARLIE-03", title: "Desk lamp LED adjustable (mock)", asin: "B09V3KXJPB", quantity: 56 },
  { sku: "SKU-DEAD-99", title: "Slow mover — high stock, no sales (mock)", asin: "B0DEADMOCK", quantity: 120 },
  { sku: "SKU-OUT-00", title: "Out of stock sample (mock)", asin: "B0STOCKOUT", quantity: 0 },
];

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const includeExcluded = searchParams.get("all") === "1";

  const storeId = await resolveStoreId();
  const env = getEnv(storeId);
  if (env.SP_API_USE_MOCK || !hasSpApiCredentials(env)) {
    let skus = MOCK_INVENTORY_SKUS;
    if (!includeExcluded) {
      const ex = await loadSkuExclusionsSet(storeId);
      skus = skus.filter((s) => !ex.has(s.sku));
    }
    return NextResponse.json({
      mode: "mock" as const,
      skus,
      truncated: false,
    });
  }

  try {
    const sp = createSellingPartner(env);
    const marketplaceId = await resolveMarketplaceId(sp, env);
    const { summaries, truncated } = await fetchAllInventorySummaries(
      sp,
      marketplaceId,
      env.SP_API_MAX_INVENTORY_PAGES,
    );
    const sorted = sortInventoryByFbaQuantity(summaries);
    let skus = sorted
      .map((r) => {
        const sku = r.sellerSku?.trim() ?? "";
        if (!sku) return null;
        return {
          sku,
          title: r.productName ?? "",
          asin: r.asin,
          quantity: inventoryDisplayQuantity(r),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x != null);

    if (!includeExcluded) {
      const ex = await loadSkuExclusionsSet(storeId);
      skus = skus.filter((s) => !ex.has(s.sku));
    }

    return NextResponse.json({
      mode: "live" as const,
      skus,
      truncated,
    });
  } catch (e) {
    return NextResponse.json({ error: formatSpApiError(e) }, { status: 502 });
  }
}
