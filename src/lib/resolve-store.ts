import "server-only";

import { cookies } from "next/headers";

import { parseStoreId, STORE_COOKIE_NAME, type StoreId } from "@/lib/store";

/** Active store from the browser cookie (defaults to Naked Armor when unset). */
export async function resolveStoreId(): Promise<StoreId> {
  const c = await cookies();
  return parseStoreId(c.get(STORE_COOKIE_NAME)?.value);
}
