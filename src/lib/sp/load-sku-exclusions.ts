import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";

const FILE = "sku-exclusions.json";

function filePath(): string {
  return path.join(process.cwd(), "data", FILE);
}

/** SKUs to hide on the dashboard and the unit-costs table (`data/sku-exclusions.json`). */
export function loadSkuExclusionsList(): string[] {
  const fp = filePath();
  if (!existsSync(fp)) return [];
  try {
    const raw = JSON.parse(readFileSync(fp, "utf8")) as unknown;
    if (Array.isArray(raw)) {
      const out: string[] = [];
      for (const x of raw) {
        if (typeof x !== "string") continue;
        const s = x.trim();
        if (s.length > 0) out.push(s);
      }
      return [...new Set(out)].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    }
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      return Object.keys(raw as Record<string, unknown>)
        .map((k) => k.trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    }
    return [];
  } catch {
    return [];
  }
}

export function loadSkuExclusionsSet(): Set<string> {
  return new Set(loadSkuExclusionsList());
}

export function saveSkuExclusionsList(skus: string[]): void {
  const unique = [
    ...new Set(skus.map((s) => s.trim()).filter((s) => s.length > 0)),
  ].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  const dir = path.join(process.cwd(), "data");
  mkdirSync(dir, { recursive: true });
  writeFileSync(filePath(), `${JSON.stringify(unique, null, 2)}\n`, "utf8");
}
