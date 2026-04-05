import {
  type CostProjection,
  type CostAnalysis,
  type CostEstimate,
  type ChemicalCostBreakdown,
  type ServiceLog,
  type ChemicalReading,
  isValidCostRange,
} from './types';

const CHEMICAL_COSTS: Record<string, Record<string, number>> = {
  ph: {
    low: 8.50,
    high: 6.00,
    critical: 15.00,
  },
  chlorine: {
    low: 12.00,
    critical: 25.00,
  },
  alkalinity: {
    low: 10.00,
    high: 6.00,
    critical: 18.00,
  },
  stabilizer: {
    low: 15.00,
    high: 50.00,
    critical: 75.00,
  },
};

const SEASONAL_MULTIPLIERS: Record<number, number> = {
  0: 0.7,
  1: 0.7,
  2: 0.85,
  3: 0.95,
  4: 1.1,
  5: 1.3,
  6: 1.4,
  7: 1.35,
  8: 1.1,
  9: 0.9,
  10: 0.75,
  11: 0.7,
};

const HIGH_MAINTENANCE_THRESHOLD = 150; // dollars per month

const VARIANCE_FACTORS = {
  low: 0.7,
  high: 1.4,
};

const MIN_LOGS_FOR_PROJECTION = 3;
function getMonthName(monthIndex: number, year: number): string {
  const date = new Date(year, monthIndex, 1);
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

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

export function calculateServiceLogCost(log: ServiceLog): number {
  let total = 0;
  
  total += calculateChemicalCost('ph', log.ph);
  total += calculateChemicalCost('chlorine', log.chlorine);
  total += calculateChemicalCost('alkalinity', log.alkalinity);
  total += calculateChemicalCost('stabilizer', log.stabilizer);
  
  return total;
}

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

export function determineCostTrend(
  logs: ServiceLog[]
): 'decreasing' | 'stable' | 'increasing' {
  if (logs.length < 4) {
    return 'stable';
  }

  const sortedLogs = [...logs].sort(
    (a, b) => new Date(a.service_date).getTime() - new Date(b.service_date).getTime()
  );

  const midpoint = Math.floor(sortedLogs.length / 2);
  const firstHalf = sortedLogs.slice(0, midpoint);
  const secondHalf = sortedLogs.slice(midpoint);

  const firstHalfCost = firstHalf.reduce((sum, log) => sum + calculateServiceLogCost(log), 0) / firstHalf.length;
  const secondHalfCost = secondHalf.reduce((sum, log) => sum + calculateServiceLogCost(log), 0) / secondHalf.length;

  const changePercent = (secondHalfCost - firstHalfCost) / (firstHalfCost || 1);

  if (changePercent > 0.15) {
    return 'increasing';
  } else if (changePercent < -0.15) {
    return 'decreasing';
  }
  return 'stable';
}

export function detectUsagePatternChanges(
  logs: ServiceLog[]
): string[] {
  const alerts: string[] = [];
  
  if (logs.length < 6) {
    return alerts;
  }

  const sortedLogs = [...logs].sort(
    (a, b) => new Date(a.service_date).getTime() - new Date(b.service_date).getTime()
  );

  const recentLogs = sortedLogs.slice(-3);
  const previousLogs = sortedLogs.slice(0, -3);

  const chemicals = ['ph', 'chlorine', 'alkalinity', 'stabilizer'] as const;

  for (const chemical of chemicals) {
    const recentIssues = recentLogs.filter(log => log[chemical] !== 'good').length;
    const previousIssues = previousLogs.filter(log => log[chemical] !== 'good').length;
    
    const recentRate = recentIssues / recentLogs.length;
    const previousRate = previousIssues / previousLogs.length;

    if (recentRate > 0.5 && previousRate < 0.3) {
      alerts.push(
        `${chemical.charAt(0).toUpperCase() + chemical.slice(1)} issues have increased significantly in recent services`
      );
    }
  }

  const recentCost = recentLogs.reduce((sum, log) => sum + calculateServiceLogCost(log), 0) / recentLogs.length;
  const previousCost = previousLogs.reduce((sum, log) => sum + calculateServiceLogCost(log), 0) / previousLogs.length;

  if (previousCost > 0 && recentCost > previousCost * 1.5) {
    alerts.push('Overall chemical costs have increased by more than 50% recently');
  }

  return alerts;
}

export function identifySavingsOpportunities(
  logs: ServiceLog[],
  averageMonthlyCost: number
): string[] {
  const opportunities: string[] = [];
  const usage = analyzeChemicalUsage(logs);

  const phData = usage.get('ph')!;
  const alkalinityData = usage.get('alkalinity')!;
  
  if (phData.count > logs.length * 0.4 && alkalinityData.count > logs.length * 0.3) {
    opportunities.push(
      'Frequent pH and alkalinity adjustments suggest addressing root cause could reduce costs by 20-30%'
    );
  }

  const stabilizerData = usage.get('stabilizer')!;
  if (stabilizerData.readings.filter(r => r === 'high' || r === 'critical').length > 2) {
    opportunities.push(
      'Consider switching to unstabilized chlorine to prevent stabilizer buildup and costly drain-downs'
    );
  }

  const chlorineData = usage.get('chlorine')!;
  if (chlorineData.count > logs.length * 0.5) {
    opportunities.push(
      'Frequent chlorine adjustments may indicate equipment issues - inspect chlorinator for potential savings'
    );
  }

  if (averageMonthlyCost > HIGH_MAINTENANCE_THRESHOLD) {
    opportunities.push(
      'This pool exceeds average maintenance costs - consider a comprehensive water chemistry audit'
    );
  }

  return opportunities;
}

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

    let totalCost = 0;
    for (const reading of data.readings) {
      totalCost += calculateChemicalCost(chemical, reading);
    }
    
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

export interface CostProjectorInput {
  serviceLogs: ServiceLog[];
  poolGallons?: number | null;
  projectionMonths?: number;
}

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

export function generateCostAnalysis(
  input: CostProjectorInput
): CostAnalysis | null {
  const { serviceLogs, projectionMonths = 3 } = input;

  if (serviceLogs.length < MIN_LOGS_FOR_PROJECTION) {
    return null;
  }

  const baseMonthlyCost = calculateAverageMonthlyCost(serviceLogs);
  
  if (baseMonthlyCost === 0) {
    const hasAnyIssues = serviceLogs.some(log => 
      log.ph !== 'good' || 
      log.chlorine !== 'good' || 
      log.alkalinity !== 'good' || 
      log.stabilizer !== 'good'
    );
    
    if (!hasAnyIssues) {
      return createMinimalCostAnalysis(projectionMonths);
    }
    return null;
  }

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

  const costTrend = determineCostTrend(serviceLogs);

  const highMaintenanceFlag = baseMonthlyCost > HIGH_MAINTENANCE_THRESHOLD;

  const savingsOpportunities = identifySavingsOpportunities(serviceLogs, baseMonthlyCost);

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

export function validateCostProjectionRanges(analysis: CostAnalysis): boolean {
  for (const projection of analysis.monthlyProjections) {
    if (!isValidCostRange(projection.estimate)) {
      return false;
    }
  }

  if (!isValidCostRange(analysis.annualEstimate)) {
    return false;
  }

  return true;
}

export function getHighMaintenanceThreshold(): number {
  return HIGH_MAINTENANCE_THRESHOLD;
}

export function getSeasonalMultipliers(): Record<number, number> {
  return { ...SEASONAL_MULTIPLIERS };
}
