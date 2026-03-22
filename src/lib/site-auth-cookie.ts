/** HMAC-signed session cookie — Web Crypto only (Edge middleware compatible). */

const enc = new TextEncoder();

function base64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  bytes.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export type SiteSessionPayload = { e: string; exp: number };

export const SITE_AUTH_COOKIE = "amazon_sales_site";

export async function signSiteSession(
  email: string,
  secret: string,
  maxAgeSec: number,
): Promise<string> {
  const payload: SiteSessionPayload = {
    e: email,
    exp: Math.floor(Date.now() / 1000) + maxAgeSec,
  };
  const body = JSON.stringify(payload);
  const key = await importHmacKey(secret);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(body)));
  return `${base64urlEncode(enc.encode(body))}.${base64urlEncode(sig)}`;
}

export async function verifySiteSession(
  token: string,
  secret: string,
  expectedEmail: string,
): Promise<SiteSessionPayload | null> {
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const bodyB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);
  if (!bodyB64 || !sigB64) return null;
  let bodyBytes: Uint8Array;
  let sig: Uint8Array;
  try {
    bodyBytes = base64urlDecode(bodyB64);
    sig = base64urlDecode(sigB64);
  } catch {
    return null;
  }
  const body = new TextDecoder().decode(bodyBytes);
  const key = await importHmacKey(secret);
  const sigCopy = new Uint8Array(sig);
  const ok = await crypto.subtle.verify("HMAC", key, sigCopy, enc.encode(body));
  if (!ok) return null;
  try {
    const p = JSON.parse(body) as SiteSessionPayload;
    if (typeof p.e !== "string" || typeof p.exp !== "number") return null;
    if (p.exp < Math.floor(Date.now() / 1000)) return null;
    if (p.e.trim().toLowerCase() !== expectedEmail.trim().toLowerCase()) return null;
    return p;
  } catch {
    return null;
  }
}
