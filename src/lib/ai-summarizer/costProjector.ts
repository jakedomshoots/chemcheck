/**
 * Cost Projector
 * 
 * Forecasts chemical costs based on usage history and pool characteristics.
 * Calculates monthly projections with low/expected/high ranges, detects
 * high-maintenance pools, and identifies savings opportunities.
 * 
 * Requirements: 5.1, 5.2, 5.4, 5.5
 */

import {
  type CostProjection,
  type CostAnalysis,
  type CostEstimate,
  type ChemicalCostBreakdown,
  type ServiceLog,
  type ChemicalReading,
  isValidCostRange,
} from './types';

// ============================================================================
// Constants
// ============================================================================

/**
 * Average chemical costs per treatment (in dollars)
 * Based on typical pool service industry pricing
 */
const CHEMICAL_COSTS: Record<string, Record<string, number>> = {
  ph: {
    low: 8.50,      // pH increaser treatment
    high: 6.00,     // pH decreaser treatment
    critical: 15.00, // Emergency pH correction
  },
  chlorine: {
    low: 12.00,     // Standard chlorine addition
    critical: 25.00, // Shock treatment
  },
  alkalinity: {
    low: 10.00,     // Alkalinity increaser
    high: 6.00,     // Alkalinity decreaser (acid)
    critical: 18.00, // Major alkalinity correction
  },
  stabilizer: {
    low: 15.00,     // Cyanuric acid addition
    high: 50.00,    // Partial drain (water + labor)
    critical: 75.00, // Significant water replacement
  },
};

/**
 * Seasonal cost multipliers
 * Summer months typically require more chemicals
 */
const SEASONAL_MULTIPLIERS: Record<number, number> = {
  0: 0.7,   // January - low usage
  1: 0.7,   // February
  2: 0.85,  // March - spring startup
  3: 0.95,  // April
  4: 1.1,   // May
  5: 1.3,   // June - peak season
  6: 1.4,   // July - peak season
  7: 1.35,  // August - peak season
  8: 1.1,   // September
  9: 0.9,   // October
  10: 0.75, // November
  11: 0.7,  // December - low usage
};

/**
 * Threshold for high-maintenance pool classification
 * Pools exceeding this monthly cost are flagged
 */
const HIGH_MAINTENANCE_THRESHOLD = 150; // dollars per month

/**
 * Variance factors for low/high estimates
 */
const VARIANCE_FACTORS = {
  low: 0.7,   // 30% below expected
  high: 1.4,  // 40% above expected
};

/**
 * Minimum service logs required for reliable projections
 */
const MIN_LOGS_FOR_PROJECTION = 3;

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Gets the month name from a month index (0-11)
 */
function getMonthName(monthIndex: number, year: number): string {
  const date = new Date(year, monthIndex, 1);
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/**
 * Calculates the cost for a single chemical reading
 */
export function calculateChemicalCost(
  chemical: string,
  reading: ChemicalReading
): number {
  if (reading === 'good') {
    return 0;
  }

  const chemicalCosts = CHEMICAL_COSTS[chemical];
  if (!chemicalCosts) {
    return 0;
  }

  return chemicalCosts[reading] || 0;
}

/**
 * Calculates total cost from a service log
 */
export function calculateServiceLogCost(log: ServiceLog): number {
  let total = 0;
  
  total += calculateChemicalCost('ph', log.ph);
  total += calculateChemicalCost('chlorine', log.chlorine);
  total += calculateChemicalCost('alkalinity', log.alkalinity);
  total += calculateChemicalCost('stabilizer', log.stabilizer);
  
  return total;
}

/**
 * Groups service logs by month
 */
export function groupLogsByMonth(
  logs: ServiceLog[]
): Map<string, ServiceLog[]> {
  const grouped = new Map<string, ServiceLog[]>();
  
  for (const log of logs) {
    const date = new Date(log.service_date);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(log);
  }
  
  return grouped;
}

/**
 * Calculates average monthly cost from historical data
 */
export function calculateAverageMonthlyCost(logs: ServiceLog[]): number {
  if (logs.length === 0) {
    return 0;
  }

  const monthlyGroups = groupLogsByMonth(logs);
  
  if (monthlyGroups.size === 0) {
    return 0;
  }

  let totalCost = 0;
  for (const monthLogs of monthlyGroups.values()) {
    for (const log of monthLogs) {
      totalCost += calculateServiceLogCost(log);
    }
  }

  return totalCost / monthlyGroups.size;
}

/**
 * Analyzes chemical usage frequency from logs
 */
export function analyzeChemicalUsage(
  logs: ServiceLog[]
): Map<string, { count: number; readings: ChemicalReading[] }> {
  const usage = new Map<string, { count: number; readings: ChemicalReading[] }>();
  
  const chemicals = ['ph', 'chlorine', 'alkalinity', 'stabilizer'] as const;
  
  for (const chemical of chemicals) {
    usage.set(chemical, { count: 0, readings: [] });
  }
  
  for (const log of logs) {
    for (const chemical of chemicals) {
      const reading = log[chemical];
      if (reading && reading !== 'good') {
        const data = usage.get(chemical)!;
        data.count++;
        data.readings.push(reading);
      }
    }
  }
  
  return usage;
}

/**
 * Determines cost trend from historical data
 */
export function determineCostTrend(
  logs: ServiceLog[]
): 'decreasing' | 'stable' | 'increasing' {
  if (logs.length < 4) {
    return 'stable';
  }

  // Sort logs by date
  const sortedLogs = [...logs].sort(
    (a, b) => new Date(a.service_date).getTime() - new Date(b.service_date).getTime()
  );

  // Split into first half and second half
  const midpoint = Math.floor(sortedLogs.length / 2);
  const firstHalf = sortedLogs.slice(0, midpoint);
  const secondHalf = sortedLogs.slice(midpoint);

  // Calculate average cost for each half
  const firstHalfCost = firstHalf.reduce((sum, log) => sum + calculateServiceLogCost(log), 0) / firstHalf.length;
  const secondHalfCost = secondHalf.reduce((sum, log) => sum + calculateServiceLogCost(log), 0) / secondHalf.length;

  // Determine trend based on 15% threshold
  const changePercent = (secondHalfCost - firstHalfCost) / (firstHalfCost || 1);

  if (changePercent > 0.15) {
    return 'increasing';
  } else if (changePercent < -0.15) {
    return 'decreasing';
  }
  return 'stable';
}

/**
 * Detects significant usage pattern changes
 * Requirement 5.5
 */
export function detectUsagePatternChanges(
  logs: ServiceLog[]
): string[] {
  const alerts: string[] = [];
  
  if (logs.length < 6) {
    return alerts;
  }

  // Sort logs by date
  const sortedLogs = [...logs].sort(
    (a, b) => new Date(a.service_date).getTime() - new Date(b.service_date).getTime()
  );

  // Compare recent 3 logs vs previous logs
  const recentLogs = sortedLogs.slice(-3);
  const previousLogs = sortedLogs.slice(0, -3);

  const chemicals = ['ph', 'chlorine', 'alkalinity', 'stabilizer'] as const;

  for (const chemical of chemicals) {
    // Count non-good readings in each period
    const recentIssues = recentLogs.filter(log => log[chemical] !== 'good').length;
    const previousIssues = previousLogs.filter(log => log[chemical] !== 'good').length;
    
    const recentRate = recentIssues / recentLogs.length;
    const previousRate = previousIssues / previousLogs.length;

    // Alert if issue rate increased significantly (doubled or more)
    if (recentRate > 0.5 && previousRate < 0.3) {
      alerts.push(
        `${chemical.charAt(0).toUpperCase() + chemical.slice(1)} issues have increased significantly in recent services`
      );
    }
  }

  // Check for overall cost increase
  const recentCost = recentLogs.reduce((sum, log) => sum + calculateServiceLogCost(log), 0) / recentLogs.length;
  const previousCost = previousLogs.reduce((sum, log) => sum + calculateServiceLogCost(log), 0) / previousLogs.length;

  if (previousCost > 0 && recentCost > previousCost * 1.5) {
    alerts.push('Overall chemical costs have increased by more than 50% recently');
  }

  return alerts;
}

/**
 * Identifies potential savings opportunities
 */
export function identifySavingsOpportunities(
  logs: ServiceLog[],
  averageMonthlyCost: number
): string[] {
  const opportunities: string[] = [];
  const usage = analyzeChemicalUsage(logs);

  // Check for frequent pH issues (often indicates alkalinity problems)
  const phData = usage.get('ph')!;
  const alkalinityData = usage.get('alkalinity')!;
  
  if (phData.count > logs.length * 0.4 && alkalinityData.count > logs.length * 0.3) {
    opportunities.push(
      'Frequent pH and alkalinity adjustments suggest addressing root cause could reduce costs by 20-30%'
    );
  }

  // Check for high stabilizer issues (expensive to fix)
  const stabilizerData = usage.get('stabilizer')!;
  if (stabilizerData.readings.filter(r => r === 'high' || r === 'critical').length > 2) {
    opportunities.push(
      'Consider switching to unstabilized chlorine to prevent stabilizer buildup and costly drain-downs'
    );
  }

  // Check for frequent chlorine issues
  const chlorineData = usage.get('chlorine')!;
  if (chlorineData.count > logs.length * 0.5) {
    opportunities.push(
      'Frequent chlorine adjustments may indicate equipment issues - inspect chlorinator for potential savings'
    );
  }

  // High maintenance pool suggestion
  if (averageMonthlyCost > HIGH_MAINTENANCE_THRESHOLD) {
    opportunities.push(
      'This pool exceeds average maintenance costs - consider a comprehensive water chemistry audit'
    );
  }

  return opportunities;
}

// ============================================================================
// Cost Breakdown Generation
// ============================================================================

/**
 * Generates chemical cost breakdown for a projection period
 */
function generateCostBreakdown(
  logs: ServiceLog[],
  seasonalMultiplier: number
): ChemicalCostBreakdown[] {
  const breakdown: ChemicalCostBreakdown[] = [];
  const usage = analyzeChemicalUsage(logs);
  
  const chemicals = ['ph', 'chlorine', 'alkalinity', 'stabilizer'] as const;
  const chemicalNames: Record<string, string> = {
    ph: 'pH Adjustment',
    chlorine: 'Chlorine/Sanitizer',
    alkalinity: 'Alkalinity Balance',
    stabilizer: 'Stabilizer/CYA',
  };

  for (const chemical of chemicals) {
    const data = usage.get(chemical)!;
    if (data.count === 0) continue;

    // Calculate average cost per occurrence
    let totalCost = 0;
    for (const reading of data.readings) {
      totalCost += calculateChemicalCost(chemical, reading);
    }
    
    // Project monthly cost based on frequency
    const avgOccurrencesPerMonth = data.count / Math.max(1, groupLogsByMonth(logs).size);
    const projectedCost = (totalCost / data.count) * avgOccurrencesPerMonth * seasonalMultiplier;

    if (projectedCost > 0) {
      breakdown.push({
        chemical: chemicalNames[chemical],
        quantity: `~${Math.ceil(avgOccurrencesPerMonth * seasonalMultiplier)} treatments`,
        cost: Math.round(projectedCost * 100) / 100,
      });
    }
  }

  return breakdown;
}

/**
 * Compares cost to average and returns classification
 */
function compareToAverage(
  cost: number,
  averageCost: number
): 'below' | 'average' | 'above' {
  if (averageCost === 0) return 'average';
  
  const ratio = cost / averageCost;
  if (ratio < 0.85) return 'below';
  if (ratio > 1.15) return 'above';
  return 'average';
}

// ============================================================================
// Main Cost Projection Functions
// ============================================================================

export interface CostProjectorInput {
  serviceLogs: ServiceLog[];
  poolGallons?: number | null;
  projectionMonths?: number;
}

/**
 * Generates a single month's cost projection
 */
export function generateMonthProjection(
  logs: ServiceLog[],
  monthIndex: number,
  year: number,
  baseMonthlyCost: number
): CostProjection {
  const seasonalMultiplier = SEASONAL_MULTIPLIERS[monthIndex] || 1.0;
  const expectedCost = baseMonthlyCost * seasonalMultiplier;
  
  const estimate: CostEstimate = {
    low: Math.round(expectedCost * VARIANCE_FACTORS.low * 100) / 100,
    expected: Math.round(expectedCost * 100) / 100,
    high: Math.round(expectedCost * VARIANCE_FACTORS.high * 100) / 100,
  };

  const breakdown = generateCostBreakdown(logs, seasonalMultiplier);
  
  const factors: string[] = [];
  if (seasonalMultiplier > 1.1) {
    factors.push('Peak season - higher chemical demand expected');
  } else if (seasonalMultiplier < 0.8) {
    factors.push('Off-season - reduced chemical usage expected');
  }

  return {
    period: getMonthName(monthIndex, year),
    estimate,
    breakdown,
    factors,
    comparedToAverage: compareToAverage(expectedCost, baseMonthlyCost),
  };
}

/**
 * Generates complete cost analysis for a pool
 * 
 * Requirements:
 * - 5.1: Project monthly chemical costs for the next 3 months
 * - 5.2: Flag high-maintenance pools with cost implications
 * - 5.4: Provide a range (low/expected/high) rather than a single estimate
 * - 5.5: Alert when chemical usage patterns change significantly
 */
export function generateCostAnalysis(
  input: CostProjectorInput
): CostAnalysis | null {
  const { serviceLogs, projectionMonths = 3 } = input;

  // Need minimum data for projections
  if (serviceLogs.length < MIN_LOGS_FOR_PROJECTION) {
    return null;
  }

  // Calculate base monthly cost from historical data
  const baseMonthlyCost = calculateAverageMonthlyCost(serviceLogs);
  
  // If no costs detected, return null
  if (baseMonthlyCost === 0) {
    // Check if all readings are good (no costs)
    const hasAnyIssues = serviceLogs.some(log => 
      log.ph !== 'good' || 
      log.chlorine !== 'good' || 
      log.alkalinity !== 'good' || 
      log.stabilizer !== 'good'
    );
    
    if (!hasAnyIssues) {
      // Pool is in excellent condition - return minimal projection
      return createMinimalCostAnalysis(projectionMonths);
    }
    return null;
  }

  // Generate monthly projections
  const now = new Date();
  const monthlyProjections: CostProjection[] = [];
  
  for (let i = 0; i < projectionMonths; i++) {
    const projectionDate = new Date(now.getFullYear(), now.getMonth() + i + 1, 1);
    const projection = generateMonthProjection(
      serviceLogs,
      projectionDate.getMonth(),
      projectionDate.getFullYear(),
      baseMonthlyCost
    );
    monthlyProjections.push(projection);
  }

  // Calculate annual estimate
  let annualLow = 0;
  let annualExpected = 0;
  let annualHigh = 0;

  for (let month = 0; month < 12; month++) {
    const seasonalMultiplier = SEASONAL_MULTIPLIERS[month] || 1.0;
    const monthlyExpected = baseMonthlyCost * seasonalMultiplier;
    
    annualLow += monthlyExpected * VARIANCE_FACTORS.low;
    annualExpected += monthlyExpected;
    annualHigh += monthlyExpected * VARIANCE_FACTORS.high;
  }

  const annualEstimate: CostEstimate = {
    low: Math.round(annualLow * 100) / 100,
    expected: Math.round(annualExpected * 100) / 100,
    high: Math.round(annualHigh * 100) / 100,
  };

  // Determine cost trend
  const costTrend = determineCostTrend(serviceLogs);

  // Check for high-maintenance flag (Requirement 5.2)
  const highMaintenanceFlag = baseMonthlyCost > HIGH_MAINTENANCE_THRESHOLD;

  // Identify savings opportunities
  const savingsOpportunities = identifySavingsOpportunities(serviceLogs, baseMonthlyCost);

  // Add pattern change alerts to savings opportunities (Requirement 5.5)
  const patternAlerts = detectUsagePatternChanges(serviceLogs);
  savingsOpportunities.push(...patternAlerts);

  return {
    monthlyProjections,
    annualEstimate,
    costTrend,
    highMaintenanceFlag,
    savingsOpportunities,
  };
}

/**
 * Creates a minimal cost analysis for pools with all good readings
 */
function createMinimalCostAnalysis(projectionMonths: number): CostAnalysis {
  const now = new Date();
  const monthlyProjections: CostProjection[] = [];

  for (let i = 0; i < projectionMonths; i++) {
    const projectionDate = new Date(now.getFullYear(), now.getMonth() + i + 1, 1);
    monthlyProjections.push({
      period: getMonthName(projectionDate.getMonth(), projectionDate.getFullYear()),
      estimate: { low: 0, expected: 0, high: 0 },
      breakdown: [],
      factors: ['Pool chemistry is well-balanced - minimal chemical costs expected'],
      comparedToAverage: 'below',
    });
  }

  return {
    monthlyProjections,
    annualEstimate: { low: 0, expected: 0, high: 0 },
    costTrend: 'stable',
    highMaintenanceFlag: false,
    savingsOpportunities: ['Excellent pool maintenance - continue current practices'],
  };
}

// ============================================================================
// Validation Functions for Testing
// ============================================================================

/**
 * Validates that all cost projections have properly ordered ranges
 * Used for Property 7: Cost Projection Range Ordering
 */
export function validateCostProjectionRanges(analysis: CostAnalysis): boolean {
  // Check monthly projections
  for (const projection of analysis.monthlyProjections) {
    if (!isValidCostRange(projection.estimate)) {
      return false;
    }
  }

  // Check annual estimate
  if (!isValidCostRange(analysis.annualEstimate)) {
    return false;
  }

  return true;
}

/**
 * Gets the high maintenance threshold constant
 */
export function getHighMaintenanceThreshold(): number {
  return HIGH_MAINTENANCE_THRESHOLD;
}

/**
 * Gets seasonal multipliers for testing
 */
export function getSeasonalMultipliers(): Record<number, number> {
  return { ...SEASONAL_MULTIPLIERS };
}
