export const CHEMICAL_READING_STATUSES = [
  'not_tested',
  'low',
  'good',
  'high',
  'critical',
] as const;

export const SERVICE_STOP_STATUSES = [
  'completed',
  'pending',
  'scheduled',
  'in_progress',
  'cancelled',
  'rescheduled',
  'skipped',
  'no_access',
  'weather',
  'green_pool',
  'equipment_issue',
] as const;

export type ChemicalReadingStatus = typeof CHEMICAL_READING_STATUSES[number];
export type ServiceStopStatus = typeof SERVICE_STOP_STATUSES[number];

type ChemicalReadingSource = Partial<Record<
  'ph' | 'chlorine' | 'alkalinity' | 'stabilizer',
  string | null | undefined
>>;

const EXCEPTION_STOP_STATUSES = new Set<ServiceStopStatus>([
  'cancelled',
  'rescheduled',
  'skipped',
  'no_access',
  'weather',
  'green_pool',
  'equipment_issue',
]);

const LEGACY_SERVICE_LOG_STATUSES = new Set([
  'completed',
  'pending',
  'cancelled',
  'rescheduled',
]);

const LEGACY_CHEMICAL_READING_STATUSES = new Set([
  'low',
  'good',
  'high',
  'critical',
]);

function isChemicalReadingStatus(value: unknown): value is ChemicalReadingStatus {
  return typeof value === 'string' && CHEMICAL_READING_STATUSES.includes(value as ChemicalReadingStatus);
}

/**
 * A new stop must make the fact that a test was not performed explicit. It is
 * safer than silently recording a passing reading that was never measured.
 */
export function createInitialChemicalReadings(source: ChemicalReadingSource = {}) {
  const reading = (value: unknown): ChemicalReadingStatus => (
    isChemicalReadingStatus(value) ? value : 'not_tested'
  );

  return {
    ph: reading(source.ph),
    chlorine: reading(source.chlorine),
    alkalinity: reading(source.alkalinity),
    stabilizer: reading(source.stabilizer),
  };
}

export function validateServiceStop({ status, notes }: { status: string; notes?: string | null }) {
  if (!SERVICE_STOP_STATUSES.includes(status as ServiceStopStatus)) {
    return { valid: false as const, error: 'Choose a valid stop outcome.' };
  }

  if (EXCEPTION_STOP_STATUSES.has(status as ServiceStopStatus) && !notes?.trim()) {
    return { valid: false as const, error: 'Add a short explanation for this stop outcome.' };
  }

  return { valid: true as const };
}

/**
 * The existing local Zod schema predates explicit not-tested readings and
 * field outcomes. This bridge preserves Zod's date,
 * numeric, and XSS checks until that schema is migrated, while callers restore
 * the original values before writing. The Convex mutation remains the source
 * of truth and validates the full modern contract.
 */
export function toLegacyServiceLogValidationInput<T extends Record<string, unknown>>(data: T): T {
  const legacyStatus = LEGACY_SERVICE_LOG_STATUSES.has(String(data.status))
    ? data.status
    : 'completed';

  const legacyReading = (value: unknown) => (
    LEGACY_CHEMICAL_READING_STATUSES.has(String(value)) ? value : 'good'
  );

  return {
    ...data,
    status: legacyStatus,
    ph: legacyReading(data.ph),
    chlorine: legacyReading(data.chlorine),
    alkalinity: legacyReading(data.alkalinity),
    stabilizer: legacyReading(data.stabilizer),
  };
}
