/**
 * Pool chemistry domain constants and math — the canonical source for
 * reading ranges, direction-aware classification, and dosing estimates.
 *
 * `src/lib/chemStatus.js` (UI status/tone helpers) and the ai-summarizer
 * recommendation engine both derive from this module so ranges, hints and
 * dosing never drift apart.
 *
 * Units: pH is unitless; free chlorine (FC), total alkalinity (TA) and
 * cyanuric acid (CYA) are ppm (mg/L). TA is ppm "as CaCO3", the same unit
 * src/lib/lsi.ts consumes.
 *
 * SAFETY: dosing figures are conservative field estimates, not lab-grade
 * results. Every dose string tells the tech to add in stages and retest.
 */

export type ChemicalKey = 'ph' | 'chlorine' | 'alkalinity' | 'stabilizer';

/** Display status (UI / stored quick-entry vocabulary). */
export type DisplayStatus = 'good' | 'low' | 'high' | 'critical';

/** Direction-aware status. 'critical' alone loses which way to correct. */
export type DirectionalStatus = 'critical_low' | 'low' | 'good' | 'high' | 'critical_high';

export interface ChemicalRange {
  status: DirectionalStatus;
  min: number;
  max: number;
  /** When true the range includes its upper bound (used for the ideal band). */
  inclusiveMax?: boolean;
}

export interface ChemicalConfig {
  /** Ideal band bounds (for display only — never use for input validation). */
  idealMin: number;
  idealMax: number;
  /** Physically plausible input bounds (what an input should accept). */
  inputMin: number;
  inputMax: number;
  unit: string;
  hint: string;
  /** Default correction target for dosing math. */
  target: number;
  ranges: ChemicalRange[];
}

export type PoolKind = 'standard' | 'salt';

export interface ChemistryContext {
  /** 'Salt' / 'salt' pool types use SWG-appropriate CYA targets. */
  poolType?: string | null;
}

export function poolKindFromType(poolType?: string | null): PoolKind {
  return typeof poolType === 'string' && poolType.trim().toLowerCase() === 'salt' ? 'salt' : 'standard';
}

/*
 * Ranges follow common industry guidance (ANSI/APSP/ICC-11, CDC MAHC,
 * Taylor/TFP field practice):
 *   pH      ideal 7.2–7.8
 *   FC      ideal 1–4 ppm (and ideally ≥ ~7.5% of CYA, see chlorineTargetFor)
 *   TA      ideal 80–120 ppm
 *   CYA     ideal 30–50 ppm (salt/SWG pools 60–80 ppm)
 */
const PH_CONFIG: ChemicalConfig = {
  idealMin: 7.2,
  idealMax: 7.8,
  inputMin: 0,
  inputMax: 14,
  unit: '',
  hint: 'Ideal range: 7.2-7.8',
  target: 7.5,
  ranges: [
    { status: 'critical_low', min: -Infinity, max: 6.8 },
    { status: 'low', min: 6.8, max: 7.2 },
    { status: 'good', min: 7.2, max: 7.8, inclusiveMax: true },
    { status: 'high', min: 7.8, max: 8.2 },
    { status: 'critical_high', min: 8.2, max: Infinity },
  ],
};

const CHLORINE_CONFIG: ChemicalConfig = {
  idealMin: 1,
  idealMax: 4,
  inputMin: 0,
  inputMax: 100,
  unit: 'ppm',
  hint: 'Ideal range: 1-4 ppm free chlorine (no swimming above 10 ppm)',
  target: 3,
  ranges: [
    { status: 'critical_low', min: -Infinity, max: 0.5 },
    { status: 'low', min: 0.5, max: 1 },
    { status: 'good', min: 1, max: 4, inclusiveMax: true },
    { status: 'high', min: 4, max: 10, inclusiveMax: true },
    { status: 'critical_high', min: 10, max: Infinity },
  ],
};

const ALKALINITY_CONFIG: ChemicalConfig = {
  idealMin: 80,
  idealMax: 120,
  inputMin: 0,
  inputMax: 1000,
  unit: 'ppm',
  hint: 'Ideal range: 80-120 ppm',
  target: 100,
  ranges: [
    { status: 'critical_low', min: -Infinity, max: 60 },
    { status: 'low', min: 60, max: 80 },
    { status: 'good', min: 80, max: 120, inclusiveMax: true },
    { status: 'high', min: 120, max: 200 },
    { status: 'critical_high', min: 200, max: Infinity },
  ],
};

const STABILIZER_CONFIG: ChemicalConfig = {
  idealMin: 30,
  idealMax: 50,
  inputMin: 0,
  inputMax: 1000,
  unit: 'ppm',
  hint: 'Ideal range: 30-50 ppm (max 100 ppm)',
  target: 40,
  ranges: [
    { status: 'critical_low', min: -Infinity, max: 10 },
    { status: 'low', min: 10, max: 30 },
    { status: 'good', min: 30, max: 50, inclusiveMax: true },
    { status: 'high', min: 50, max: 100 },
    { status: 'critical_high', min: 100, max: Infinity },
  ],
};

/** Salt-water-generator pools run higher CYA to protect cell-generated chlorine. */
const SALT_STABILIZER_CONFIG: ChemicalConfig = {
  idealMin: 60,
  idealMax: 80,
  inputMin: 0,
  inputMax: 1000,
  unit: 'ppm',
  hint: 'Ideal range (salt pool): 60-80 ppm (max 100 ppm)',
  target: 70,
  ranges: [
    { status: 'critical_low', min: -Infinity, max: 20 },
    { status: 'low', min: 20, max: 60 },
    { status: 'good', min: 60, max: 80, inclusiveMax: true },
    { status: 'high', min: 80, max: 100 },
    { status: 'critical_high', min: 100, max: Infinity },
  ],
};

export const CHEMISTRY_CONFIGS: Record<ChemicalKey, ChemicalConfig> = {
  ph: PH_CONFIG,
  chlorine: CHLORINE_CONFIG,
  alkalinity: ALKALINITY_CONFIG,
  stabilizer: STABILIZER_CONFIG,
};

export function isChemicalKey(key: unknown): key is ChemicalKey {
  return key === 'ph' || key === 'chlorine' || key === 'alkalinity' || key === 'stabilizer';
}

export function getChemistryConfig(key: ChemicalKey, context: ChemistryContext = {}): ChemicalConfig {
  if (key === 'stabilizer' && poolKindFromType(context.poolType) === 'salt') {
    return SALT_STABILIZER_CONFIG;
  }
  return CHEMISTRY_CONFIGS[key];
}

export function parseReadingNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const num = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(num) ? num : null;
}

/** Classify a numeric value against a set of ranges, keeping direction. */
export function classifyInRanges(value: unknown, ranges: ChemicalRange[]): DirectionalStatus | undefined {
  const num = parseReadingNumber(value);
  if (num === null) return undefined;
  for (const range of ranges) {
    const belowMax = range.inclusiveMax ? num <= range.max : num < range.max;
    if (num >= range.min && belowMax) return range.status;
  }
  return undefined;
}

export function classifyReading(
  key: ChemicalKey,
  value: unknown,
  context: ChemistryContext = {}
): DirectionalStatus | undefined {
  return classifyInRanges(value, getChemistryConfig(key, context).ranges);
}

export function toDisplayStatus(status: DirectionalStatus): DisplayStatus;
export function toDisplayStatus(status: DirectionalStatus | undefined): DisplayStatus | undefined;
export function toDisplayStatus(status: DirectionalStatus | undefined): DisplayStatus | undefined {
  if (status === 'critical_low' || status === 'critical_high') return 'critical';
  return status;
}

export function directionOf(status: DirectionalStatus | undefined): 'raise' | 'lower' | 'none' {
  if (status === 'critical_low' || status === 'low') return 'raise';
  if (status === 'critical_high' || status === 'high') return 'lower';
  return 'none';
}

/* ------------------------------------------------------------------------ */
/* Dosing constants                                                         */
/* ------------------------------------------------------------------------ */

/**
 * All rates are per 10,000 US gallons. Derivations use 10,000 gal × 8.34
 * lb/gal = 83,400 lb of water, so 1 ppm = 0.0834 lb (1.33 oz) of the active
 * species. Figures match the Taylor Watergram / TFP PoolMath / Orenda
 * calculators to within rounding.
 */
export const DOSING_CONSTANTS = {
  /**
   * Sodium bicarbonate (baking soda) raises TA ~10 ppm per 1.4 lb / 10k gal.
   * (0.834 lb as CaCO3 × 84/50 = 1.40 lb; Taylor lists 1.4 lb, many guides round to 1.5.)
   */
  bicarbLbPer10PpmTa: 1.4,
  /**
   * Muriatic acid (31.45% HCl, ~20° Baumé) lowers TA ~10 ppm per 25.6 fl oz / 10k gal.
   * (0.834 lb CaCO3 × 36.46/50 / 0.3145 = 1.93 lb solution ÷ 9.67 lb/gal = 0.20 gal.)
   * Taylor lists 26 fl oz (1.6 pt).
   */
  muriaticFlOzPer10PpmTa: 25.6,
  /**
   * Liquid chlorine, 12.5% trade strength (sodium hypochlorite):
   * 1 ppm FC per 10.2 fl oz / 10k gal (37.85 g Cl2 ÷ 125 g/L = 0.303 L).
   */
  liquidChlorineFlOzPerPpm: 10.2,
  /** Calcium hypochlorite 65%: 1 ppm FC per ~2.05 oz (wt) / 10k gal (1.33 oz ÷ 0.65). */
  calHypoOzPerPpm: 2.05,
  /** Cyanuric acid (stabilizer, ~100%): 1 ppm per ~1.33 oz / 10k gal (13 oz ≈ 10 ppm). */
  cyaOzPerPpm: 1.33,
  /** Carbonic acid apparent pKa1 in pool water (25 °C, typical ionic strength). */
  carbonicPka1: 6.3,
  /** Soda ash (Na2CO3) molar mass, g/mol. */
  sodaAshMolarMass: 105.99,
  /** lb of chemical per 1 mg/L in 10,000 gal. */
  lbPerPpmPer10kGal: 0.0834,
  /** Assumed TA when pH must be adjusted but TA was not measured. */
  assumedTaForPh: 100,
  /* Single-addition caps per 10k gal — split larger corrections across visits/hours. */
  maxAcidFlOzPerAddition: 32, // ≈ 1 quart
  maxSodaAshLbPerAddition: 1, // larger doses risk clouding/scaling
  maxBicarbLbPerAddition: 7, // ≈ +50 ppm TA
  maxCyaPpmPerAddition: 30, // CYA dissolves slowly and is only removed by draining
} as const;

/** FC target: at least 3 ppm, and ~10% of CYA when CYA is known (TFP min is 7.5%). */
export function chlorineTargetFor(cya: number | null | undefined): number {
  const target = CHLORINE_CONFIG.target;
  if (typeof cya !== 'number' || !Number.isFinite(cya) || cya <= 0) return target;
  return Math.max(target, Math.round(cya * 0.1 * 2) / 2);
}

/**
 * Approximate acid needed (meq/L) to move pH from `from` to `to` (to < from)
 * given carbonate alkalinity TA (ppm as CaCO3). Closed-system carbonate model:
 * pH = pKa1 + log10([HCO3-]/[CO2]); acid converts HCO3- → CO2.
 * Ignores CYA/borate buffering, so it tends to UNDER-estimate (the safe side).
 */
export function acidMeqForPhDrop(from: number, to: number, ta: number): number {
  if (!(from > to) || !(ta > 0)) return 0;
  const pKa = DOSING_CONSTANTS.carbonicPka1;
  const hco3 = ta / 50; // meq/L
  const co2 = hco3 / Math.pow(10, from - pKa);
  const ratio = Math.pow(10, to - pKa);
  const acid = (hco3 - ratio * co2) / (1 + ratio);
  return Math.max(0, Math.min(acid, hco3));
}

/**
 * Approximate soda ash (mmol/L) to move pH from `from` up to `to`.
 * CO3^2- + CO2 → 2 HCO3-. Ignores aeration/outgassing (which also raises pH),
 * so real needs are usually lower than this estimate — add half, then retest.
 */
export function sodaAshMmolForPhRise(from: number, to: number, ta: number): number {
  if (!(to > from) || !(ta > 0)) return 0;
  const pKa = DOSING_CONSTANTS.carbonicPka1;
  const hco3 = ta / 50;
  const co2 = hco3 / Math.pow(10, from - pKa);
  const ratio = Math.pow(10, to - pKa);
  const mmol = (ratio * co2 - hco3) / (ratio + 2);
  return Math.max(0, Math.min(mmol, co2));
}

/* ------------------------------------------------------------------------ */
/* Dose planning                                                            */
/* ------------------------------------------------------------------------ */

export type DoseEffect = 'raise' | 'lower' | 'none';

export interface DosePlan {
  chemical: ChemicalKey;
  status: DirectionalStatus;
  /** Which way this plan moves the reading. */
  effect: DoseEffect;
  /** Product added (null when the fix is "add nothing" or a drain). */
  product: string | null;
  /** Amount of product for this addition (after capping), or null. */
  amount: number | null;
  unit: string | null;
  /** True when the full correction exceeded the single-addition cap. */
  capped: boolean;
  /** Reading value the plan was computed from. */
  assumedValue: number;
  /** True when the value was inferred from the status band rather than measured. */
  valueAssumed: boolean;
  target: number;
  /** Human-readable dose instruction. */
  text: string;
}

export interface DoseInput {
  chemical: ChemicalKey;
  status: DirectionalStatus;
  gallons: number;
  /** Measured value for this chemical, if recorded. */
  value?: number | null;
  /** Other measured values in the same log, used for context (TA for pH, CYA for FC). */
  alkalinity?: number | null;
  stabilizer?: number | null;
  poolType?: string | null;
}

/**
 * Representative value when only a status word was recorded: the band
 * midpoint for low/high, the band edge nearest ideal for critical bands
 * (smallest plausible deviation → conservative dose).
 */
export function representativeValue(key: ChemicalKey, status: DirectionalStatus, context: ChemistryContext = {}): number {
  const config = getChemistryConfig(key, context);
  const range = config.ranges.find((r) => r.status === status);
  if (!range || status === 'good') return config.target;
  if (status === 'critical_low') return range.max;
  if (status === 'critical_high') return range.min;
  return (range.min + range.max) / 2;
}

function round(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function fmt(value: number, digits = 1): string {
  return Number(value.toFixed(digits)).toString();
}

function volumeFlOz(flOz: number): string {
  if (flOz >= 128) return `${fmt(flOz / 128, 2)} gal (${Math.round(flOz)} fl oz)`;
  return `${Math.round(flOz)} fl oz`;
}

function weightOz(oz: number): string {
  if (oz >= 16) return `${fmt(oz / 16, 1)} lb`;
  return `${fmt(oz, 1)} oz`;
}

const RETEST = 'Circulate at least 30 minutes, then retest before adding more.';

/**
 * Build a dose plan proportional to the deviation from target. Always moves
 * the reading toward the ideal band; never adds chlorine to a high-chlorine pool.
 */
export function planDose(input: DoseInput): DosePlan | null {
  const { chemical, status, gallons } = input;
  if (status === 'good') return null;
  if (!(gallons > 0) || !Number.isFinite(gallons)) return null;

  const context = { poolType: input.poolType };
  const config = getChemistryConfig(chemical, context);
  const measured = parseReadingNumber(input.value);
  const valueAssumed = measured === null;
  const current = measured ?? representativeValue(chemical, status, context);
  const scale = gallons / 10000;
  const gal = `${Math.round(gallons)} gallons`;
  const approxNote = valueAssumed
    ? ' Estimated from the status only — record a numeric reading for an accurate dose.'
    : '';
  const effect = directionOf(status);
  const base = { chemical, status, effect, assumedValue: current, valueAssumed };

  switch (chemical) {
    case 'ph': {
      const target = config.target;
      const measuredTa = parseReadingNumber(input.alkalinity);
      const ta = measuredTa !== null && measuredTa > 0 ? measuredTa : DOSING_CONSTANTS.assumedTaForPh;
      const taNote = measuredTa !== null && measuredTa > 0 ? `TA ${Math.round(ta)} ppm` : `TA assumed ${ta} ppm`;
      if (effect === 'lower') {
        const meq = acidMeqForPhDrop(current, target, ta);
        const taDropPpm = meq * 50;
        const fullFlOz = (taDropPpm / 10) * DOSING_CONSTANTS.muriaticFlOzPer10PpmTa * scale;
        const capFlOz = DOSING_CONSTANTS.maxAcidFlOzPerAddition * scale;
        const capped = fullFlOz > capFlOz;
        const flOz = Math.max(1, Math.round(Math.min(fullFlOz, capFlOz)));
        const text =
          `Approx. ${volumeFlOz(flOz)} muriatic acid (31.45%) for ${gal} to lower pH from ${fmt(current)} toward ${target} (${taNote}).` +
          (capped ? ` Full correction ≈ ${volumeFlOz(fullFlOz)}; add no more than this now and split the rest.` : '') +
          ` Pour slowly in front of a return with the pump running. ${RETEST}${approxNote}`;
        return { ...base, product: 'muriatic acid (31.45%)', amount: flOz, unit: 'fl oz', capped, target, text };
      }
      const mmol = sodaAshMmolForPhRise(current, target, ta);
      const fullLb = mmol * DOSING_CONSTANTS.sodaAshMolarMass * DOSING_CONSTANTS.lbPerPpmPer10kGal * scale;
      const capLb = DOSING_CONSTANTS.maxSodaAshLbPerAddition * scale;
      const capped = fullLb > capLb;
      const oz = Math.max(1, round(Math.min(fullLb, capLb) * 16, 0.5));
      const text =
        `Approx. ${weightOz(oz)} sodium carbonate (soda ash / pH increaser) for ${gal} to raise pH from ${fmt(current)} toward ${target} (${taNote}).` +
        (capped ? ` Full correction ≈ ${weightOz(fullLb * 16)}; add no more than this now to avoid clouding.` : '') +
        ` If TA is also low, raise TA with sodium bicarbonate first. ${RETEST}${approxNote}`;
      return { ...base, product: 'sodium carbonate (soda ash)', amount: oz, unit: 'oz', capped, target, text };
    }

    case 'chlorine': {
      const target = chlorineTargetFor(parseReadingNumber(input.stabilizer));
      if (effect === 'lower') {
        const critical = status === 'critical_high';
        const text = critical
          ? `Do NOT add chlorine. Free chlorine ${valueAssumed ? 'is' : `of ${fmt(current)} ppm is`} above 10 ppm — no swimming until it drops to 10 ppm or below (or your local code limit). Turn off/down the chlorinator or salt cell, uncover the pool, and let sunlight dissipate it. Retest before reopening.${approxNote}`
          : `Do NOT add chlorine. Reduce chlorinator/salt-cell output and let it dissipate naturally toward ${target} ppm. Retest next visit.${approxNote}`;
        return { ...base, product: null, amount: null, unit: null, capped: false, target, text };
      }
      const deltaPpm = Math.max(0, target - current);
      const flOz = Math.max(1, Math.round(deltaPpm * DOSING_CONSTANTS.liquidChlorineFlOzPerPpm * scale));
      const calHypoOz = Math.max(0.5, round(deltaPpm * DOSING_CONSTANTS.calHypoOzPerPpm * scale, 0.5));
      const text =
        `Approx. ${volumeFlOz(flOz)} liquid chlorine (12.5%) — or ${weightOz(calHypoOz)} cal-hypo (65%) — for ${gal} to raise free chlorine from ${fmt(current)} to about ${target} ppm (+${fmt(deltaPpm)} ppm).` +
        ` If algae is visible or combined chlorine is above 0.5 ppm, shock to a CYA-appropriate level instead. ${RETEST}${approxNote}`;
      return { ...base, product: 'liquid chlorine (12.5%)', amount: flOz, unit: 'fl oz', capped: false, target, text };
    }

    case 'alkalinity': {
      const target = config.target;
      if (effect === 'lower') {
        const drop = Math.max(0, current - target);
        const fullFlOz = (drop / 10) * DOSING_CONSTANTS.muriaticFlOzPer10PpmTa * scale;
        const capFlOz = DOSING_CONSTANTS.maxAcidFlOzPerAddition * scale;
        const capped = fullFlOz > capFlOz;
        const flOz = Math.max(1, Math.round(Math.min(fullFlOz, capFlOz)));
        const text =
          `Approx. ${volumeFlOz(flOz)} muriatic acid (31.45%) for ${gal} toward lowering TA from ${Math.round(current)} to ${target} ppm (full correction ≈ ${volumeFlOz(fullFlOz)}).` +
          (capped ? ' Add no more than this per addition. ' : ' ') +
          `Lowering TA takes repeated acid additions (keep pH ≥ 7.0) plus aeration to bring pH back up. ${RETEST}${approxNote}`;
        return { ...base, product: 'muriatic acid (31.45%)', amount: flOz, unit: 'fl oz', capped, target, text };
      }
      const rise = Math.max(0, target - current);
      const fullLb = (rise / 10) * DOSING_CONSTANTS.bicarbLbPer10PpmTa * scale;
      const capLb = DOSING_CONSTANTS.maxBicarbLbPerAddition * scale;
      const capped = fullLb > capLb;
      const lb = Math.max(0.1, round(Math.min(fullLb, capLb), 0.1));
      const text =
        `Approx. ${fmt(lb)} lbs sodium bicarbonate for ${gal} to raise TA from ${Math.round(current)} toward ${target} ppm (+${Math.round(rise)} ppm).` +
        (capped ? ` Full correction ≈ ${fmt(fullLb)} lbs; split into multiple additions.` : '') +
        ` ${RETEST}${approxNote}`;
      return { ...base, product: 'sodium bicarbonate', amount: lb, unit: 'lbs', capped, target, text };
    }

    case 'stabilizer': {
      const target = config.target;
      if (effect === 'lower') {
        const fraction = current > 0 ? Math.min(1, Math.max(0, 1 - target / current)) : 0;
        const pct = Math.max(5, Math.ceil((fraction * 100) / 5) * 5);
        const drainGallons = Math.round((gallons * pct) / 100 / 100) * 100;
        const text =
          `Partial drain and refill: replace about ${pct}% of the water (~${drainGallons} of ${gal}) to reduce CYA from ${Math.round(current)} toward ${target} ppm, assuming fill water has no CYA. ` +
          'Chemicals cannot remove CYA. Switch to unstabilized chlorine (liquid/cal-hypo) meanwhile, and retest after refilling.' +
          approxNote;
        return { ...base, product: null, amount: pct, unit: '% drain', capped: false, target, text };
      }
      const rise = Math.max(0, target - current);
      const cappedRise = Math.min(rise, DOSING_CONSTANTS.maxCyaPpmPerAddition);
      const capped = rise > cappedRise;
      const oz = Math.max(0.5, round(cappedRise * DOSING_CONSTANTS.cyaOzPerPpm * scale, 0.5));
      const text =
        `Approx. ${weightOz(oz)} cyanuric acid (stabilizer) for ${gal} to raise CYA from ${Math.round(current)} by ~${Math.round(cappedRise)} ppm toward ${target} ppm.` +
        (capped ? ' Add the remainder only after retesting.' : '') +
        ' Dissolve in a skimmer sock; CYA can take up to a week to register — retest before adding more (only draining lowers it).' +
        approxNote;
      return { ...base, product: 'cyanuric acid', amount: oz, unit: 'oz', capped, target, text };
    }

    default:
      return null;
  }
}

/** Which way each product moves each reading (used by tests and callers to sanity-check plans). */
export const PRODUCT_EFFECTS: Record<string, Partial<Record<ChemicalKey, DoseEffect>>> = {
  'sodium carbonate (soda ash)': { ph: 'raise', alkalinity: 'raise' },
  'muriatic acid (31.45%)': { ph: 'lower', alkalinity: 'lower' },
  'sodium bicarbonate': { alkalinity: 'raise' },
  'liquid chlorine (12.5%)': { chlorine: 'raise' },
  'cyanuric acid': { stabilizer: 'raise' },
};
