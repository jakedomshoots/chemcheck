/**
 * Property-Based Tests for Learning Engine
 * 
 * These tests validate the correctness properties defined in the design document
 * using fast-check for property-based testing.
 * 
 * Requirements: 8.1
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  calculateInterventionSuccess,
  didReadingImprove,
  validateInterventionOutcome,
  parseServiceNotes,
  extractInterventions,
  analyzeLearning,
} from './learningEngine';
import type { ChemicalReading, ServiceLog } from './types';

// ============================================================================
// Generators for Property-Based Testing
// ============================================================================

/**
 * Generator for valid chemical readings
 */
const chemicalReadingArb = fc.constantFrom<ChemicalReading>('good', 'low', 'high', 'critical');

/**
 * Generator for a valid date string in YYYY-MM-DD format
 */
const dateStringArb = fc.integer({ min: 0, max: 2190 }).map(days => {
  const date = new Date('2020-01-01');
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0];
});

/**
 * Generator for service notes with actions
 */
const serviceNotesArb = fc.oneof(
  fc.constant('Added shock treatment'),
  fc.constant('Added chlorine tablets'),
  fc.constant('Added muriatic acid to lower pH'),
  fc.constant('Added baking soda for alkalinity'),
  fc.constant('Added stabilizer'),
  fc.constant('Brushed and vacuumed pool'),
  fc.constant('Backwashed filter'),
  fc.constant('Regular maintenance'),
  fc.constant(''),
  fc.constant(undefined),
);

/**
 * Generator for a service log
 */
const serviceLogArb = fc.record({
  id: fc.integer({ min: 1, max: 10000 }),
  service_date: dateStringArb,
  ph: chemicalReadingArb,
  chlorine: chemicalReadingArb,
  alkalinity: chemicalReadingArb,
  stabilizer: chemicalReadingArb,
  notes: serviceNotesArb,
});

/**
 * Generator for a sequence of service logs with unique dates
 */
const serviceLogSequenceArb = fc.array(serviceLogArb, { minLength: 2, maxLength: 10 })
  .map(logs => {
    // Ensure unique dates by adding index to base date
    return logs.map((log, index) => ({
      ...log,
      service_date: (() => {
        const date = new Date('2020-01-01');
        date.setDate(date.getDate() + index * 7); // Weekly intervals
        return date.toISOString().split('T')[0];
      })(),
    }));
  });

// ============================================================================
// Property Tests
// ============================================================================

describe('Learning Engine - Property Tests', () => {
  /**
   * **Feature: ai-pool-summarizer, Property 14: Learning Engine Outcome Tracking**
   * 
   * *For any* intervention record with a recorded afterReading, the success field 
   * SHALL be non-null and correctly reflect whether the reading improved.
   * 
   * **Validates: Requirements 8.1**
   */
  describe('Property 14: Learning Engine Outcome Tracking', () => {
    it('success should be non-null when afterReading is provided', () => {
      fc.assert(
        fc.property(
          chemicalReadingArb,
          chemicalReadingArb,
          (beforeReading, afterReading) => {
            const success = calculateInterventionSuccess(beforeReading, afterReading);
            
            // Success should never be null when afterReading is provided
            expect(success).not.toBeNull();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('success should be null when afterReading is null', () => {
      fc.assert(
        fc.property(
          chemicalReadingArb,
          (beforeReading) => {
            const success = calculateInterventionSuccess(beforeReading, null);
            
            // Success should be null when no afterReading
            expect(success).toBeNull();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('success should correctly reflect reading improvement', () => {
      fc.assert(
        fc.property(
          chemicalReadingArb,
          chemicalReadingArb,
          (beforeReading, afterReading) => {
            const success = calculateInterventionSuccess(beforeReading, afterReading);
            const improved = didReadingImprove(beforeReading, afterReading);
            
            // Success should match whether reading improved
            expect(success).toBe(improved);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('validateInterventionOutcome should return true for all valid reading pairs', () => {
      fc.assert(
        fc.property(
          chemicalReadingArb,
          chemicalReadingArb,
          (beforeReading, afterReading) => {
            const isValid = validateInterventionOutcome(beforeReading, afterReading);
            
            // Validation should always pass for valid reading pairs
            expect(isValid).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('improvement from critical to good should always be success', () => {
      const success = calculateInterventionSuccess('critical', 'good');
      expect(success).toBe(true);
    });

    it('improvement from low to good should always be success', () => {
      const success = calculateInterventionSuccess('low', 'good');
      expect(success).toBe(true);
    });

    it('improvement from high to good should always be success', () => {
      const success = calculateInterventionSuccess('high', 'good');
      expect(success).toBe(true);
    });

    it('decline from good to critical should always be failure', () => {
      const success = calculateInterventionSuccess('good', 'critical');
      expect(success).toBe(false);
    });

    it('same reading should not be considered improvement', () => {
      fc.assert(
        fc.property(
          chemicalReadingArb,
          (reading) => {
            const success = calculateInterventionSuccess(reading, reading);
            
            // Same reading is not an improvement
            expect(success).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('extracted interventions with afterReading should have non-null success', () => {
      fc.assert(
        fc.property(
          serviceLogSequenceArb,
          fc.string({ minLength: 1, maxLength: 10 }),
          (logs, poolId) => {
            // Add notes to ensure some interventions are extracted
            const logsWithNotes = logs.map((log, i) => ({
              ...log,
              notes: i === 0 ? 'Added shock treatment' : log.notes,
            }));

            const interventions = extractInterventions(logsWithNotes, poolId);
            
            // All interventions with afterReading should have non-null success
            for (const intervention of interventions) {
              if (intervention.afterReading !== null) {
                expect(intervention.success).not.toBeNull();
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('analyzeLearning should produce valid intervention records', () => {
      fc.assert(
        fc.property(
          serviceLogSequenceArb,
          fc.string({ minLength: 1, maxLength: 10 }),
          (logs, poolId) => {
            const result = analyzeLearning({ serviceLogs: logs, poolId });
            
            // All interventions with afterReading should have correctly calculated success
            for (const intervention of result.interventions) {
              if (intervention.afterReading !== null) {
                expect(intervention.success).not.toBeNull();
                
                const expectedSuccess = didReadingImprove(
                  intervention.beforeReading as ChemicalReading,
                  intervention.afterReading as ChemicalReading
                );
                expect(intervention.success).toBe(expectedSuccess);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Additional unit tests for note parsing
   */
  describe('Service Note Parsing', () => {
    it('should extract shock treatment action', () => {
      const actions = parseServiceNotes('Added shock treatment to pool');
      expect(actions).toContainEqual({ chemical: 'chlorine', action: 'shock treatment' });
    });

    it('should extract acid action', () => {
      const actions = parseServiceNotes('Added muriatic acid');
      expect(actions).toContainEqual({ chemical: 'ph', action: 'added muriatic acid' });
    });

    it('should extract baking soda action', () => {
      const actions = parseServiceNotes('Added baking soda for alkalinity');
      expect(actions).toContainEqual({ chemical: 'alkalinity', action: 'added baking soda' });
    });

    it('should extract stabilizer action', () => {
      const actions = parseServiceNotes('Added stabilizer');
      expect(actions).toContainEqual({ chemical: 'stabilizer', action: 'added stabilizer' });
    });

    it('should return empty array for empty notes', () => {
      expect(parseServiceNotes('')).toEqual([]);
      expect(parseServiceNotes('   ')).toEqual([]);
    });

    it('should handle multiple actions in one note', () => {
      const actions = parseServiceNotes('Added shock and muriatic acid');
      expect(actions.length).toBeGreaterThanOrEqual(2);
    });
  });

  /**
   * Reading improvement tests
   */
  describe('Reading Improvement Detection', () => {
    it('critical to any other reading is improvement', () => {
      expect(didReadingImprove('critical', 'low')).toBe(true);
      expect(didReadingImprove('critical', 'high')).toBe(true);
      expect(didReadingImprove('critical', 'good')).toBe(true);
    });

    it('low/high to good is improvement', () => {
      expect(didReadingImprove('low', 'good')).toBe(true);
      expect(didReadingImprove('high', 'good')).toBe(true);
    });

    it('good to anything else is not improvement', () => {
      expect(didReadingImprove('good', 'low')).toBe(false);
      expect(didReadingImprove('good', 'high')).toBe(false);
      expect(didReadingImprove('good', 'critical')).toBe(false);
      expect(didReadingImprove('good', 'good')).toBe(false);
    });

    it('same reading is not improvement', () => {
      expect(didReadingImprove('low', 'low')).toBe(false);
      expect(didReadingImprove('high', 'high')).toBe(false);
      expect(didReadingImprove('critical', 'critical')).toBe(false);
    });

    it('low to high or high to low is not improvement', () => {
      expect(didReadingImprove('low', 'high')).toBe(false);
      expect(didReadingImprove('high', 'low')).toBe(false);
    });
  });
});
