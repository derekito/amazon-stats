/**
 * Structured fields from amazon-sp-api CustomError (and similar).
 */
export function spApiErrorDetails(e: unknown): {
  message: string;
  code?: string;
  details?: string;
} {
  if (e instanceof Error) {
    const x = e as Error & { code?: string; details?: string };
    return {
      message: e.message,
      ...(x.code ? { code: x.code } : {}),
      ...(x.details ? { details: x.details } : {}),
    };
  }
  return { message: String(e) };
}
