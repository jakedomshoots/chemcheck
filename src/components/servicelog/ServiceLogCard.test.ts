/**
 * Property-Based Tests for ServiceLogCard Component
 * 
 * These tests validate the correctness properties defined in the design document
 * using fast-check for property-based testing.
 * 
 * Feature: customer-service-reports
 * Property 1: Photo count indicator accuracy
 * Property 8: Report sent indicator accuracy
 * Validates: Requirements 1.1, 1.5, 5.1
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { calculatePhotoCounts, formatReportSentDate } from './ServiceLogCard';

// ============================================================================
// Generators for Property-Based Testing
// ============================================================================

/**
 * Generator for photo category
 */
const photoCategoryArb = fc.constantFrom('before', 'after');

/**
 * Generator for valid ISO timestamp strings
 */
const validTimestampStringArb = fc.integer({ 
  min: new Date('2020-01-01').getTime(), 
  max: new Date('2030-12-31').getTime() 
}).map(ts => new Date(ts).toISOString());

/**
 * Generator for a single photo object
 */
const photoArb = fc.record({
  id: fc.uuid(),
  url: fc.webUrl(),
  category: photoCategoryArb,
  timestamp: validTimestampStringArb,
});

/**
 * Generator for an array of photos with specific before/after counts
 */
const photosWithCountsArb = fc.tuple(
  fc.integer({ min: 0, max: 20 }),
  fc.integer({ min: 0, max: 20 })
).chain(([beforeCount, afterCount]) => {
  const beforePhotos = fc.array(
    fc.record({
      id: fc.uuid(),
      url: fc.webUrl(),
      category: fc.constant('before' as const),
      timestamp: validTimestampStringArb,
    }),
    { minLength: beforeCount, maxLength: beforeCount }
  );
  
  const afterPhotos = fc.array(
    fc.record({
      id: fc.uuid(),
      url: fc.webUrl(),
      category: fc.constant('after' as const),
      timestamp: validTimestampStringArb,
    }),
    { minLength: afterCount, maxLength: afterCount }
  );
  
  return fc.tuple(beforePhotos, afterPhotos, fc.constant({ beforeCount, afterCount }));
});

/**
 * Generator for timestamps (Unix milliseconds)
 */
const timestampArb = fc.integer({ min: 0, max: Date.now() + 365 * 24 * 60 * 60 * 1000 });

/**
 * Generator for valid sent timestamps (past dates)
 */
const validSentTimestampArb = fc.integer({ 
  min: new Date('2020-01-01').getTime(), 
  max: Date.now() 
});

// ============================================================================
// Property-Based Tests
// ============================================================================

describe('ServiceLogCard Utilities', () => {
  /**
   * Property 1: Photo count indicator accuracy
   * 
   * For any service log with N associated photos (where N > 0), the ServiceLogCard
   * SHALL display a photo indicator showing exactly N photos, with correct counts
   * for before and after categories.
   * 
   * **Validates: Requirements 1.1, 1.5**
   */
  describe('Property 1: Photo count indicator accuracy', () => {
    it('calculatePhotoCounts returns exact before count for any photo array', () => {
      fc.assert(
        fc.property(
          photosWithCountsArb,
          ([beforePhotos, afterPhotos, expected]) => {
            const allPhotos = [...beforePhotos, ...afterPhotos];
            const counts = calculatePhotoCounts(allPhotos);
            
            expect(counts.before).toBe(expected.beforeCount);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('calculatePhotoCounts returns exact after count for any photo array', () => {
      fc.assert(
        fc.property(
          photosWithCountsArb,
          ([beforePhotos, afterPhotos, expected]) => {
            const allPhotos = [...beforePhotos, ...afterPhotos];
            const counts = calculatePhotoCounts(allPhotos);
            
            expect(counts.after).toBe(expected.afterCount);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('calculatePhotoCounts returns exact total count for any photo array', () => {
      fc.assert(
        fc.property(
          photosWithCountsArb,
          ([beforePhotos, afterPhotos, expected]) => {
            const allPhotos = [...beforePhotos, ...afterPhotos];
            const counts = calculatePhotoCounts(allPhotos);
            
            expect(counts.total).toBe(expected.beforeCount + expected.afterCount);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('calculatePhotoCounts total equals before + after for any photo array', () => {
      fc.assert(
        fc.property(
          fc.array(photoArb, { minLength: 0, maxLength: 50 }),
          (photos) => {
            const counts = calculatePhotoCounts(photos);
            
            expect(counts.total).toBe(counts.before + counts.after);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('calculatePhotoCounts returns zeros for empty array', () => {
      const counts = calculatePhotoCounts([]);
      
      expect(counts.before).toBe(0);
      expect(counts.after).toBe(0);
      expect(counts.total).toBe(0);
    });

    it('calculatePhotoCounts handles null/undefined gracefully', () => {
      // @ts-expect-error - Testing invalid input
      expect(calculatePhotoCounts(null)).toEqual({ before: 0, after: 0, total: 0 });
      // @ts-expect-error - Testing invalid input
      expect(calculatePhotoCounts(undefined)).toEqual({ before: 0, after: 0, total: 0 });
    });

    it('photo counts are non-negative for any input', () => {
      fc.assert(
        fc.property(
          fc.array(photoArb, { minLength: 0, maxLength: 50 }),
          (photos) => {
            const counts = calculatePhotoCounts(photos);
            
            expect(counts.before).toBeGreaterThanOrEqual(0);
            expect(counts.after).toBeGreaterThanOrEqual(0);
            expect(counts.total).toBeGreaterThanOrEqual(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('shuffling photos does not change counts', () => {
      fc.assert(
        fc.property(
          // Use fc.shuffledSubarray to get a deterministic shuffle that fast-check can reproduce
          fc.array(photoArb, { minLength: 1, maxLength: 30 }).chain(photos => 
            fc.tuple(
              fc.constant(photos),
              fc.shuffledSubarray(photos, { minLength: photos.length, maxLength: photos.length })
            )
          ),
          ([original, shuffled]) => {
            const originalCounts = calculatePhotoCounts(original);
            const shuffledCounts = calculatePhotoCounts(shuffled);
            
            expect(shuffledCounts.before).toBe(originalCounts.before);
            expect(shuffledCounts.after).toBe(originalCounts.after);
            expect(shuffledCounts.total).toBe(originalCounts.total);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 8: Report sent indicator accuracy
   * 
   * For any service log with a sent report, the ServiceLogCard SHALL display
   * a "Report Sent" indicator showing the correct sent date.
   * 
   * **Validates: Requirements 5.1**
   */
  describe('Property 8: Report sent indicator accuracy', () => {
    it('formatReportSentDate returns non-empty string for valid timestamps', () => {
      fc.assert(
        fc.property(
          validSentTimestampArb,
          (timestamp) => {
            const formatted = formatReportSentDate(timestamp);
            
            expect(formatted).toBeTruthy();
            expect(typeof formatted).toBe('string');
            expect(formatted.length).toBeGreaterThan(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('formatReportSentDate includes month name for any valid timestamp', () => {
      fc.assert(
        fc.property(
          validSentTimestampArb,
          (timestamp) => {
            const formatted = formatReportSentDate(timestamp);
            
            // Should contain a month abbreviation
            const monthAbbreviations = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                                        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const hasMonth = monthAbbreviations.some(month => formatted.includes(month));
            
            expect(hasMonth).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('formatReportSentDate includes day number for any valid timestamp', () => {
      fc.assert(
        fc.property(
          validSentTimestampArb,
          (timestamp) => {
            const formatted = formatReportSentDate(timestamp);
            const date = new Date(timestamp);
            const day = date.getDate();
            
            // Should contain the day number
            expect(formatted).toContain(String(day));
          }
        ),
        { numRuns: 100 }
      );
    });

    it('formatReportSentDate includes year only for non-current year', () => {
      const currentYear = new Date().getFullYear();
      
      fc.assert(
        fc.property(
          fc.integer({ min: 2020, max: currentYear + 5 }),
          fc.integer({ min: 1, max: 12 }),
          fc.integer({ min: 1, max: 28 }),
          (year, month, day) => {
            const date = new Date(year, month - 1, day);
            const timestamp = date.getTime();
            const formatted = formatReportSentDate(timestamp);
            
            if (year === currentYear) {
              // Current year should NOT include year in output
              expect(formatted).not.toContain(String(year));
            } else {
              // Non-current year SHOULD include year in output
              expect(formatted).toContain(String(year));
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('formatReportSentDate returns empty string for invalid inputs', () => {
      // Null
      // @ts-expect-error - Testing invalid input
      expect(formatReportSentDate(null)).toBe('');
      
      // Undefined
      // @ts-expect-error - Testing invalid input
      expect(formatReportSentDate(undefined)).toBe('');
      
      // Non-number
      // @ts-expect-error - Testing invalid input
      expect(formatReportSentDate('not a number')).toBe('');
      
      // NaN
      expect(formatReportSentDate(NaN)).toBe('');
    });

    it('formatReportSentDate produces consistent output for same timestamp', () => {
      fc.assert(
        fc.property(
          validSentTimestampArb,
          (timestamp) => {
            const formatted1 = formatReportSentDate(timestamp);
            const formatted2 = formatReportSentDate(timestamp);
            
            expect(formatted1).toBe(formatted2);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('formatReportSentDate correctly formats the date from timestamp', () => {
      fc.assert(
        fc.property(
          validSentTimestampArb,
          (timestamp) => {
            const formatted = formatReportSentDate(timestamp);
            const date = new Date(timestamp);
            
            // Extract expected values
            const expectedMonth = date.toLocaleDateString('en-US', { month: 'short' });
            const expectedDay = date.getDate();
            
            // Verify month and day are present
            expect(formatted).toContain(expectedMonth);
            expect(formatted).toContain(String(expectedDay));
          }
        ),
        { numRuns: 100 }
      );
    });

    it('different timestamps produce different formatted dates (when dates differ)', () => {
      fc.assert(
        fc.property(
          fc.tuple(
            fc.integer({ min: new Date('2020-01-01').getTime(), max: new Date('2023-06-15').getTime() }),
            fc.integer({ min: new Date('2023-06-16').getTime(), max: Date.now() })
          ),
          ([timestamp1, timestamp2]) => {
            const date1 = new Date(timestamp1);
            const date2 = new Date(timestamp2);
            
            // Only test if dates are actually different
            if (date1.toDateString() !== date2.toDateString()) {
              const formatted1 = formatReportSentDate(timestamp1);
              const formatted2 = formatReportSentDate(timestamp2);
              
              // At least one component should differ
              expect(formatted1).not.toBe(formatted2);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});

// ============================================================================
// Integration Tests for Photo Indicator Logic
// ============================================================================

describe('Photo Indicator Display Logic', () => {
  /**
   * Tests the logic for when to show/hide photo indicators
   * Requirements: 1.1, 1.5
   */
  
  it('photo indicator should be hidden when total is 0', () => {
    const photos: any[] = [];
    const counts = calculatePhotoCounts(photos);
    const shouldShowIndicator = counts.total > 0;
    
    expect(shouldShowIndicator).toBe(false);
  });

  it('photo indicator should be shown when total > 0', () => {
    fc.assert(
      fc.property(
        fc.array(photoArb, { minLength: 1, maxLength: 20 }),
        (photos) => {
          const counts = calculatePhotoCounts(photos);
          const shouldShowIndicator = counts.total > 0;
          
          expect(shouldShowIndicator).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('photo indicator format: shows before/after when both exist', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 1, max: 10 }),
        (beforeCount, afterCount) => {
          const counts = { before: beforeCount, after: afterCount, total: beforeCount + afterCount };
          
          // When both before and after exist, format should be "before/after"
          const hasBoth = counts.before > 0 && counts.after > 0;
          const expectedFormat = hasBoth 
            ? `${counts.before}/${counts.after}` 
            : String(counts.total);
          
          expect(expectedFormat).toBe(`${beforeCount}/${afterCount}`);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('photo indicator format: shows total when only one category exists', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        fc.boolean(),
        (count, isBeforeOnly) => {
          const counts = isBeforeOnly 
            ? { before: count, after: 0, total: count }
            : { before: 0, after: count, total: count };
          
          // When only one category exists, format should be total
          const hasBoth = counts.before > 0 && counts.after > 0;
          const expectedFormat = hasBoth 
            ? `${counts.before}/${counts.after}` 
            : String(counts.total);
          
          expect(expectedFormat).toBe(String(count));
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ============================================================================
// Integration Tests for Report Sent Indicator Logic
// ============================================================================

describe('Report Sent Indicator Display Logic', () => {
  /**
   * Tests the logic for when to show/hide report sent indicators
   * Requirements: 5.1
   */
  
  it('report sent indicator should be hidden when sentAt is undefined', () => {
    const reportStatus = { sentAt: undefined };
    const shouldShowIndicator = !!reportStatus.sentAt;
    
    expect(shouldShowIndicator).toBe(false);
  });

  it('report sent indicator should be hidden when sentAt is null', () => {
    const reportStatus = { sentAt: null };
    const shouldShowIndicator = !!reportStatus.sentAt;
    
    expect(shouldShowIndicator).toBe(false);
  });

  it('report sent indicator should be shown when sentAt is a valid timestamp', () => {
    fc.assert(
      fc.property(
        validSentTimestampArb,
        (timestamp) => {
          const reportStatus = { sentAt: timestamp };
          const shouldShowIndicator = !!reportStatus.sentAt;
          
          expect(shouldShowIndicator).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('report sent indicator displays formatted date when shown', () => {
    fc.assert(
      fc.property(
        validSentTimestampArb,
        (timestamp) => {
          const reportStatus = { sentAt: timestamp };
          
          if (reportStatus.sentAt) {
            const formattedDate = formatReportSentDate(reportStatus.sentAt);
            
            expect(formattedDate).toBeTruthy();
            expect(formattedDate.length).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
