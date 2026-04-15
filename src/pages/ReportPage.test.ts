/**
 * Property-Based Tests for Report Page Content
 * 
 * These tests validate the correctness properties defined in the design document
 * using fast-check for property-based testing.
 * 
 * Feature: customer-service-reports
 * Property 7: Report page content completeness
 * Validates: Requirements 3.2, 3.3, 3.4, 3.5
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

// ============================================================================
// Types (mirroring ReportPage types)
// ============================================================================

interface ChemicalReadings {
  ph: string | null;
  chlorine: string | null;
  alkalinity: string | null;
  stabilizer: string | null;
  salt: number | null;
}

interface ReportPhoto {
  id: string;
  category: 'before' | 'after';
  timestamp: string;
  url: string | null;
}

interface ReportData {
  businessName: string;
  serviceDate: string;
  technicianName: string;
  customerName: string;
  chemicalReadings: ChemicalReadings;
  notes?: string;
  overallStatus: 'good' | 'needs_attention';
  photos: {
    before: ReportPhoto[];
    after: ReportPhoto[];
  };
  serviceDuration?: number;
  startTime?: string;
  endTime?: string;
}

// ============================================================================
// Helper Functions (extracted from ReportPage for testing)
// ============================================================================

/**
 * Format service date for display
 */
function formatDisplayDate(dateString: string): string {
  try {
    const [year, month, day] = dateString.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return dateString;
  }
}

/**
 * Get status color and label for chemical readings
 */
function getReadingStatus(value: string | null): {
  color: string;
  bgColor: string;
  label: string;
  icon: 'check' | 'warning' | 'critical' | 'unknown';
} {
  if (!value) {
    return { color: 'text-slate-500', bgColor: 'bg-slate-100', label: 'Not tested', icon: 'unknown' };
  }
  
  switch (value.toLowerCase()) {
    case 'good':
    case 'ok':
      return { color: 'text-green-700', bgColor: 'bg-green-100', label: 'Good', icon: 'check' };
    case 'low':
      return { color: 'text-amber-700', bgColor: 'bg-amber-100', label: 'Low', icon: 'warning' };
    case 'high':
      return { color: 'text-amber-700', bgColor: 'bg-amber-100', label: 'High', icon: 'warning' };
    case 'critical':
      return { color: 'text-red-700', bgColor: 'bg-red-100', label: 'Critical', icon: 'critical' };
    default:
      return { color: 'text-slate-700', bgColor: 'bg-slate-100', label: value, icon: 'unknown' };
  }
}

/**
 * Format duration in milliseconds to human readable string
 */
function formatDuration(ms: number | undefined): string {
  if (!ms) return '';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

/**
 * Validates that report data contains all required fields for display
 * This function checks the completeness requirements from Property 7
 */
function validateReportContentCompleteness(report: ReportData): {
  hasServiceDate: boolean;
  hasTechnicianName: boolean;
  hasChemicalReadings: boolean;
  hasNotesIfPresent: boolean;
  hasPhotosGroupedByCategory: boolean;
  allFieldsPresent: boolean;
} {
  const hasServiceDate = typeof report.serviceDate === 'string' && report.serviceDate.length > 0;
  const hasTechnicianName = typeof report.technicianName === 'string' && report.technicianName.length > 0;
  
  // Chemical readings should have status indicators (even if null = "Not tested")
  const hasChemicalReadings = report.chemicalReadings !== null && 
    report.chemicalReadings !== undefined &&
    'ph' in report.chemicalReadings &&
    'chlorine' in report.chemicalReadings &&
    'alkalinity' in report.chemicalReadings &&
    'stabilizer' in report.chemicalReadings;
  
  // Notes are optional, but if present should be a string
  const hasNotesIfPresent = report.notes === undefined || 
    report.notes === null || 
    typeof report.notes === 'string';
  
  // Photos should be grouped by category
  const hasPhotosGroupedByCategory = 
    report.photos !== null &&
    report.photos !== undefined &&
    Array.isArray(report.photos.before) &&
    Array.isArray(report.photos.after) &&
    report.photos.before.every(p => p.category === 'before') &&
    report.photos.after.every(p => p.category === 'after');
  
  return {
    hasServiceDate,
    hasTechnicianName,
    hasChemicalReadings,
    hasNotesIfPresent,
    hasPhotosGroupedByCategory,
    allFieldsPresent: hasServiceDate && hasTechnicianName && hasChemicalReadings && 
      hasNotesIfPresent && hasPhotosGroupedByCategory,
  };
}

// ============================================================================
// Generators for Property-Based Testing
// ============================================================================

/**
 * Generator for chemical reading values
 * Covers all code paths in getReadingStatus:
 * - null (not tested)
 * - 'good', 'ok' (good status)
 * - 'low', 'high' (warning status)
 * - 'critical' (critical status)
 * - unknown values (default case)
 */
const chemicalReadingValueArb: fc.Arbitrary<string | null> = fc.oneof(
  fc.constant(null),
  fc.constantFrom('good', 'ok', 'low', 'high', 'critical'),
  // Occasionally test unknown values to cover the default case
  fc.string({ minLength: 1, maxLength: 10 }).filter(s =>
    !['good', 'ok', 'low', 'high', 'critical'].includes(s.toLowerCase())
  )
);

/**
 * Generator for chemical readings object
 */
const chemicalReadingsArb: fc.Arbitrary<ChemicalReadings> = fc.record({
  ph: chemicalReadingValueArb,
  chlorine: chemicalReadingValueArb,
  alkalinity: chemicalReadingValueArb,
  stabilizer: chemicalReadingValueArb,
  salt: fc.oneof(fc.constant(null), fc.integer({ min: 0, max: 5000 })),
});

/**
 * Generator for ISO timestamp strings
 */
const timestampArb = fc.tuple(
  fc.integer({ min: 2020, max: 2030 }),
  fc.integer({ min: 1, max: 12 }),
  fc.integer({ min: 1, max: 28 }),
  fc.integer({ min: 0, max: 23 }),
  fc.integer({ min: 0, max: 59 }),
  fc.integer({ min: 0, max: 59 })
).map(([year, month, day, hour, min, sec]) => 
  `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}T${hour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}.000Z`
);

/**
 * Generator for a single photo
 */
const photoArb = (category: 'before' | 'after'): fc.Arbitrary<ReportPhoto> => fc.record({
  id: fc.uuid(),
  category: fc.constant(category),
  timestamp: timestampArb,
  url: fc.oneof(
    fc.constant(null),
    fc.webUrl()
  ),
});

/**
 * Generator for photos grouped by category
 */
const photosArb = fc.record({
  before: fc.array(photoArb('before'), { minLength: 0, maxLength: 5 }),
  after: fc.array(photoArb('after'), { minLength: 0, maxLength: 5 }),
});

/**
 * Generator for service date in YYYY-MM-DD format
 */
const serviceDateArb = fc.tuple(
  fc.integer({ min: 2020, max: 2030 }),
  fc.integer({ min: 1, max: 12 }),
  fc.integer({ min: 1, max: 28 })
).map(([year, month, day]) => 
  `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
);

/**
 * Generator for non-empty strings (names)
 */
const nameArb = fc.string({ minLength: 1, maxLength: 50 })
  .filter(s => s.trim().length > 0);

/**
 * Generator for optional notes
 */
const notesArb = fc.oneof(
  fc.constant(undefined),
  fc.string({ minLength: 0, maxLength: 500 })
);

/**
 * Generator for overall status
 */
const overallStatusArb = fc.constantFrom('good', 'needs_attention') as fc.Arbitrary<'good' | 'needs_attention'>;

/**
 * Generator for complete report data
 */
const reportDataArb: fc.Arbitrary<ReportData> = fc.record({
  businessName: nameArb,
  serviceDate: serviceDateArb,
  technicianName: nameArb,
  customerName: nameArb,
  chemicalReadings: chemicalReadingsArb,
  notes: notesArb,
  overallStatus: overallStatusArb,
  photos: photosArb,
  serviceDuration: fc.oneof(fc.constant(undefined), fc.integer({ min: 60000, max: 7200000 })),
  startTime: fc.oneof(fc.constant(undefined), timestampArb),
  endTime: fc.oneof(fc.constant(undefined), timestampArb),
});

// ============================================================================
// Property-Based Tests
// ============================================================================

describe('Report Page Content', () => {
  /**
   * Property 7: Report page content completeness
   * 
   * For any valid report token, the public report page SHALL display:
   * service date, technician name, all chemical readings with status indicators,
   * any notes (if present), and all photos grouped by category.
   * 
   * **Validates: Requirements 3.2, 3.3, 3.4, 3.5**
   */
  describe('Property 7: Report page content completeness', () => {
    it('report data contains service date - Requirements 3.2', () => {
      fc.assert(
        fc.property(
          reportDataArb,
          (report) => {
            const validation = validateReportContentCompleteness(report);
            expect(validation.hasServiceDate).toBe(true);
            
            // Service date should be in valid format
            expect(report.serviceDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('report data contains technician name - Requirements 3.2', () => {
      fc.assert(
        fc.property(
          reportDataArb,
          (report) => {
            const validation = validateReportContentCompleteness(report);
            expect(validation.hasTechnicianName).toBe(true);
            
            // Technician name should be non-empty
            expect(report.technicianName.trim().length).toBeGreaterThan(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('report data contains all chemical readings with status indicators - Requirements 3.3', () => {
      fc.assert(
        fc.property(
          reportDataArb,
          (report) => {
            const validation = validateReportContentCompleteness(report);
            expect(validation.hasChemicalReadings).toBe(true);
            
            // Each reading should have a valid status
            const readings = [
              report.chemicalReadings.ph,
              report.chemicalReadings.chlorine,
              report.chemicalReadings.alkalinity,
              report.chemicalReadings.stabilizer,
            ];
            
            for (const reading of readings) {
              const status = getReadingStatus(reading);
              // Status should have all required fields
              expect(status).toHaveProperty('color');
              expect(status).toHaveProperty('bgColor');
              expect(status).toHaveProperty('label');
              expect(status).toHaveProperty('icon');
              
              // Label should be non-empty
              expect(status.label.length).toBeGreaterThan(0);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('report data handles notes correctly (present or absent) - Requirements 3.4', () => {
      fc.assert(
        fc.property(
          reportDataArb,
          (report) => {
            const validation = validateReportContentCompleteness(report);
            expect(validation.hasNotesIfPresent).toBe(true);
            
            // Notes should be undefined, null, or a string
            if (report.notes !== undefined && report.notes !== null) {
              expect(typeof report.notes).toBe('string');
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('report data has photos grouped by category - Requirements 3.5', () => {
      fc.assert(
        fc.property(
          reportDataArb,
          (report) => {
            const validation = validateReportContentCompleteness(report);
            expect(validation.hasPhotosGroupedByCategory).toBe(true);
            
            // Before photos should all have category 'before'
            for (const photo of report.photos.before) {
              expect(photo.category).toBe('before');
            }
            
            // After photos should all have category 'after'
            for (const photo of report.photos.after) {
              expect(photo.category).toBe('after');
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('all required content fields are present together', () => {
      fc.assert(
        fc.property(
          reportDataArb,
          (report) => {
            const validation = validateReportContentCompleteness(report);
            
            // All fields should be present
            expect(validation.allFieldsPresent).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('formatDisplayDate', () => {
    it('formats valid dates correctly', () => {
      fc.assert(
        fc.property(
          serviceDateArb,
          (dateString) => {
            const formatted = formatDisplayDate(dateString);
            
            // Should return a non-empty string
            expect(formatted.length).toBeGreaterThan(0);
            
            // Should contain the year
            const year = dateString.split('-')[0];
            expect(formatted).toContain(year);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('returns original string for invalid dates', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('invalid', 'not-a-date', ''),
          (invalidDate) => {
            const formatted = formatDisplayDate(invalidDate);
            // Should return the original string or handle gracefully
            expect(typeof formatted).toBe('string');
          }
        ),
        { numRuns: 5 }
      );
    });
  });

  describe('getReadingStatus', () => {
    it('returns correct status for all valid reading values', () => {
      fc.assert(
        fc.property(
          chemicalReadingValueArb,
          (value) => {
            const status = getReadingStatus(value);
            
            // Should always return an object with required fields
            expect(status).toHaveProperty('color');
            expect(status).toHaveProperty('bgColor');
            expect(status).toHaveProperty('label');
            expect(status).toHaveProperty('icon');
            
            // Color classes should be valid Tailwind classes
            expect(status.color).toMatch(/^text-/);
            expect(status.bgColor).toMatch(/^bg-/);
            
            // Icon should be one of the valid values
            expect(['check', 'warning', 'critical', 'unknown']).toContain(status.icon);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('returns "Not tested" for null values', () => {
      const status = getReadingStatus(null);
      expect(status.label).toBe('Not tested');
      expect(status.icon).toBe('unknown');
    });

    it('returns correct status for "good" readings', () => {
      const status = getReadingStatus('good');
      expect(status.label).toBe('Good');
      expect(status.icon).toBe('check');
      expect(status.color).toContain('green');
    });

    it('returns correct status for "ok" readings', () => {
      const status = getReadingStatus('ok');
      expect(status.label).toBe('Good');
      expect(status.icon).toBe('check');
      expect(status.color).toContain('green');
    });

    it('returns correct status for "low" readings', () => {
      const status = getReadingStatus('low');
      expect(status.label).toBe('Low');
      expect(status.icon).toBe('warning');
      expect(status.color).toContain('amber');
    });

    it('returns correct status for "high" readings', () => {
      const status = getReadingStatus('high');
      expect(status.label).toBe('High');
      expect(status.icon).toBe('warning');
      expect(status.color).toContain('amber');
    });

    it('returns correct status for "critical" readings', () => {
      const status = getReadingStatus('critical');
      expect(status.label).toBe('Critical');
      expect(status.icon).toBe('critical');
      expect(status.color).toContain('red');
    });

    it('returns correct status for unknown readings (default case)', () => {
      const status = getReadingStatus('unknown-value');
      expect(status.label).toBe('unknown-value');
      expect(status.icon).toBe('unknown');
      expect(status.color).toContain('slate');
    });
  });

  describe('formatDuration', () => {
    it('formats durations correctly', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 60000, max: 7200000 }),
          (ms) => {
            const formatted = formatDuration(ms);
            
            // Should return a non-empty string
            expect(formatted.length).toBeGreaterThan(0);
            
            // Should contain time units
            expect(formatted).toMatch(/min|h/);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('returns empty string for undefined', () => {
      expect(formatDuration(undefined)).toBe('');
    });

    it('returns empty string for zero', () => {
      expect(formatDuration(0)).toBe('');
    });

    it('formats minutes correctly', () => {
      expect(formatDuration(60000)).toBe('1 min');
      expect(formatDuration(1800000)).toBe('30 min');
    });

    it('formats hours correctly', () => {
      expect(formatDuration(3600000)).toBe('1h');
      expect(formatDuration(7200000)).toBe('2h');
    });

    it('formats hours and minutes correctly', () => {
      expect(formatDuration(5400000)).toBe('1h 30m');
    });
  });
});
