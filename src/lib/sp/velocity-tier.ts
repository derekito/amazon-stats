import type { ProductRow, VelocityTier } from "@/lib/sp/types";

/**
 * ABC-style tiers from velocity on **this page** only: A = top third, B = middle, C = bottom (units/day).
 * If the product table is paginated, tiers are relative to the current page, not the whole catalog.
 */
export function assignVelocityTiers(products: ProductRow[]): ProductRow[] {
  const n = products.length;
  if (n === 0) return products;

  const order = [...products.keys()].sort(
    (a, b) => (products[b].velocityPerDay ?? 0) - (products[a].velocityPerDay ?? 0),
  );
  const rankOf = new Map<number, number>();
  order.forEach((idx, rank) => rankOf.set(idx, rank));

  const aCut = Math.ceil(n / 3);
  const bCut = Math.ceil((2 * n) / 3);

  return products.map((p, i) => {
    const rank = rankOf.get(i) ?? 0;
    const tier: VelocityTier = rank < aCut ? "A" : rank < bCut ? "B" : "C";
    return { ...p, velocityTier: tier };
  });
}
