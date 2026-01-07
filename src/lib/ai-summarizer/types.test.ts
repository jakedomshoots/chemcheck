/**
 * Property-Based Tests for AI Pool Summarizer Types
 * 
 * These tests validate the correctness properties defined in the design document
 * using fast-check for property-based testing.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  scoreToGrade,
  isValidHealthScore,
  isValidConfidence,
  isValidCostRange,
  type HealthGrade,
  type CostEstimate,
  type PoolHealthScore,
  type Prediction,
} from './types';

// ============================================================================
// Generators for Property-Based Testing
// ============================================================================

/**
 * Generator for valid health scores (0-100)
 */
const healthScoreArb = fc.integer({ min: 0, max: 100 });

/**
 * Generator for valid confidence values (0-100)
 */
const confidenceArb = fc.integer({ min: 0, max: 100 });

/**
 * Generator for valid cost estimates with proper ordering
 */
const validCostEstimateArb = fc.tuple(
  fc.float({ min: 0, max: 10000, noNaN: true }),
  fc.float({ min: 0, max: 10000, noNaN: true }),
  fc.float({ min: 0, max: 10000, noNaN: true })
).map(([a, b, c]) => {
  // Sort to ensure low <= expected <= high
  const sorted = [a, b, c].sort((x, y) => x - y);
  return {
    low: sorted[0],
    expected: sorted[1],
    high: sorted[2],
  } as CostEstimate;
});

/**
 * Generator for PoolHealthScore objects
 */
const poolHealthScoreArb = fc.record({
  score: healthScoreArb,
  grade: fc.constantFrom<HealthGrade>('A', 'B', 'C', 'D', 'F'),
  breakdown: fc.array(fc.record({
    chemical: fc.constantFrom('ph', 'chlorine', 'alkalinity', 'stabilizer', 'salt'),
    score: healthScoreArb,
    weight: fc.float({ min: 0, max: 1, noNaN: true }),
    contribution: fc.float({ min: 0, max: 100, noNaN: true }),
  })),
  trend: fc.constantFrom<'improving' | 'stable' | 'declining'>('improving', 'stable', 'declining'),
  confidence: confidenceArb,
});

/**
 * Generator for Prediction objects
 */
const predictionArb = fc.record({
  chemical: fc.constantFrom('ph', 'chlorine', 'alkalinity', 'stabilizer', 'salt'),
  currentLevel: fc.constantFrom('good', 'low', 'high', 'critical'),
  predictedLevel: fc.constantFrom('good', 'low', 'high', 'critical'),
  daysUntilCritical: fc.option(fc.integer({ min: 0, max: 365 }), { nil: null }),
  confidence: confidenceArb,
  factors: fc.array(fc.string()),
  recommendedAction: fc.option(fc.string(), { nil: null }),
});

// ============================================================================
// Property Tests
// ============================================================================

describe('AI Pool Summarizer - Type Property Tests', () => {
  /**
   * **Feature: ai-pool-summarizer, Property 1: Health Score Bounds**
   * 
   * *For any* pool analysis with valid service logs, the Pool_Health_Score 
   * SHALL be a number between 0 and 100 inclusive, and the grade SHALL 
   * correctly correspond to the score range (A: 80-100, B: 60-79, C: 40-59, 
   * D: 20-39, F: 0-19).
   * 
   * **Validates: Requirements 1.2**
   */
  describe('Property 1: Health Score Bounds', () => {
    it('health scores must be between 0 and 100 inclusive', () => {
      fc.assert(
        fc.property(healthScoreArb, (score) => {
          expect(isValidHealthScore(score)).toBe(true);
          expect(score).toBeGreaterThanOrEqual(0);
          expect(score).toBeLessThanOrEqual(100);
        }),
        { numRuns: 100 }
      );
    });

    it('grade A corresponds to scores 80-100', () => {
      fc.assert(
        fc.property(fc.integer({ min: 80, max: 100 }), (score) => {
          expect(scoreToGrade(score)).toBe('A');
        }),
        { numRuns: 100 }
      );
    });

    it('grade B corresponds to scores 60-79', () => {
      fc.assert(
        fc.property(fc.integer({ min: 60, max: 79 }), (score) => {
          expect(scoreToGrade(score)).toBe('B');
        }),
        { numRuns: 100 }
      );
    });

    it('grade C corresponds to scores 40-59', () => {
      fc.assert(
        fc.property(fc.integer({ min: 40, max: 59 }), (score) => {
          expect(scoreToGrade(score)).toBe('C');
        }),
        { numRuns: 100 }
      );
    });

    it('grade D corresponds to scores 20-39', () => {
      fc.assert(
        fc.property(fc.integer({ min: 20, max: 39 }), (score) => {
          expect(scoreToGrade(score)).toBe('D');
        }),
        { numRuns: 100 }
      );
    });

    it('grade F corresponds to scores 0-19', () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 19 }), (score) => {
          expect(scoreToGrade(score)).toBe('F');
        }),
        { numRuns: 100 }
      );
    });

    it('scoreToGrade and isValidHealthScore are consistent for all valid scores', () => {
      fc.assert(
        fc.property(healthScoreArb, (score) => {
          // If score is valid, grade conversion should work
          expect(isValidHealthScore(score)).toBe(true);
          const grade = scoreToGrade(score);
          expect(['A', 'B', 'C', 'D', 'F']).toContain(grade);
        }),
        { numRuns: 100 }
      );
    });
  });


  /**
   * **Feature: ai-pool-summarizer, Property 3: Prediction Confidence Bounds**
   * 
   * *For any* prediction generated by the AI_Pool_Summarizer, the confidence 
   * value SHALL be between 0 and 100 inclusive.
   * 
   * **Validates: Requirements 2.4**
   */
  describe('Property 3: Prediction Confidence Bounds', () => {
    it('prediction confidence must be between 0 and 100 inclusive', () => {
      fc.assert(
        fc.property(predictionArb, (prediction) => {
          expect(isValidConfidence(prediction.confidence)).toBe(true);
          expect(prediction.confidence).toBeGreaterThanOrEqual(0);
          expect(prediction.confidence).toBeLessThanOrEqual(100);
        }),
        { numRuns: 100 }
      );
    });

    it('isValidConfidence correctly validates confidence values', () => {
      fc.assert(
        fc.property(confidenceArb, (confidence) => {
          expect(isValidConfidence(confidence)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('isValidConfidence rejects values outside 0-100 range', () => {
      // Test values below 0
      fc.assert(
        fc.property(fc.integer({ min: -1000, max: -1 }), (value) => {
          expect(isValidConfidence(value)).toBe(false);
        }),
        { numRuns: 100 }
      );

      // Test values above 100
      fc.assert(
        fc.property(fc.integer({ min: 101, max: 1000 }), (value) => {
          expect(isValidConfidence(value)).toBe(false);
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Feature: ai-pool-summarizer, Property 7: Cost Projection Range Ordering**
   * 
   * *For any* cost projection, the low estimate SHALL be less than or equal 
   * to expected, and expected SHALL be less than or equal to high.
   * 
   * **Validates: Requirements 5.4**
   */
  describe('Property 7: Cost Projection Range Ordering', () => {
    it('cost estimates must maintain low <= expected <= high ordering', () => {
      fc.assert(
        fc.property(validCostEstimateArb, (estimate) => {
          expect(isValidCostRange(estimate)).toBe(true);
          expect(estimate.low).toBeLessThanOrEqual(estimate.expected);
          expect(estimate.expected).toBeLessThanOrEqual(estimate.high);
        }),
        { numRuns: 100 }
      );
    });

    it('isValidCostRange correctly validates properly ordered estimates', () => {
      fc.assert(
        fc.property(validCostEstimateArb, (estimate) => {
          expect(isValidCostRange(estimate)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('isValidCostRange rejects improperly ordered estimates', () => {
      // Generate estimates where low > expected
      fc.assert(
        fc.property(
          fc.float({ min: 100, max: 1000, noNaN: true }),
          fc.float({ min: 0, max: 99, noNaN: true }),
          fc.float({ min: 0, max: 1000, noNaN: true }),
          (low, expected, high) => {
            const estimate: CostEstimate = { low, expected, high };
            // low > expected, so this should be invalid
            expect(isValidCostRange(estimate)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('equal values are valid (low = expected = high)', () => {
      fc.assert(
        fc.property(fc.float({ min: 0, max: 10000, noNaN: true }), (value) => {
          const estimate: CostEstimate = {
            low: value,
            expected: value,
            high: value,
          };
          expect(isValidCostRange(estimate)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });
  });
});
