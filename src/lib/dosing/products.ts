/**
 * Shared chemical product catalogue.
 *
 * Per-addition caps and circulation waits live here so the recommendation
 * engine (history-based) and the at-the-stop dosing calculator (live readings)
 * can never disagree about how much of a product is safe to add at once.
 */

export type DosageProduct =
  | 'sodium_carbonate'
  | 'muriatic_acid'
  | 'calcium_hypochlorite'
  | 'sodium_bicarbonate'
  | 'cyanuric_acid'
  | 'liquid_chlorine'
  | 'trichlor'
  | 'calcium_chloride'
  | 'salt';

export interface DosageProductSpec {
  unit: string;
  /** Maximum amount for one addition, per `perGallons` gallons of pool water. */
  maxPerAddition: number;
  perGallons: number;
  /** Minutes to circulate before retesting after an addition. */
  circulateMinutes: number;
}

export const DOSAGE_PRODUCTS: Record<DosageProduct, DosageProductSpec> = {
  sodium_carbonate: { unit: 'lbs sodium carbonate', maxPerAddition: 1, perGallons: 10000, circulateMinutes: 60 },
  // 1 gal = 4 quarts; dosages below are expressed in quarts.
  muriatic_acid: { unit: 'quarts muriatic acid', maxPerAddition: 4, perGallons: 20000, circulateMinutes: 60 },
  calcium_hypochlorite: { unit: 'lbs calcium hypochlorite', maxPerAddition: 1, perGallons: 10000, circulateMinutes: 60 },
  sodium_bicarbonate: { unit: 'lbs sodium bicarbonate', maxPerAddition: 2.5, perGallons: 10000, circulateMinutes: 360 },
  cyanuric_acid: { unit: 'lbs cyanuric acid', maxPerAddition: 2, perGallons: 10000, circulateMinutes: 1440 },
  // 1 gallon of 12.5% liquid chlorine raises FC ~12 ppm in 10k gallons; cap one addition near shock level.
  liquid_chlorine: { unit: 'gallons liquid chlorine', maxPerAddition: 1, perGallons: 10000, circulateMinutes: 30 },
  trichlor: { unit: 'lbs trichlor', maxPerAddition: 1, perGallons: 10000, circulateMinutes: 1440 },
  // Calcium chloride is exothermic and clouds water when overdosed; keep additions modest.
  calcium_chloride: { unit: 'lbs calcium chloride', maxPerAddition: 5, perGallons: 10000, circulateMinutes: 240 },
  salt: { unit: 'lbs salt', maxPerAddition: 120, perGallons: 10000, circulateMinutes: 1440 },
};

/** Safety guidance attached to every set that includes a chemical addition. */
export const GENERAL_CHEMICAL_SAFETY_NOTE =
  'Never mix chemicals. Add acid and chlorine products at separate times, at least 30 minutes apart, with the pump running.';

export const ACID_LAST_SAFETY_NOTE =
  'Both a pH-down (acid) product and a chlorine product are recommended for this visit: add the chlorine product first, keep the pump running, wait at least 30 minutes, then add the acid last. Never combine them.';

export function formatAmount(amount: number): string {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(1);
}

export function formatCirculateWait(minutes: number): string {
  return minutes >= 60
    ? `${Math.round(minutes / 60)} hour${minutes >= 120 ? 's' : ''}`
    : `${minutes} minutes`;
}

/**
 * Per-addition cap for a product in the spec's own unit, scaled to the pool.
 */
export function capForGallons(spec: DosageProductSpec, gallons: number): number {
  return spec.maxPerAddition * (gallons / spec.perGallons);
}

/**
 * Builds a dosage instruction that never exceeds the product's per-addition
 * cap. Larger corrections are split into repeated add / circulate / retest
 * steps instead of one oversized dose.
 */
export function buildCappedDosage(
  totalAmount: number,
  spec: DosageProductSpec,
  gallons: number,
  unitLabel: string = spec.unit
): string {
  const cap = capForGallons(spec, gallons);
  if (!(cap > 0) || totalAmount <= cap) {
    return `${formatAmount(totalAmount)} ${unitLabel} for ${gallons} gallons`;
  }

  const steps = Math.ceil(totalAmount / cap);
  const perStep = totalAmount / steps;
  const wait = formatCirculateWait(spec.circulateMinutes);
  return `${formatAmount(totalAmount)} ${unitLabel} total for ${gallons} gallons. ` +
    `Do not add all at once: add ${formatAmount(perStep)} ${unitLabel} (max ${formatAmount(cap)} ${unitLabel} per addition), ` +
    `circulate for ${wait}, retest, and repeat up to ${steps} times until in range.`;
}
