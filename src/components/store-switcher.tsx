"use client";

import { useRouter } from "next/navigation";

import { STORE_IDS, STORE_LABELS, type StoreId } from "@/lib/store";

export function StoreSwitcher({ current }: { current: StoreId }) {
  const router = useRouter();

  async function choose(storeId: StoreId) {
    if (storeId === current) return;
    const res = await fetch("/api/store", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId }),
    });
    if (res.ok) router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-1 text-xs">
      <span className="text-zinc-500 dark:text-zinc-400">Store:</span>
      {STORE_IDS.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => void choose(id)}
          className={
            id === current
              ? "rounded-md bg-emerald-100 px-2 py-0.5 font-medium text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100"
              : "rounded-md px-2 py-0.5 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          }
        >
          {STORE_LABELS[id]}
        </button>
      ))}
    </div>
  );
}
