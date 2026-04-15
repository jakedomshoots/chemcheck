/**
 * Property-Based Tests for Natural Language Generator
 * 
 * These tests validate the correctness properties defined in the design document
 * using fast-check for property-based testing.
 * 
 * Properties tested:
 * - Property 10: Summary Generation Completeness
 * - Property 11: Customer Report Tone Appropriateness
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  generateProfessionalSummary,
  generateCustomerReport,
  determineTone,
  isCompleteSummary,
  isToneAppropriate,
  type LanguageGeneratorInput,
} from './languageGenerator';
import type {
  PoolHealthScore,
  ChemicalTrend,
  PoolProblem,
  CategorizedRecommendations,
  HealthGrade,
  TrendDirection,
  ChemicalReading,
  ProblemSeverity,
  SummaryTone,
} from './types';

// ============================================================================
// Generators for Property-Based Testing
// ============================================================================

/**
 * Generator for valid health grades
 */
const healthGradeArb = fc.constantFrom<HealthGrade>('A', 'B', 'C', 'D', 'F');

/**
 * Generator for trend directions
 */
const trendDirectionArb = fc.constantFrom<TrendDirection>('improving', 'stable', 'declining');

/**
 * Generator for chemical readings
 */
const chemicalReadingArb = fc.constantFrom<ChemicalReading>('good', 'low', 'high', 'critical');

/**
 * Generator for problem severity
 */
const problemSeverityArb = fc.constantFrom<ProblemSeverity>('low', 'medium', 'high', 'critical');

/**
 * Generator for chemical names
 */
const chemicalNameArb = fc.constantFrom('ph', 'chlorine', 'alkalinity', 'stabilizer', 'salt');

/**
 * Generator for valid health scores (0-100) with matching grade
 */
const healthScoreArb: fc.Arbitrary<PoolHealthScore> = fc.integer({ min: 0, max: 100 }).chain(score => {
  const grade: HealthGrade = 
    score >= 80 ? 'A' :
    score >= 60 ? 'B' :
    score >= 40 ? 'C' :
    score >= 20 ? 'D' : 'F';
  
  return fc.record({
    score: fc.constant(score),
    grade: fc.constant(grade),
    breakdown: fc.array(
      fc.record({
        chemical: chemicalNameArb,
        score: fc.integer({ min: 0, max: 100 }),
        weight: fc.integer({ min: 10, max: 50 }).map(n => n / 100),
        contribution: fc.integer({ min: 0, max: 5000 }).map(n => n / 100),
      }),
      { minLength: 0, maxLength: 5 }
    ),
    trend: trendDirectionArb,
    confidence: fc.integer({ min: 0, max: 100 }),
  });
});

/**
 * Generator for chemical trends
 */
const chemicalTrendArb: fc.Arbitrary<ChemicalTrend> = fc.record({
  chemical: chemicalNameArb,
  trend: trendDirectionArb,
  currentStatus: chemicalReadingArb,
  history: fc.array(chemicalReadingArb, { minLength: 1, maxLength: 10 }),
  confidence: fc.integer({ min: 0, max: 100 }),
});

/**
 * Generator for date strings in YYYY-MM-DD format
 */
const dateStringArb = fc.tuple(
  fc.integer({ min: 2020, max: 2025 }),
  fc.integer({ min: 1, max: 12 }),
  fc.integer({ min: 1, max: 28 })
).map(([year, month, day]) => 
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
);

/**
 * Generator for pool problems
 */
const poolProblemArb: fc.Arbitrary<PoolProblem> = fc.record({
  id: fc.uuid(),
  chemical: chemicalNameArb,
  severity: problemSeverityArb,
  description: fc.string({ minLength: 5, maxLength: 50 }),
  occurrences: fc.integer({ min: 1, max: 20 }),
  firstDetected: dateStringArb,
  lastDetected: dateStringArb,
});

/**
 * Generator for recommendations
 */
const recommendationArb = fc.record({
  id: fc.uuid(),
  priority: fc.integer({ min: 1, max: 10 }),
  action: fc.string({ minLength: 5, maxLength: 50 }),
  reason: fc.string({ minLength: 5, maxLength: 50 }),
  chemical: fc.option(chemicalNameArb, { nil: null }),
  dosage: fc.option(fc.string(), { nil: null }),
  equipmentCheck: fc.option(fc.string(), { nil: null }),
  addressesIssue: fc.string(),
  preventsFuture: fc.boolean(),
});

/**
 * Generator for categorized recommendations
 */
const categorizedRecommendationsArb: fc.Arbitrary<CategorizedRecommendations> = fc.record({
  immediate: fc.array(recommendationArb, { minLength: 0, maxLength: 3 }),
  thisVisit: fc.array(recommendationArb, { minLength: 0, maxLength: 3 }),
  nextVisit: fc.array(recommendationArb, { minLength: 0, maxLength: 3 }),
  longTerm: fc.array(recommendationArb, { minLength: 0, maxLength: 3 }),
});

/**
 * Generator for customer names
 */
const customerNameArb = fc.string({ minLength: 3, maxLength: 15 }).filter(s => s.trim().length > 0);


/**
 * Generator for complete LanguageGeneratorInput
 */
const languageGeneratorInputArb: fc.Arbitrary<LanguageGeneratorInput> = fc.record({
  customerName: customerNameArb,
  healthScore: healthScoreArb,
  chemicalTrends: fc.array(chemicalTrendArb, { minLength: 0, maxLength: 5 }),
  problems: fc.array(poolProblemArb, { minLength: 0, maxLength: 5 }),
  recommendations: categorizedRecommendationsArb,
});

// ============================================================================
// Property Tests
// ============================================================================

describe('Natural Language Generator - Property Tests', () => {
  /**
   * **Feature: ai-pool-summarizer, Property 10: Summary Generation Completeness**
   * 
   * *For any* valid pool analysis, the generated summary SHALL contain a non-empty 
   * headline, paragraph, and at least one bullet point.
   * 
   * **Validates: Requirements 1.1, 4.1**
   */
  describe('Property 10: Summary Generation Completeness', () => {
    it('generated summary should always have non-empty headline, paragraph, and at least one bullet point', () => {
      fc.assert(
        fc.property(
          languageGeneratorInputArb,
          (input) => {
            const summary = generateProfessionalSummary(input);
            
            // Headline must be non-empty string
            expect(typeof summary.headline).toBe('string');
            expect(summary.headline.length).toBeGreaterThan(0);
            
            // Paragraph must be non-empty string
            expect(typeof summary.paragraph).toBe('string');
            expect(summary.paragraph.length).toBeGreaterThan(0);
            
            // Must have at least one bullet point
            expect(Array.isArray(summary.bulletPoints)).toBe(true);
            expect(summary.bulletPoints.length).toBeGreaterThanOrEqual(1);
            
            // All bullet points must be non-empty strings
            for (const bullet of summary.bulletPoints) {
              expect(typeof bullet).toBe('string');
              expect(bullet.length).toBeGreaterThan(0);
            }
            
            // Tone must be valid
            expect(['positive', 'neutral', 'concerned', 'urgent']).toContain(summary.tone);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('isCompleteSummary helper correctly validates summaries', () => {
      fc.assert(
        fc.property(
          languageGeneratorInputArb,
          (input) => {
            const summary = generateProfessionalSummary(input);
            expect(isCompleteSummary(summary)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('headline should include health score', () => {
      fc.assert(
        fc.property(
          languageGeneratorInputArb,
          (input) => {
            const summary = generateProfessionalSummary(input);
            // Headline should contain the score
            expect(summary.headline).toContain(String(input.healthScore.score));
          }
        ),
        { numRuns: 100 }
      );
    });

    it('paragraph should describe pool condition', () => {
      fc.assert(
        fc.property(
          languageGeneratorInputArb,
          (input) => {
            const summary = generateProfessionalSummary(input);
            // Paragraph should mention the score
            expect(summary.paragraph).toContain(String(input.healthScore.score));
            // Paragraph should mention condition
            expect(summary.paragraph.toLowerCase()).toMatch(/condition|status|health/);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('bullet points should include health score information', () => {
      fc.assert(
        fc.property(
          languageGeneratorInputArb,
          (input) => {
            const summary = generateProfessionalSummary(input);
            // First bullet should be about health score
            const firstBullet = summary.bulletPoints[0].toLowerCase();
            expect(firstBullet).toMatch(/health|score|grade/);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Feature: ai-pool-summarizer, Property 11: Customer Report Tone Appropriateness**
   * 
   * *For any* pool with health score below 40, the customer report tone SHALL be 
   * 'concerned' or 'urgent', not 'positive'.
   * 
   * **Validates: Requirements 4.2, 4.3**
   */
  describe('Property 11: Customer Report Tone Appropriateness', () => {
    it('pools with health score below 40 should have concerned or urgent tone', () => {
      // Generate inputs specifically with low health scores
      const lowScoreInputArb = fc.integer({ min: 0, max: 39 }).chain(score => {
        const grade: HealthGrade = score >= 20 ? 'D' : 'F';
        
        return fc.record({
          customerName: customerNameArb,
          healthScore: fc.record({
            score: fc.constant(score),
            grade: fc.constant(grade),
            breakdown: fc.array(
              fc.record({
                chemical: chemicalNameArb,
                score: fc.integer({ min: 0, max: 100 }),
                weight: fc.integer({ min: 10, max: 50 }).map(n => n / 100),
                contribution: fc.integer({ min: 0, max: 5000 }).map(n => n / 100),
              }),
              { minLength: 0, maxLength: 5 }
            ),
            trend: trendDirectionArb,
            confidence: fc.integer({ min: 0, max: 100 }),
          }),
          chemicalTrends: fc.array(chemicalTrendArb, { minLength: 0, maxLength: 5 }),
          problems: fc.array(poolProblemArb, { minLength: 0, maxLength: 5 }),
          recommendations: categorizedRecommendationsArb,
        });
      });

      fc.assert(
        fc.property(
          lowScoreInputArb,
          (input) => {
            const summary = generateProfessionalSummary(input);
            
            // For scores below 40, tone must be 'concerned' or 'urgent'
            expect(['concerned', 'urgent']).toContain(summary.tone);
            
            // Verify using helper function
            expect(isToneAppropriate(input.healthScore.score, summary.tone)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('determineTone returns appropriate tone for all score ranges', () => {
      // Test specific boundaries
      expect(determineTone(100)).toBe('positive');
      expect(determineTone(80)).toBe('positive');
      expect(determineTone(79)).toBe('neutral');
      expect(determineTone(60)).toBe('neutral');
      expect(determineTone(59)).toBe('concerned');
      expect(determineTone(40)).toBe('concerned');
      expect(determineTone(39)).toBe('urgent');
      expect(determineTone(0)).toBe('urgent');
    });

    it('tone should never be positive for scores below 40', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 39 }),
          (score) => {
            const tone = determineTone(score);
            expect(tone).not.toBe('positive');
            expect(tone).not.toBe('neutral');
            expect(['concerned', 'urgent']).toContain(tone);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('isToneAppropriate correctly validates tone for low scores', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 39 }),
          fc.constantFrom<SummaryTone>('positive', 'neutral', 'concerned', 'urgent'),
          (score, tone) => {
            const isAppropriate = isToneAppropriate(score, tone);
            
            if (tone === 'positive' || tone === 'neutral') {
              // Positive and neutral are NOT appropriate for low scores
              expect(isAppropriate).toBe(false);
            } else {
              // Concerned and urgent ARE appropriate for low scores
              expect(isAppropriate).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('isToneAppropriate allows any tone for scores >= 40', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 40, max: 100 }),
          fc.constantFrom<SummaryTone>('positive', 'neutral', 'concerned', 'urgent'),
          (score, tone) => {
            // Any tone is acceptable for higher scores
            expect(isToneAppropriate(score, tone)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Additional tests for customer report generation
   */
  describe('Customer Report Generation', () => {
    it('customer report should have all required fields', () => {
      fc.assert(
        fc.property(
          languageGeneratorInputArb,
          (input) => {
            const report = generateCustomerReport(input);
            
            // All fields must be present and non-empty
            expect(typeof report.greeting).toBe('string');
            expect(report.greeting.length).toBeGreaterThan(0);
            
            expect(typeof report.healthSummary).toBe('string');
            expect(report.healthSummary.length).toBeGreaterThan(0);
            
            expect(Array.isArray(report.whatWeDid)).toBe(true);
            expect(report.whatWeDid.length).toBeGreaterThan(0);
            
            expect(typeof report.whatToExpect).toBe('string');
            expect(report.whatToExpect.length).toBeGreaterThan(0);
            
            expect(Array.isArray(report.recommendations)).toBe(true);
            
            expect(typeof report.closingNote).toBe('string');
            expect(report.closingNote.length).toBeGreaterThan(0);
            
            expect(typeof report.shareableText).toBe('string');
            expect(report.shareableText.length).toBeGreaterThan(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('greeting should include customer first name', () => {
      fc.assert(
        fc.property(
          languageGeneratorInputArb,
          (input) => {
            const report = generateCustomerReport(input);
            const firstName = input.customerName.split(' ')[0];
            expect(report.greeting).toContain(firstName);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('shareable text should be concise (suitable for SMS)', () => {
      fc.assert(
        fc.property(
          languageGeneratorInputArb,
          (input) => {
            const report = generateCustomerReport(input);
            // SMS should be reasonably short (under 500 chars)
            expect(report.shareableText.length).toBeLessThan(500);
            // Should contain score
            expect(report.shareableText).toContain(String(input.healthScore.score));
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
