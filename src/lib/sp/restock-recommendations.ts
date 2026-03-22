import "server-only";

import type { SellingPartner } from "amazon-sp-api";

export type RestockRecommendation = {
  recommendedQty: number | null;
  recommendedShipDate: string | null;
};

export type RestockReportLoadResult = {
  bySku: Map<string, RestockRecommendation>;
  /** `createdTime` of the newest Amazon report document used (either source). */
  asOf: string | null;
  /** At least one DONE report was found and downloaded (TSV may still parse to zero rows). */
  loadedFromAmazon: boolean;
};

const RESTOCK_REPORT_TYPE = "GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT" as const;
/** Seller Central “FBA Inventory” / Manage Inventory Health — same `reportType` in Reports API. */
const PLANNING_REPORT_TYPE = "GET_FBA_INVENTORY_PLANNING_DATA" as const;

type ReportListEntry = {
  reportType?: string;
  processingStatus?: string;
  reportDocumentId?: string;
  createdTime?: string;
  marketplaceIds?: string[];
};

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function normalizeHeader(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** RFC-style CSV row split (handles quoted fields). */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      out.push(field.trim());
      field = "";
    } else {
      field += c;
    }
  }
  out.push(field.trim());
  return out.map((cell) => cell.replace(/^"|"$/g, "").trim());
}

function detectDelimiter(headerLine: string): "\t" | "," {
  const tabs = (headerLine.match(/\t/g) ?? []).length;
  const commas = (headerLine.match(/,/g) ?? []).length;
  if (tabs >= 2 && tabs >= commas) return "\t";
  if (commas >= 2) return ",";
  return tabs > commas ? "\t" : ",";
}

function splitRow(line: string, delim: "\t" | ","): string[] {
  if (delim === "\t") {
    return line.split("\t").map((c) => c.trim().replace(/^"|"$/g, ""));
  }
  return splitCsvLine(line);
}

function findSkuColumnIndex(headers: string[]): number {
  const norm = headers.map(normalizeHeader);
  for (const name of ["merchant sku", "seller sku", "seller-sku", "msku"]) {
    const i = norm.indexOf(name);
    if (i >= 0) return i;
  }
  const skuOnly = norm.indexOf("sku");
  if (skuOnly >= 0 && norm[skuOnly] === "sku") return skuOnly;
  for (let i = 0; i < norm.length; i++) {
    const h = norm[i];
    if (!h || h === "fnsku" || h.includes("fnsku")) continue;
    if (h === "sku" || h.endsWith(" sku")) return i;
  }
  return -1;
}

function findSuggestedQtyColumnIndex(headers: string[]): number {
  const norm = headers.map(normalizeHeader);
  const exact = [
    "recommended replenishment qty",
    "recommended ship-in quantity",
    "recommended restock units",
    "recommended ship in quantity",
  ];
  for (const e of exact) {
    const i = norm.indexOf(e);
    if (i >= 0) return i;
  }
  for (let i = 0; i < norm.length; i++) {
    const h = norm[i];
    if (!h) continue;
    const hasRec = h.includes("recommended") || h.includes("recommendation");
    const hasRestock =
      h.includes("restock") || h.includes("replenish") || h.includes("ship-in") || h.includes("ship in");
    const hasQty =
      h.includes("qty") || h.includes("quantity") || h.endsWith(" units") || h.includes(" units ");
    if (hasRec && hasRestock && hasQty) return i;
  }
  return -1;
}

function findShipDateColumnIndex(headers: string[]): number {
  const norm = headers.map(normalizeHeader);
  const exact = ["recommended ship date", "recommended ship-in date", "recommended ship in date"];
  for (const e of exact) {
    const i = norm.indexOf(e);
    if (i >= 0) return i;
  }
  for (let i = 0; i < norm.length; i++) {
    const h = norm[i];
    if (!h) continue;
    if (
      h.includes("recommended") &&
      (h.includes("ship") || h.includes("restock")) &&
      (h.includes("date") || h.includes("ship by"))
    ) {
      return i;
    }
  }
  return -1;
}

function parseQtyCell(cell: string): number | null {
  const t = cell.trim();
  if (t === "" || t === "-" || t === "—") return null;
  const n = Number.parseInt(t.replace(/,/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parses Restock, FBA Inventory / Inventory Planning, or Seller Central CSV exports.
 * Detects tab vs comma; matches flexible column names (e.g. “Recommended restock units”).
 */
export function parseInventoryReplenishmentFile(content: string): Map<string, RestockRecommendation> {
  const text = stripBom(content).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = text.split("\n").filter((l) => l.length > 0);
  if (lines.length < 2) return new Map();

  const delim = detectDelimiter(lines[0] ?? "");
  const headerCells = splitRow(lines[0] ?? "", delim);
  const skuIdx = findSkuColumnIndex(headerCells);
  const qtyIdx = findSuggestedQtyColumnIndex(headerCells);
  const dateIdx = findShipDateColumnIndex(headerCells);
  if (skuIdx < 0 || qtyIdx < 0) return new Map();

  const out = new Map<string, RestockRecommendation>();
  for (let r = 1; r < lines.length; r++) {
    const cells = splitRow(lines[r] ?? "", delim);
    const sku = (cells[skuIdx] ?? "").trim();
    if (!sku) continue;
    const recommendedQty = parseQtyCell(cells[qtyIdx] ?? "");
    const shipRaw = dateIdx >= 0 ? (cells[dateIdx] ?? "").trim() : "";
    const recommendedShipDate = shipRaw === "" || shipRaw === "-" ? null : shipRaw;
    if (!out.has(sku)) {
      out.set(sku, { recommendedQty, recommendedShipDate });
    }
  }
  return out;
}

/** @deprecated Use {@link parseInventoryReplenishmentFile} — behavior is identical. */
export function parseRestockInventoryReportTsv(tsv: string): Map<string, RestockRecommendation> {
  return parseInventoryReplenishmentFile(tsv);
}

/** @deprecated Use {@link parseInventoryReplenishmentFile} — behavior is identical. */
export function parsePlanningInventoryReportTsv(tsv: string): Map<string, RestockRecommendation> {
  return parseInventoryReplenishmentFile(tsv);
}

function pickLatestDoneReport(
  reports: ReportListEntry[] | undefined,
  marketplaceId: string,
  maxAgeMs: number,
  reportType: string,
): { reportDocumentId: string; createdTime: string | null } | null {
  if (!reports?.length) return null;
  const now = Date.now();
  const inMarketplace = (r: ReportListEntry) => {
    const ids = r.marketplaceIds;
    if (!ids?.length) return true;
    return ids.includes(marketplaceId);
  };
  const done = reports.filter(
    (r) =>
      r.processingStatus === "DONE" &&
      r.reportType === reportType &&
      r.reportDocumentId &&
      inMarketplace(r),
  );
  if (!done.length) return null;
  const byTime = (a: ReportListEntry, b: ReportListEntry) => {
    const ta = a.createdTime ? Date.parse(a.createdTime) : 0;
    const tb = b.createdTime ? Date.parse(b.createdTime) : 0;
    return tb - ta;
  };
  done.sort(byTime);
  const fresh = done.filter((r) => {
    if (!r.createdTime || maxAgeMs <= 0) return true;
    return now - Date.parse(r.createdTime) <= maxAgeMs;
  });
  const pick = (fresh.length ? fresh : done)[0];
  const id = pick?.reportDocumentId;
  if (!id) return null;
  return { reportDocumentId: id, createdTime: pick.createdTime ?? null };
}

async function listDoneReports(
  sp: SellingPartner,
  marketplaceId: string,
  reportType: string,
  withMarketplaceFilter: boolean,
): Promise<ReportListEntry[] | undefined> {
  const query: Record<string, unknown> = {
    reportTypes: [reportType],
    processingStatuses: ["DONE"],
    pageSize: 100,
  };
  if (withMarketplaceFilter) {
    query.marketplaceIds = [marketplaceId];
  }
  const listRes = (await sp.callAPI({
    operation: "getReports",
    endpoint: "reports",
    query,
  })) as { reports?: ReportListEntry[] };
  return listRes.reports;
}

type ParsedReport = {
  map: Map<string, RestockRecommendation>;
  asOf: string | null;
  hadDocument: boolean;
};

async function fetchAndParseReport(
  sp: SellingPartner,
  marketplaceId: string,
  maxAgeMs: number,
  reportType: string,
): Promise<ParsedReport> {
  const empty: ParsedReport = { map: new Map(), asOf: null, hadDocument: false };

  try {
    let reports = await listDoneReports(sp, marketplaceId, reportType, true);
    let picked = pickLatestDoneReport(reports, marketplaceId, maxAgeMs, reportType);

    if (!picked) {
      reports = await listDoneReports(sp, marketplaceId, reportType, false);
      picked = pickLatestDoneReport(reports, marketplaceId, maxAgeMs, reportType);
    }

    if (!picked) return empty;

    const reportDocument = (await sp.callAPI({
      operation: "getReportDocument",
      endpoint: "reports",
      path: { reportDocumentId: picked.reportDocumentId },
    })) as { url?: string; compressionAlgorithm?: string };

    const docUrl = reportDocument?.url;
    if (!docUrl) return { map: new Map(), asOf: picked.createdTime, hadDocument: true };

    const raw = await sp.download({ ...reportDocument, url: docUrl }, { unzip: true });
    const body = typeof raw === "string" ? raw : Buffer.isBuffer(raw) ? raw.toString("utf8") : "";
    if (!body) return { map: new Map(), asOf: picked.createdTime, hadDocument: true };

    return {
      map: parseInventoryReplenishmentFile(body),
      asOf: picked.createdTime,
      hadDocument: true,
    };
  } catch {
    return empty;
  }
}

function mergeReplenishMaps(
  planning: Map<string, RestockRecommendation>,
  restock: Map<string, RestockRecommendation>,
): Map<string, RestockRecommendation> {
  const out = new Map(planning);
  for (const [sku, rec] of restock) {
    out.set(sku, rec);
  }
  return out;
}

function newestAsOf(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

/**
 * Loads suggested replenishment from Reports API:
 * - **GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT** (legacy “Restock Inventory” — being phased out in Seller Central UI)
 * - **GET_FBA_INVENTORY_PLANNING_DATA** — same `reportType` as Seller Central’s **FBA Inventory** / Manage Inventory Health export
 *
 * Merged by SKU; Restock report wins on collisions. Files may be tab- or comma-delimited; column names are matched flexibly.
 */
export async function fetchRestockRecommendationsBySku(
  sp: SellingPartner,
  marketplaceId: string,
  maxAgeHours: number,
): Promise<RestockReportLoadResult> {
  const maxAgeMs = Math.max(0, maxAgeHours) * 60 * 60 * 1000;
  const empty: RestockReportLoadResult = { bySku: new Map(), asOf: null, loadedFromAmazon: false };

  const [restock, planning] = await Promise.all([
    fetchAndParseReport(sp, marketplaceId, maxAgeMs, RESTOCK_REPORT_TYPE),
    fetchAndParseReport(sp, marketplaceId, maxAgeMs, PLANNING_REPORT_TYPE),
  ]);

  const hadAnyDoc = restock.hadDocument || planning.hadDocument;
  if (!hadAnyDoc) return empty;

  const bySku = mergeReplenishMaps(planning.map, restock.map);
  return {
    bySku,
    asOf: newestAsOf(restock.asOf, planning.asOf),
    loadedFromAmazon: true,
  };
}
