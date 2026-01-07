/**
 * Property-Based Tests for Root Cause Analyzer
 * 
 * These tests validate the correctness properties defined in the design document
 * using fast-check for property-based testing.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  analyzeRootCauses,
  detectChronicIssues,
  detectCorrelations,
  calculateCorrelationStrength,
  getChronicIssueThreshold,
  hasChronicIssue,
  validateCorrelationSymmetry,
  countChemicalIssues,
} from './rootCauseAnalyzer';
import type { ServiceLog, ChemicalReading } from './types';

// ============================================================================
// Generators for Property-Based Testing
// ============================================================================

/**
 * Generator for valid chemical readings
 */
const chemicalReadingArb = fc.constantFrom<ChemicalReading>('good', 'low', 'high', 'critical');

/**
 * Generator for non-good chemical readings (for creating issues)
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
 * Generator for a service log with a specific chemical having an issue
 */
const serviceLogWithIssueArb = (
  chemical: 'ph' | 'chlorine' | 'alkalinity' | 'stabilizer'
) => fc.record({
  id: fc.integer({ min: 1, max: 10000 }),
  service_date: dateStringArb,
  ph: chemical === 'ph' ? nonGoodReadingArb : chemicalReadingArb,
  chlorine: chemical === 'chlorine' ? nonGoodReadingArb : chemicalReadingArb,
  alkalinity: chemical === 'alkalinity' ? nonGoodReadingArb : chemicalReadingArb,
  stabilizer: chemical === 'stabilizer' ? nonGoodReadingArb : chemicalReadingArb,
  notes: fc.option(fc.string(), { nil: undefined }),
});

/**
 * Generator for chemical names
 */
const chemicalNameArb = fc.constantFrom<'ph' | 'chlorine' | 'alkalinity' | 'stabilizer'>(
  'ph', 'chlorine', 'alkalinity', 'stabilizer'
);

// ============================================================================
// Property Tests
// ============================================================================

describe('Root Cause Analyzer - Property Tests', () => {
  /**
   * **Feature: ai-pool-summarizer, Property 6: Chronic Issue Detection Threshold**
   * 
   * *For any* chemical that shows the same problem (low/high/critical) in more 
   * than 3 service logs, the AI_Pool_Summarizer SHALL flag it as a chronic issue.
   * 
   * **Validates: Requirements 3.2**
   */
  describe('Property 6: Chronic Issue Detection Threshold', () => {
    const THRESHOLD = getChronicIssueThreshold();

    it('chemicals with more than 3 issues should be flagged as chronic', () => {
      fc.assert(
        fc.property(
          chemicalNameArb,
          fc.integer({ min: THRESHOLD + 1, max: 15 }),
          (chemical, issueCount) => {
            // Generate logs where the specified chemical has issues
            const logs: ServiceLog[] = [];
            for (let i = 0; i < issueCount; i++) {
              logs.push({
                id: i + 1,
                service_date: `2024-01-${String(i + 1).padStart(2, '0')}`,
                ph: chemical === 'ph' ? 'low' : 'good',
                chlorine: chemical === 'chlorine' ? 'low' : 'good',
                alkalinity: chemical === 'alkalinity' ? 'low' : 'good',
                stabilizer: chemical === 'stabilizer' ? 'low' : 'good',
              });
            }

            const chronicIssues = detectChronicIssues(logs);
            
            // Should find a chronic issue for this chemical
            const foundIssue = chronicIssues.find(issue => issue.chemical === chemical);
            expect(foundIssue).toBeDefined();
            expect(foundIssue!.occurrences).toBe(issueCount);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('chemicals with exactly 3 or fewer issues should NOT be flagged as chronic', () => {
      fc.assert(
        fc.property(
          chemicalNameArb,
          fc.integer({ min: 1, max: THRESHOLD }),
          (chemical, issueCount) => {
            // Generate logs where the specified chemical has issues
            const logs: ServiceLog[] = [];
            for (let i = 0; i < issueCount; i++) {
              logs.push({
                id: i + 1,
                service_date: `2024-01-${String(i + 1).padStart(2, '0')}`,
                ph: chemical === 'ph' ? 'low' : 'good',
                chlorine: chemical === 'chlorine' ? 'low' : 'good',
                alkalinity: chemical === 'alkalinity' ? 'low' : 'good',
                stabilizer: chemical === 'stabilizer' ? 'low' : 'good',
              });
            }

            const chronicIssues = detectChronicIssues(logs);
            
            // Should NOT find a chronic issue for this chemical
            const foundIssue = chronicIssues.find(issue => issue.chemical === chemical);
            expect(foundIssue).toBeUndefined();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('chronic issue threshold is 3', () => {
      expect(getChronicIssueThreshold()).toBe(3);
    });

    it('hasChronicIssue correctly identifies threshold boundary', () => {
      expect(hasChronicIssue(0)).toBe(false);
      expect(hasChronicIssue(1)).toBe(false);
      expect(hasChronicIssue(2)).toBe(false);
      expect(hasChronicIssue(3)).toBe(false);
      expect(hasChronicIssue(4)).toBe(true);
      expect(hasChronicIssue(5)).toBe(true);
      expect(hasChronicIssue(100)).toBe(true);
    });

    it('chronic issues include occurrence count and suggested investigation', () => {
      fc.assert(
        fc.property(
          chemicalNameArb,
          fc.integer({ min: THRESHOLD + 1, max: 10 }),
          (chemical, issueCount) => {
            const logs: ServiceLog[] = [];
            for (let i = 0; i < issueCount; i++) {
              logs.push({
                id: i + 1,
                service_date: `2024-01-${String(i + 1).padStart(2, '0')}`,
                ph: chemical === 'ph' ? 'high' : 'good',
                chlorine: chemical === 'chlorine' ? 'high' : 'good',
                alkalinity: chemical === 'alkalinity' ? 'high' : 'good',
                stabilizer: chemical === 'stabilizer' ? 'high' : 'good',
              });
            }

            const chronicIssues = detectChronicIssues(logs);
            const foundIssue = chronicIssues.find(issue => issue.chemical === chemical);
            
            expect(foundIssue).toBeDefined();
            expect(foundIssue!.occurrences).toBeGreaterThan(THRESHOLD);
            expect(foundIssue!.pattern).toBeTruthy();
            expect(foundIssue!.suggestedInvestigation).toBeTruthy();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('multiple chemicals can have chronic issues simultaneously', () => {
      // Create logs where multiple chemicals have issues
      const logs: ServiceLog[] = [];
      for (let i = 0; i < 5; i++) {
        logs.push({
          id: i + 1,
          service_date: `2024-01-${String(i + 1).padStart(2, '0')}`,
          ph: 'low',
          chlorine: 'high',
          alkalinity: 'good',
          stabilizer: 'good',
        });
      }

      const chronicIssues = detectChronicIssues(logs);
      
      // Should find chronic issues for both pH and chlorine
      const phIssue = chronicIssues.find(issue => issue.chemical === 'ph');
      const chlorineIssue = chronicIssues.find(issue => issue.chemical === 'chlorine');
      
      expect(phIssue).toBeDefined();
      expect(chlorineIssue).toBeDefined();
    });

    it('empty logs should produce no chronic issues', () => {
      const chronicIssues = detectChronicIssues([]);
      expect(chronicIssues).toHaveLength(0);
    });

    it('all good readings should produce no chronic issues', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 20 }),
          (logCount) => {
            const logs: ServiceLog[] = [];
            for (let i = 0; i < logCount; i++) {
              logs.push({
                id: i + 1,
                service_date: `2024-01-${String((i % 28) + 1).padStart(2, '0')}`,
                ph: 'good',
                chlorine: 'good',
                alkalinity: 'good',
                stabilizer: 'good',
              });
            }

            const chronicIssues = detectChronicIssues(logs);
            expect(chronicIssues).toHaveLength(0);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Feature: ai-pool-summarizer, Property 13: Chemical Correlation Symmetry**
   * 
   * *For any* detected correlation between chemicals A and B, if correlation(A, B) 
   * exists, then the correlation strength SHALL be the same regardless of order.
   * 
   * **Validates: Requirements 3.1**
   */
  describe('Property 13: Chemical Correlation Symmetry', () => {
    it('correlation strength is symmetric for any two chemicals', () => {
      fc.assert(
        fc.property(
          fc.array(serviceLogArb, { minLength: 2, maxLength: 20 }),
          chemicalNameArb,
          chemicalNameArb,
          (logs, chemA, chemB) => {
            const strengthAB = calculateCorrelationStrength(logs, chemA, chemB);
            const strengthBA = calculateCorrelationStrength(logs, chemB, chemA);
            
            // Correlation strength should be the same regardless of order
            // Use precision of 5 decimal places to account for floating-point arithmetic
            expect(strengthAB).toBeCloseTo(strengthBA, 5);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('validateCorrelationSymmetry returns true for all chemical pairs', () => {
      fc.assert(
        fc.property(
          fc.array(serviceLogArb, { minLength: 1, maxLength: 15 }),
          chemicalNameArb,
          chemicalNameArb,
          (logs, chemA, chemB) => {
            expect(validateCorrelationSymmetry(logs, chemA, chemB)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('correlation strength is between 0 and 1', () => {
      fc.assert(
        fc.property(
          fc.array(serviceLogArb, { minLength: 0, maxLength: 20 }),
          chemicalNameArb,
          chemicalNameArb,
          (logs, chemA, chemB) => {
            const strength = calculateCorrelationStrength(logs, chemA, chemB);
            
            expect(strength).toBeGreaterThanOrEqual(0);
            expect(strength).toBeLessThanOrEqual(1);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('correlation strength is 0 for empty logs', () => {
      const chemicals: Array<'ph' | 'chlorine' | 'alkalinity' | 'stabilizer'> = [
        'ph', 'chlorine', 'alkalinity', 'stabilizer'
      ];

      for (const chemA of chemicals) {
        for (const chemB of chemicals) {
          expect(calculateCorrelationStrength([], chemA, chemB)).toBe(0);
        }
      }
    });

    it('correlation strength is 1 when issues always co-occur', () => {
      // Create logs where pH and chlorine always have issues together
      const logs: ServiceLog[] = [];
      for (let i = 0; i < 5; i++) {
        logs.push({
          id: i + 1,
          service_date: `2024-01-${String(i + 1).padStart(2, '0')}`,
          ph: 'low',
          chlorine: 'low',
          alkalinity: 'good',
          stabilizer: 'good',
        });
      }

      const strength = calculateCorrelationStrength(logs, 'ph', 'chlorine');
      expect(strength).toBe(1);
    });

    it('correlation strength is 0 when no issues exist', () => {
      const logs: ServiceLog[] = [];
      for (let i = 0; i < 5; i++) {
        logs.push({
          id: i + 1,
          service_date: `2024-01-${String(i + 1).padStart(2, '0')}`,
          ph: 'good',
          chlorine: 'good',
          alkalinity: 'good',
          stabilizer: 'good',
        });
      }

      const strength = calculateCorrelationStrength(logs, 'ph', 'chlorine');
      expect(strength).toBe(0);
    });

    it('detected correlations have symmetric strength values', () => {
      fc.assert(
        fc.property(
          fc.array(serviceLogArb, { minLength: 5, maxLength: 20 }),
          (logs) => {
            const correlations = detectCorrelations(logs);
            
            for (const correlation of correlations) {
              const [chemA, chemB] = correlation.chemicals as [
                'ph' | 'chlorine' | 'alkalinity' | 'stabilizer',
                'ph' | 'chlorine' | 'alkalinity' | 'stabilizer'
              ];
              
              const strengthAB = calculateCorrelationStrength(logs, chemA, chemB);
              const strengthBA = calculateCorrelationStrength(logs, chemB, chemA);
              
              // Use precision of 5 decimal places to account for floating-point arithmetic
              expect(strengthAB).toBeCloseTo(strengthBA, 5);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Additional tests for root cause analysis structure
   */
  describe('Root Cause Analysis Structure', () => {
    it('analyzeRootCauses returns valid structure', () => {
      fc.assert(
        fc.property(
          fc.array(serviceLogArb, { minLength: 0, maxLength: 15 }),
          (logs) => {
            const analysis = analyzeRootCauses({ serviceLogs: logs });
            
            expect(Array.isArray(analysis.correlations)).toBe(true);
            expect(Array.isArray(analysis.rootCauses)).toBe(true);
            expect(Array.isArray(analysis.chronicIssues)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('root causes have required fields', () => {
      // Create logs that will trigger root causes
      const logs: ServiceLog[] = [];
      for (let i = 0; i < 5; i++) {
        logs.push({
          id: i + 1,
          service_date: `2024-01-${String(i + 1).padStart(2, '0')}`,
          ph: 'low',
          chlorine: 'low',
          alkalinity: 'low',
          stabilizer: 'high',
        });
      }

      const analysis = analyzeRootCauses({ serviceLogs: logs });
      
      for (const rootCause of analysis.rootCauses) {
        expect(rootCause.id).toBeTruthy();
        expect(rootCause.symptom).toBeTruthy();
        expect(rootCause.cause).toBeTruthy();
        expect(rootCause.confidence).toBeGreaterThanOrEqual(0);
        expect(rootCause.confidence).toBeLessThanOrEqual(100);
        expect(Array.isArray(rootCause.evidence)).toBe(true);
        expect(rootCause.solution).toBeDefined();
        expect(rootCause.solution.immediate).toBeTruthy();
        expect(rootCause.solution.longTerm).toBeTruthy();
        expect(rootCause.recurrenceCount).toBeGreaterThan(0);
      }
    });

    it('correlations have required fields', () => {
      // Create logs that will trigger correlations
      const logs: ServiceLog[] = [];
      for (let i = 0; i < 5; i++) {
        logs.push({
          id: i + 1,
          service_date: `2024-01-${String(i + 1).padStart(2, '0')}`,
          ph: 'low',
          chlorine: 'good',
          alkalinity: 'low',
          stabilizer: 'good',
        });
      }

      const correlations = detectCorrelations(logs);
      
      for (const correlation of correlations) {
        expect(correlation.chemicals).toHaveLength(2);
        expect(['positive', 'negative', 'causal']).toContain(correlation.correlationType);
        expect(correlation.strength).toBeGreaterThanOrEqual(0);
        expect(correlation.strength).toBeLessThanOrEqual(1);
        expect(correlation.description).toBeTruthy();
        expect(correlation.implication).toBeTruthy();
      }
    });
  });
});
