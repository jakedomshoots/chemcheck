import type { ChemicalReading, ServiceLog, CostEstimate } from './types';

export const VALID_CHEMICALS = ['ph', 'chlorine', 'alkalinity', 'stabilizer'] as const;
export type ValidChemical = typeof VALID_CHEMICALS[number];

export const VALID_READINGS: ChemicalReading[] = ['good', 'low', 'high', 'critical'];

export const VALID_CATEGORIES = ['immediate', 'thisVisit', 'nextVisit', 'longTerm'] as const;

export const BOUNDS = {
  POOL_GALLONS: { min: 100, max: 1_000_000 },
  PERCENTAGE: { min: 0, max: 100 },
  CORRELATION: { min: 0, max: 1 },
  MAX_ARRAY_SIZE: 10_000,
  MAX_STRING_LENGTH: 50_000,
  MAX_EVIDENCE_ITEMS: 100,
  MAX_SERVICE_LOGS: 10_000,
} as const;

export const CORRELATION_STRENGTH_THRESHOLD = 0.3;
export function isValidChemical(chemical: unknown): chemical is ValidChemical {
  return typeof chemical === 'string' && VALID_CHEMICALS.includes(chemical as ValidChemical);
}

export function isValidReading(reading: unknown): reading is ChemicalReading {
  return typeof reading === 'string' && VALID_READINGS.includes(reading as ChemicalReading);
}

export function isValidCategory(category: unknown): category is typeof VALID_CATEGORIES[number] {
  return typeof category === 'string' && VALID_CATEGORIES.includes(category as typeof VALID_CATEGORIES[number]);
}

export function validateNumeric(
  value: unknown,
  min: number,
  max: number
): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  if (value < min || value > max) {
    return null;
  }
  return value;
}

export function validatePoolGallons(gallons: unknown): number | null {
  return validateNumeric(gallons, BOUNDS.POOL_GALLONS.min, BOUNDS.POOL_GALLONS.max);
}

export function validatePercentage(value: unknown): number | null {
  return validateNumeric(value, BOUNDS.PERCENTAGE.min, BOUNDS.PERCENTAGE.max);
}

export function validateCorrelationStrength(value: unknown): number | null {
  return validateNumeric(value, BOUNDS.CORRELATION.min, BOUNDS.CORRELATION.max);
}

export function validateCostRange(estimate: CostEstimate): boolean {
  const { low, expected, high } = estimate;

  if (!Number.isFinite(low) || !Number.isFinite(expected) || !Number.isFinite(high)) {
    return false;
  }

  if (low < 0 || expected < 0 || high < 0) {
    return false;
  }

  return low <= expected && expected <= high;
}

export function validateStringLength(
  value: unknown,
  maxLength: number = BOUNDS.MAX_STRING_LENGTH
): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  if (value.length > maxLength) {
    return null;
  }
  return value;
}

export function sanitizeId(value: string): string | null {
  const sanitized = value.toLowerCase().replace(/[^a-z0-9-]/g, '');
  return sanitized.length > 0 ? sanitized : null;
}

export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  const str = String(value);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  const str = String(value);
  // Prevent formula injection by prefixing with single quote if starts with dangerous chars
  const dangerousChars = ['=', '+', '-', '@', '\t', '\r'];
  let escaped = str;
  if (dangerousChars.some(char => str.startsWith(char))) {
    escaped = `'${str}`;
  }
  // Quote and escape if contains special characters
  if (escaped.includes(',') || escaped.includes('"') || escaped.includes('\n') || escaped.includes('\r')) {
    return `"${escaped.replace(/"/g, '""')}"`;
  }
  return escaped;
}

export function validateArray<T>(
  arr: unknown,
  maxSize: number = BOUNDS.MAX_ARRAY_SIZE
): T[] {
  if (!Array.isArray(arr)) {
    return [];
  }
  if (arr.length > maxSize) {
    console.warn(`Array size ${arr.length} exceeds limit ${maxSize}, truncating`);
    return arr.slice(0, maxSize) as T[];
  }
  return [...arr] as T[];
}

export function validateEvidence(evidence: string[], limit: number = 5): string[] {
  const validated = validateArray<string>(evidence, BOUNDS.MAX_EVIDENCE_ITEMS);
  return validated.slice(0, limit);
}

export function isValidDateString(dateString: unknown): boolean {
  if (typeof dateString !== 'string') {
    return false;
  }
  const date = new Date(dateString);
  return !isNaN(date.getTime());
}

export function validateDateRange(range: { start: string; end: string }): boolean {
  if (!isValidDateString(range.start) || !isValidDateString(range.end)) {
    return false;
  }
  const start = new Date(range.start).getTime();
  const end = new Date(range.end).getTime();
  return start <= end && start > 0 && end > 0;
}

export function validateServiceLog(log: unknown): log is ServiceLog {
  if (!log || typeof log !== 'object') {
    return false;
  }

  const l = log as Record<string, unknown>;

  return (
    (typeof l.id === 'number' || typeof l.id === 'string') &&
    typeof l.service_date === 'string' &&
    isValidReading(l.ph) &&
    isValidReading(l.chlorine) &&
    isValidReading(l.alkalinity) &&
    isValidReading(l.stabilizer)
  );
}

export function validateServiceLogs(logs: unknown[]): ServiceLog[] {
  const validated = validateArray<unknown>(logs, BOUNDS.MAX_SERVICE_LOGS);
  return validated.filter(validateServiceLog);
}

export function generateSecureId(prefix: string, ...parts: (string | number)[]): string {
  const sanitizedPrefix = sanitizeId(prefix) || 'id';
  const sanitizedParts = parts.map(p => {
    if (typeof p === 'number') {
      return String(p);
    }
    return sanitizeId(p) || 'unknown';
  });

  return [sanitizedPrefix, ...sanitizedParts, Date.now()].join('-');
}

export function calculateBoundedConfidence(
  baseConfidence: number,
  modifier: number,
  maxConfidence: number = 95
): number {
  const result = baseConfidence + modifier;
  return Math.max(0, Math.min(result, maxConfidence));
}
