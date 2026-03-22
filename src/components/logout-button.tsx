"use client";

const btn =
  "rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800";

export function LogoutButton() {
  return (
    <button
      type="button"
      className={btn}
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        window.location.href = "/login";
      }}
    >
      Log out
    </button>
  );
}
