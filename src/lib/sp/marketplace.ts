import "server-only";

import type { SellingPartner } from "amazon-sp-api";

import type { AppEnv } from "@/lib/env";
import {
  marketplaceIdsForRegion,
  type SpApiRegion,
} from "@/lib/sp/marketplace-ids-by-region";

/** Marketplace IDs look like ATVPDKIKX0DER (US). Application IDs look like amzn1.sp.solution.... */
export function assertRunnableMarketplaceId(id: string): void {
  const t = id.trim();
  if (!t) throw new Error("Marketplace id is empty.");
  if (t.includes("sp.solution") || t.startsWith("amzn1.")) {
    throw new Error(
      "Invalid marketplace id: this value looks like an SP-API Application/Solution id (amzn1.sp…), not a marketplace id. Example US marketplace: ATVPDKIKX0DER. Remove SP_API_MARKETPLACE_ID from .env.local to auto-detect from Sellers API, or set the correct Marketplace ID from Amazon’s marketplace list.",
    );
  }
}

export async function resolveMarketplaceId(sp: SellingPartner, env: AppEnv): Promise<string> {
  if (env.SP_API_MARKETPLACE_ID) {
    assertRunnableMarketplaceId(env.SP_API_MARKETPLACE_ID);
    return env.SP_API_MARKETPLACE_ID;
  }
  const res = (await sp.callAPI({
    operation: "getMarketplaceParticipations",
    endpoint: "sellers",
  })) as { marketplace?: { id?: string }; participation?: { isParticipating?: boolean } }[];
  if (!Array.isArray(res) || res.length === 0) {
    throw new Error("No marketplace participation returned; set SP_API_MARKETPLACE_ID.");
  }

  const region = env.SP_API_REGION as SpApiRegion;
  const allowed = marketplaceIdsForRegion(region);
  const eligible = res.filter((p) => p.marketplace?.id && allowed.has(p.marketplace.id));

  const id = pickMarketplaceIdForRegion(eligible, region);
  if (!id) {
    const seen = res.map((p) => p.marketplace?.id).filter(Boolean);
    throw new Error(
      `No marketplace participation matches SP_API_REGION=${region} (known ids for that host). ` +
        `Returned ids: ${seen.join(", ")}. ` +
        `Set SP_API_MARKETPLACE_ID to an id from https://developer-docs.amazon.com/sp-api/docs/marketplace-ids for your country, ` +
        `or set SP_API_REGION to na / eu / fe to match https://developer-docs.amazon.com/sp-api/docs/sp-api-endpoints .`,
    );
  }
  assertRunnableMarketplaceId(id);
  return id;
}

type Part = {
  marketplace?: { id?: string };
  participation?: { isParticipating?: boolean };
};

/** Prefer participations that belong to the current SP-API host; avoid picking an id that only works on another host. */
function pickMarketplaceIdForRegion(eligible: Part[], region: SpApiRegion): string | undefined {
  if (eligible.length > 0) {
    const active = eligible.find((p) => p.participation?.isParticipating);
    if (active?.marketplace?.id) return active.marketplace.id;
    if (region === "na") {
      const us = eligible.find((p) => p.marketplace?.id === "ATVPDKIKX0DER");
      if (us?.marketplace?.id) return us.marketplace.id;
    }
    return eligible[0]?.marketplace?.id;
  }
  return undefined;
}
