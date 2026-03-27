"use client";

import { useRouter } from "next/navigation";

import { STORE_IDS, STORE_LABELS, type StoreId } from "@/lib/store";

export function StorePicker() {
  const router = useRouter();

  async function choose(storeId: StoreId) {
    const res = await fetch("/api/store", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId }),
    });
    if (res.ok) router.refresh();
  }

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col justify-center gap-8 px-4 py-16">
      <div className="text-center">
        <p className="text-sm font-medium uppercase tracking-wide text-emerald-800 dark:text-emerald-400">
          Amazon Seller
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Choose a store
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Dashboard, sales, and SKU data are separate per account. You can switch anytime from the top bar.
        </p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
        {STORE_IDS.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => void choose(id)}
            className="rounded-xl border border-zinc-200 bg-white px-6 py-4 text-left text-base font-medium text-zinc-900 shadow-sm transition hover:border-emerald-500/40 hover:bg-emerald-50/80 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-100 dark:hover:border-emerald-500/30 dark:hover:bg-emerald-950/30"
          >
            {STORE_LABELS[id]}
          </button>
        ))}
      </div>
    </div>
  );
}
