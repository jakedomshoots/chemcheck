/**
 * Normalizes tax input to decimal multiplier.
 * - 8.25 -> 0.0825
 * - 0.0825 -> 0.0825
 */
export function normalizeTaxRateInput(rate: number): number {
  if (!Number.isFinite(rate)) return 0;

  const nonNegative = Math.max(0, rate);
  const decimal = nonNegative > 1 ? nonNegative / 100 : nonNegative;

  return Math.min(decimal, 1);
}
