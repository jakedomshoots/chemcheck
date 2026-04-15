/**
 * Property-Based Tests for Recommendation Engine
 * 
 * These tests validate the correctness properties defined in the design document
 * using fast-check for property-based testing.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  generateRecommendations,
  validatePriorityOrdering,
  validateCategoryPriorities,
  flattenRecommendations,
  getPriorityLevels,
  calculateDosage,
  getPriorityForReading,
} from './recommendationEngine';
import type { ServiceLog, ChemicalReading, CategorizedRecommendations } from './types';

// ============================================================================
// Generators for Property-Based Testing
// ============================================================================

/**
 * Generator for valid chemical readings
 */
const chemicalReadingArb = fc.constantFrom<ChemicalReading>('good', 'low', 'high', 'critical');

/**
 * Generator for non-good chemical readings (to ensure recommendations are generated)
 */
const nonGoodReadingArb = fc.constantFrom<ChemicalReading>('low', 'high', 'critical');

/**
 * Generator for a valid date string in YYYY-MM-DD format
 */
const dateStringArb = fc.tuple(
  fc.integer({ min: 2020, max: 2025 }),
  fc.integer({ min: 1, max: 12 }),
  fc.integer({ min: 1, max: 28 })
).map(([year, month, day]) => 
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
);

/**
 * Generator for any valid service log
 */
const serviceLogArb = fc.record({
  id: fc.integer({ min: 1, max: 10000 }),
  service_date: dateStringArb,
  ph: chemicalReadingArb,
  chlorine: chemicalReadingArb,
  alkalinity: chemicalReadingArb,
  stabilizer: chemicalReadingArb,
  notes: fc.option(fc.string(), { nil: undefined }),
});

/**
 * Generator for service log with at least one critical reading
 * (ensures immediate recommendations are generated)
 */
const criticalServiceLogArb = fc.record({
  id: fc.integer({ min: 1, max: 10000 }),
  service_date: dateStringArb,
  ph: fc.constantFrom<ChemicalReading>('critical', 'good'),
  chlorine: fc.constantFrom<ChemicalReading>('critical', 'good'),
  alkalinity: fc.constantFrom<ChemicalReading>('critical', 'good'),
  stabilizer: fc.constantFrom<ChemicalReading>('critical', 'good'),
  notes: fc.option(fc.string(), { nil: undefined }),
}).filter(log => {
  // Ensure at least one reading is critical
  return log.ph === 'critical' || log.chlorine === 'critical' || 
         log.alkalinity === 'critical' || log.stabilizer === 'critical';
});

/**
 * Generator for service log with only low/high readings (no critical)
 * (ensures this-visit/next-visit recommendations)
 */
const moderateIssueServiceLogArb = fc.record({
  id: fc.integer({ min: 1, max: 10000 }),
  service_date: dateStringArb,
  ph: fc.constantFrom<ChemicalReading>('low', 'high', 'good'),
  chlorine: fc.constantFrom<ChemicalReading>('low', 'high', 'good'),
  alkalinity: fc.constantFrom<ChemicalReading>('low', 'high', 'good'),
  stabilizer: fc.constantFrom<ChemicalReading>('low', 'high', 'good'),
  notes: fc.option(fc.string(), { nil: undefined }),
}).filter(log => {
  // Ensure at least one reading is low or high (not good, not critical)
  return (log.ph === 'low' || log.ph === 'high') ||
         (log.chlorine === 'low' || log.chlorine === 'high') ||
         (log.alkalinity === 'low' || log.alkalinity === 'high') ||
         (log.stabilizer === 'low' || log.stabilizer === 'high');
});

/**
 * Generator for pool gallons (realistic pool sizes)
 */
const poolGallonsArb = fc.oneof(
  fc.constant(null),
  fc.integer({ min: 5000, max: 50000 })
);

// ============================================================================
// Property Tests
// ============================================================================

describe('Recommendation Engine - Property Tests', () => {
  /**
   * **Feature: ai-pool-summarizer, Property 8: Recommendation Priority Ordering**
   * 
   * *For any* set of recommendations, immediate recommendations SHALL have 
   * lower priority numbers (higher urgency) than long-term recommendations.
   * 
   * **Validates: Requirements 6.1, 6.2**
   */
  describe('Property 8: Recommendation Priority Ordering', () => {
    it('immediate recommendations should have lower priority numbers than long-term recommendations', () => {
      fc.assert(
        fc.property(
          fc.array(serviceLogArb, { minLength: 1, maxLength: 10 }),
          poolGallonsArb,
          (logs, gallons) => {
            const recommendations = generateRecommendations({
              serviceLogs: logs,
              poolGallons: gallons,
            });

            // Validate priority ordering
            expect(validatePriorityOrdering(recommendations)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('critical readings should generate immediate recommendations with lowest priority numbers', () => {
      fc.assert(
        fc.property(
          fc.array(criticalServiceLogArb, { minLength: 1, maxLength: 5 }),
          poolGallonsArb,
          (logs, gallons) => {
            const recommendations = generateRecommendations({
              serviceLogs: logs,
              poolGallons: gallons,
            });

            // Should have immediate recommendations
            expect(recommendations.immediate.length).toBeGreaterThan(0);

            // All immediate recommendations should have priority <= 2
            const priorityLevels = getPriorityLevels();
            for (const rec of recommendations.immediate) {
              expect(rec.priority).toBeLessThanOrEqual(priorityLevels.high);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('moderate issues should generate this-visit or next-visit recommendations', () => {
      fc.assert(
        fc.property(
          fc.array(moderateIssueServiceLogArb, { minLength: 1, maxLength: 5 }),
          poolGallonsArb,
          (logs, gallons) => {
            const recommendations = generateRecommendations({
              serviceLogs: logs,
              poolGallons: gallons,
            });

            // Should have some recommendations in thisVisit or nextVisit
            const hasModerateRecs = 
              recommendations.thisVisit.length > 0 || 
              recommendations.nextVisit.length > 0;
            
            expect(hasModerateRecs).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('all recommendations should be sorted by priority within their categories', () => {
      fc.assert(
        fc.property(
          fc.array(serviceLogArb, { minLength: 1, maxLength: 10 }),
          poolGallonsArb,
          (logs, gallons) => {
            const recommendations = generateRecommendations({
              serviceLogs: logs,
              poolGallons: gallons,
            });

            // Flatten and check overall ordering
            const flattened = flattenRecommendations(recommendations);
            
            // Should be sorted by priority (ascending)
            for (let i = 1; i < flattened.length; i++) {
              expect(flattened[i].priority).toBeGreaterThanOrEqual(flattened[i - 1].priority);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('category priorities should be valid', () => {
      fc.assert(
        fc.property(
          fc.array(serviceLogArb, { minLength: 1, maxLength: 10 }),
          poolGallonsArb,
          (logs, gallons) => {
            const recommendations = generateRecommendations({
              serviceLogs: logs,
              poolGallons: gallons,
            });

            expect(validateCategoryPriorities(recommendations)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('priority ordering should hold across different pool sizes', () => {
      fc.assert(
        fc.property(
          fc.array(serviceLogArb, { minLength: 1, maxLength: 5 }),
          fc.integer({ min: 5000, max: 100000 }),
          (logs, gallons) => {
            const recommendations = generateRecommendations({
              serviceLogs: logs,
              poolGallons: gallons,
            });

            // Priority ordering should be consistent regardless of pool size
            expect(validatePriorityOrdering(recommendations)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Additional tests for dosage calculation (Requirement 6.3)
   */
  describe('Dosage Calculation', () => {
    it('should calculate dosage proportional to pool size or provide special instructions', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('ph', 'chlorine', 'alkalinity', 'stabilizer'),
          fc.constantFrom<ChemicalReading>('low', 'high'),
          fc.integer({ min: 10000, max: 50000 }),
          (chemical, reading, gallons) => {
            const dosage = calculateDosage(chemical, reading, gallons);
            
            // Should return a dosage string for non-good readings
            // Either contains gallons (scaled dosage) or special instructions (like "Partial drain")
            if (dosage !== null) {
              // Use locale-independent string conversion for gallons
              const hasGallons = dosage.includes(String(gallons));
              const dosageLower = dosage.toLowerCase();
              const hasSpecialInstructions = dosageLower.includes('partial drain') || 
                                             dosageLower.includes('reduce');
              expect(hasGallons || hasSpecialInstructions).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return null dosage for good readings', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('ph', 'chlorine', 'alkalinity', 'stabilizer'),
          fc.integer({ min: 5000, max: 50000 }),
          (chemical, gallons) => {
            const dosage = calculateDosage(chemical, 'good', gallons);
            expect(dosage).toBeNull();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return null dosage when pool gallons is null', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('ph', 'chlorine', 'alkalinity', 'stabilizer'),
          nonGoodReadingArb,
          (chemical, reading) => {
            const dosage = calculateDosage(chemical, reading, null);
            expect(dosage).toBeNull();
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Additional tests for priority calculation
   */
  describe('Priority Calculation', () => {
    it('critical readings should have lowest priority numbers', () => {
      const priorityLevels = getPriorityLevels();
      
      const criticalPriority = getPriorityForReading('critical', 'immediate');
      const lowPriority = getPriorityForReading('low', 'thisVisit');
      const goodPriority = getPriorityForReading('good', 'longTerm');

      expect(criticalPriority).toBeLessThan(lowPriority);
      expect(lowPriority).toBeLessThan(goodPriority);
    });

    it('same reading severity should have different priorities based on category', () => {
      const immediateP = getPriorityForReading('low', 'immediate');
      const thisVisitP = getPriorityForReading('low', 'thisVisit');
      const nextVisitP = getPriorityForReading('low', 'nextVisit');
      const longTermP = getPriorityForReading('low', 'longTerm');

      expect(immediateP).toBeLessThan(thisVisitP);
      expect(thisVisitP).toBeLessThan(nextVisitP);
      expect(nextVisitP).toBeLessThan(longTermP);
    });
  });

  /**
   * Tests for recommendation generation completeness
   */
  describe('Recommendation Generation', () => {
    it('should generate recommendations for all non-good readings', () => {
      fc.assert(
        fc.property(
          fc.record({
            id: fc.integer({ min: 1, max: 10000 }),
            service_date: dateStringArb,
            ph: nonGoodReadingArb,
            chlorine: nonGoodReadingArb,
            alkalinity: nonGoodReadingArb,
            stabilizer: nonGoodReadingArb,
          }),
          poolGallonsArb,
          (log, gallons) => {
            const recommendations = generateRecommendations({
              serviceLogs: [log],
              poolGallons: gallons,
            });

            // Should have at least 4 recommendations (one per chemical)
            const total = 
              recommendations.immediate.length +
              recommendations.thisVisit.length +
              recommendations.nextVisit.length +
              recommendations.longTerm.length;

            expect(total).toBeGreaterThanOrEqual(4);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should not generate recommendations for all-good readings', () => {
      fc.assert(
        fc.property(
          fc.record({
            id: fc.integer({ min: 1, max: 10000 }),
            service_date: dateStringArb,
            ph: fc.constant<ChemicalReading>('good'),
            chlorine: fc.constant<ChemicalReading>('good'),
            alkalinity: fc.constant<ChemicalReading>('good'),
            stabilizer: fc.constant<ChemicalReading>('good'),
          }),
          poolGallonsArb,
          (log, gallons) => {
            const recommendations = generateRecommendations({
              serviceLogs: [log],
              poolGallons: gallons,
            });

            // Should have no recommendations for all-good readings
            const total = 
              recommendations.immediate.length +
              recommendations.thisVisit.length +
              recommendations.nextVisit.length +
              recommendations.longTerm.length;

            expect(total).toBe(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('each recommendation should have required fields', () => {
      fc.assert(
        fc.property(
          fc.array(serviceLogArb, { minLength: 1, maxLength: 5 }),
          poolGallonsArb,
          (logs, gallons) => {
            const recommendations = generateRecommendations({
              serviceLogs: logs,
              poolGallons: gallons,
            });

            const allRecs = flattenRecommendations(recommendations);

            for (const rec of allRecs) {
              expect(rec.id).toBeDefined();
              expect(typeof rec.priority).toBe('number');
              expect(rec.action).toBeDefined();
              expect(rec.action.length).toBeGreaterThan(0);
              expect(rec.reason).toBeDefined();
              expect(rec.addressesIssue).toBeDefined();
              expect(typeof rec.preventsFuture).toBe('boolean');
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
