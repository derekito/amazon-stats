import type { SkuCostEntry } from "@/lib/sp/load-sku-costs";

function stripBom(text: string): string {
  if (text.charCodeAt(0) === 0xfeff) return text.slice(1);
  return text;
}

/** Lowercase alphanumerics only — "Seller SKU" → "sellersku", "Unit Cost" → "unitcost" */
export function normalizeHeaderCell(s: string): string {
  return s
    .toLowerCase()
    .replace(/^\uFEFF/, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQ = !inQ;
      continue;
    }
    if (!inQ && c === ",") {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Lines that are not data (Google HTML/JS snippets, comments, etc.) */
function isJunkCsvLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (t.startsWith("//")) return true;
  if (t.startsWith("/*") || t.startsWith("*/")) return true;
  if (t === "/*" || t === "*/") return true;
  if (t.startsWith("#") && !t.includes(",")) return true;

  const first = parseCsvLine(t)[0]?.trim() ?? "";
  if (!first) return true;
  if (first === "/*" || first === "*/" || first === "*") return true;
  if (first.startsWith("//")) return true;
  if (first.startsWith("/*")) return true;
  if (/^[\/*#]+$/.test(first)) return true;

  return false;
}

function findSkuColumnIndex(headerNorms: string[]): number {
  const skuCandidates = [
    "sellersku",
    "merchantsku",
    "sellsku",
    "sku",
    "fnsku",
    "amazonsku",
  ];
  for (const c of skuCandidates) {
    const i = headerNorms.findIndex((n) => n === c);
    if (i >= 0) return i;
  }
  return -1;
}

function findCostColumnIndex(headerNorms: string[]): number {
  const exact = [
    "unitcost",
    "landedcost",
    "landedunitcost",
    "cogs",
    "unitcogs",
    "wholesalecost",
    "productcost",
    "costperunit",
    "buyingcost",
    "purchasecost",
    "cost",
  ];
  for (const c of exact) {
    const i = headerNorms.findIndex((n) => n === c);
    if (i >= 0) return i;
  }
  for (const sub of ["unitcost", "landedcost", "cogs", "wholesale"]) {
    const i = headerNorms.findIndex((n) => n.includes(sub));
    if (i >= 0) return i;
  }
  const i = headerNorms.findIndex(
    (n) =>
      n.endsWith("cost") &&
      !n.includes("sale") &&
      !n.includes("retail") &&
      !n.includes("shipping") &&
      !n.includes("amazonfee") &&
      !n.includes("advertising"),
  );
  return i;
}

function findCurrencyColumnIndex(headerNorms: string[]): number {
  return headerNorms.findIndex((n) => n === "currency" || n === "curr" || n === "ccy");
}

function isLikelyHeaderRow(parts: string[]): boolean {
  if (parts.length < 2) return false;
  const norms = parts.map((p) => normalizeHeaderCell(p));
  const skuI = findSkuColumnIndex(norms);
  const costI = findCostColumnIndex(norms);
  if (skuI < 0 || costI < 0 || skuI === costI) return false;
  const skuSample = parts[skuI]?.replace(/[$,\s]/g, "") ?? "";
  if (skuSample !== "" && Number.isFinite(Number(skuSample)) && Number(skuSample) > 1000) {
    return false;
  }
  return true;
}

type ColumnMap = { sku: number; cost: number; currency: number };

function parseCostCell(raw: string | undefined): number | null {
  if (raw == null) return null;
  const t = raw.replace(/[$€£¥,\s]/g, "").trim();
  if (t === "" || t === "-" || t === ".") return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/**
 * Columns: product title, seller SKU, unit cost[, currency].
 * Common when the sheet has no header row or the header wasn’t recognized.
 */
function tryMiddleSkuCost(parts: string[]): { sku: string; cost: number } | null {
  if (parts.length < 3) return null;
  const sku = parts[1]?.trim() ?? "";
  if (!sku || isJunkCsvLine(`${sku},`)) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(sku)) return null;
  const cost = parseCostCell(parts[2]);
  if (cost == null) return null;
  return { sku, cost };
}

function emitRow(
  out: Record<string, SkuCostEntry>,
  sku: string,
  cost: number,
  currencyRaw: string | undefined,
): void {
  if (!sku || isJunkCsvLine(`${sku},`)) return;
  if (/^[\/*#]+$/.test(sku) || sku.startsWith("//")) return;

  let currency: string | undefined;
  if (currencyRaw) {
    const c = currencyRaw.trim().toUpperCase();
    if (c.length >= 3 && c.length <= 8 && /^[A-Z]+$/.test(c)) currency = c;
  }

  out[sku] = {
    unitCost: Math.round(cost * 100) / 100,
    ...(currency ? { currency } : {}),
  };
}

/**
 * Parses SKU cost CSV from Google Sheets or paste.
 * - Strips BOM; skips comment/junk lines (//, /*, HTML/JS noise).
 * - Detects header row and maps **Seller SKU**, **Unit cost**, etc. by column name.
 * - If there is no header, uses **sku, cost, currency** or **product, sku, cost** (3+ columns).
 */
export function parseSkuCostsCsv(text: string): Record<string, SkuCostEntry> {
  const rawLines = stripBom(text)
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);

  const lines = rawLines.filter((l) => !isJunkCsvLine(l));
  const out: Record<string, SkuCostEntry> = {};
  if (lines.length === 0) return out;

  let col: ColumnMap = { sku: 0, cost: 1, currency: 2 };
  let hasHeader = false;

  const firstParts = parseCsvLine(lines[0]);
  if (isLikelyHeaderRow(firstParts)) {
    const norms = firstParts.map((p) => normalizeHeaderCell(p));
    const sku = findSkuColumnIndex(norms);
    const cost = findCostColumnIndex(norms);
    if (sku >= 0 && cost >= 0 && sku !== cost) {
      const cur = findCurrencyColumnIndex(norms);
      col = { sku, cost, currency: cur >= 0 ? cur : -1 };
      hasHeader = true;
    }
  }

  const dataStart = hasHeader ? 1 : 0;

  for (let i = dataStart; i < lines.length; i++) {
    if (isJunkCsvLine(lines[i])) continue;
    const parts = parseCsvLine(lines[i]);
    if (parts.length === 0) continue;

    if (hasHeader) {
      const maxIdx = Math.max(col.sku, col.cost, col.currency >= 0 ? col.currency : -1);
      if (parts.length <= maxIdx) continue;
      const sku = parts[col.sku]?.trim() ?? "";
      const cost = parseCostCell(parts[col.cost]);
      if (!sku || cost == null) continue;
      const cur = col.currency >= 0 ? parts[col.currency] : undefined;
      emitRow(out, sku, cost, cur);
      continue;
    }

    const mid = tryMiddleSkuCost(parts);
    if (mid) {
      emitRow(out, mid.sku, mid.cost, parts.length > 3 ? parts[3] : undefined);
      continue;
    }

    if (parts.length >= 2) {
      const sku = parts[0]?.trim() ?? "";
      const cost = parseCostCell(parts[1]);
      if (sku && cost != null) {
        emitRow(out, sku, cost, parts[2]);
      }
    }
  }

  return out;
}
