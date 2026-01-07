/**
 * Property-Based Tests for Service Summary Generation
 * 
 * These tests validate the correctness properties defined in the design document
 * using fast-check for property-based testing.
 * 
 * Feature: proof-of-service
 * Property 7: Service Summary Completeness
 * Validates: Requirements 4.2, 4.5
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  generateServiceVisitSummary,
  generateProofOfServiceMetadata,
  generateChemicalReadings,
  isValidServiceVisitSummary,
  hasCompleteProofOfService,
  hasAnyProofOfService,
  getProofOfServiceCompletionPercent,
  type ServiceLogData,
  type CustomerData,
} from './serviceSummary';

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
 * Generator for customer names
 */
const customerNameArb = fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0);

/**
 * Generator for addresses
 */
const addressArb = fc.string({ minLength: 1, maxLength: 200 }).filter(s => s.trim().length > 0);

/**
 * Generator for pool types
 */
const poolTypeArb = fc.constantFrom('Salt', 'Chlorine');

/**
 * Generator for surface types
 */
const surfaceTypeArb = fc.constantFrom('Plaster', 'Vinyl', 'Fiberglass', 'Tile');

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
 * Generator for ServiceLogData with proof-of-service fields
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
 * Generator for ServiceLogData with complete proof-of-service
 */
const completeProofServiceLogArb: fc.Arbitrary<ServiceLogData> = fc.record({
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
  start_time: timestampArb,
  end_time: timestampArb,
  duration_ms: durationMsArb,
  photo_count: fc.integer({ min: 1, max: 20 }),
  has_before_photos: fc.boolean(),
  has_after_photos: fc.boolean(),
});

/**
 * Generator for CustomerData
 */
const customerDataArb: fc.Arbitrary<CustomerData> = fc.record({
  _id: customerIdArb,
  full_name: customerNameArb,
  address: addressArb,
  phone: fc.option(fc.string({ minLength: 10, maxLength: 15 }), { nil: undefined }),
  email: fc.option(fc.emailAddress(), { nil: undefined }),
  pool_type: poolTypeArb,
  surface_type: surfaceTypeArb,
});

// ============================================================================
// Property-Based Tests
// ============================================================================

describe('Service Summary Generation', () => {
  /**
   * Property 7: Service Summary Completeness
   * 
   * For any completed service log, the generated summary SHALL contain all required fields:
   * customer name, service date, start time, end time, duration, photo count, and chemical readings.
   * 
   * **Validates: Requirements 4.2, 4.5**
   */
  describe('Property 7: Service Summary Completeness', () => {
    it('generated summaries always contain all required fields', () => {
      fc.assert(
        fc.property(
          serviceLogDataArb,
          customerDataArb,
          (log, customer) => {
            const summary = generateServiceVisitSummary(log, customer);
            
            // Verify all required fields are present per Requirements 4.2
            expect(summary.serviceLogId).toBe(log._id);
            expect(summary.customerName).toBe(customer.full_name);
            expect(summary.customerAddress).toBe(customer.address);
            expect(summary.serviceDate).toBe(log.service_date);
            expect(typeof summary.photoCount).toBe('number');
            
            // Chemical readings must be present
            expect(summary.chemicalReadings).toBeDefined();
            expect(summary.chemicalReadings.ph).toBe(log.ph);
            expect(summary.chemicalReadings.chlorine).toBe(log.chlorine);
            expect(summary.chemicalReadings.alkalinity).toBe(log.alkalinity);
            expect(summary.chemicalReadings.stabilizer).toBe(log.stabilizer);
            
            // Proof-of-service metadata must be present
            expect(summary.proofOfService).toBeDefined();
            expect(typeof summary.proofOfService.hasTimeTracking).toBe('boolean');
            expect(typeof summary.proofOfService.hasPhotos).toBe('boolean');
            expect(typeof summary.proofOfService.photoCount).toBe('number');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('summaries pass validation when all required fields are present', () => {
      fc.assert(
        fc.property(
          serviceLogDataArb,
          customerDataArb,
          (log, customer) => {
            const summary = generateServiceVisitSummary(log, customer);
            const isValid = isValidServiceVisitSummary(summary);
            
            expect(isValid).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('duration is correctly formatted in summary', () => {
      fc.assert(
        fc.property(
          completeProofServiceLogArb,
          customerDataArb,
          (log, customer) => {
            const summary = generateServiceVisitSummary(log, customer);
            
            // Duration should be formatted as a string
            expect(typeof summary.durationFormatted).toBe('string');
            expect(summary.durationFormatted.length).toBeGreaterThan(0);
            
            // Duration in ms should match the log
            expect(summary.duration).toBe(log.duration_ms);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('photo count in summary matches log photo count', () => {
      fc.assert(
        fc.property(
          serviceLogDataArb,
          customerDataArb,
          (log, customer) => {
            const summary = generateServiceVisitSummary(log, customer);
            
            // Photo count should match (defaulting to 0 if undefined)
            expect(summary.photoCount).toBe(log.photo_count ?? 0);
            expect(summary.proofOfService.photoCount).toBe(log.photo_count ?? 0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('time tracking status is correctly determined', () => {
      fc.assert(
        fc.property(
          serviceLogDataArb,
          customerDataArb,
          (log, customer) => {
            const summary = generateServiceVisitSummary(log, customer);
            
            const expectedHasTimeTracking = !!(log.start_time && log.end_time);
            expect(summary.proofOfService.hasTimeTracking).toBe(expectedHasTimeTracking);
            
            // Start and end times should be preserved
            expect(summary.startTime).toBe(log.start_time ?? null);
            expect(summary.endTime).toBe(log.end_time ?? null);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('hasPhotos is true when photo count is greater than 0', () => {
      fc.assert(
        fc.property(
          serviceLogDataArb,
          customerDataArb,
          (log, customer) => {
            const summary = generateServiceVisitSummary(log, customer);
            
            const expectedHasPhotos = (log.photo_count ?? 0) > 0;
            expect(summary.proofOfService.hasPhotos).toBe(expectedHasPhotos);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('isComplete is true only when both time tracking and photos exist', () => {
      fc.assert(
        fc.property(
          serviceLogDataArb,
          customerDataArb,
          (log, customer) => {
            const summary = generateServiceVisitSummary(log, customer);
            
            const hasTimeTracking = !!(log.start_time && log.end_time);
            const hasPhotos = (log.photo_count ?? 0) > 0;
            const expectedIsComplete = hasTimeTracking && hasPhotos;
            
            expect(summary.proofOfService.isComplete).toBe(expectedIsComplete);
          }
        ),
        { numRuns: 100 }
      );
    });
  });


  describe('Proof-of-Service Metadata Generation', () => {
    it('generateProofOfServiceMetadata returns correct structure', () => {
      fc.assert(
        fc.property(
          serviceLogDataArb,
          (log) => {
            const metadata = generateProofOfServiceMetadata(log);
            
            // All fields should be present
            expect(typeof metadata.hasTimeTracking).toBe('boolean');
            expect(typeof metadata.hasPhotos).toBe('boolean');
            expect(typeof metadata.photoCount).toBe('number');
            expect(typeof metadata.hasBeforePhotos).toBe('boolean');
            expect(typeof metadata.hasAfterPhotos).toBe('boolean');
            expect(typeof metadata.isComplete).toBe('boolean');
            expect(typeof metadata.durationFormatted).toBe('string');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('generateChemicalReadings preserves all chemical values', () => {
      fc.assert(
        fc.property(
          serviceLogDataArb,
          (log) => {
            const readings = generateChemicalReadings(log);
            
            expect(readings.ph).toBe(log.ph);
            expect(readings.chlorine).toBe(log.chlorine);
            expect(readings.alkalinity).toBe(log.alkalinity);
            expect(readings.stabilizer).toBe(log.stabilizer);
            expect(readings.salt).toBe(log.salt);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Proof-of-Service Helper Functions', () => {
    it('hasCompleteProofOfService returns true only when both time and photos exist', () => {
      fc.assert(
        fc.property(
          serviceLogDataArb,
          (log) => {
            const result = hasCompleteProofOfService(log);
            
            const hasTimeTracking = !!(log.start_time && log.end_time);
            const hasPhotos = (log.photo_count ?? 0) > 0;
            
            expect(result).toBe(hasTimeTracking && hasPhotos);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('hasAnyProofOfService returns true when either time or photos exist', () => {
      fc.assert(
        fc.property(
          serviceLogDataArb,
          (log) => {
            const result = hasAnyProofOfService(log);
            
            const hasTimeTracking = !!(log.start_time && log.end_time);
            const hasPhotos = (log.photo_count ?? 0) > 0;
            
            expect(result).toBe(hasTimeTracking || hasPhotos);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('getProofOfServiceCompletionPercent returns value between 0 and 100', () => {
      fc.assert(
        fc.property(
          serviceLogDataArb,
          (log) => {
            const percent = getProofOfServiceCompletionPercent(log);
            
            expect(percent).toBeGreaterThanOrEqual(0);
            expect(percent).toBeLessThanOrEqual(100);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('getProofOfServiceCompletionPercent is 100 when all proof elements present', () => {
      fc.assert(
        fc.property(
          completeProofServiceLogArb.map(log => ({
            ...log,
            has_before_photos: true,
            has_after_photos: true,
            photo_count: Math.max(1, log.photo_count ?? 1),
          })),
          (log) => {
            const percent = getProofOfServiceCompletionPercent(log);
            
            // Should be 100% when all elements are present
            expect(percent).toBe(100);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('getProofOfServiceCompletionPercent is 0 when no proof elements present', () => {
      fc.assert(
        fc.property(
          serviceLogDataArb.map(log => ({
            ...log,
            start_time: undefined,
            end_time: undefined,
            duration_ms: undefined,
            photo_count: 0,
            has_before_photos: false,
            has_after_photos: false,
          })),
          (log) => {
            const percent = getProofOfServiceCompletionPercent(log);
            
            // Should be 0% when no elements are present
            expect(percent).toBe(0);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
