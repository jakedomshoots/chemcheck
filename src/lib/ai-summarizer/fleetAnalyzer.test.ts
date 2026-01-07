/**
 * Property-Based Tests for Fleet Analyzer
 * 
 * These tests validate the correctness properties defined in the design document
 * using fast-check for property-based testing.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  analyzeFleet,
  calculateAverageHealthScore,
  rankPoolsByHealthScore,
  calculateHealthDistribution,
  getPriorityPools,
  groupPoolsByProblem,
  calculateServiceDayStats,
  generateAlerts,
  determineUrgency,
  categorizeHealthScore,
  toFleetPool,
  type PoolData,
  DEFAULT_FLEET_CONFIG,
} from './fleetAnalyzer';
import type { 
  FleetPool, 
  PoolHealthScore, 
  HealthGrade, 
  TrendDirection,
  ChemicalBreakdown,
} from './types';

// ============================================================================
// Generators for Property-Based Testing
// ============================================================================

/**
 * Generator for valid health grades
 */
const healthGradeArb = fc.constantFrom<HealthGrade>('A', 'B', 'C', 'D', 'F');

/**
 * Generator for valid trend directions
 */
const trendDirectionArb = fc.constantFrom<TrendDirection>('improving', 'stable', 'declining');

/**
 * Generator for service days
 */
const serviceDayArb = fc.constantFrom(
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'
);

/**
 * Generator for valid date strings in YYYY-MM-DD format
 */
const dateStringArb = fc.tuple(
  fc.integer({ min: 2020, max: 2025 }),
  fc.integer({ min: 1, max: 12 }),
  fc.integer({ min: 1, max: 28 })
).map(([year, month, day]) => 
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
);


/**
 * Generator for pool issues
 */
const poolIssueArb = fc.option(
  fc.constantFrom(
    'low chlorine',
    'high chlorine',
    'low ph',
    'high ph',
    'low alkalinity',
    'high alkalinity',
    'low stabilizer',
    'algae growth',
    'cloudy water'
  ),
  { nil: null }
);

/**
 * Generator for chemical breakdown
 */
const chemicalBreakdownArb: fc.Arbitrary<ChemicalBreakdown> = fc.record({
  chemical: fc.constantFrom('ph', 'chlorine', 'alkalinity', 'stabilizer'),
  score: fc.integer({ min: 0, max: 100 }),
  weight: fc.double({ min: 0.1, max: 0.5, noNaN: true }),
  contribution: fc.double({ min: 0, max: 50, noNaN: true }),
});

/**
 * Generator for valid health scores (0-100)
 */
const healthScoreValueArb = fc.integer({ min: 0, max: 100 });

/**
 * Generator for PoolHealthScore
 */
const poolHealthScoreArb: fc.Arbitrary<PoolHealthScore> = fc.record({
  score: healthScoreValueArb,
  grade: healthGradeArb,
  breakdown: fc.array(chemicalBreakdownArb, { minLength: 0, maxLength: 4 }),
  trend: trendDirectionArb,
  confidence: fc.integer({ min: 0, max: 100 }),
});

/**
 * Generator for PoolData
 */
const poolDataArb: fc.Arbitrary<PoolData> = fc.record({
  customerId: fc.uuid(),
  customerName: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
  healthScore: poolHealthScoreArb,
  primaryIssue: poolIssueArb,
  serviceDay: serviceDayArb,
  lastService: dateStringArb,
  previousHealthScore: fc.option(healthScoreValueArb, { nil: undefined }),
});

/**
 * Generator for FleetPool (for direct testing of fleet pool functions)
 */
const fleetPoolArb: fc.Arbitrary<FleetPool> = fc.record({
  customerId: fc.uuid(),
  customerName: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
  healthScore: healthScoreValueArb,
  urgency: fc.constantFrom('none', 'low', 'medium', 'high', 'critical'),
  primaryIssue: poolIssueArb,
  serviceDay: serviceDayArb,
  lastService: dateStringArb,
  daysSinceService: fc.integer({ min: 0, max: 365 }),
});

// ============================================================================
// Property Tests
// ============================================================================

describe('Fleet Analyzer - Property Tests', () => {
  /**
   * **Feature: ai-pool-summarizer, Property 9: Fleet Health Score Consistency**
   * 
   * *For any* fleet analysis, the average health score SHALL equal the sum of 
   * individual pool health scores divided by the number of pools.
   * 
   * **Validates: Requirements 7.1**
   */
  describe('Property 9: Fleet Health Score Consistency', () => {
    it('average health score equals sum of scores divided by pool count', () => {
      fc.assert(
        fc.property(
          fc.array(fleetPoolArb, { minLength: 1, maxLength: 50 }),
          (pools) => {
            const calculatedAverage = calculateAverageHealthScore(pools);
            const expectedAverage = pools.reduce((sum, p) => sum + p.healthScore, 0) / pools.length;
            
            // Allow for floating point precision differences
            expect(Math.abs(calculatedAverage - expectedAverage)).toBeLessThan(0.0001);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('fleet analysis average matches manual calculation', () => {
      fc.assert(
        fc.property(
          fc.array(poolDataArb, { minLength: 1, maxLength: 30 }),
          (pools) => {
            const insights = analyzeFleet(pools);
            
            // Calculate expected average from input pool health scores
            const expectedSum = pools.reduce((sum, p) => sum + p.healthScore.score, 0);
            const expectedAverage = expectedSum / pools.length;
            
            // The insights average should match (with rounding tolerance)
            expect(Math.abs(insights.averageHealthScore - expectedAverage)).toBeLessThan(0.01);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('empty fleet returns zero average', () => {
      const insights = analyzeFleet([]);
      expect(insights.averageHealthScore).toBe(0);
      expect(insights.totalPools).toBe(0);
    });

    it('single pool fleet has average equal to that pool score', () => {
      fc.assert(
        fc.property(
          poolDataArb,
          (pool) => {
            const insights = analyzeFleet([pool]);
            expect(insights.averageHealthScore).toBe(pool.healthScore.score);
          }
        ),
        { numRuns: 100 }
      );
    });
  });


  /**
   * Additional property tests for fleet analysis correctness
   */
  describe('Fleet Ranking Properties', () => {
    it('pools are ranked from lowest to highest health score', () => {
      fc.assert(
        fc.property(
          fc.array(fleetPoolArb, { minLength: 2, maxLength: 30 }),
          (pools) => {
            const ranked = rankPoolsByHealthScore(pools);
            
            // Verify sorted order
            for (let i = 1; i < ranked.length; i++) {
              expect(ranked[i].healthScore).toBeGreaterThanOrEqual(ranked[i - 1].healthScore);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('priority pools are the N lowest scoring pools', () => {
      fc.assert(
        fc.property(
          fc.array(fleetPoolArb, { minLength: 6, maxLength: 30 }),
          fc.integer({ min: 1, max: 5 }),
          (pools, count) => {
            const priority = getPriorityPools(pools, count);
            
            expect(priority.length).toBeLessThanOrEqual(count);
            
            // All priority pools should have scores <= any non-priority pool
            const priorityScores = priority.map(p => p.healthScore);
            const allScores = pools.map(p => p.healthScore).sort((a, b) => a - b);
            const lowestScores = allScores.slice(0, count);
            
            // Priority pool scores should be among the lowest
            for (const score of priorityScores) {
              expect(score).toBeLessThanOrEqual(Math.max(...lowestScores));
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Health Distribution Properties', () => {
    it('distribution counts sum to total pool count', () => {
      fc.assert(
        fc.property(
          fc.array(fleetPoolArb, { minLength: 0, maxLength: 50 }),
          (pools) => {
            const distribution = calculateHealthDistribution(pools);
            const total = distribution.excellent + distribution.good + 
                         distribution.fair + distribution.poor;
            
            expect(total).toBe(pools.length);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('categorization is consistent with score ranges', () => {
      fc.assert(
        fc.property(
          healthScoreValueArb,
          (score) => {
            const category = categorizeHealthScore(score);
            
            if (score >= 80) expect(category).toBe('excellent');
            else if (score >= 60) expect(category).toBe('good');
            else if (score >= 40) expect(category).toBe('fair');
            else expect(category).toBe('poor');
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Urgency Determination Properties', () => {
    it('urgency levels correspond to health score ranges', () => {
      fc.assert(
        fc.property(
          healthScoreValueArb,
          (score) => {
            const urgency = determineUrgency(score);
            
            if (score < 20) expect(urgency).toBe('critical');
            else if (score < 40) expect(urgency).toBe('high');
            else if (score < 60) expect(urgency).toBe('medium');
            else if (score < 80) expect(urgency).toBe('low');
            else expect(urgency).toBe('none');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('lower scores always have higher or equal urgency', () => {
      const urgencyOrder = ['none', 'low', 'medium', 'high', 'critical'];
      
      fc.assert(
        fc.property(
          healthScoreValueArb,
          healthScoreValueArb,
          (score1, score2) => {
            const urgency1 = determineUrgency(score1);
            const urgency2 = determineUrgency(score2);
            
            const index1 = urgencyOrder.indexOf(urgency1);
            const index2 = urgencyOrder.indexOf(urgency2);
            
            if (score1 < score2) {
              expect(index1).toBeGreaterThanOrEqual(index2);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Service Day Stats Properties', () => {
    it('total pools across all days equals input pool count', () => {
      fc.assert(
        fc.property(
          fc.array(fleetPoolArb, { minLength: 0, maxLength: 30 }),
          (pools) => {
            const stats = calculateServiceDayStats(pools);
            const totalFromStats = stats.reduce((sum, s) => sum + s.poolCount, 0);
            
            expect(totalFromStats).toBe(pools.length);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('estimated time is proportional to pool count', () => {
      const timePerPool = 30;
      
      fc.assert(
        fc.property(
          fc.array(fleetPoolArb, { minLength: 1, maxLength: 30 }),
          (pools) => {
            const stats = calculateServiceDayStats(pools, timePerPool);
            
            for (const dayStat of stats) {
              expect(dayStat.estimatedTime).toBe(dayStat.poolCount * timePerPool);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Problem Clustering Properties', () => {
    it('each pool with an issue appears in exactly one cluster', () => {
      fc.assert(
        fc.property(
          fc.array(fleetPoolArb, { minLength: 1, maxLength: 30 }),
          (pools) => {
            const clusters = groupPoolsByProblem(pools);
            
            // Count pools with issues
            const poolsWithIssues = pools.filter(p => p.primaryIssue !== null);
            
            // Count total pools in clusters
            const poolsInClusters = clusters.reduce((sum, c) => sum + c.pools.length, 0);
            
            expect(poolsInClusters).toBe(poolsWithIssues.length);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('clusters are sorted by pool count descending', () => {
      fc.assert(
        fc.property(
          fc.array(fleetPoolArb, { minLength: 1, maxLength: 30 }),
          (pools) => {
            const clusters = groupPoolsByProblem(pools);
            
            for (let i = 1; i < clusters.length; i++) {
              expect(clusters[i].pools.length).toBeLessThanOrEqual(clusters[i - 1].pools.length);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
