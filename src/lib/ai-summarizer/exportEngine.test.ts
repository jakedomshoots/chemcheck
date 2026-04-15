/**
 * Property-Based Tests for Export Engine
 * 
 * These tests validate the correctness properties defined in the design document
 * using fast-check for property-based testing.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  getCurrentTimestamp,
  isTimestampAccurate,
  exportPoolAnalysis,
  exportFleetInsights,
  validateExportResult,
  validateExportTimestamp,
} from './exportEngine';
import type {
  PoolAnalysisResult,
  FleetInsights,
  PoolHealthScore,
  GeneratedSummary,
  CustomerReport,
  ChemicalTrend,
  CategorizedRecommendations,
  RootCauseAnalysis,
  PredictiveInsights,
  ExportFormat,
} from './types';

// ============================================================================
// Generators for Property-Based Testing
// ============================================================================


/**
 * Generator for valid health scores
 */
const healthScoreArb: fc.Arbitrary<PoolHealthScore> = fc.record({
  score: fc.integer({ min: 0, max: 100 }),
  grade: fc.constantFrom('A', 'B', 'C', 'D', 'F') as fc.Arbitrary<'A' | 'B' | 'C' | 'D' | 'F'>,
  breakdown: fc.array(
    fc.record({
      chemical: fc.constantFrom('pH', 'Chlorine', 'Alkalinity', 'Stabilizer'),
      score: fc.integer({ min: 0, max: 100 }),
      weight: fc.float({ min: Math.fround(0.1), max: Math.fround(1) }),
      contribution: fc.float({ min: Math.fround(0), max: Math.fround(50) }),
    }),
    { minLength: 1, maxLength: 4 }
  ),
  trend: fc.constantFrom('improving', 'stable', 'declining') as fc.Arbitrary<'improving' | 'stable' | 'declining'>,
  confidence: fc.integer({ min: 0, max: 100 }),
});

/**
 * Generator for generated summaries
 */
const generatedSummaryArb: fc.Arbitrary<GeneratedSummary> = fc.record({
  headline: fc.string({ minLength: 1, maxLength: 100 }),
  paragraph: fc.string({ minLength: 1, maxLength: 500 }),
  bulletPoints: fc.array(fc.string({ minLength: 1, maxLength: 100 }), { minLength: 1, maxLength: 5 }),
  callToAction: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: null }),
  tone: fc.constantFrom('positive', 'neutral', 'concerned', 'urgent') as fc.Arbitrary<'positive' | 'neutral' | 'concerned' | 'urgent'>,
});

/**
 * Generator for customer reports
 */
const customerReportArb: fc.Arbitrary<CustomerReport> = fc.record({
  greeting: fc.string({ minLength: 1, maxLength: 100 }),
  healthSummary: fc.string({ minLength: 1, maxLength: 300 }),
  whatWeDid: fc.array(fc.string({ minLength: 1, maxLength: 100 }), { minLength: 0, maxLength: 5 }),
  whatToExpect: fc.string({ minLength: 1, maxLength: 200 }),
  recommendations: fc.array(fc.string({ minLength: 1, maxLength: 100 }), { minLength: 0, maxLength: 5 }),
  closingNote: fc.string({ minLength: 1, maxLength: 100 }),
  shareableText: fc.string({ minLength: 1, maxLength: 300 }),
});


/**
 * Generator for date strings using integer-based approach to avoid invalid dates
 */
const dateStringArb = fc.integer({ min: 0, max: 2190 }).map(days => {
  const date = new Date('2020-01-01');
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0];
});

/**
 * Generator for minimal pool analysis result
 */
const poolAnalysisResultArb: fc.Arbitrary<PoolAnalysisResult> = fc.record({
  customerId: fc.string({ minLength: 1, maxLength: 20 }),
  customerName: fc.string({ minLength: 1, maxLength: 50 }),
  poolType: fc.constantFrom('Chlorine', 'Salt', 'Mineral'),
  poolGallons: fc.option(fc.integer({ min: 5000, max: 50000 }), { nil: null }),
  analysisDate: dateStringArb,
  dataRange: fc.record({
    start: dateStringArb,
    end: dateStringArb,
  }),
  totalServices: fc.integer({ min: 1, max: 100 }),
  healthScore: healthScoreArb,
  chemicalTrends: fc.array(
    fc.record({
      chemical: fc.constantFrom('pH', 'Chlorine', 'Alkalinity', 'Stabilizer'),
      trend: fc.constantFrom('improving', 'stable', 'declining') as fc.Arbitrary<'improving' | 'stable' | 'declining'>,
      currentStatus: fc.constantFrom('good', 'low', 'high', 'critical') as fc.Arbitrary<'good' | 'low' | 'high' | 'critical'>,
      history: fc.array(fc.constantFrom('good', 'low', 'high', 'critical') as fc.Arbitrary<'good' | 'low' | 'high' | 'critical'>, { minLength: 1, maxLength: 10 }),
      confidence: fc.integer({ min: 0, max: 100 }),
    }),
    { minLength: 0, maxLength: 4 }
  ),
  overallTrend: fc.constantFrom('improving', 'stable', 'declining') as fc.Arbitrary<'improving' | 'stable' | 'declining'>,
  problems: fc.constant([]),
  rootCauseAnalysis: fc.constant({ correlations: [], rootCauses: [], chronicIssues: [] }),
  predictiveInsights: fc.constant({
    predictions: [],
    overallOutlook: 'stable' as const,
    nextServiceRecommendation: { urgency: 'routine' as const, suggestedDate: '2025-01-01', reason: 'Regular maintenance' },
    seasonalFactors: [],
    weatherFactors: [],
  }),
  weatherImpact: fc.constant(null),
  costAnalysis: fc.constant(null),
  professionalSummary: generatedSummaryArb,
  customerReport: customerReportArb,
  recommendations: fc.constant({
    immediate: [],
    thisVisit: [],
    nextVisit: [],
    longTerm: [],
  }),
  learningInsights: fc.constant(null),
  confidence: fc.integer({ min: 0, max: 100 }),
  dataQuality: fc.constantFrom('excellent', 'good', 'fair', 'limited') as fc.Arbitrary<'excellent' | 'good' | 'fair' | 'limited'>,
  generatedAt: fc.constant(new Date().toISOString()),
});


/**
 * Generator for fleet insights
 */
const fleetInsightsArb: fc.Arbitrary<FleetInsights> = fc.record({
  totalPools: fc.integer({ min: 0, max: 100 }),
  averageHealthScore: fc.float({ min: Math.fround(0), max: Math.fround(100) }),
  healthDistribution: fc.record({
    excellent: fc.integer({ min: 0, max: 50 }),
    good: fc.integer({ min: 0, max: 50 }),
    fair: fc.integer({ min: 0, max: 50 }),
    poor: fc.integer({ min: 0, max: 50 }),
  }),
  priorityPools: fc.array(
    fc.record({
      customerId: fc.string({ minLength: 1, maxLength: 20 }),
      customerName: fc.string({ minLength: 1, maxLength: 50 }),
      healthScore: fc.integer({ min: 0, max: 100 }),
      urgency: fc.constantFrom('none', 'low', 'medium', 'high', 'critical') as fc.Arbitrary<'none' | 'low' | 'medium' | 'high' | 'critical'>,
      primaryIssue: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: null }),
      serviceDay: fc.constantFrom('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'),
      lastService: dateStringArb,
      daysSinceService: fc.integer({ min: 0, max: 30 }),
    }),
    { minLength: 0, maxLength: 5 }
  ),
  problemClusters: fc.array(
    fc.record({
      issue: fc.string({ minLength: 1, maxLength: 50 }),
      pools: fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 1, maxLength: 5 }),
      suggestedBatchAction: fc.string({ minLength: 1, maxLength: 100 }),
    }),
    { minLength: 0, maxLength: 5 }
  ),
  byServiceDay: fc.array(
    fc.record({
      day: fc.constantFrom('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'),
      poolCount: fc.integer({ min: 0, max: 20 }),
      averageHealth: fc.float({ min: Math.fround(0), max: Math.fround(100) }),
      estimatedTime: fc.integer({ min: 0, max: 600 }),
    }),
    { minLength: 0, maxLength: 5 }
  ),
  alerts: fc.array(
    fc.record({
      type: fc.constantFrom('score-drop', 'overdue', 'chronic-issue') as fc.Arbitrary<'score-drop' | 'overdue' | 'chronic-issue'>,
      poolId: fc.string({ minLength: 1, maxLength: 20 }),
      message: fc.string({ minLength: 1, maxLength: 100 }),
    }),
    { minLength: 0, maxLength: 10 }
  ),
});

/**
 * Generator for export formats
 */
const exportFormatArb = fc.constantFrom('pdf', 'csv', 'json') as fc.Arbitrary<ExportFormat>;


// ============================================================================
// Property Tests
// ============================================================================

describe('Export Engine - Property Tests', () => {
  /**
   * **Feature: ai-pool-summarizer, Property 12: Export Timestamp Accuracy**
   * 
   * *For any* export, the generatedAt timestamp SHALL be within 1 minute 
   * of the actual generation time.
   * 
   * **Validates: Requirements 10.5**
   */
  describe('Property 12: Export Timestamp Accuracy', () => {
    it('getCurrentTimestamp should return a timestamp within 1 minute of now', () => {
      fc.assert(
        fc.property(
          fc.constant(null), // No input needed, just run multiple times
          () => {
            const before = Date.now();
            const timestamp = getCurrentTimestamp();
            const after = Date.now();
            
            const timestampMs = new Date(timestamp).getTime();
            
            // Timestamp should be between before and after
            expect(timestampMs).toBeGreaterThanOrEqual(before);
            expect(timestampMs).toBeLessThanOrEqual(after);
            
            // And definitely within 1 minute (60000ms) of now
            expect(isTimestampAccurate(timestamp, 60000)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('pool analysis exports should have accurate timestamps', () => {
      fc.assert(
        fc.property(
          poolAnalysisResultArb,
          exportFormatArb,
          (analysis, format) => {
            const before = Date.now();
            const result = exportPoolAnalysis(analysis, { format });
            const after = Date.now();
            
            // Validate the export result structure
            expect(validateExportResult(result)).toBe(true);
            
            // Validate timestamp accuracy
            const timestampMs = new Date(result.generatedAt).getTime();
            expect(timestampMs).toBeGreaterThanOrEqual(before);
            expect(timestampMs).toBeLessThanOrEqual(after);
            
            // Within 1 minute tolerance
            expect(validateExportTimestamp(result, 60000)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('fleet insights exports should have accurate timestamps', () => {
      fc.assert(
        fc.property(
          fleetInsightsArb,
          exportFormatArb,
          (insights, format) => {
            const before = Date.now();
            const result = exportFleetInsights(insights, { format });
            const after = Date.now();
            
            // Validate the export result structure
            expect(validateExportResult(result)).toBe(true);
            
            // Validate timestamp accuracy
            const timestampMs = new Date(result.generatedAt).getTime();
            expect(timestampMs).toBeGreaterThanOrEqual(before);
            expect(timestampMs).toBeLessThanOrEqual(after);
            
            // Within 1 minute tolerance
            expect(validateExportTimestamp(result, 60000)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('isTimestampAccurate correctly identifies stale timestamps', () => {
      // A timestamp from 2 minutes ago should fail the 1-minute check
      const twoMinutesAgo = new Date(Date.now() - 120000).toISOString();
      expect(isTimestampAccurate(twoMinutesAgo, 60000)).toBe(false);
      
      // A timestamp from 30 seconds ago should pass
      const thirtySecondsAgo = new Date(Date.now() - 30000).toISOString();
      expect(isTimestampAccurate(thirtySecondsAgo, 60000)).toBe(true);
      
      // Current timestamp should always pass
      const now = new Date().toISOString();
      expect(isTimestampAccurate(now, 60000)).toBe(true);
    });
  });


  /**
   * Additional tests for export functionality
   */
  describe('Export Result Validation', () => {
    it('all pool analysis exports should have valid structure', () => {
      fc.assert(
        fc.property(
          poolAnalysisResultArb,
          exportFormatArb,
          (analysis, format) => {
            const result = exportPoolAnalysis(analysis, { format });
            
            // Should have all required fields
            expect(result.format).toBe(format);
            expect(result.filename).toBeTruthy();
            expect(result.data).toBeTruthy();
            expect(result.generatedAt).toBeTruthy();
            expect(result.dataRange).toBeTruthy();
            
            // Filename should contain the format extension
            if (format === 'pdf') {
              expect(result.filename).toContain('.html');
            } else {
              expect(result.filename).toContain(`.${format}`);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('all fleet exports should have valid structure', () => {
      fc.assert(
        fc.property(
          fleetInsightsArb,
          exportFormatArb,
          (insights, format) => {
            const result = exportFleetInsights(insights, { format });
            
            // Should have all required fields
            expect(result.format).toBe(format);
            expect(result.filename).toBeTruthy();
            expect(result.data).toBeTruthy();
            expect(result.generatedAt).toBeTruthy();
            expect(result.dataRange).toBeTruthy();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('CSV exports should produce valid CSV content', () => {
      fc.assert(
        fc.property(
          fleetInsightsArb,
          (insights) => {
            const result = exportFleetInsights(insights, { format: 'csv' });
            
            // CSV should be a string
            expect(typeof result.data).toBe('string');
            
            // Should have header row
            const lines = (result.data as string).split('\n');
            expect(lines.length).toBeGreaterThanOrEqual(1);
            
            // Header should contain expected columns
            const header = lines[0];
            expect(header).toContain('customerId');
            expect(header).toContain('customerName');
            expect(header).toContain('healthScore');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('JSON exports should produce valid JSON content', () => {
      fc.assert(
        fc.property(
          poolAnalysisResultArb,
          (analysis) => {
            const result = exportPoolAnalysis(analysis, { format: 'json' });
            
            // JSON should be a string
            expect(typeof result.data).toBe('string');
            
            // Should be parseable JSON
            const parsed = JSON.parse(result.data as string);
            expect(parsed).toBeTruthy();
            expect(parsed.customerId).toBe(analysis.customerId);
            expect(parsed.customerName).toBe(analysis.customerName);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('PDF exports should produce HTML Blob content', () => {
      fc.assert(
        fc.property(
          poolAnalysisResultArb,
          (analysis) => {
            const result = exportPoolAnalysis(analysis, { format: 'pdf' });
            
            // PDF (HTML) should be a Blob
            expect(result.data instanceof Blob).toBe(true);
            expect((result.data as Blob).type).toBe('text/html');
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
