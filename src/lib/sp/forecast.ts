/** Days of cover at recent velocity; null if velocity is ~0. */
export function forecastDaysOfCover(
  quantityInStock: number,
  unitsOrderedInWindow: number,
  windowDays: number,
): number | null {
  if (windowDays <= 0) return null;
  const daily = unitsOrderedInWindow / windowDays;
  if (daily < 0.01) return null;
  return Math.round(quantityInStock / daily);
}
