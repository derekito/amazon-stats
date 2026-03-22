import Link from "next/link";

import { getSiteAccessGate } from "@/lib/site-access";
import { LogoutButton } from "@/components/logout-button";

const link =
  "text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100";

export async function SiteNav() {
  const gated = getSiteAccessGate() != null;
  return (
    <nav className="border-b border-zinc-200 bg-white/80 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
      <div className="mx-auto flex w-full max-w-full flex-wrap items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center gap-4">
          <Link href="/" className={link}>
            Dashboard
          </Link>
          <Link href="/costs" className={link}>
            SKU costs
          </Link>
          {gated ? <LogoutButton /> : null}
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          <span className="font-mono">data/sku-costs.json</span> ·{" "}
          <span className="font-mono">data/sku-exclusions.json</span>
        </p>
      </div>
    </nav>
  );
}
