/** Cookie-backed seller account (separate SP-API credentials + persisted SKU data). */
export const STORE_IDS = ["na", "bbs"] as const;
export type StoreId = (typeof STORE_IDS)[number];

export const STORE_COOKIE_NAME = "amazon_sales_store";

export const STORE_LABELS: Record<StoreId, string> = {
  na: "Naked Armor",
  bbs: "BirdBeSafe",
};

export function parseStoreId(raw: string | undefined | null): StoreId {
  if (raw === "bbs") return "bbs";
  return "na";
}
