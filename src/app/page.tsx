import { cookies } from "next/headers";

import { Dashboard } from "@/components/dashboard";
import { StorePicker } from "@/components/store-picker";
import { STORE_COOKIE_NAME } from "@/lib/store";

export default async function Home() {
  const c = await cookies();
  if (!c.get(STORE_COOKIE_NAME)?.value) {
    return (
      <div className="min-h-full flex-1 bg-zinc-50 dark:bg-zinc-950">
        <StorePicker />
      </div>
    );
  }

  return (
    <div className="min-h-full flex-1 bg-zinc-50 dark:bg-zinc-950">
      <Dashboard />
    </div>
  );
}
