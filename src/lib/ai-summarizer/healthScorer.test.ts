/**
 * Property-Based Tests for Pool Health Scorer
 * 
 * These tests validate the correctness properties defined in the design document
 * using fast-check for property-based testing.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  calculateHealthScore,
  hasAllGoodReadings,
  hasMixedReadings,
  getReadingScore,
  calculateTrend,
  determineDataQuality,
  calculateConfidence,
} from './healthScorer';
import type { ServiceLog, ChemicalReading } from './types';

// ============================================================================
// Generators for Property-Based Testing
// ============================================================================

/**
 * Generator for valid chemical readings
 */
const chemicalReadingArb = fc.constantFrom<ChemicalReading>('good', 'low', 'high', 'critical');

/**
 * Generator for non-good chemical readings (for mixed pools)
 */
const nonGoodReadingArb = fc.constantFrom<ChemicalReading>('low', 'high', 'critical');

/**
 * Generator for a valid date string in YYYY-MM-DD format
 */
const dateStringArb = fc.tuple(
  fc.integer({ min: 2020, max: 2025 }),
  fc.integer({ min: 1, max: 12 }),
  fc.integer({ min: 1, max: 28 }) // Use 28 to avoid invalid dates
).map(([year, month, day]) => 
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
);

/**
 * Generator for a service log with all 'good' readings
 */
const allGoodServiceLogArb = fc.record({
  id: fc.integer({ min: 1, max: 10000 }),
  service_date: dateStringArb,
  ph: fc.constant<ChemicalReading>('good'),
  chlorine: fc.constant<ChemicalReading>('good'),
  alkalinity: fc.constant<ChemicalReading>('good'),
  stabilizer: fc.constant<ChemicalReading>('good'),
  notes: fc.option(fc.string(), { nil: undefined }),
});

/**
 * Generator for a service log with at least one non-good reading
 */
const mixedServiceLogArb = fc.record({
  id: fc.integer({ min: 1, max: 10000 }),
  service_date: dateStringArb,
  ph: chemicalReadingArb,
  chlorine: chemicalReadingArb,
  alkalinity: chemicalReadingArb,
  stabilizer: chemicalReadingArb,
  notes: fc.option(fc.string(), { nil: undefined }),
}).filter(log => {
  // Ensure at least one reading is not 'good'
  return log.ph !== 'good' || log.chlorine !== 'good' || 
         log.alkalinity !== 'good' || log.stabilizer !== 'good';
});

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

// ============================================================================
// Property Tests
// ============================================================================

describe('Pool Health Scorer - Property Tests', () => {
  /**
   * **Feature: ai-pool-summarizer, Property 2: Health Score Monotonicity with Chemical Quality**
   * 
   * *For any* two pools where one has all 'good' readings and another has mixed 
   * readings, the pool with all 'good' readings SHALL have a higher or equal 
   * health score.
   * 
   * **Validates: Requirements 1.2, 1.3**
   */
  describe('Property 2: Health Score Monotonicity with Chemical Quality', () => {
    it('pools with all good readings should have higher or equal scores than pools with mixed readings', () => {
      fc.assert(
        fc.property(
          fc.array(allGoodServiceLogArb, { minLength: 1, maxLength: 10 }),
          fc.array(mixedServiceLogArb, { minLength: 1, maxLength: 10 }),
          (allGoodLogs, mixedLogs) => {
            // Verify our generators are working correctly
            expect(hasAllGoodReadings(allGoodLogs)).toBe(true);
            expect(hasMixedReadings(mixedLogs)).toBe(true);

            const allGoodResult = calculateHealthScore({ serviceLogs: allGoodLogs });
            const mixedResult = calculateHealthScore({ serviceLogs: mixedLogs });

            // Pool with all good readings should have >= score
            expect(allGoodResult.healthScore.score).toBeGreaterThanOrEqual(
              mixedResult.healthScore.score
            );
          }
        ),
        { numRuns: 100 }
      );
    });

    it('all good readings should produce maximum or near-maximum scores', () => {
      fc.assert(
        fc.property(
          fc.array(allGoodServiceLogArb, { minLength: 1, maxLength: 10 }),
          (logs) => {
            const result = calculateHealthScore({ serviceLogs: logs });
            
            // All good readings should produce a high score (at least 80 for grade A)
            // The score might be slightly below 100 due to trend calculations
            expect(result.healthScore.score).toBeGreaterThanOrEqual(80);
            expect(result.healthScore.grade).toBe('A');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('critical readings should significantly lower the score', () => {
      // Use integer-based date generation to avoid invalid date issues
      const dateArb = fc.integer({ min: 0, max: 2190 }).map(days => {
        const date = new Date('2020-01-01');
        date.setDate(date.getDate() + days);
        return date.toISOString().split('T')[0];
      });

      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              id: fc.integer({ min: 1, max: 10000 }),
              service_date: dateArb,
              ph: fc.constant<ChemicalReading>('critical'),
              chlorine: fc.constant<ChemicalReading>('critical'),
              alkalinity: fc.constant<ChemicalReading>('critical'),
              stabilizer: fc.constant<ChemicalReading>('critical'),
            }),
            { minLength: 1, maxLength: 10 }
          ),
          (criticalLogs) => {
            const result = calculateHealthScore({ serviceLogs: criticalLogs });
            
            // All critical readings should produce a very low score
            expect(result.healthScore.score).toBeLessThanOrEqual(20);
            expect(['D', 'F']).toContain(result.healthScore.grade);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('reading scores follow expected ordering: good > low/high > critical', () => {
      expect(getReadingScore('good')).toBeGreaterThan(getReadingScore('low'));
      expect(getReadingScore('good')).toBeGreaterThan(getReadingScore('high'));
      expect(getReadingScore('low')).toBeGreaterThan(getReadingScore('critical'));
      expect(getReadingScore('high')).toBeGreaterThan(getReadingScore('critical'));
    });
  });

  /**
   * **Feature: ai-pool-summarizer, Property 4: Insufficient Data Detection**
   * 
   * *For any* pool with fewer than 3 service logs, the AI_Pool_Summarizer 
   * SHALL set dataQuality to 'limited' and confidence below 50.
   * 
   * **Validates: Requirements 1.5**
   */
  describe('Property 4: Insufficient Data Detection', () => {
    it('pools with 0 service logs should have limited data quality and confidence below 50', () => {
      const result = calculateHealthScore({ serviceLogs: [] });
      
      expect(result.dataQuality).toBe('limited');
      expect(result.healthScore.confidence).toBeLessThan(50);
    });

    it('pools with 1 service log should have limited data quality and confidence below 50', () => {
      fc.assert(
        fc.property(
          fc.array(serviceLogArb, { minLength: 1, maxLength: 1 }),
          (logs) => {
            const result = calculateHealthScore({ serviceLogs: logs });
            
            expect(result.dataQuality).toBe('limited');
            expect(result.healthScore.confidence).toBeLessThan(50);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('pools with 2 service logs should have limited data quality and confidence below 50', () => {
      fc.assert(
        fc.property(
          fc.array(serviceLogArb, { minLength: 2, maxLength: 2 }),
          (logs) => {
            const result = calculateHealthScore({ serviceLogs: logs });
            
            expect(result.dataQuality).toBe('limited');
            expect(result.healthScore.confidence).toBeLessThan(50);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('pools with fewer than 3 service logs should always have limited data quality', () => {
      fc.assert(
        fc.property(
          fc.array(serviceLogArb, { minLength: 0, maxLength: 2 }),
          (logs) => {
            const result = calculateHealthScore({ serviceLogs: logs });
            
            expect(result.dataQuality).toBe('limited');
            expect(result.healthScore.confidence).toBeLessThan(50);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('pools with 3 or more service logs should have fair or better data quality', () => {
      fc.assert(
        fc.property(
          fc.array(serviceLogArb, { minLength: 3, maxLength: 15 }),
          (logs) => {
            const result = calculateHealthScore({ serviceLogs: logs });
            
            expect(['excellent', 'good', 'fair']).toContain(result.dataQuality);
            // Confidence should be at least 30 with 3+ logs (fair data quality)
            expect(result.healthScore.confidence).toBeGreaterThanOrEqual(30);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('determineDataQuality correctly categorizes log counts', () => {
      // 0-2 logs = limited
      expect(determineDataQuality(0)).toBe('limited');
      expect(determineDataQuality(1)).toBe('limited');
      expect(determineDataQuality(2)).toBe('limited');
      
      // 3-4 logs = fair
      expect(determineDataQuality(3)).toBe('fair');
      expect(determineDataQuality(4)).toBe('fair');
      
      // 5-9 logs = good
      expect(determineDataQuality(5)).toBe('good');
      expect(determineDataQuality(9)).toBe('good');
      
      // 10+ logs = excellent
      expect(determineDataQuality(10)).toBe('excellent');
      expect(determineDataQuality(100)).toBe('excellent');
    });

    it('confidence increases with more data', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 20 }),
          fc.integer({ min: 0, max: 20 }),
          (count1, count2) => {
            const quality1 = determineDataQuality(count1);
            const quality2 = determineDataQuality(count2);
            const conf1 = calculateConfidence(count1, quality1);
            const conf2 = calculateConfidence(count2, quality2);
            
            // More logs should generally mean higher or equal confidence
            if (count1 < count2) {
              expect(conf1).toBeLessThanOrEqual(conf2);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Additional unit tests for trend calculation
   */
  describe('Trend Calculation', () => {
    it('should detect improving trend when readings get better', () => {
      const readings: ChemicalReading[] = ['critical', 'low', 'good'];
      expect(calculateTrend(readings)).toBe('improving');
    });

    it('should detect declining trend when readings get worse', () => {
      const readings: ChemicalReading[] = ['good', 'low', 'critical'];
      expect(calculateTrend(readings)).toBe('declining');
    });

    it('should detect stable trend when readings stay the same', () => {
      const readings: ChemicalReading[] = ['good', 'good', 'good'];
      expect(calculateTrend(readings)).toBe('stable');
    });

    it('should return stable for single reading', () => {
      const readings: ChemicalReading[] = ['good'];
      expect(calculateTrend(readings)).toBe('stable');
    });

    it('should return stable for empty readings', () => {
      const readings: ChemicalReading[] = [];
      expect(calculateTrend(readings)).toBe('stable');
    });
  });
});
