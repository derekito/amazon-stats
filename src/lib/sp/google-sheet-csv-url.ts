/**
 * Turn a normal Google Sheets link into the CSV export URL the server can fetch.
 *
 * Example:
 * `https://docs.google.com/spreadsheets/d/1abc.../edit?usp=sharing`
 * → `https://docs.google.com/spreadsheets/d/1abc.../export?format=csv&gid=0`
 *
 * The spreadsheet must be shared so **Anyone with the link can view** (or published),
 * otherwise Google returns a login HTML page instead of CSV.
 */
export function toGoogleSheetCsvExportUrl(
  input: string,
  options?: { gid?: string },
): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;

  const lower = trimmed.toLowerCase();
  if (lower.includes("/export?") && lower.includes("format=csv")) {
    return trimmed;
  }

  const m = trimmed.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!m) return trimmed;

  const spreadsheetId = m[1];
  let gid = options?.gid?.trim() || "0";
  const gidMatch = trimmed.match(/[?&#]gid=(\d+)/);
  if (gidMatch) gid = gidMatch[1];

  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;
}

export function responseLooksLikeHtml(text: string): boolean {
  const t = text.slice(0, 200).trim().toLowerCase();
  return t.startsWith("<!doctype") || t.startsWith("<html") || t.startsWith("<html");
}
