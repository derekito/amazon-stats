/**
 * When all three are set, middleware requires a login cookie for pages and most API routes.
 * Cron routes use their own secrets and stay ungated.
 */
export function getSiteAccessGate(): {
  email: string;
  password: string;
  secret: string;
} | null {
  const email = process.env.SITE_ACCESS_EMAIL?.trim();
  const password = process.env.SITE_ACCESS_PASSWORD;
  const secret = process.env.SITE_ACCESS_AUTH_SECRET;
  if (!email || !password || !secret) return null;
  return { email, password, secret };
}
