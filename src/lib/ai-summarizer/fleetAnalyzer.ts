/**
 * Fleet Analyzer
 * 
 * Aggregates analysis across multiple pools for business-level insights.
 * Ranks pools by health score, groups by problem type, calculates averages
 * by service day, and generates alerts for score drops.
 * 
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5
 */

import {
  type FleetPool,
  type FleetInsights,
  type HealthDistribution,
  type ProblemCluster,
  type ServiceDayStats,
  type FleetAlert,
  type UrgencyLevel,
  type PoolHealthScore,
} from './types';

// ============================================================================
// Types for Fleet Analysis Input
// ============================================================================

export interface PoolData {
  customerId: string;
  customerName: string;
  healthScore: PoolHealthScore;
  primaryIssue: string | null;
  serviceDay: string;
  lastService: string;
  previousHealthScore?: number; // For detecting score drops
}

export interface FleetAnalyzerConfig {
  priorityPoolCount: number;      // Number of priority pools to return (default: 5)
  scoreDropThreshold: number;     // Minimum score drop to trigger alert (default: 15)
  overdueThresholdDays: number;   // Days since service to consider overdue (default: 14)
  estimatedTimePerPool: number;   // Minutes per pool for time estimation (default: 30)
}

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_FLEET_CONFIG: FleetAnalyzerConfig = {
  priorityPoolCount: 5,
  scoreDropThreshold: 15,
  overdueThresholdDays: 14,
  estimatedTimePerPool: 30,
};

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Determines urgency level based on health score
 */
export function determineUrgency(healthScore: number): UrgencyLevel {
  if (healthScore < 20) return 'critical';
  if (healthScore < 40) return 'high';
  if (healthScore < 60) return 'medium';
  if (healthScore < 80) return 'low';
  return 'none';
}

/**
 * Calculates days since a given date
 */
export function calculateDaysSince(dateString: string): number {
  const date = new Date(dateString);
  const now = new Date();
  const diffTime = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
}


/**
 * Categorizes health score into distribution bucket
 */
export function categorizeHealthScore(score: number): keyof HealthDistribution {
  if (score >= 80) return 'excellent';
  if (score >= 60) return 'good';
  if (score >= 40) return 'fair';
  return 'poor';
}

/**
 * Converts pool data to fleet pool format
 */
export function toFleetPool(pool: PoolData): FleetPool {
  const daysSinceService = calculateDaysSince(pool.lastService);
  
  return {
    customerId: pool.customerId,
    customerName: pool.customerName,
    healthScore: pool.healthScore.score,
    urgency: determineUrgency(pool.healthScore.score),
    primaryIssue: pool.primaryIssue,
    serviceDay: pool.serviceDay,
    lastService: pool.lastService,
    daysSinceService,
  };
}

// ============================================================================
// Core Analysis Functions
// ============================================================================

/**
 * Ranks pools by health score from lowest to highest
 * Requirement 7.1: Rank all pools by Pool_Health_Score from lowest to highest
 */
export function rankPoolsByHealthScore(pools: FleetPool[]): FleetPool[] {
  return [...pools].sort((a, b) => a.healthScore - b.healthScore);
}

/**
 * Calculates health distribution across the fleet
 */
export function calculateHealthDistribution(pools: FleetPool[]): HealthDistribution {
  const distribution: HealthDistribution = {
    excellent: 0,
    good: 0,
    fair: 0,
    poor: 0,
  };

  for (const pool of pools) {
    const category = categorizeHealthScore(pool.healthScore);
    distribution[category]++;
  }

  return distribution;
}

/**
 * Calculates average health score for the fleet
 * Property 9: Fleet Health Score Consistency - average equals sum/count
 */
export function calculateAverageHealthScore(pools: FleetPool[]): number {
  if (pools.length === 0) return 0;
  
  const sum = pools.reduce((acc, pool) => acc + pool.healthScore, 0);
  return sum / pools.length;
}

/**
 * Gets the top N pools requiring immediate attention
 * Requirement 7.3: Identify the top 5 pools requiring immediate attention
 */
export function getPriorityPools(
  pools: FleetPool[],
  count: number = 5
): FleetPool[] {
  const ranked = rankPoolsByHealthScore(pools);
  return ranked.slice(0, count);
}


/**
 * Groups pools by problem type for efficient batch addressing
 * Requirement 7.2: Group pools by problem type for efficient batch addressing
 */
export function groupPoolsByProblem(pools: FleetPool[]): ProblemCluster[] {
  const problemMap = new Map<string, string[]>();

  for (const pool of pools) {
    if (pool.primaryIssue) {
      const existing = problemMap.get(pool.primaryIssue) || [];
      existing.push(pool.customerName);
      problemMap.set(pool.primaryIssue, existing);
    }
  }

  const clusters: ProblemCluster[] = [];
  
  for (const [issue, poolNames] of problemMap.entries()) {
    clusters.push({
      issue,
      pools: poolNames,
      suggestedBatchAction: generateBatchAction(issue),
    });
  }

  // Sort by number of affected pools (descending)
  return clusters.sort((a, b) => b.pools.length - a.pools.length);
}

/**
 * Generates a suggested batch action for a given issue
 */
function generateBatchAction(issue: string): string {
  const issueActions: Record<string, string> = {
    'low chlorine': 'Add chlorine shock treatment to all affected pools',
    'high chlorine': 'Allow chlorine to dissipate naturally or add neutralizer',
    'low ph': 'Add pH increaser (sodium carbonate) to affected pools',
    'high ph': 'Add pH decreaser (muriatic acid) to affected pools',
    'low alkalinity': 'Add alkalinity increaser (sodium bicarbonate)',
    'high alkalinity': 'Add muriatic acid to lower alkalinity',
    'low stabilizer': 'Add cyanuric acid to affected pools',
    'high stabilizer': 'Partial drain and refill recommended',
    'algae growth': 'Apply algaecide treatment and brush pool surfaces',
    'cloudy water': 'Check filtration and add clarifier',
  };

  const lowerIssue = issue.toLowerCase();
  
  for (const [key, action] of Object.entries(issueActions)) {
    if (lowerIssue.includes(key)) {
      return action;
    }
  }

  return `Address ${issue} across all affected pools`;
}

/**
 * Calculates statistics by service day
 * Requirement 7.4: Calculate average health scores by service day for route optimization
 */
export function calculateServiceDayStats(
  pools: FleetPool[],
  estimatedTimePerPool: number = 30
): ServiceDayStats[] {
  const dayMap = new Map<string, FleetPool[]>();

  for (const pool of pools) {
    const day = pool.serviceDay;
    const existing = dayMap.get(day) || [];
    existing.push(pool);
    dayMap.set(day, existing);
  }

  const stats: ServiceDayStats[] = [];

  for (const [day, dayPools] of dayMap.entries()) {
    const avgHealth = calculateAverageHealthScore(dayPools);
    
    stats.push({
      day,
      poolCount: dayPools.length,
      averageHealth: Math.round(avgHealth * 100) / 100,
      estimatedTime: dayPools.length * estimatedTimePerPool,
    });
  }

  // Sort by day of week
  const dayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  return stats.sort((a, b) => {
    const aIndex = dayOrder.indexOf(a.day);
    const bIndex = dayOrder.indexOf(b.day);
    if (aIndex === -1 && bIndex === -1) return a.day.localeCompare(b.day);
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;
    return aIndex - bIndex;
  });
}


/**
 * Generates alerts for pools requiring attention
 * Requirement 7.5: Flag pools for priority attention when health score drops significantly
 */
export function generateAlerts(
  pools: PoolData[],
  config: FleetAnalyzerConfig = DEFAULT_FLEET_CONFIG
): FleetAlert[] {
  const alerts: FleetAlert[] = [];

  for (const pool of pools) {
    // Check for significant score drop
    if (
      pool.previousHealthScore !== undefined &&
      pool.previousHealthScore - pool.healthScore.score >= config.scoreDropThreshold
    ) {
      alerts.push({
        type: 'score-drop',
        poolId: pool.customerId,
        message: `${pool.customerName}'s health score dropped from ${pool.previousHealthScore} to ${pool.healthScore.score}`,
      });
    }

    // Check for overdue service
    const daysSinceService = calculateDaysSince(pool.lastService);
    if (daysSinceService >= config.overdueThresholdDays) {
      alerts.push({
        type: 'overdue',
        poolId: pool.customerId,
        message: `${pool.customerName} is overdue for service (${daysSinceService} days since last visit)`,
      });
    }

    // Check for chronic issues (indicated by low health score with issue)
    if (pool.healthScore.score < 40 && pool.primaryIssue) {
      alerts.push({
        type: 'chronic-issue',
        poolId: pool.customerId,
        message: `${pool.customerName} has chronic ${pool.primaryIssue} requiring investigation`,
      });
    }
  }

  return alerts;
}

// ============================================================================
// Main Fleet Analysis Function
// ============================================================================

/**
 * Analyzes the entire fleet and generates comprehensive insights
 * 
 * Requirements:
 * - 7.1: Rank all pools by Pool_Health_Score from lowest to highest
 * - 7.2: Group pools by problem type for efficient batch addressing
 * - 7.3: Identify the top 5 pools requiring immediate attention
 * - 7.4: Calculate average health scores by service day for route optimization
 * - 7.5: Flag pools for priority attention when health score drops significantly
 */
export function analyzeFleet(
  pools: PoolData[],
  config: Partial<FleetAnalyzerConfig> = {}
): FleetInsights {
  const fullConfig = { ...DEFAULT_FLEET_CONFIG, ...config };

  // Handle empty fleet
  if (pools.length === 0) {
    return {
      totalPools: 0,
      averageHealthScore: 0,
      healthDistribution: {
        excellent: 0,
        good: 0,
        fair: 0,
        poor: 0,
      },
      priorityPools: [],
      problemClusters: [],
      byServiceDay: [],
      alerts: [],
    };
  }

  // Convert to fleet pools
  const fleetPools = pools.map(toFleetPool);

  // Calculate all metrics
  const averageHealthScore = calculateAverageHealthScore(fleetPools);
  const healthDistribution = calculateHealthDistribution(fleetPools);
  const priorityPools = getPriorityPools(fleetPools, fullConfig.priorityPoolCount);
  const problemClusters = groupPoolsByProblem(fleetPools);
  const byServiceDay = calculateServiceDayStats(fleetPools, fullConfig.estimatedTimePerPool);
  const alerts = generateAlerts(pools, fullConfig);

  return {
    totalPools: pools.length,
    averageHealthScore: Math.round(averageHealthScore * 100) / 100,
    healthDistribution,
    priorityPools,
    problemClusters,
    byServiceDay,
    alerts,
  };
}
