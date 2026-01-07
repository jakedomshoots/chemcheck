/**
 * Property-Based Tests for Proof-of-Service Filtering
 * 
 * These tests validate the correctness properties defined in the design document
 * using fast-check for property-based testing.
 * 
 * Feature: proof-of-service
 * Property 9: Proof-of-Service Filter Accuracy
 * Validates: Requirements 4.4
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  filterByProofOfService,
  hasPhotos,
  hasTimeTracking,
  hasCompleteProof,
  hasIncompleteProof,
  getFilterCounts,
  validateFilterResult,
  PROOF_OF_SERVICE_FILTER_OPTIONS,
  type ProofOfServiceFilterType,
} from './proofOfServiceFilter';
import { type ServiceLogData } from './serviceSummary';

// ============================================================================
// Generators for Property-Based Testing
// ============================================================================

/**
 * Generator for valid chemical level values
 */
const chemicalLevelArb = fc.constantFrom('low', 'good', 'high', 'critical');

/**
 * Generator for valid ISO 8601 timestamps
 */
const timestampArb = fc.integer({
  min: new Date('2020-01-01').getTime(),
  max: new Date('2030-12-31').getTime(),
}).map(ms => new Date(ms).toISOString());

/**
 * Generator for service dates (YYYY-MM-DD format)
 */
const serviceDateArb = fc.integer({
  min: new Date('2020-01-01').getTime(),
  max: new Date('2030-12-31').getTime(),
}).map(ms => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
});

/**
 * Generator for valid service log IDs
 */
const serviceLogIdArb = fc.string({ minLength: 10, maxLength: 30 });

/**
 * Generator for valid customer IDs
 */
const customerIdArb = fc.string({ minLength: 10, maxLength: 30 });

/**
 * Generator for service status
 */
const statusArb = fc.constantFrom('completed', 'pending', 'in_progress');

/**
 * Generator for optional notes
 */
const notesArb = fc.option(fc.string({ minLength: 1, maxLength: 500 }), { nil: undefined });

/**
 * Generator for optional salt value
 */
const saltArb = fc.option(fc.integer({ min: 0, max: 10000 }), { nil: undefined });

/**
 * Generator for photo count
 */
const photoCountArb = fc.integer({ min: 0, max: 20 });

/**
 * Generator for duration in milliseconds (0 to 4 hours)
 */
const durationMsArb = fc.integer({ min: 0, max: 4 * 60 * 60 * 1000 });

/**
 * Generator for filter types
 */
const filterTypeArb: fc.Arbitrary<ProofOfServiceFilterType> = fc.constantFrom(
  'all', 'has_photos', 'has_time', 'complete', 'incomplete'
);

/**
 * Generator for ServiceLogData with random proof-of-service fields
 */
const serviceLogDataArb: fc.Arbitrary<ServiceLogData> = fc.record({
  _id: serviceLogIdArb,
  customer_id: customerIdArb,
  service_date: serviceDateArb,
  status: statusArb,
  notes: notesArb,
  ph: chemicalLevelArb,
  chlorine: chemicalLevelArb,
  alkalinity: chemicalLevelArb,
  stabilizer: chemicalLevelArb,
  salt: saltArb,
  start_time: fc.option(timestampArb, { nil: undefined }),
  end_time: fc.option(timestampArb, { nil: undefined }),
  duration_ms: fc.option(durationMsArb, { nil: undefined }),
  photo_count: fc.option(photoCountArb, { nil: undefined }),
  has_before_photos: fc.option(fc.boolean(), { nil: undefined }),
  has_after_photos: fc.option(fc.boolean(), { nil: undefined }),
});

/**
 * Generator for ServiceLogData with photos (photo_count > 0)
 */
const serviceLogWithPhotosArb: fc.Arbitrary<ServiceLogData> = serviceLogDataArb.map(log => ({
  ...log,
  photo_count: Math.max(1, log.photo_count ?? 1),
}));

/**
 * Generator for ServiceLogData without photos (photo_count = 0)
 */
const serviceLogWithoutPhotosArb: fc.Arbitrary<ServiceLogData> = serviceLogDataArb.map(log => ({
  ...log,
  photo_count: 0,
}));

/**
 * Generator for ServiceLogData with time tracking (both start and end time)
 */
const serviceLogWithTimeArb: fc.Arbitrary<ServiceLogData> = fc.tuple(
  serviceLogDataArb,
  timestampArb,
  timestampArb
).map(([log, start, end]) => ({
  ...log,
  start_time: start,
  end_time: end,
}));

/**
 * Generator for ServiceLogData without time tracking
 */
const serviceLogWithoutTimeArb: fc.Arbitrary<ServiceLogData> = serviceLogDataArb.map(log => ({
  ...log,
  start_time: undefined,
  end_time: undefined,
}));

/**
 * Generator for ServiceLogData with complete proof (photos AND time)
 */
const serviceLogCompleteProofArb: fc.Arbitrary<ServiceLogData> = fc.tuple(
  serviceLogDataArb,
  timestampArb,
  timestampArb,
  fc.integer({ min: 1, max: 20 })
).map(([log, start, end, photoCount]) => ({
  ...log,
  start_time: start,
  end_time: end,
  photo_count: photoCount,
}));

/**
 * Generator for array of service logs
 */
const serviceLogArrayArb = fc.array(serviceLogDataArb, { minLength: 0, maxLength: 50 });

// ============================================================================
// Property-Based Tests
// ============================================================================

describe('Proof-of-Service Filter', () => {
  /**
   * Property 9: Proof-of-Service Filter Accuracy
   * 
   * For any filter query on service logs by proof-of-service completeness,
   * the returned logs SHALL match the filter criteria (has photos, has time tracking).
   * 
   * **Validates: Requirements 4.4**
   */
  describe('Property 9: Proof-of-Service Filter Accuracy', () => {
    it('all filtered results match the applied filter criteria', () => {
      fc.assert(
        fc.property(
          serviceLogArrayArb,
          filterTypeArb,
          (logs, filterType) => {
            const filtered = filterByProofOfService(logs, filterType);
            
            // Every result must match the filter criteria
            for (const log of filtered) {
              expect(validateFilterResult(log, filterType)).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('filter "all" returns all logs unchanged', () => {
      fc.assert(
        fc.property(
          serviceLogArrayArb,
          (logs) => {
            const filtered = filterByProofOfService(logs, 'all');
            
            expect(filtered.length).toBe(logs.length);
            expect(filtered).toEqual(logs);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('filter "has_photos" returns only logs with photo_count > 0', () => {
      fc.assert(
        fc.property(
          serviceLogArrayArb,
          (logs) => {
            const filtered = filterByProofOfService(logs, 'has_photos');
            
            // All results must have photos
            for (const log of filtered) {
              expect(hasPhotos(log)).toBe(true);
              expect((log.photo_count ?? 0) > 0).toBe(true);
            }
            
            // No logs with photos should be excluded
            const logsWithPhotos = logs.filter(l => (l.photo_count ?? 0) > 0);
            expect(filtered.length).toBe(logsWithPhotos.length);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('filter "has_time" returns only logs with start_time AND end_time', () => {
      fc.assert(
        fc.property(
          serviceLogArrayArb,
          (logs) => {
            const filtered = filterByProofOfService(logs, 'has_time');
            
            // All results must have time tracking
            for (const log of filtered) {
              expect(hasTimeTracking(log)).toBe(true);
              expect(log.start_time).toBeDefined();
              expect(log.end_time).toBeDefined();
            }
            
            // No logs with time tracking should be excluded
            const logsWithTime = logs.filter(l => !!(l.start_time && l.end_time));
            expect(filtered.length).toBe(logsWithTime.length);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('filter "complete" returns only logs with BOTH photos AND time tracking', () => {
      fc.assert(
        fc.property(
          serviceLogArrayArb,
          (logs) => {
            const filtered = filterByProofOfService(logs, 'complete');
            
            // All results must have complete proof
            for (const log of filtered) {
              expect(hasCompleteProof(log)).toBe(true);
              expect(hasPhotos(log)).toBe(true);
              expect(hasTimeTracking(log)).toBe(true);
            }
            
            // No complete logs should be excluded
            const completeLogs = logs.filter(l => 
              (l.photo_count ?? 0) > 0 && !!(l.start_time && l.end_time)
            );
            expect(filtered.length).toBe(completeLogs.length);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('filter "incomplete" returns only logs missing photos OR time tracking', () => {
      fc.assert(
        fc.property(
          serviceLogArrayArb,
          (logs) => {
            const filtered = filterByProofOfService(logs, 'incomplete');
            
            // All results must have incomplete proof
            for (const log of filtered) {
              expect(hasIncompleteProof(log)).toBe(true);
              // At least one of photos or time tracking must be missing
              const missingPhotos = (log.photo_count ?? 0) === 0;
              const missingTime = !(log.start_time && log.end_time);
              expect(missingPhotos || missingTime).toBe(true);
            }
            
            // No incomplete logs should be excluded
            const incompleteLogs = logs.filter(l => 
              (l.photo_count ?? 0) === 0 || !(l.start_time && l.end_time)
            );
            expect(filtered.length).toBe(incompleteLogs.length);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('complete and incomplete filters are mutually exclusive and exhaustive', () => {
      fc.assert(
        fc.property(
          serviceLogArrayArb,
          (logs) => {
            const complete = filterByProofOfService(logs, 'complete');
            const incomplete = filterByProofOfService(logs, 'incomplete');
            
            // No overlap between complete and incomplete
            const completeIds = new Set(complete.map(l => l._id));
            const incompleteIds = new Set(incomplete.map(l => l._id));
            
            for (const id of completeIds) {
              expect(incompleteIds.has(id)).toBe(false);
            }
            
            // Together they should cover all logs
            expect(complete.length + incomplete.length).toBe(logs.length);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('filtered results are a subset of original logs', () => {
      fc.assert(
        fc.property(
          serviceLogArrayArb,
          filterTypeArb,
          (logs, filterType) => {
            const filtered = filterByProofOfService(logs, filterType);
            
            // Filtered count should never exceed original count
            expect(filtered.length).toBeLessThanOrEqual(logs.length);
            
            // All filtered logs should exist in original
            const originalIds = new Set(logs.map(l => l._id));
            for (const log of filtered) {
              expect(originalIds.has(log._id)).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('filter preserves log order', () => {
      fc.assert(
        fc.property(
          serviceLogArrayArb,
          filterTypeArb,
          (logs, filterType) => {
            const filtered = filterByProofOfService(logs, filterType);
            
            // Check that relative order is preserved
            let lastIndex = -1;
            for (const filteredLog of filtered) {
              const currentIndex = logs.findIndex(l => l._id === filteredLog._id);
              expect(currentIndex).toBeGreaterThan(lastIndex);
              lastIndex = currentIndex;
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Filter Predicate Functions', () => {
    it('hasPhotos returns true only when photo_count > 0', () => {
      fc.assert(
        fc.property(
          serviceLogDataArb,
          (log) => {
            const result = hasPhotos(log);
            const expected = (log.photo_count ?? 0) > 0;
            expect(result).toBe(expected);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('hasTimeTracking returns true only when both start_time and end_time exist', () => {
      fc.assert(
        fc.property(
          serviceLogDataArb,
          (log) => {
            const result = hasTimeTracking(log);
            const expected = !!(log.start_time && log.end_time);
            expect(result).toBe(expected);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('hasCompleteProof equals hasPhotos AND hasTimeTracking', () => {
      fc.assert(
        fc.property(
          serviceLogDataArb,
          (log) => {
            const result = hasCompleteProof(log);
            const expected = hasPhotos(log) && hasTimeTracking(log);
            expect(result).toBe(expected);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('hasIncompleteProof is the negation of hasCompleteProof', () => {
      fc.assert(
        fc.property(
          serviceLogDataArb,
          (log) => {
            const incomplete = hasIncompleteProof(log);
            const complete = hasCompleteProof(log);
            expect(incomplete).toBe(!complete);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Filter Counts', () => {
    it('getFilterCounts returns correct counts for all filter types', () => {
      fc.assert(
        fc.property(
          serviceLogArrayArb,
          (logs) => {
            const counts = getFilterCounts(logs);
            
            // Verify each count matches actual filter result
            expect(counts.all).toBe(logs.length);
            expect(counts.has_photos).toBe(filterByProofOfService(logs, 'has_photos').length);
            expect(counts.has_time).toBe(filterByProofOfService(logs, 'has_time').length);
            expect(counts.complete).toBe(filterByProofOfService(logs, 'complete').length);
            expect(counts.incomplete).toBe(filterByProofOfService(logs, 'incomplete').length);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('complete + incomplete counts equal total count', () => {
      fc.assert(
        fc.property(
          serviceLogArrayArb,
          (logs) => {
            const counts = getFilterCounts(logs);
            expect(counts.complete + counts.incomplete).toBe(counts.all);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Validate Filter Result', () => {
    it('validateFilterResult correctly validates all filter types', () => {
      fc.assert(
        fc.property(
          serviceLogDataArb,
          filterTypeArb,
          (log, filterType) => {
            const isValid = validateFilterResult(log, filterType);
            
            // Cross-check with predicate functions
            switch (filterType) {
              case 'all':
                expect(isValid).toBe(true);
                break;
              case 'has_photos':
                expect(isValid).toBe(hasPhotos(log));
                break;
              case 'has_time':
                expect(isValid).toBe(hasTimeTracking(log));
                break;
              case 'complete':
                expect(isValid).toBe(hasCompleteProof(log));
                break;
              case 'incomplete':
                expect(isValid).toBe(hasIncompleteProof(log));
                break;
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Filter Options Configuration', () => {
    it('all filter types have corresponding options', () => {
      const filterTypes: ProofOfServiceFilterType[] = ['all', 'has_photos', 'has_time', 'complete', 'incomplete'];
      
      for (const filterType of filterTypes) {
        const option = PROOF_OF_SERVICE_FILTER_OPTIONS.find(o => o.value === filterType);
        expect(option).toBeDefined();
        expect(option?.label).toBeTruthy();
        expect(option?.description).toBeTruthy();
      }
    });
  });
});
