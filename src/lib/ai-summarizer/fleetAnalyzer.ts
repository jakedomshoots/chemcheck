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

export interface PoolData {
  customerId: string;
  customerName: string;
  healthScore: PoolHealthScore;
  primaryIssue: string | null;
  serviceDay: string;
  lastService: string;
  previousHealthScore?: number;
}

export interface FleetAnalyzerConfig {
  priorityPoolCount: number;
  scoreDropThreshold: number;
  overdueThresholdDays: number;
  estimatedTimePerPool: number;
}

export const DEFAULT_FLEET_CONFIG: FleetAnalyzerConfig = {
  priorityPoolCount: 5,
  scoreDropThreshold: 15,
  overdueThresholdDays: 14,
  estimatedTimePerPool: 30,
};

export function determineUrgency(healthScore: number): UrgencyLevel {
  if (healthScore < 20) return 'critical';
  if (healthScore < 40) return 'high';
  if (healthScore < 60) return 'medium';
  if (healthScore < 80) return 'low';
  return 'none';
}

export function calculateDaysSince(dateString: string): number {
  const date = new Date(dateString);
  const now = new Date();
  const diffTime = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
}

export function categorizeHealthScore(score: number): keyof HealthDistribution {
  if (score >= 80) return 'excellent';
  if (score >= 60) return 'good';
  if (score >= 40) return 'fair';
  return 'poor';
}

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

export function rankPoolsByHealthScore(pools: FleetPool[]): FleetPool[] {
  return [...pools].sort((a, b) => a.healthScore - b.healthScore);
}

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

export function calculateAverageHealthScore(pools: FleetPool[]): number {
  if (pools.length === 0) return 0;

  const sum = pools.reduce((acc, pool) => acc + pool.healthScore, 0);
  return sum / pools.length;
}

export function getPriorityPools(pools: FleetPool[], count: number = 5): FleetPool[] {
  const ranked = rankPoolsByHealthScore(pools);
  return ranked.slice(0, count);
}
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

  return clusters.sort((a, b) => b.pools.length - a.pools.length);
}

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
export function generateAlerts(
  pools: PoolData[],
  config: FleetAnalyzerConfig = DEFAULT_FLEET_CONFIG
): FleetAlert[] {
  const alerts: FleetAlert[] = [];

  for (const pool of pools) {
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

    const daysSinceService = calculateDaysSince(pool.lastService);
    if (daysSinceService >= config.overdueThresholdDays) {
      alerts.push({
        type: 'overdue',
        poolId: pool.customerId,
        message: `${pool.customerName} is overdue for service (${daysSinceService} days since last visit)`,
      });
    }

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

export function analyzeFleet(
  pools: PoolData[],
  config: Partial<FleetAnalyzerConfig> = {}
): FleetInsights {
  const fullConfig = { ...DEFAULT_FLEET_CONFIG, ...config };

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

  const fleetPools = pools.map(toFleetPool);

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
