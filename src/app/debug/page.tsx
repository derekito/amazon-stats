"use client";

import { useCallback, useEffect, useState } from "react";

async function fetchDebugPanels(): Promise<{ spAuth: string; dashboard: string }> {
  const [r1, r2] = await Promise.all([
    fetch("/api/debug/sp-auth"),
    fetch("/api/dashboard?period=month"),
  ]);
  return {
    spAuth: JSON.stringify(await r1.json(), null, 2),
    dashboard: JSON.stringify(await r2.json(), null, 2),
  };
}

export default function DebugPage() {
  const [spAuth, setSpAuth] = useState<string>("Loading…");
  const [dashboard, setDashboard] = useState<string>("(not loaded)");
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (showLoading: boolean) => {
    if (showLoading) {
      setErr(null);
      setSpAuth("Loading…");
      setDashboard("Loading…");
    }
    try {
      const data = await fetchDebugPanels();
      setSpAuth(data.spAuth);
      setDashboard(data.dashboard);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to fetch");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await fetchDebugPanels();
        if (cancelled) return;
        setSpAuth(data.spAuth);
        setDashboard(data.dashboard);
      } catch (e) {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : "Failed to fetch");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-4xl p-6 font-mono text-sm text-zinc-800 dark:text-zinc-200">
      <h1 className="mb-4 text-lg font-sans font-semibold">API debug</h1>
      <p className="mb-4 font-sans text-zinc-600 dark:text-zinc-400">
        If <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">/api/debug/sp-auth</code>{" "}
        returns 404, add <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">SP_DEBUG=1</code>{" "}
        to <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">.env.local</code> and restart{" "}
        <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">npm run dev</code>.
      </p>
      {err && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {err}
        </div>
      )}
      <button
        type="button"
        onClick={() => void load(true)}
        className="mb-6 rounded-lg bg-zinc-900 px-4 py-2 text-white dark:bg-zinc-100 dark:text-zinc-900"
      >
        Refresh
      </button>
      <h2 className="mb-2 font-sans font-medium">GET /api/debug/sp-auth</h2>
      <pre className="mb-8 max-h-96 overflow-auto rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-xs dark:border-zinc-700 dark:bg-zinc-950">
        {spAuth}
      </pre>
      <h2 className="mb-2 font-sans font-medium">GET /api/dashboard?period=month</h2>
      <pre className="max-h-96 overflow-auto rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-xs dark:border-zinc-700 dark:bg-zinc-950">
        {dashboard}
      </pre>
    </div>
  );
}
