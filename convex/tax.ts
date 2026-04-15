/**
 * Normalizes tax rate input into a decimal multiplier.
 * Accepts:
 * - Decimal: 0.0825 => 8.25%
 * - Percent: 8.25 => 8.25%
 */
export function normalizeTaxRate(rate?: number): number {
  if (!Number.isFinite(rate)) return 0;

  const nonNegative = Math.max(0, rate as number);
  const decimal = nonNegative > 1 ? nonNegative / 100 : nonNegative;

  // Hard upper bound: 100%
  return Math.min(decimal, 1);
}
