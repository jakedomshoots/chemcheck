/**
 * Pool Health Scorer
 * 
 * Calculates the overall Pool Health Score (0-100) based on weighted chemical 
 * readings and trend data. Implements the scoring algorithm defined in the 
 * AI Pool Summarizer design document.
 * 
 * Requirements: 1.2, 1.3, 1.5
 */

import {
  type PoolHealthScore,
  type PoolHealthScorerConfig,
  type ChemicalBreakdown,
  type TrendDirection,
  type ChemicalReading,
  type ServiceLog,
  type DataQuality,
  scoreToGrade,
} from './types';

export const DEFAULT_HEALTH_SCORER_CONFIG: PoolHealthScorerConfig = {
  weights: {
    ph: 0.25,
    chlorine: 0.30,
    alkalinity: 0.20,
    stabilizer: 0.15,
    salt: 0.10,
  },
  trendWeight: 0.15,    // 15% of final score influenced by trend
  recencyBias: 0.7,     // Recent readings weighted 70% more
};

const READING_SCORES: Record<ChemicalReading, number> = {
  good: 100,
  low: 50,
  high: 50,
  critical: 10,
};

const TREND_MODIFIERS: Record<TrendDirection, number> = {
  improving: 10,
  stable: 0,
  declining: -10,
};

export function getReadingScore(reading: ChemicalReading): number {
  return READING_SCORES[reading] ?? 50;
}

export function calculateTrend(readings: ChemicalReading[]): TrendDirection {
  if (readings.length < 2) {
    return 'stable';
  }

  let improvements = 0;
  let declines = 0;

  const scoreOrder: Record<ChemicalReading, number> = {
    critical: 0,
    low: 1,
    high: 1,
    good: 2,
  };

  for (let i = 1; i < readings.length; i++) {
    const prevScore = scoreOrder[readings[i - 1]];
    const currScore = scoreOrder[readings[i]];
    
    if (currScore > prevScore) {
      improvements++;
    } else if (currScore < prevScore) {
      declines++;
    }
  }

  if (improvements > declines) {
    return 'improving';
  } else if (declines > improvements) {
    return 'declining';
  }
  return 'stable';
}

export function calculateWeightedAverage(
  scores: number[],
  recencyBias: number
): number {
  if (scores.length === 0) {
    return 50;
  }

  if (scores.length === 1) {
    return scores[0];
  }

  let totalWeight = 0;
  let weightedSum = 0;

  for (let i = 0; i < scores.length; i++) {
    const recencyWeight = Math.pow(1 + recencyBias, i);
    weightedSum += scores[i] * recencyWeight;
    totalWeight += recencyWeight;
  }

  return weightedSum / totalWeight;
}

export function extractChemicalReadings(
  logs: ServiceLog[],
  chemical: keyof Pick<ServiceLog, 'ph' | 'chlorine' | 'alkalinity' | 'stabilizer'>
): ChemicalReading[] {
  return logs
    .filter(log => log[chemical] !== undefined)
    .map(log => log[chemical] as ChemicalReading);
}

export function determineDataQuality(logCount: number): DataQuality {
  if (logCount >= 10) return 'excellent';
  if (logCount >= 5) return 'good';
  if (logCount >= 3) return 'fair';
  return 'limited';
}

export function calculateConfidence(
  logCount: number,
  dataQuality: DataQuality
): number {
  const baseConfidence = Math.min(logCount * 10, 80);

  const qualityModifiers: Record<DataQuality, number> = {
    excellent: 20,
    good: 15,
    fair: 10,
    limited: 0,
  };

  const confidence = baseConfidence + qualityModifiers[dataQuality];
  return Math.max(0, Math.min(100, confidence));
}

export interface HealthScoreInput {
  serviceLogs: ServiceLog[];
  config?: Partial<PoolHealthScorerConfig>;
}

export interface HealthScoreResult {
  healthScore: PoolHealthScore;
  dataQuality: DataQuality;
}

export function calculateHealthScore(input: HealthScoreInput): HealthScoreResult {
  const { serviceLogs } = input;
  const config: PoolHealthScorerConfig = {
    ...DEFAULT_HEALTH_SCORER_CONFIG,
    ...input.config,
    weights: {
      ...DEFAULT_HEALTH_SCORER_CONFIG.weights,
      ...input.config?.weights,
    },
  };
  
  const dataQuality = determineDataQuality(serviceLogs.length);

  if (serviceLogs.length === 0) {
    return {
      healthScore: {
        score: 50,
        grade: 'C',
        breakdown: [],
        trend: 'stable',
        confidence: 0,
      },
      dataQuality: 'limited',
    };
  }

  const chemicals: Array<{
    name: string;
    key: keyof Pick<ServiceLog, 'ph' | 'chlorine' | 'alkalinity' | 'stabilizer'>;
    weight: number;
  }> = [
    { name: 'ph', key: 'ph', weight: config.weights.ph },
    { name: 'chlorine', key: 'chlorine', weight: config.weights.chlorine },
    { name: 'alkalinity', key: 'alkalinity', weight: config.weights.alkalinity },
    { name: 'stabilizer', key: 'stabilizer', weight: config.weights.stabilizer },
  ];

  const breakdown: ChemicalBreakdown[] = [];
  let totalWeightedScore = 0;
  let totalWeight = 0;

  for (const chemical of chemicals) {
    const readings = extractChemicalReadings(serviceLogs, chemical.key);
    
    if (readings.length === 0) {
      continue;
    }

    const scores = readings.map(getReadingScore);
    const chemicalScore = calculateWeightedAverage(scores, config.recencyBias);
    const contribution = chemicalScore * chemical.weight;

    breakdown.push({
      chemical: chemical.name,
      score: Math.round(chemicalScore),
      weight: chemical.weight,
      contribution: Math.round(contribution * 100) / 100,
    });

    totalWeightedScore += contribution;
    totalWeight += chemical.weight;
  }

  let baseScore = totalWeight > 0 
    ? totalWeightedScore / totalWeight 
    : 50;

  const allReadings: ChemicalReading[] = [];
  for (const chemical of chemicals) {
    allReadings.push(...extractChemicalReadings(serviceLogs, chemical.key));
  }
  const trend = calculateTrend(allReadings);

  const trendModifier = TREND_MODIFIERS[trend] * config.trendWeight;
  const finalScore = Math.max(0, Math.min(100, baseScore + trendModifier));

  const confidence = calculateConfidence(serviceLogs.length, dataQuality);

  const adjustedConfidence = dataQuality === 'limited' 
    ? Math.min(confidence, 49)
    : confidence;

  const healthScore: PoolHealthScore = {
    score: Math.round(finalScore),
    grade: scoreToGrade(Math.round(finalScore)),
    breakdown,
    trend,
    confidence: adjustedConfidence,
  };

  return {
    healthScore,
    dataQuality,
  };
}

export function hasAllGoodReadings(logs: ServiceLog[]): boolean {
  for (const log of logs) {
    if (log.ph !== 'good') return false;
    if (log.chlorine !== 'good') return false;
    if (log.alkalinity !== 'good') return false;
    if (log.stabilizer !== 'good') return false;
  }
  return true;
}

export function hasMixedReadings(logs: ServiceLog[]): boolean {
  for (const log of logs) {
    if (log.ph !== 'good') return true;
    if (log.chlorine !== 'good') return true;
    if (log.alkalinity !== 'good') return true;
    if (log.stabilizer !== 'good') return true;
  }
  return false;
}
