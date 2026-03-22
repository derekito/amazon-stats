import "server-only";

import { SellingPartner } from "amazon-sp-api";
import type { AppEnv } from "@/lib/env";

export function createSellingPartner(env: AppEnv): SellingPartner {
  if (!env.SP_API_REFRESH_TOKEN || !env.SELLING_PARTNER_APP_CLIENT_ID || !env.SELLING_PARTNER_APP_CLIENT_SECRET) {
    throw new Error("SP-API credentials are not configured");
  }

  return new SellingPartner({
    region: env.SP_API_REGION,
    refresh_token: env.SP_API_REFRESH_TOKEN,
    credentials: {
      SELLING_PARTNER_APP_CLIENT_ID: env.SELLING_PARTNER_APP_CLIENT_ID,
      SELLING_PARTNER_APP_CLIENT_SECRET: env.SELLING_PARTNER_APP_CLIENT_SECRET,
    },
    options: {
      auto_request_throttled: true,
      debug_log: false,
    },
  });
}
