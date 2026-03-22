/**
 * amazon-sp-api throws CustomError with Amazon fields: code, message, details.
 */
export function formatSpApiError(e: unknown): string {
  if (e instanceof Error) {
    const x = e as Error & { code?: string; details?: string };
    const parts = [e.message];
    if (x.code) parts.push(`(${x.code})`);
    if (x.details && x.details !== e.message) parts.push(x.details);
    return parts.join(" ");
  }
  return String(e);
}
