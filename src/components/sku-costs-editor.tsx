"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type SkuCostEntry = { unitCost: number; currency?: string };

type InventorySku = {
  sku: string;
  title: string;
  asin?: string;
  quantity: number;
};

type Row = {
  clientKey: string;
  sku: string;
  unitCost: string;
  currency: string;
  title?: string;
  quantity?: number;
};

function buildRows(
  inventory: InventorySku[],
  saved: Record<string, SkuCostEntry>,
  excluded: Set<string>,
): Row[] {
  const seen = new Set<string>();
  const rows: Row[] = [];
  for (const inv of inventory) {
    if (excluded.has(inv.sku)) continue;
    seen.add(inv.sku);
    const c = saved[inv.sku];
    rows.push({
      clientKey: `inv:${inv.sku}`,
      sku: inv.sku,
      title: inv.title,
      quantity: inv.quantity,
      unitCost: c != null ? String(c.unitCost) : "",
      currency: c?.currency ?? "",
    });
  }
  for (const [sku, c] of Object.entries(saved)) {
    if (excluded.has(sku) || seen.has(sku)) continue;
    rows.push({
      clientKey: `saved:${sku}`,
      sku,
      unitCost: String(c.unitCost),
      currency: c.currency ?? "",
    });
  }
  rows.sort((a, b) => a.sku.localeCompare(b.sku, undefined, { sensitivity: "base" }));
  return rows;
}

function rowsToCosts(rows: Row[]): Record<string, SkuCostEntry> {
  const out: Record<string, SkuCostEntry> = {};
  for (const r of rows) {
    const sku = r.sku.trim();
    if (!sku) continue;
    const raw = r.unitCost.trim().replace(/[$,\s]/g, "");
    if (raw === "") continue;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) continue;
    const cur = r.currency.trim().toUpperCase();
    out[sku] = { unitCost: n, ...(cur.length > 0 ? { currency: cur } : {}) };
  }
  return out;
}

type CostsTab = "unitCosts" | "excluded";

export function SkuCostsEditor() {
  const [tab, setTab] = useState<CostsTab>("unitCosts");
  const [rows, setRows] = useState<Row[]>([]);
  const [excludedSkus, setExcludedSkus] = useState<string[]>([]);
  const [addExcludedInput, setAddExcludedInput] = useState("");
  const [allInventory, setAllInventory] = useState<InventorySku[] | null>(null);
  const [loadingAllInv, setLoadingAllInv] = useState(false);
  const [filter, setFilter] = useState("");
  const [sheetSyncConfigured, setSheetSyncConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingExclusions, setSavingExclusions] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inventoryTruncated, setInventoryTruncated] = useState(false);
  /** `clientKey` of unit-cost rows selected for bulk exclude */
  const [unitCostsExcludeSelection, setUnitCostsExcludeSelection] = useState<Set<string>>(
    () => new Set(),
  );
  /** SKU keys for Active FBA table (excluded tab) */
  const [fbaExcludeSelection, setFbaExcludeSelection] = useState<Set<string>>(() => new Set());
  const unitCostsHeaderCbRef = useRef<HTMLInputElement>(null);
  const fbaHeaderCbRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [costRes, invRes, exRes] = await Promise.all([
        fetch("/api/sku-costs", { cache: "no-store" }),
        fetch("/api/inventory-skus", { cache: "no-store" }),
        fetch("/api/sku-exclusions", { cache: "no-store" }),
      ]);
      if (!costRes.ok) throw new Error("Failed to load saved costs");
      if (!exRes.ok) throw new Error("Failed to load SKU exclusions");
      const costJson = (await costRes.json()) as {
        costs: Record<string, SkuCostEntry>;
        sheetSyncConfigured?: boolean;
      };
      setSheetSyncConfigured(Boolean(costJson.sheetSyncConfigured));

      const exJson = (await exRes.json()) as { excluded: string[] };
      const excluded = exJson.excluded ?? [];
      setExcludedSkus(excluded);
      const exSet = new Set(excluded);

      if (!invRes.ok) {
        const j = await invRes.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? "Failed to load inventory SKUs");
      }
      const invJson = (await invRes.json()) as {
        skus: InventorySku[];
        truncated?: boolean;
      };
      setInventoryTruncated(Boolean(invJson.truncated));
      setRows(buildRows(invJson.skus ?? [], costJson.costs ?? {}, exSet));
      setUnitCostsExcludeSelection(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAllInventory = useCallback(async () => {
    setLoadingAllInv(true);
    try {
      const res = await fetch("/api/inventory-skus?all=1", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load full inventory");
      const j = (await res.json()) as { skus: InventorySku[] };
      setAllInventory(j.skus ?? []);
    } catch {
      setAllInventory([]);
    } finally {
      setLoadingAllInv(false);
    }
  }, []);

  useEffect(() => {
    if (tab !== "excluded") return;
    void loadAllInventory();
  }, [tab, loadAllInventory]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredRows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.sku.toLowerCase().includes(q) ||
        (r.title ?? "").toLowerCase().includes(q),
    );
  }, [rows, filter]);

  /** All visible rows (including blank SKU) — selectable for bulk exclude / delete. */
  const unitCostsSelectable = useMemo(() => filteredRows, [filteredRows]);
  const unitCostsAllSelected =
    unitCostsSelectable.length > 0 &&
    unitCostsSelectable.every((r) => unitCostsExcludeSelection.has(r.clientKey));
  const unitCostsSomeSelected = unitCostsSelectable.some((r) =>
    unitCostsExcludeSelection.has(r.clientKey),
  );

  useEffect(() => {
    const el = unitCostsHeaderCbRef.current;
    if (el) el.indeterminate = unitCostsSomeSelected && !unitCostsAllSelected;
  }, [unitCostsSomeSelected, unitCostsAllSelected]);

  const excludedSet = useMemo(() => new Set(excludedSkus), [excludedSkus]);
  const visibleInventoryForExclude = useMemo(() => {
    if (!allInventory) return [];
    return allInventory.filter((x) => !excludedSet.has(x.sku));
  }, [allInventory, excludedSet]);

  const fbaSelectableCount = visibleInventoryForExclude.length;
  const fbaAllSelected =
    fbaSelectableCount > 0 &&
    visibleInventoryForExclude.every((inv) => fbaExcludeSelection.has(inv.sku));
  const fbaSomeSelected = visibleInventoryForExclude.some((inv) =>
    fbaExcludeSelection.has(inv.sku),
  );

  useEffect(() => {
    const el = fbaHeaderCbRef.current;
    if (el) el.indeterminate = fbaSomeSelected && !fbaAllSelected;
  }, [fbaSomeSelected, fbaAllSelected]);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const costs = rowsToCosts(rows);
      const res = await fetch("/api/sku-costs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ costs }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((j as { error?: string }).error ?? res.statusText);
      setMessage(`Saved ${(j as { count?: number }).count ?? Object.keys(costs).length} SKU cost(s).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const syncSheet = async (merge: boolean) => {
    setSyncing(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/sku-costs/sync-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ merge }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((j as { error?: string }).error ?? res.statusText);
      setMessage(
        `Imported ${(j as { importedRows?: number }).importedRows} rows; ${(j as { savedSkus?: number }).savedSkus} SKU cost(s) saved.`,
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const importPaste = async () => {
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/sku-costs/import-csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: pasteText, merge: true }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((j as { error?: string }).error ?? res.statusText);
      setMessage(
        `Imported ${(j as { importedRows?: number }).importedRows} rows; ${(j as { savedSkus?: number }).savedSkus} SKUs saved.`,
      );
      setPasteText("");
      setPasteOpen(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    }
  };

  const updateRow = (clientKey: string, patch: Partial<Row>) => {
    setRows((prev) => {
      const i = prev.findIndex((r) => r.clientKey === clientKey);
      if (i < 0) return prev;
      const next = [...prev];
      next[i] = { ...next[i], ...patch };
      return next;
    });
  };

  const addRow = () => {
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `new-${Date.now()}-${Math.random()}`;
    setRows((prev) => [...prev, { clientKey: `new:${id}`, sku: "", unitCost: "", currency: "" }]);
  };

  const saveExclusions = async (next: string[]) => {
    setSavingExclusions(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/sku-exclusions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ excluded: next }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((j as { error?: string }).error ?? res.statusText);
      setExcludedSkus(next);
      setMessage(`Saved ${next.length} excluded SKU(s).`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSavingExclusions(false);
    }
  };

  const addExcluded = async () => {
    const s = addExcludedInput.trim();
    if (!s) return;
    setAddExcludedInput("");
    const next = [...new Set([...excludedSkus, s])].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
    await saveExclusions(next);
  };

  const removeExcluded = async (sku: string) => {
    await saveExclusions(excludedSkus.filter((x) => x !== sku));
  };

  const excludeSkuFromTable = async (sku: string) => {
    const s = sku.trim();
    if (!s) return;
    const next = [...new Set([...excludedSkus, s])].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
    await saveExclusions(next);
  };

  const unitCostsSelectedSkuCount = useMemo(() => {
    let n = 0;
    for (const key of unitCostsExcludeSelection) {
      const row = rows.find((r) => r.clientKey === key);
      if (row?.sku.trim()) n++;
    }
    return n;
  }, [rows, unitCostsExcludeSelection]);

  const unitCostsSelectedRowCount = useMemo(() => {
    const rowKeys = new Set(rows.map((r) => r.clientKey));
    let n = 0;
    for (const k of unitCostsExcludeSelection) {
      if (rowKeys.has(k)) n++;
    }
    return n;
  }, [rows, unitCostsExcludeSelection]);

  const excludeSelectedUnitCosts = async () => {
    const skus = new Set<string>();
    for (const key of unitCostsExcludeSelection) {
      const row = rows.find((r) => r.clientKey === key);
      const s = row?.sku.trim();
      if (s) skus.add(s);
    }
    if (skus.size === 0) return;
    const next = [...new Set([...excludedSkus, ...skus])].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
    await saveExclusions(next);
  };

  const deleteSelectedUnitCostRows = async () => {
    const keySet = new Set(
      [...unitCostsExcludeSelection].filter((k) => rows.some((r) => r.clientKey === k)),
    );
    if (keySet.size === 0) return;
    if (
      !window.confirm(
        `Remove ${keySet.size} row(s) from the table and delete their unit costs? Inventory SKUs will reappear after Reload if they are still in FBA.`,
      )
    ) {
      return;
    }
    const nextRows = rows.filter((r) => !keySet.has(r.clientKey));
    setRows(nextRows);
    setUnitCostsExcludeSelection(new Set());
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const costs = rowsToCosts(nextRows);
      const res = await fetch("/api/sku-costs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ costs }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((j as { error?: string }).error ?? res.statusText);
      setMessage(
        `Deleted ${keySet.size} row(s); saved ${(j as { count?: number }).count ?? Object.keys(costs).length} SKU cost(s).`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
      await load();
    } finally {
      setSaving(false);
    }
  };

  const toggleUnitCostExcludeSelect = (clientKey: string) => {
    setUnitCostsExcludeSelection((prev) => {
      const next = new Set(prev);
      if (next.has(clientKey)) next.delete(clientKey);
      else next.add(clientKey);
      return next;
    });
  };

  const toggleSelectAllUnitCosts = () => {
    setUnitCostsExcludeSelection((prev) => {
      const next = new Set(prev);
      if (unitCostsAllSelected) {
        for (const r of unitCostsSelectable) next.delete(r.clientKey);
      } else {
        for (const r of unitCostsSelectable) next.add(r.clientKey);
      }
      return next;
    });
  };

  const toggleFbaExcludeSelect = (sku: string) => {
    setFbaExcludeSelection((prev) => {
      const next = new Set(prev);
      if (next.has(sku)) next.delete(sku);
      else next.add(sku);
      return next;
    });
  };

  const toggleSelectAllFba = () => {
    setFbaExcludeSelection((prev) => {
      const next = new Set(prev);
      if (fbaAllSelected) {
        for (const inv of visibleInventoryForExclude) next.delete(inv.sku);
      } else {
        for (const inv of visibleInventoryForExclude) next.add(inv.sku);
      }
      return next;
    });
  };

  const excludeSelectedFba = async () => {
    if (fbaExcludeSelection.size === 0) return;
    const next = [...new Set([...excludedSkus, ...fbaExcludeSelection])].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
    await saveExclusions(next);
    setFbaExcludeSelection(new Set());
  };

  const tabBtn = (id: CostsTab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
        tab === id
          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
          : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="mx-auto flex min-w-0 w-full max-w-full flex-col gap-8 px-4 py-10 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-2 border-b border-zinc-200 pb-8 dark:border-zinc-800">
        <p className="text-sm font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">
          Amazon Seller
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          SKU costs & exclusions
        </h1>
        <p className="max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
          Unit costs are stored locally in{" "}
          <span className="font-mono text-xs">data/sku-costs.json</span> or on Vercel in{" "}
          <span className="font-mono text-xs">Blob</span> when{" "}
          <span className="font-mono text-xs">BLOB_READ_WRITE_TOKEN</span> is set. Inactive
          SKUs are listed as exclusions — locally in{" "}
          <span className="font-mono text-xs">data/sku-exclusions.json</span>, or on Vercel in{" "}
          <span className="font-mono text-xs">Blob</span> when{" "}
          <span className="font-mono text-xs">BLOB_READ_WRITE_TOKEN</span> is set — they disappear from
          the main dashboard and from the unit-cost table until you remove the exclusion.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {tabBtn("unitCosts", "Unit costs")}
          {tabBtn("excluded", "Excluded SKUs")}
        </div>
      </header>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      )}
      {message && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-100">
          {message}
        </div>
      )}

      {tab === "excluded" ? (
        <div className="flex flex-col gap-8">
          <p className="max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
            These SKUs are omitted from the <strong>dashboard</strong> product table and the{" "}
            <strong>Unit costs</strong> tab.             Saved unit cost entries are left as-is; remove an exclusion here to show the SKU again.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex min-w-[12rem] flex-col gap-1">
              <label htmlFor="add-excluded" className="text-xs font-medium text-zinc-500">
                Add SKU
              </label>
              <input
                id="add-excluded"
                value={addExcludedInput}
                onChange={(e) => setAddExcludedInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void addExcluded();
                }}
                placeholder="e.g. old-listing-sku"
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
            </div>
            <button
              type="button"
              disabled={savingExclusions || !addExcludedInput.trim()}
              onClick={() => void addExcluded()}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {savingExclusions ? "Saving…" : "Add & save"}
            </button>
          </div>

          <div className="rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/50">
            <h2 className="mb-3 text-sm font-medium text-zinc-900 dark:text-zinc-50">
              Excluded list ({excludedSkus.length})
            </h2>
            {excludedSkus.length === 0 ? (
              <p className="text-sm text-zinc-500">No exclusions yet.</p>
            ) : (
              <ul className="max-h-64 divide-y divide-zinc-100 overflow-y-auto dark:divide-zinc-800">
                {excludedSkus.map((sku) => (
                  <li
                    key={sku}
                    className="flex items-center justify-between gap-2 py-2 text-sm first:pt-0"
                  >
                    <span className="font-mono text-xs text-zinc-800 dark:text-zinc-200">{sku}</span>
                    <button
                      type="button"
                      disabled={savingExclusions}
                      onClick={() => void removeExcluded(sku)}
                      className="shrink-0 rounded border border-zinc-200 px-2 py-0.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/50">
            <div className="mb-1 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">Active FBA SKUs</h2>
              <button
                type="button"
                disabled={savingExclusions || fbaExcludeSelection.size === 0 || loadingAllInv}
                onClick={() => void excludeSelectedFba()}
                className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-950 disabled:cursor-not-allowed disabled:opacity-40 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100"
              >
                {savingExclusions
                  ? "Saving…"
                  : `Exclude selected${fbaExcludeSelection.size > 0 ? ` (${fbaExcludeSelection.size})` : ""}`}
              </button>
            </div>
            <p className="mb-3 text-xs text-zinc-500">
              SKUs still in inventory summaries. Check rows and use Exclude selected, or Exclude one at a time.
            </p>
            {loadingAllInv ? (
              <p className="text-sm text-zinc-500">Loading inventory…</p>
            ) : visibleInventoryForExclude.length === 0 ? (
              <p className="text-sm text-zinc-500">None left to exclude, or inventory failed to load.</p>
            ) : (
              <div className="max-h-96 overflow-y-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-zinc-100 text-xs font-medium uppercase text-zinc-500 dark:border-zinc-800">
                      <th className="w-8 py-2 pr-1 text-center">
                        <span className="sr-only">Select</span>
                        <input
                          ref={fbaHeaderCbRef}
                          type="checkbox"
                          disabled={
                            visibleInventoryForExclude.length === 0 || savingExclusions || loadingAllInv
                          }
                          checked={fbaAllSelected}
                          onChange={() => toggleSelectAllFba()}
                          className="h-4 w-4 rounded border-zinc-300 accent-zinc-900 dark:border-zinc-600 dark:accent-zinc-200"
                          title="Select all rows"
                        />
                      </th>
                      <th className="py-2 pr-2">SKU</th>
                      <th className="py-2">Product</th>
                      <th className="py-2 text-right">FBA</th>
                      <th className="py-2 text-right" />
                    </tr>
                  </thead>
                  <tbody>
                    {visibleInventoryForExclude.map((inv) => (
                      <tr
                        key={inv.sku}
                        className="border-b border-zinc-50 dark:border-zinc-900"
                      >
                        <td className="py-2 pr-1 text-center align-top">
                          <input
                            type="checkbox"
                            disabled={savingExclusions}
                            checked={fbaExcludeSelection.has(inv.sku)}
                            onChange={() => toggleFbaExcludeSelect(inv.sku)}
                            className="h-4 w-4 rounded border-zinc-300 accent-zinc-900 dark:border-zinc-600 dark:accent-zinc-200"
                            aria-label={`Select ${inv.sku} for exclude`}
                          />
                        </td>
                        <td className="py-2 pr-2 font-mono text-xs">{inv.sku}</td>
                        <td className="max-w-md py-2 text-xs text-zinc-600 dark:text-zinc-400">
                          <span className="line-clamp-2">{inv.title || "—"}</span>
                        </td>
                        <td className="py-2 text-right tabular-nums text-zinc-500">
                          {inv.quantity.toLocaleString()}
                        </td>
                        <td className="py-2 text-right">
                          <button
                            type="button"
                            disabled={savingExclusions}
                            onClick={() => void excludeSkuFromTable(inv.sku)}
                            className="rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100"
                          >
                            Exclude
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex min-w-[12rem] max-w-md flex-1 flex-col gap-1">
          <label htmlFor="sku-filter" className="text-xs font-medium text-zinc-500">
            Filter
          </label>
          <input
            id="sku-filter"
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="SKU or title…"
            className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || loading}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {saving ? "Saving…" : "Save to file"}
          </button>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-800 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          >
            Reload
          </button>
          <button type="button" onClick={addRow} className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
            Add SKU row
          </button>
          <button
            type="button"
            disabled={savingExclusions || unitCostsSelectedSkuCount === 0 || loading}
            onClick={() => void excludeSelectedUnitCosts()}
            title="Add checked SKUs to sku-exclusions.json"
            className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-950 disabled:cursor-not-allowed disabled:opacity-40 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100"
          >
            {savingExclusions
              ? "Saving…"
              : `Exclude selected${unitCostsSelectedSkuCount > 0 ? ` (${unitCostsSelectedSkuCount})` : ""}`}
          </button>
          <button
            type="button"
            disabled={
              saving ||
              savingExclusions ||
              unitCostsSelectedRowCount === 0 ||
              loading
            }
            onClick={() => void deleteSelectedUnitCostRows()}
            title="Remove checked rows and drop their saved unit costs"
            className="rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm font-medium text-red-900 disabled:cursor-not-allowed disabled:opacity-40 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100"
          >
            {saving
              ? "Saving…"
              : `Delete selected${unitCostsSelectedRowCount > 0 ? ` (${unitCostsSelectedRowCount})` : ""}`}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-200/80 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/50">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">Google Sheet (CSV)</h2>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!sheetSyncConfigured || syncing || loading}
              title={
                sheetSyncConfigured
                  ? "Fetch CSV from SP_SKU_COSTS_SHEET_CSV_URL and merge into file"
                  : "Set SP_SKU_COSTS_SHEET_CSV_URL in .env.local"
              }
              onClick={() => void syncSheet(true)}
              className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-200 dark:text-zinc-900"
            >
              {syncing ? "Syncing…" : "Sync sheet → merge"}
            </button>
            <button
              type="button"
              disabled={!sheetSyncConfigured || syncing || loading}
              onClick={() => void syncSheet(false)}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-600 dark:text-zinc-200"
            >
              Replace file from sheet
            </button>
            <button
              type="button"
              onClick={() => setPasteOpen((o) => !o)}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-800 dark:border-zinc-600 dark:text-zinc-200"
            >
              Paste CSV
            </button>
          </div>
        </div>
        {!sheetSyncConfigured && (
          <p className="text-xs text-zinc-500">
            Set <span className="font-mono">SP_SKU_COSTS_SHEET_CSV_URL</span> in{" "}
            <span className="font-mono">.env.local</span> to your sheet’s{" "}
            <strong>edit link</strong> (or a published CSV link). Share the sheet as{" "}
            <strong>Anyone with the link → Viewer</strong>, restart the dev server, then Sync.
          </p>
        )}
        {pasteOpen && (
          <div className="mt-3 flex flex-col gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={6}
              placeholder={`Header row (recommended): Product,Seller SKU,Unit Cost,Currency\nOr: sku,unit_cost,USD\n\nMY-SKU-1,12.50,USD`}
              className="w-full rounded-lg border border-zinc-200 bg-zinc-50 p-3 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900"
            />
            <button
              type="button"
              onClick={() => void importPaste()}
              className="self-start rounded-lg bg-zinc-700 px-3 py-1.5 text-xs font-medium text-white dark:bg-zinc-300 dark:text-zinc-900"
            >
              Import pasted CSV (merge)
            </button>
          </div>
        )}
      </div>

      {inventoryTruncated && (
        <p className="text-sm text-amber-800 dark:text-amber-200">
          FBA inventory list was truncated (raise <span className="font-mono">SP_API_MAX_INVENTORY_PAGES</span>
          ). Some SKUs may be missing—use &quot;Add SKU row&quot; or import CSV for those.
        </p>
      )}

      {loading ? (
        <p className="text-sm text-zinc-500">Loading SKUs…</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-zinc-200/80 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950/50">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-100 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                <th className="w-10 px-2 py-3 text-center">
                  <span className="sr-only">Select for bulk actions</span>
                  <input
                    ref={unitCostsHeaderCbRef}
                    type="checkbox"
                    disabled={
                      unitCostsSelectable.length === 0 || savingExclusions || saving
                    }
                    checked={unitCostsAllSelected}
                    onChange={() => toggleSelectAllUnitCosts()}
                    className="h-4 w-4 rounded border-zinc-300 accent-zinc-900 dark:border-zinc-600 dark:accent-zinc-200"
                    title="Select all visible rows"
                  />
                </th>
                <th className="px-4 py-3">SKU</th>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3 text-right">FBA qty</th>
                <th className="px-4 py-3 text-right">Unit cost</th>
                <th className="px-4 py-3">Currency</th>
                <th className="px-4 py-3 text-right">Hide</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-zinc-500">
                    No rows match the filter.
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => (
                  <tr
                    key={row.clientKey}
                    className="border-b border-zinc-50 last:border-0 dark:border-zinc-900"
                  >
                    <td className="px-2 py-2 text-center align-top">
                      <input
                        type="checkbox"
                        disabled={savingExclusions || saving}
                        checked={unitCostsExcludeSelection.has(row.clientKey)}
                        onChange={() => toggleUnitCostExcludeSelect(row.clientKey)}
                        className="h-4 w-4 rounded border-zinc-300 accent-zinc-900 dark:border-zinc-600 dark:accent-zinc-200"
                        title="Select for Exclude selected or Delete selected"
                        aria-label={`Select row ${row.sku.trim() || "(new)"} for bulk actions`}
                      />
                    </td>
                    <td className="px-4 py-2 align-top">
                      <input
                        value={row.sku}
                        onChange={(e) => updateRow(row.clientKey, { sku: e.target.value })}
                        className="w-full min-w-[8rem] rounded border border-zinc-200 bg-white px-2 py-1 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900"
                        placeholder="SKU"
                      />
                    </td>
                    <td className="max-w-xs px-4 py-2 align-top text-xs text-zinc-600 dark:text-zinc-400">
                      <span className="line-clamp-2">{row.title ?? "—"}</span>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-zinc-500">
                      {row.quantity != null ? row.quantity.toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-2 align-top">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={row.unitCost}
                        onChange={(e) => updateRow(row.clientKey, { unitCost: e.target.value })}
                        className="w-full min-w-[6rem] rounded border border-zinc-200 bg-white px-2 py-1 text-right tabular-nums dark:border-zinc-700 dark:bg-zinc-900"
                        placeholder="—"
                      />
                    </td>
                    <td className="px-4 py-2 align-top">
                      <input
                        value={row.currency}
                        onChange={(e) => updateRow(row.clientKey, { currency: e.target.value })}
                        className="w-20 rounded border border-zinc-200 bg-white px-2 py-1 text-xs uppercase dark:border-zinc-700 dark:bg-zinc-900"
                        placeholder="USD"
                        maxLength={8}
                      />
                    </td>
                    <td className="px-4 py-2 text-right align-top">
                      <button
                        type="button"
                        disabled={savingExclusions || !row.sku.trim()}
                        title="Move to Excluded SKUs tab"
                        onClick={() => void excludeSkuFromTable(row.sku)}
                        className="whitespace-nowrap rounded border border-zinc-200 px-2 py-1 text-[10px] font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-800"
                      >
                        Exclude
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
        </>
      )}
    </div>
  );
}
