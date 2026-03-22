import "server-only";

import { formatSpApiError } from "@/lib/sp/error-message";

/** Re-throw with a label so API routes can show which SP-API surface failed. */
export async function runSpStep<T>(step: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw new Error(`${step}: ${formatSpApiError(e)}`);
  }
}
