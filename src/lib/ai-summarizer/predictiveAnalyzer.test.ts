/**
 * Property-Based Tests for Predictive Analyzer
 * 
 * These tests validate the correctness properties defined in the design document
 * using fast-check for property-based testing.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  generatePredictiveInsights,
  generateChemicalPrediction,
  hasSufficientDataForPrediction,
  getMinimumLogsForPrediction,
  getLowConfidenceThreshold,
  validatePredictionConfidences,
} from './predictiveAnalyzer';
import type { ChemicalReading } from './types';

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
const dateStringArb = fc.tuple(
  fc.integer({ min: 2020, max: 2025 }),
  fc.integer({ min: 1, max: 12 }),
  fc.integer({ min: 1, max: 28 }) // Use 28 to avoid invalid dates
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

// ============================================================================
// Property Tests
// ============================================================================

describe('Predictive Analyzer - Property Tests', () => {
  /**
   * **Feature: ai-pool-summarizer, Property 5: Prediction Requires Minimum Data**
   * 
   * *For any* pool with fewer than 5 service logs, the AI_Pool_Summarizer 
   * SHALL NOT generate predictions with confidence above 60%.
   * 
   * **Validates: Requirements 2.1, 2.5**
   */
  describe('Property 5: Prediction Requires Minimum Data', () => {
    const MINIMUM_LOGS = getMinimumLogsForPrediction();
    const LOW_CONFIDENCE_THRESHOLD = getLowConfidenceThreshold();

    it('pools with fewer than 5 service logs should have prediction confidence below 60%', () => {
      fc.assert(
        fc.property(
          fc.array(serviceLogArb, { minLength: 0, maxLength: MINIMUM_LOGS - 1 }),
          (logs) => {
            const insights = generatePredictiveInsights({ serviceLogs: logs });
            
            // All predictions should have confidence below 60%
            for (const prediction of insights.predictions) {
              expect(prediction.confidence).toBeLessThan(LOW_CONFIDENCE_THRESHOLD);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('pools with 0 service logs should have very low prediction confidence', () => {
      const insights = generatePredictiveInsights({ serviceLogs: [] });
      
      for (const prediction of insights.predictions) {
        expect(prediction.confidence).toBeLessThan(LOW_CONFIDENCE_THRESHOLD);
        expect(prediction.confidence).toBeLessThanOrEqual(10);
      }
    });

    it('pools with 1 service log should have prediction confidence below 60%', () => {
      fc.assert(
        fc.property(
          fc.array(serviceLogArb, { minLength: 1, maxLength: 1 }),
          (logs) => {
            const insights = generatePredictiveInsights({ serviceLogs: logs });
            
            for (const prediction of insights.predictions) {
              expect(prediction.confidence).toBeLessThan(LOW_CONFIDENCE_THRESHOLD);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('pools with 2 service logs should have prediction confidence below 60%', () => {
      fc.assert(
        fc.property(
          fc.array(serviceLogArb, { minLength: 2, maxLength: 2 }),
          (logs) => {
            const insights = generatePredictiveInsights({ serviceLogs: logs });
            
            for (const prediction of insights.predictions) {
              expect(prediction.confidence).toBeLessThan(LOW_CONFIDENCE_THRESHOLD);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('pools with 3 service logs should have prediction confidence below 60%', () => {
      fc.assert(
        fc.property(
          fc.array(serviceLogArb, { minLength: 3, maxLength: 3 }),
          (logs) => {
            const insights = generatePredictiveInsights({ serviceLogs: logs });
            
            for (const prediction of insights.predictions) {
              expect(prediction.confidence).toBeLessThan(LOW_CONFIDENCE_THRESHOLD);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('pools with 4 service logs should have prediction confidence below 60%', () => {
      fc.assert(
        fc.property(
          fc.array(serviceLogArb, { minLength: 4, maxLength: 4 }),
          (logs) => {
            const insights = generatePredictiveInsights({ serviceLogs: logs });
            
            for (const prediction of insights.predictions) {
              expect(prediction.confidence).toBeLessThan(LOW_CONFIDENCE_THRESHOLD);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('pools with 5 or more service logs CAN have prediction confidence at or above 60%', () => {
      fc.assert(
        fc.property(
          fc.array(serviceLogArb, { minLength: MINIMUM_LOGS, maxLength: 20 }),
          (logs) => {
            const insights = generatePredictiveInsights({ serviceLogs: logs });
            
            // With sufficient data, confidence CAN be >= 60% (but not guaranteed due to variance)
            // At minimum, we verify the predictions are generated and confidences are valid
            expect(insights.predictions.length).toBe(4); // ph, chlorine, alkalinity, stabilizer
            
            for (const prediction of insights.predictions) {
              expect(prediction.confidence).toBeGreaterThanOrEqual(0);
              expect(prediction.confidence).toBeLessThanOrEqual(100);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('hasSufficientDataForPrediction correctly identifies minimum data threshold', () => {
      expect(hasSufficientDataForPrediction(0)).toBe(false);
      expect(hasSufficientDataForPrediction(1)).toBe(false);
      expect(hasSufficientDataForPrediction(2)).toBe(false);
      expect(hasSufficientDataForPrediction(3)).toBe(false);
      expect(hasSufficientDataForPrediction(4)).toBe(false);
      expect(hasSufficientDataForPrediction(5)).toBe(true);
      expect(hasSufficientDataForPrediction(10)).toBe(true);
      expect(hasSufficientDataForPrediction(100)).toBe(true);
    });

    it('minimum logs for prediction is 5', () => {
      expect(getMinimumLogsForPrediction()).toBe(5);
    });

    it('low confidence threshold is 60', () => {
      expect(getLowConfidenceThreshold()).toBe(60);
    });

    it('all prediction confidences are within valid bounds (0-100)', () => {
      fc.assert(
        fc.property(
          fc.array(serviceLogArb, { minLength: 0, maxLength: 20 }),
          (logs) => {
            const insights = generatePredictiveInsights({ serviceLogs: logs });
            
            expect(validatePredictionConfidences(insights)).toBe(true);
            
            for (const prediction of insights.predictions) {
              expect(prediction.confidence).toBeGreaterThanOrEqual(0);
              expect(prediction.confidence).toBeLessThanOrEqual(100);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('individual chemical predictions respect minimum data requirement', () => {
      fc.assert(
        fc.property(
          fc.array(serviceLogArb, { minLength: 0, maxLength: MINIMUM_LOGS - 1 }),
          fc.constantFrom<'ph' | 'chlorine' | 'alkalinity' | 'stabilizer'>('ph', 'chlorine', 'alkalinity', 'stabilizer'),
          (logs, chemical) => {
            const prediction = generateChemicalPrediction(chemical, logs, false);
            
            expect(prediction.confidence).toBeLessThan(LOW_CONFIDENCE_THRESHOLD);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Additional tests for prediction structure and validity
   */
  describe('Prediction Structure Validity', () => {
    it('predictions include all required chemicals', () => {
      fc.assert(
        fc.property(
          fc.array(serviceLogArb, { minLength: 1, maxLength: 10 }),
          (logs) => {
            const insights = generatePredictiveInsights({ serviceLogs: logs });
            
            const chemicals = insights.predictions.map(p => p.chemical);
            expect(chemicals).toContain('ph');
            expect(chemicals).toContain('chlorine');
            expect(chemicals).toContain('alkalinity');
            expect(chemicals).toContain('stabilizer');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('predictions have valid current and predicted levels', () => {
      fc.assert(
        fc.property(
          fc.array(serviceLogArb, { minLength: 1, maxLength: 10 }),
          (logs) => {
            const insights = generatePredictiveInsights({ serviceLogs: logs });
            
            const validLevels = ['good', 'low', 'high', 'critical'];
            
            for (const prediction of insights.predictions) {
              expect(validLevels).toContain(prediction.currentLevel);
              expect(validLevels).toContain(prediction.predictedLevel);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('overall outlook is one of the valid values', () => {
      fc.assert(
        fc.property(
          fc.array(serviceLogArb, { minLength: 0, maxLength: 10 }),
          (logs) => {
            const insights = generatePredictiveInsights({ serviceLogs: logs });
            
            expect(['stable', 'attention-needed', 'intervention-required']).toContain(
              insights.overallOutlook
            );
          }
        ),
        { numRuns: 100 }
      );
    });

    it('next service recommendation has valid urgency', () => {
      fc.assert(
        fc.property(
          fc.array(serviceLogArb, { minLength: 0, maxLength: 10 }),
          (logs) => {
            const insights = generatePredictiveInsights({ serviceLogs: logs });
            
            expect(['routine', 'soon', 'urgent']).toContain(
              insights.nextServiceRecommendation.urgency
            );
            expect(insights.nextServiceRecommendation.suggestedDate).toBeTruthy();
            expect(insights.nextServiceRecommendation.reason).toBeTruthy();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('daysUntilCritical is null or non-negative', () => {
      fc.assert(
        fc.property(
          fc.array(serviceLogArb, { minLength: 1, maxLength: 10 }),
          (logs) => {
            const insights = generatePredictiveInsights({ serviceLogs: logs });
            
            for (const prediction of insights.predictions) {
              if (prediction.daysUntilCritical !== null) {
                expect(prediction.daysUntilCritical).toBeGreaterThanOrEqual(0);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('factors array is always present and non-empty', () => {
      fc.assert(
        fc.property(
          fc.array(serviceLogArb, { minLength: 0, maxLength: 10 }),
          (logs) => {
            const insights = generatePredictiveInsights({ serviceLogs: logs });
            
            for (const prediction of insights.predictions) {
              expect(Array.isArray(prediction.factors)).toBe(true);
              expect(prediction.factors.length).toBeGreaterThan(0);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
