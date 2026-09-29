/**
 * Pool chemistry status helpers for the UI — what a reading MEANS. Ranges,
 * hints and targets come from src/lib/poolChemistry.ts (the canonical source
 * shared with the dosing engine), so the logging form, the route list chips,
 * and the analysis panel never drift.
 *
 * Status vocabulary (maps to the token ramp in index.css):
 *   good     -> ok      (in range)
 *   low      -> watch   (below ideal, not dangerous)
 *   high     -> action  (above ideal, treat)
 *   critical -> critical (unsafe / far out of range)
 *   not_tested -> (none) chemical was not tested this visit; resolves to an
 *               undefined status / neutral tone, exactly like a missing
 *               reading. It is never 'good' and never a problem.
 *
 * 'critical' is a DISPLAY status and does not say which way to correct.
 * Anything that decides what to add must use readingToDirectionalStatus(),
 * which returns 'critical_low' / 'critical_high'.
 */
import {
  CHEMISTRY_CONFIGS,
  classifyInRanges,
  classifyReading,
  getChemistryConfig,
  isChemicalKey,
  isNotTested,
  NOT_TESTED,
  toDisplayStatus,
} from './poolChemistry';

function toUiConfig(config) {
  return {
    // Ideal band — for status display only. Inputs must NOT use these as
    // validation limits (out-of-range readings are exactly the ones techs
    // need to record).
    min: config.idealMin,
    max: config.idealMax,
    idealMin: config.idealMin,
    idealMax: config.idealMax,
    // Physically plausible input bounds.
    inputMin: config.inputMin,
    inputMax: config.inputMax,
    step: 'any',
    unit: config.unit,
    hint: config.hint,
    target: config.target,
    // Display ranges ('critical' on both sides) for backward compatibility.
    ranges: config.ranges.map((range) => ({ ...range, status: toDisplayStatus(range.status) })),
    // Direction-aware ranges.
    directionalRanges: config.ranges,
  };
}

export const CHEMICAL_CONFIGS = {
  ph: toUiConfig(CHEMISTRY_CONFIGS.ph),
  chlorine: toUiConfig(CHEMISTRY_CONFIGS.chlorine),
  alkalinity: toUiConfig(CHEMISTRY_CONFIGS.alkalinity),
  stabilizer: toUiConfig(CHEMISTRY_CONFIGS.stabilizer),
};

/**
 * Pool-type aware config (salt pools use a 60-80 ppm CYA band).
 * `poolType` is the customer's pool_type field (e.g. "Salt").
 */
export function getChemicalConfig(key, poolType) {
  if (!isChemicalKey(key)) return undefined;
  return toUiConfig(getChemistryConfig(key, { poolType }));
}

export { NOT_TESTED, isNotTested };

/** True when a stored reading holds an actual test result (not missing, not 'not_tested'). */
export function isTestedReading(value) {
  return value !== undefined && value !== null && value !== '' && !isNotTested(value);
}

const KNOWN_STATUSES = new Set(['good', 'low', 'high', 'critical']);
const DIRECTIONAL_STATUSES = new Set(['critical_low', 'low', 'good', 'high', 'critical_high']);

/** Map a numeric reading to its display status via the given ranges. */
export function mapNumericValueToStatus(value, ranges) {
  if (!Array.isArray(ranges)) return undefined;
  return toDisplayStatus(classifyInRanges(value, ranges));
}

/**
 * Resolve a stored reading to a display status. Readings are stored either
 * as a status word ('good') or as a number — handle both so colored chips
 * actually render their intended tone.
 */
export function readingToStatus(key, value, poolType) {
  if (value === undefined || value === null || value === '' || isNotTested(value)) return undefined;
  const asString = String(value).toLowerCase();
  if (KNOWN_STATUSES.has(asString)) return asString;
  if (asString === 'critical_low' || asString === 'critical_high') return 'critical';
  if (!isChemicalKey(key)) return undefined;
  return toDisplayStatus(classifyReading(key, value, { poolType }));
}

/**
 * Direction-aware status: 'critical_low' | 'low' | 'good' | 'high' |
 * 'critical_high'. A bare stored 'critical' word (quick entry) carries no
 * direction and resolves to undefined — callers must ask for a numeric
 * reading instead of guessing which way to dose.
 */
export function readingToDirectionalStatus(key, value, poolType) {
  if (value === undefined || value === null || value === '' || isNotTested(value)) return undefined;
  const asString = String(value).toLowerCase();
  if (DIRECTIONAL_STATUSES.has(asString)) return asString;
  if (asString === 'critical') return undefined;
  if (!isChemicalKey(key)) return undefined;
  return classifyReading(key, value, { poolType });
}

/** status word -> token ramp name */
export const STATUS_TO_TONE = {
  good: 'ok',
  low: 'watch',
  high: 'action',
  critical: 'critical',
  critical_low: 'critical',
  critical_high: 'critical',
};

export function statusToTone(status) {
  if (isNotTested(status)) return 'neutral';
  return STATUS_TO_TONE[status] || 'info';
}

/** Tailwind-free tone classes backed by the color-mix token tints. */
export function chemToneClasses(key, value, poolType) {
  const tone = statusToTone(readingToStatus(key, value, poolType));
  switch (tone) {
    case 'ok':
      return 'border-[var(--status-ok-line)] bg-[var(--status-ok-soft)] text-[var(--status-ok-ink)]';
    case 'watch':
      return 'border-[var(--status-watch-line)] bg-[var(--status-watch-soft)] text-[var(--status-watch-ink)]';
    case 'action':
      return 'border-[var(--status-action-line)] bg-[var(--status-action-soft)] text-[var(--status-action-ink)]';
    case 'critical':
      return 'border-[var(--status-critical-line)] bg-[var(--status-critical-soft)] text-[var(--status-critical-ink)]';
    default:
      return 'border-line bg-surface-1 text-ink-secondary';
  }
}
