/**
 * Validation Module
 * 
 * Centralized input validation and sanitization utilities for the AI Pool Summarizer.
 * Provides security-focused validation to prevent injection attacks, XSS, and data corruption.
 * 
 * Security Requirements:
 * - Validate all external inputs before processing
 * - Sanitize data before rendering in HTML
 * - Enforce reasonable bounds on numeric values
 * - Prevent prototype pollution attacks
 */

import type { ChemicalReading, ServiceLog, CostEstimate } from './types';

// ============================================================================
// Constants - Validation Rules
// ============================================================================

/**
 * Valid chemical names - used to prevent prototype pollution
 */
export const VALID_CHEMICALS = ['ph', 'chlorine', 'alkalinity', 'stabilizer'] as const;
export type ValidChemical = typeof VALID_CHEMICALS[number];

/**
 * Valid chemical readings
 */
export const VALID_READINGS: ChemicalReading[] = ['good', 'low', 'high', 'critical'];

/**
 * Valid recommendation categories
 */
export const VALID_CATEGORIES = ['immediate', 'thisVisit', 'nextVisit', 'longTerm'] as const;

/**
 * Numeric bounds for validation
 */
export const BOUNDS = {
  /** Pool size bounds in gallons */
  POOL_GALLONS: { min: 100, max: 1_000_000 },
  /** Confidence/score bounds (0-100) */
  PERCENTAGE: { min: 0, max: 100 },
  /** Correlation strength bounds (0-1) */
  CORRELATION: { min: 0, max: 1 },
  /** Maximum array size to prevent DoS */
  MAX_ARRAY_SIZE: 10_000,
  /** Maximum string length to prevent memory issues */
  MAX_STRING_LENGTH: 50_000,
  /** Maximum evidence items to store */
  MAX_EVIDENCE_ITEMS: 100,
  /** Maximum service logs to process */
  MAX_SERVICE_LOGS: 10_000,
} as const;

/**
 * Correlation strength threshold for reporting
 */
export const CORRELATION_STRENGTH_THRESHOLD = 0.3;

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard to check if a string is a valid chemical name
 * Prevents prototype pollution by only allowing known chemical names
 */
export function isValidChemical(chemical: unknown): chemical is ValidChemical {
  return typeof chemical === 'string' && VALID_CHEMICALS.includes(chemical as ValidChemical);
}

/**
 * Type guard to check if a string is a valid chemical reading
 */
export function isValidReading(reading: unknown): reading is ChemicalReading {
  return typeof reading === 'string' && VALID_READINGS.includes(reading as ChemicalReading);
}

/**
 * Type guard to check if a string is a valid recommendation category
 */
export function isValidCategory(category: unknown): category is typeof VALID_CATEGORIES[number] {
  return typeof category === 'string' && VALID_CATEGORIES.includes(category as typeof VALID_CATEGORIES[number]);
}

// ============================================================================
// Numeric Validation
// ============================================================================

/**
 * Validates and clamps a number to specified bounds
 * Returns null if the value is not a valid finite number
 */
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

/**
 * Validates pool gallons are within reasonable bounds
 */
export function validatePoolGallons(gallons: unknown): number | null {
  return validateNumeric(gallons, BOUNDS.POOL_GALLONS.min, BOUNDS.POOL_GALLONS.max);
}

/**
 * Validates a percentage value (0-100)
 */
export function validatePercentage(value: unknown): number | null {
  return validateNumeric(value, BOUNDS.PERCENTAGE.min, BOUNDS.PERCENTAGE.max);
}

/**
 * Validates correlation strength (0-1)
 */
export function validateCorrelationStrength(value: unknown): number | null {
  return validateNumeric(value, BOUNDS.CORRELATION.min, BOUNDS.CORRELATION.max);
}

/**
 * Validates that cost projection ranges are properly ordered
 * Also validates that all values are finite and non-negative
 */
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

// ============================================================================
// String Validation & Sanitization
// ============================================================================

/**
 * Validates string length is within bounds
 */
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

/**
 * Sanitizes a string for use as an ID (alphanumeric + hyphens only)
 * Returns null if the result would be empty
 */
export function sanitizeId(value: string): string | null {
  const sanitized = value.toLowerCase().replace(/[^a-z0-9-]/g, '');
  return sanitized.length > 0 ? sanitized : null;
}

/**
 * Escapes HTML special characters to prevent XSS attacks
 */
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

/**
 * Escapes a value for CSV format to prevent CSV injection
 */
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

// ============================================================================
// Array Validation
// ============================================================================

/**
 * Validates array size and truncates if necessary
 * Returns a safe copy of the array
 */
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

/**
 * Validates and limits evidence array
 */
export function validateEvidence(evidence: string[], limit: number = 5): string[] {
  const validated = validateArray<string>(evidence, BOUNDS.MAX_EVIDENCE_ITEMS);
  return validated.slice(0, limit);
}

// ============================================================================
// Date Validation
// ============================================================================

/**
 * Validates a date string is in valid ISO format
 */
export function isValidDateString(dateString: unknown): boolean {
  if (typeof dateString !== 'string') {
    return false;
  }
  const date = new Date(dateString);
  return !isNaN(date.getTime());
}

/**
 * Validates a date range (start <= end)
 */
export function validateDateRange(range: { start: string; end: string }): boolean {
  if (!isValidDateString(range.start) || !isValidDateString(range.end)) {
    return false;
  }
  const start = new Date(range.start).getTime();
  const end = new Date(range.end).getTime();
  return start <= end && start > 0 && end > 0;
}

// ============================================================================
// Service Log Validation
// ============================================================================

/**
 * Validates a single service log entry
 */
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

/**
 * Validates and filters an array of service logs
 * Returns only valid logs, up to the maximum limit
 */
export function validateServiceLogs(logs: unknown[]): ServiceLog[] {
  const validated = validateArray<unknown>(logs, BOUNDS.MAX_SERVICE_LOGS);
  return validated.filter(validateServiceLog);
}

// ============================================================================
// ID Generation
// ============================================================================

/**
 * Generates a secure unique ID with sanitized inputs
 */
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

// ============================================================================
// Confidence Calculation
// ============================================================================

/**
 * Calculates confidence with bounds checking
 * Ensures result is always between 0 and the specified maximum
 */
export function calculateBoundedConfidence(
  baseConfidence: number,
  modifier: number,
  maxConfidence: number = 95
): number {
  const result = baseConfidence + modifier;
  return Math.max(0, Math.min(result, maxConfidence));
}
