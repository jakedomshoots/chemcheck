/**
 * Dosing at the stop.
 *
 * Pure functions that turn this visit's readings into an ordered list of dose
 * steps a technician can follow at the pool. Rates are industry-standard per
 * 10,000 gallons; per-addition caps and circulation waits come from the shared
 * product catalogue so these numbers can never drift from the recommendation
 * engine.
 *
 * Nothing here touches React or storage.
 */

import {
  DOSAGE_PRODUCTS,
  capForGallons,
  formatCirculateWait,
  GENERAL_CHEMICAL_SAFETY_NOTE,
  ACID_LAST_SAFETY_NOTE,
  type DosageProduct,
} from './products';
import { validatePoolGallons } from '../ai-summarizer/validation';
import { getLsiStatus } from '../lsi';

export type DosingChemical = 'alkalinity' | 'hardness' | 'stabilizer' | 'salt' | 'ph' | 'chlorine';
export type DoseUnit = 'fl oz' | 'lb';
export type DoseDirection = 'raise' | 'lower';
export type DoseKind = 'add' | 'drain' | 'wait';

export interface DosingReadings {
  ph_value?: number | null;
  chlorine_value?: number | null;
  alkalinity_value?: number | null;
  stabilizer_value?: number | null;
  hardness_value?: number | null;
  salt?: number | null;
  water_temperature?: number | null;
  tds_value?: number | null;
}

export interface DosingInput {
  readings: DosingReadings;
  poolGallons?: number | null;
  poolType?: string | null;
  surfaceType?: string | null;
  waterTemperature?: number | null;
  lsi?: number | null;
}

export interface TargetRange {
  min: number;
  max: number;
  unit: string;
  label: string;
}

export interface DoseAmount {
  value: number;
  unit: DoseUnit;
  text: string;
}

export interface DoseCap {
  perAddition: DoseAmount;
  splits: number;
  perSplit: DoseAmount;
  circulateMinutes: number;
}

export interface DoseStep {
  id: string;
  order: number;
  chemical: DosingChemical;
  chemicalLabel: string;
  direction: DoseDirection;
  kind: DoseKind;
  product: DosageProduct | null;
  productLabel: string;
  reading: number;
  target: TargetRange;
  targetValue: number;
  amount: DoseAmount | null;
  cap: DoseCap | null;
  instructions: string;
  wait: string;
  why: string;
  chemicalUsage: { chemical_type: string; quantity: string } | null;
}

export interface DosingPlan {
  steps: DoseStep[];
  missing: string[];
  warnings: string[];
  notes: string[];
  targets: Partial<Record<DosingChemical, TargetRange>>;
  gallons: number | null;
  fcTarget: number | null;
}

/* ------------------------------------------------------------------------ */
/* Targets                                                                   */
/* ------------------------------------------------------------------------ */

export const SALT_TARGET_PPM = 3200;
/** Free chlorine should sit near 7.5% of CYA (min 2 ppm) to stay effective. */
export const FC_TO_CYA_RATIO = 0.075;
export const FC_MIN_PPM = 2;
export const SALT_BAG_LB = 40;

export function isSaltPool(poolType?: string | null): boolean {
  return typeof poolType === 'string' && poolType.trim().toLowerCase() === 'salt';
}

export function isPlasterSurface(surfaceType?: string | null): boolean {
  return typeof surfaceType === 'string' && surfaceType.trim().toLowerCase() === 'plaster';
}

export function getDosingTargets(
  poolType?: string | null,
  surfaceType?: string | null,
  cya?: number | null,
): Record<DosingChemical, TargetRange> {
  const salt = isSaltPool(poolType);
  const baseFc: TargetRange = salt
    ? { min: 3, max: 5, unit: 'ppm', label: 'Free chlorine' }
    : { min: 2, max: 4, unit: 'ppm', label: 'Free chlorine' };
  const chlorine = applyCyaToFcRange(baseFc, cya);
  return {
    ph: { min: 7.4, max: 7.6, unit: '', label: 'pH' },
    chlorine,
    alkalinity: { min: 80, max: 120, unit: 'ppm', label: 'Total alkalinity' },
    stabilizer: salt
      ? { min: 60, max: 80, unit: 'ppm', label: 'Stabilizer (CYA)' }
      : { min: 30, max: 50, unit: 'ppm', label: 'Stabilizer (CYA)' },
    hardness: isPlasterSurface(surfaceType)
      ? { min: 250, max: 450, unit: 'ppm', label: 'Calcium hardness' }
      : { min: 200, max: 400, unit: 'ppm', label: 'Calcium hardness' },
    salt: { min: 2700, max: 3400, unit: 'ppm', label: 'Salt' },
  };
}

/** FC floor derived from CYA: 7.5% of CYA, never below 2 ppm. */
export function fcFloorForCya(cya?: number | null): number {
  if (!isReading(cya)) return FC_MIN_PPM;
  return Math.max(FC_MIN_PPM, round(cya * FC_TO_CYA_RATIO, 1));
}

function applyCyaToFcRange(range: TargetRange, cya?: number | null): TargetRange {
  const floor = fcFloorForCya(cya);
  if (floor <= range.min) return range;
  // High CYA pushes the whole band up; keep a 2 ppm wide window.
  return { ...range, min: floor, max: Math.max(range.max, floor + 2) };
}

/* ------------------------------------------------------------------------ */
/* Rates per 10,000 gallons (display units)                                  */
/* ------------------------------------------------------------------------ */

interface ProductInfo {
  label: string;
  chemicalType: string;
  unit: DoseUnit;
  /** Multiplier from the catalogue's cap unit to the display unit. */
  capUnitFactor: number;
}

const PRODUCT_INFO: Record<DosageProduct, ProductInfo> = {
  muriatic_acid: { label: 'muriatic acid 31.45%', chemicalType: 'Muriatic Acid', unit: 'fl oz', capUnitFactor: 32 },
  sodium_carbonate: { label: 'soda ash (sodium carbonate)', chemicalType: 'Soda Ash', unit: 'lb', capUnitFactor: 1 },
  sodium_bicarbonate: { label: 'sodium bicarbonate (baking soda)', chemicalType: 'Baking Soda', unit: 'lb', capUnitFactor: 1 },
  calcium_chloride: { label: 'calcium chloride 77%', chemicalType: 'Calcium Chloride', unit: 'lb', capUnitFactor: 1 },
  cyanuric_acid: { label: 'cyanuric acid (stabilizer)', chemicalType: 'Stabilizer (CYA)', unit: 'lb', capUnitFactor: 1 },
  liquid_chlorine: { label: 'liquid chlorine 12.5%', chemicalType: 'Liquid Chlorine', unit: 'fl oz', capUnitFactor: 128 },
  calcium_hypochlorite: { label: 'cal-hypo 65%', chemicalType: 'Calcium Hypochlorite (Cal-Hypo)', unit: 'lb', capUnitFactor: 1 },
  trichlor: { label: 'trichlor tablets', chemicalType: 'Chlorine Tablets', unit: 'lb', capUnitFactor: 1 },
  salt: { label: 'pool salt', chemicalType: 'Salt', unit: 'lb', capUnitFactor: 1 },
};

/** Amount of product (display unit) per 10,000 gal to move the reading by one unit. */
const RATE_PER_10K: Record<DosageProduct, number> = {
  muriatic_acid: 60, // fl oz per 1.0 pH (12 fl oz lowers pH ~0.2)
  sodium_carbonate: 1.875, // lb per 1.0 pH (6 oz raises pH ~0.2)
  sodium_bicarbonate: 0.15, // lb per ppm TA (1.5 lb per 10 ppm)
  calcium_chloride: 0.125, // lb per ppm CH (1.25 lb of 77% per 10 ppm)
  cyanuric_acid: 0.08125, // lb per ppm CYA (13 oz per 10 ppm)
  liquid_chlorine: 10.5, // fl oz per ppm FC
  calcium_hypochlorite: 0.125, // lb per ppm FC (2 oz per ppm)
  trichlor: 0.094, // lb per ppm FC (1.5 oz per ppm)
  salt: 0.0834, // lb per ppm salt (83.4 lb per 1000 ppm)
};
/** Muriatic acid lowers TA at a different rate than it lowers pH. */
const ACID_FL_OZ_PER_PPM_TA_10K = 2.6; // 26 fl oz lowers TA 10 ppm

const ORDER: Record<string, number> = {
  'alkalinity:raise': 1,
  'hardness:raise': 2,
  'stabilizer:raise': 3,
  'salt:raise': 4,
  'ph:raise': 5,
  'chlorine:raise': 6,
  'alkalinity:lower': 7,
  'ph:lower': 7,
  'chlorine:lower': 8,
  'stabilizer:lower': 8,
  'hardness:lower': 8,
  'salt:lower': 8,
};

const CHEMICAL_LABEL: Record<DosingChemical, string> = {
  ph: 'pH',
  chlorine: 'Free chlorine',
  alkalinity: 'Total alkalinity',
  stabilizer: 'Stabilizer (CYA)',
  hardness: 'Calcium hardness',
  salt: 'Salt',
};

/* ------------------------------------------------------------------------ */
/* Helpers                                                                   */
/* ------------------------------------------------------------------------ */

export function isReading(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function formatLb(value: number): string {
  if (value < 1) {
    const oz = Math.max(1, Math.round(value * 16));
    return `${oz} oz`;
  }
  const rounded = round(value * 4, 0) / 4;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(rounded * 10 % 1 === 0 ? 1 : 2)} lb`;
}

function formatFlOz(value: number): string {
  const oz = Math.max(1, Math.round(value));
  if (oz >= 128) {
    const gallons = round(oz / 128, 2);
    return `${oz} fl oz (${gallons} gal)`;
  }
  return `${oz} fl oz`;
}

function formatSalt(value: number): string {
  const lb = Math.max(5, Math.round(value / 5) * 5);
  const bags = Math.max(1, Math.round((lb / SALT_BAG_LB) * 2) / 2);
  return `${lb} lb (${bags} × ${SALT_BAG_LB} lb bag${bags === 1 ? '' : 's'})`;
}

function makeAmount(product: DosageProduct, value: number): DoseAmount {
  const unit = PRODUCT_INFO[product].unit;
  if (product === 'salt') return { value: Math.max(5, Math.round(value / 5) * 5), unit, text: formatSalt(value) };
  if (unit === 'fl oz') return { value: Math.max(1, Math.round(value)), unit, text: formatFlOz(value) };
  return { value: round(value, 2), unit, text: formatLb(value) };
}

/** Quantity string stored on a chemical-usage row ("12 fl oz", "1.5 lb", "80 lb"). */
function usageQuantity(product: DosageProduct, amount: DoseAmount): string {
  if (product === 'salt') return `${amount.value} lb`;
  if (amount.unit === 'fl oz') return `${amount.value} fl oz`;
  return formatLb(amount.value);
}

function buildCap(product: DosageProduct, total: number, gallons: number): DoseCap | null {
  const spec = DOSAGE_PRODUCTS[product];
  const cap = capForGallons(spec, gallons) * PRODUCT_INFO[product].capUnitFactor;
  if (!(cap > 0)) return null;
  const splits = Math.max(1, Math.ceil(total / cap));
  return {
    perAddition: makeAmount(product, cap),
    splits,
    perSplit: makeAmount(product, total / splits),
    circulateMinutes: spec.circulateMinutes,
  };
}

function buildInstructions(amount: DoseAmount, cap: DoseCap | null): string {
  if (!cap || cap.splits <= 1) {
    return `Add ${amount.text} in one addition with the pump running.`;
  }
  return `Do not add all at once. Add ${cap.perSplit.text} (max ${cap.perAddition.text} per addition), ` +
    `circulate ${formatCirculateWait(cap.circulateMinutes)}, retest, and repeat up to ${cap.splits} times until in range.`;
}

const WAIT_TEXT: Record<DosageProduct, string> = {
  sodium_bicarbonate: 'Pump running. Broadcast over the deep end and circulate 6 hours before retesting. Wait at least 4 hours before adding calcium chloride.',
  calcium_chloride: 'Pre-dissolve in a bucket of pool water, pump running. Never add within 4 hours of bicarbonate or soda ash — it clouds the water.',
  cyanuric_acid: 'Add through a skimmer sock or pre-dissolved, pump running. Takes up to 24 hours to register — do not retest or redose today.',
  salt: 'Broadcast over the shallow end and brush until dissolved, pump running 24 hours before trusting the cell reading.',
  sodium_carbonate: 'Pre-dissolve, pump running. Retest pH after 1 hour of circulation before any further adjustment.',
  liquid_chlorine: 'Pour slowly around the deep end with the pump running. Wait at least 30 minutes before any acid.',
  calcium_hypochlorite: 'Pre-dissolve in a bucket of pool water (never add water to the chemical), pump running. Wait at least 30 minutes before any acid.',
  trichlor: 'Place in the feeder or floater, never the skimmer with the pump off. Keep tablets away from acid and other chlorine products.',
  muriatic_acid: 'Add LAST. Pump running, pour slowly into the deep end away from fittings, at least 30 minutes after any chlorine product. Retest after 1 hour.',
};

interface StepDraft {
  chemical: DosingChemical;
  direction: DoseDirection;
  kind: DoseKind;
  product: DosageProduct | null;
  reading: number;
  target: TargetRange;
  targetValue: number;
  /** Total product for the pool in display units (undefined for non-add steps). */
  total?: number;
  why: string;
  wait?: string;
  productLabel?: string;
}

function finalizeStep(draft: StepDraft, gallons: number | null, index: number): DoseStep {
  const key = `${draft.chemical}:${draft.direction}`;
  const info = draft.product ? PRODUCT_INFO[draft.product] : null;
  let amount: DoseAmount | null = null;
  let cap: DoseCap | null = null;
  let instructions = '';
  let chemicalUsage: DoseStep['chemicalUsage'] = null;

  if (draft.kind === 'add' && draft.product && info) {
    if (gallons !== null && draft.total !== undefined) {
      amount = makeAmount(draft.product, draft.total);
      cap = buildCap(draft.product, draft.total, gallons);
      instructions = buildInstructions(amount, cap);
      chemicalUsage = { chemical_type: info.chemicalType, quantity: usageQuantity(draft.product, amount) };
    } else {
      instructions = 'Enter pool gallons on the client profile to size this dose.';
    }
  } else if (draft.kind === 'drain') {
    instructions = 'No product. Dilute with fresh water and retest after refilling.';
  } else {
    instructions = 'No product today.';
  }

  return {
    id: `dose-${draft.chemical}-${draft.direction}-${index}`,
    order: ORDER[key] ?? 9,
    chemical: draft.chemical,
    chemicalLabel: CHEMICAL_LABEL[draft.chemical],
    direction: draft.direction,
    kind: draft.kind,
    product: draft.product,
    productLabel: draft.productLabel ?? info?.label ?? 'No product',
    reading: draft.reading,
    target: draft.target,
    targetValue: draft.targetValue,
    amount,
    cap,
    instructions,
    wait: draft.wait ?? (draft.product ? WAIT_TEXT[draft.product] : ''),
    why: draft.why,
    chemicalUsage,
  };
}

function scale(ratePer10k: number, delta: number, gallons: number | null): number | undefined {
  if (gallons === null) return undefined;
  return ratePer10k * delta * (gallons / 10000);
}

function fmtRange(range: TargetRange): string {
  const unit = range.unit ? ` ${range.unit}` : '';
  return `${range.min}–${range.max}${unit}`;
}

/* ------------------------------------------------------------------------ */
/* Sanitizer choice                                                          */
/* ------------------------------------------------------------------------ */

export function chooseSanitizer(input: {
  poolType?: string | null;
  deficit: number;
  cya?: number | null;
  hardness?: number | null;
  targets: Record<DosingChemical, TargetRange>;
}): DosageProduct {
  const { poolType, deficit, cya, hardness, targets } = input;
  if (isSaltPool(poolType)) return 'liquid_chlorine';
  const cyaLow = isReading(cya) && cya < targets.stabilizer.min;
  const cyaHigh = isReading(cya) && cya > targets.stabilizer.max;
  const chHigh = isReading(hardness) && hardness > targets.hardness.max;
  // Small top-up on an under-stabilized pool: tablets carry their own CYA.
  if (cyaLow && deficit <= 3) return 'trichlor';
  // Shock-level deficit: cal-hypo is fast and unstabilized, unless calcium is already high.
  if (deficit >= 5 && !chHigh && !cyaHigh) return 'calcium_hypochlorite';
  return 'liquid_chlorine';
}

/* ------------------------------------------------------------------------ */
/* Plan                                                                      */
/* ------------------------------------------------------------------------ */

export function hasMinimumReadings(readings: DosingReadings | null | undefined): boolean {
  return !!readings && isReading(readings.ph_value) && isReading(readings.chlorine_value);
}

export function buildDosingPlan(input: DosingInput): DosingPlan {
  const readings = input.readings || {};
  const salt = isSaltPool(input.poolType);
  const gallons = validatePoolGallons(input.poolGallons ?? null);
  const cya = isReading(readings.stabilizer_value) ? readings.stabilizer_value : null;
  const targets = getDosingTargets(input.poolType, input.surfaceType, cya);
  const warnings: string[] = [];
  const notes: string[] = [];
  const missing: string[] = [];
  const drafts: StepDraft[] = [];

  if (!isReading(readings.ph_value)) missing.push('pH');
  if (!isReading(readings.chlorine_value)) missing.push('free chlorine');
  if (!isReading(readings.alkalinity_value)) missing.push('total alkalinity');
  if (!isReading(readings.stabilizer_value)) missing.push('CYA');
  if (!isReading(readings.hardness_value)) missing.push('calcium hardness');
  if (salt && !isReading(readings.salt)) missing.push('salt');

  if (gallons === null) {
    warnings.push('Pool size is missing or unrealistic, so doses cannot be sized. Add pool gallons on the client profile.');
  }

  const lsiStatus = isReading(input.lsi) ? getLsiStatus(input.lsi) : null;
  if (lsiStatus === 'scale-forming') {
    notes.push('LSI is scale-forming: avoid adding calcium or raising alkalinity further today; bring pH down first.');
  } else if (lsiStatus === 'aggressive') {
    notes.push('LSI is aggressive: water is corrosive to plaster and equipment. Raising calcium and alkalinity toward target protects the surface.');
  }

  const ph = readings.ph_value;
  const fc = readings.chlorine_value;
  const ta = readings.alkalinity_value;
  const ch = readings.hardness_value;
  const saltPpm = readings.salt;

  // --- Total alkalinity -------------------------------------------------
  let acidForAlkalinity = false;
  if (isReading(ta)) {
    const t = targets.alkalinity;
    if (ta < t.min) {
      const target = Math.round((t.min + t.max) / 2);
      drafts.push({
        chemical: 'alkalinity', direction: 'raise', kind: 'add', product: 'sodium_bicarbonate',
        reading: ta, target: t, targetValue: target,
        total: scale(RATE_PER_10K.sodium_bicarbonate, target - ta, gallons),
        why: `Alkalinity ${ta} ppm is below ${fmtRange(t)}. Low TA lets pH swing and makes water aggressive; fix it before pH.`,
      });
    } else if (ta > t.max) {
      if (isReading(ph) && ph < 7.2) {
        warnings.push(`Alkalinity ${ta} ppm is high but pH ${ph} is already low. Hold the acid: aerate or let pH rise above 7.2, then lower TA next visit.`);
      } else {
        const target = t.max;
        acidForAlkalinity = true;
        drafts.push({
          chemical: 'alkalinity', direction: 'lower', kind: 'add', product: 'muriatic_acid',
          reading: ta, target: t, targetValue: target,
          total: scale(ACID_FL_OZ_PER_PPM_TA_10K, ta - target, gallons),
          why: `Alkalinity ${ta} ppm is above ${fmtRange(t)}. High TA drives pH up every week. This acid dose also lowers pH — retest pH after it circulates.`,
        });
      }
    }
  }

  // --- pH -----------------------------------------------------------------
  if (isReading(ph)) {
    const t = targets.ph;
    const target = 7.5;
    if (ph < t.min) {
      const taLow = isReading(ta) && ta < targets.alkalinity.min;
      if (taLow && ph >= 7.0) {
        warnings.push(`pH ${ph} is low but alkalinity is low too. Add the bicarbonate first and retest pH — it usually lifts pH on its own.`);
      } else {
        drafts.push({
          chemical: 'ph', direction: 'raise', kind: 'add', product: 'sodium_carbonate',
          reading: ph, target: t, targetValue: target,
          total: scale(RATE_PER_10K.sodium_carbonate, target - ph, gallons),
          why: `pH ${ph} is below ${fmtRange(t)}. Low pH corrodes surfaces, heaters and salt cells and stings eyes.`,
        });
      }
    } else if (ph > t.max) {
      if (acidForAlkalinity) {
        notes.push(`pH ${ph} is high as well; the alkalinity acid dose covers it. Retest pH before adding more acid.`);
      } else {
        drafts.push({
          chemical: 'ph', direction: 'lower', kind: 'add', product: 'muriatic_acid',
          reading: ph, target: t, targetValue: target,
          total: scale(RATE_PER_10K.muriatic_acid, ph - target, gallons),
          why: `pH ${ph} is above ${fmtRange(t)}. High pH cuts chlorine effectiveness and forms scale.`,
        });
      }
    }
  }

  // --- Calcium hardness ---------------------------------------------------
  if (isReading(ch)) {
    const t = targets.hardness;
    if (ch < t.min) {
      if (lsiStatus === 'scale-forming') {
        warnings.push(`Calcium ${ch} ppm is below ${fmtRange(t)} but LSI is already scale-forming. Correct pH and alkalinity first, then raise calcium next visit.`);
      } else {
        const target = Math.round((t.min + t.max) / 2);
        drafts.push({
          chemical: 'hardness', direction: 'raise', kind: 'add', product: 'calcium_chloride',
          reading: ch, target: t, targetValue: target,
          total: scale(RATE_PER_10K.calcium_chloride, target - ch, gallons),
          why: `Calcium ${ch} ppm is below ${fmtRange(t)}. Soft water pulls calcium out of plaster and grout.`,
        });
      }
    } else if (ch > t.max) {
      const percent = Math.min(50, Math.max(10, Math.round((1 - t.max / ch) * 100)));
      drafts.push({
        chemical: 'hardness', direction: 'lower', kind: 'drain', product: null,
        reading: ch, target: t, targetValue: t.max,
        why: `Calcium ${ch} ppm is above ${fmtRange(t)}. Only dilution lowers it: plan a ${percent}% drain and refill. Avoid cal-hypo meanwhile.`,
        wait: 'Schedule a partial drain; keep pH on the low side of target until then to limit scaling.',
        productLabel: `Partial drain ~${percent}%`,
      });
    }
  }

  // --- Stabilizer ---------------------------------------------------------
  if (isReading(cya)) {
    const t = targets.stabilizer;
    if (cya < t.min) {
      const target = Math.round((t.min + t.max) / 2);
      drafts.push({
        chemical: 'stabilizer', direction: 'raise', kind: 'add', product: 'cyanuric_acid',
        reading: cya, target: t, targetValue: target,
        total: scale(RATE_PER_10K.cyanuric_acid, target - cya, gallons),
        why: `CYA ${cya} ppm is below ${fmtRange(t)}. Without stabilizer, sunlight burns off chlorine within hours.`,
      });
    } else if (cya > t.max) {
      const percent = Math.min(75, Math.max(10, Math.round((1 - t.max / cya) * 100)));
      drafts.push({
        chemical: 'stabilizer', direction: 'lower', kind: 'drain', product: null,
        reading: cya, target: t, targetValue: t.max,
        why: `CYA ${cya} ppm is above ${fmtRange(t)}. High CYA locks up chlorine; only a ~${percent}% drain and refill lowers it. Stop using stabilized chlorine (trichlor/dichlor).`,
        wait: 'Until the drain, hold free chlorine at the raised target above and use unstabilized chlorine only.',
        productLabel: `Partial drain ~${percent}%`,
      });
    }
  }

  // --- Salt ---------------------------------------------------------------
  if (salt && isReading(saltPpm)) {
    const t = targets.salt;
    if (saltPpm < t.min) {
      drafts.push({
        chemical: 'salt', direction: 'raise', kind: 'add', product: 'salt',
        reading: saltPpm, target: t, targetValue: SALT_TARGET_PPM,
        total: scale(RATE_PER_10K.salt, SALT_TARGET_PPM - saltPpm, gallons),
        why: `Salt ${saltPpm} ppm is below ${fmtRange(t)}. The cell cannot make chlorine below its minimum and may fault.`,
      });
    } else if (saltPpm > t.max) {
      drafts.push({
        chemical: 'salt', direction: 'lower', kind: 'drain', product: null,
        reading: saltPpm, target: t, targetValue: SALT_TARGET_PPM,
        why: `Salt ${saltPpm} ppm is above ${fmtRange(t)}. High salt can trip the cell and corrode metal; dilute with fresh water.`,
        wait: 'Confirm with a second test before draining — cell readouts drift with temperature.',
        productLabel: 'Dilute with fresh water',
      });
    }
  }

  // --- Free chlorine ------------------------------------------------------
  let fcTarget: number | null = null;
  if (isReading(fc)) {
    const t = targets.chlorine;
    fcTarget = round((t.min + t.max) / 2, 1);
    if (fc === 0 && isReading(cya) && cya > 100) {
      warnings.push(`Free chlorine reads 0 with CYA ${cya} ppm. Suspect chlorine lock or a bleached test — confirm with a FAS-DPD test before dosing.`);
    }
    if (fc < t.min) {
      const deficit = round(fcTarget - fc, 1);
      const product = chooseSanitizer({ poolType: input.poolType, deficit, cya, hardness: ch, targets });
      const cyaNote = isReading(cya) && fcFloorForCya(cya) > FC_MIN_PPM
        ? ` Target is raised to ${t.min}–${t.max} ppm because CYA is ${cya} ppm.`
        : '';
      drafts.push({
        chemical: 'chlorine', direction: 'raise', kind: 'add', product,
        reading: fc, target: t, targetValue: fcTarget,
        total: scale(RATE_PER_10K[product], deficit, gallons),
        why: `Free chlorine ${fc} ppm is below ${fmtRange(t)}. Under-sanitized water grows algae and bacteria.${cyaNote}`,
      });
    } else if (fc > t.max) {
      drafts.push({
        chemical: 'chlorine', direction: 'lower', kind: 'wait', product: null,
        reading: fc, target: t, targetValue: fcTarget,
        why: `Free chlorine ${fc} ppm is above ${fmtRange(t)}. Skip chlorine today and let sunlight bring it down.`,
        wait: 'Check the chlorinator or cell output setting before leaving.',
        productLabel: 'No chlorine today',
      });
    }
  }

  // Finalize, sort, and renumber.
  const steps = drafts
    .map((draft, index) => finalizeStep(draft, gallons, index))
    .sort((a, b) => a.order - b.order)
    .map((step, index) => ({ ...step, order: index + 1 }));

  const addSteps = steps.filter((step) => step.kind === 'add');
  const hasAcid = addSteps.some((step) => step.product === 'muriatic_acid');
  const hasChlorine = addSteps.some((step) => step.product === 'liquid_chlorine'
    || step.product === 'calcium_hypochlorite' || step.product === 'trichlor');
  if (addSteps.length > 0) notes.unshift(GENERAL_CHEMICAL_SAFETY_NOTE);
  if (hasAcid && hasChlorine) notes.splice(1, 0, ACID_LAST_SAFETY_NOTE);

  return { steps, missing, warnings, notes, targets, gallons, fcTarget };
}
