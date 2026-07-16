/**
 * Pool chemistry domain model — the single source of truth for what a
 * reading MEANS. Ranges, status mapping, and tone classes live here so the
 * logging form, the route list chips, and the analysis panel never drift.
 *
 * Status vocabulary (maps to the token ramp in index.css):
 *   good     -> ok      (in range)
 *   low      -> watch   (below ideal, not dangerous)
 *   high     -> action  (above ideal, treat)
 *   critical -> critical (unsafe / far out of range)
 */

export const CHEMICAL_CONFIGS = {
  ph: {
    min: 6.8,
    max: 8.2,
    step: 0.1,
    unit: '',
    hint: 'Ideal range: 6.8-8.2',
    ranges: [
      { status: 'critical', min: -Infinity, max: 6.8 },
      { status: 'low', min: 6.8, max: 7.2 },
      { status: 'good', min: 7.2, max: 7.8 },
      { status: 'high', min: 7.8, max: 8.2 },
      { status: 'critical', min: 8.2, max: Infinity },
    ],
  },
  chlorine: {
    min: 0,
    max: 10,
    step: 0.5,
    unit: 'ppm',
    hint: 'Ideal range: 1-3 ppm (max 10 ppm)',
    ranges: [
      { status: 'critical', min: -Infinity, max: 0.5 },
      { status: 'low', min: 0.5, max: 1 },
      { status: 'good', min: 1, max: 3 },
      { status: 'high', min: 3, max: 10 },
      { status: 'critical', min: 10, max: Infinity },
    ],
  },
  alkalinity: {
    min: 80,
    max: 120,
    step: 1,
    unit: 'ppm',
    hint: 'Ideal range: 80-120 ppm',
    ranges: [
      { status: 'critical', min: -Infinity, max: 80 },
      { status: 'low', min: 80, max: 100 },
      { status: 'good', min: 100, max: 120 },
      { status: 'high', min: 120, max: 200 },
      { status: 'critical', min: 200, max: Infinity },
    ],
  },
  stabilizer: {
    min: 30,
    max: 100,
    step: 1,
    unit: 'ppm',
    hint: 'Ideal range: 30-50 ppm (max 100 ppm)',
    ranges: [
      { status: 'critical', min: -Infinity, max: 10 },
      { status: 'low', min: 10, max: 30 },
      { status: 'good', min: 30, max: 50 },
      { status: 'high', min: 50, max: 100 },
      { status: 'critical', min: 100, max: Infinity },
    ],
  },
};

const KNOWN_STATUSES = new Set(['good', 'low', 'high', 'critical']);

/** Map a numeric reading to its status via the chemical's configured ranges. */
export function mapNumericValueToStatus(value, ranges) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const num = typeof value === 'number' ? value : parseFloat(value);
  if (Number.isNaN(num)) {
    return undefined;
  }
  for (const range of ranges) {
    if (num >= range.min && num < range.max) {
      return range.status;
    }
  }
  return undefined;
}

/**
 * Resolve a stored reading to a status. Readings are stored either as a
 * status word ('good') or as a number — handle both so colored chips
 * actually render their intended tone.
 */
export function readingToStatus(key, value) {
  if (value === undefined || value === null || value === '') return undefined;
  const asString = String(value).toLowerCase();
  if (KNOWN_STATUSES.has(asString)) return asString;
  const config = CHEMICAL_CONFIGS[key];
  if (!config) return undefined;
  return mapNumericValueToStatus(value, config.ranges);
}

/** status word -> token ramp name */
export const STATUS_TO_TONE = {
  good: 'ok',
  low: 'watch',
  high: 'action',
  critical: 'critical',
};

export function statusToTone(status) {
  return STATUS_TO_TONE[status] || 'info';
}

/** Tailwind-free tone classes backed by the color-mix token tints. */
export function chemToneClasses(key, value) {
  const tone = statusToTone(readingToStatus(key, value));
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
