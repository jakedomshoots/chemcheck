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
  type HealthGrade,
  type TrendDirection,
  type ChemicalReading,
  type ServiceLog,
  type DataQuality,
  scoreToGrade,
} from './types';

// ============================================================================
// Default Configuration
// ============================================================================

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

// ============================================================================
// Chemical Reading Score Mapping
// ============================================================================

/**
 * Maps chemical reading status to a base score (0-100)
 */
const READING_SCORES: Record<ChemicalReading, number> = {
  good: 100,
  low: 50,
  high: 50,
  critical: 10,
};

/**
 * Trend impact on score (-10 to +10)
 */
const TREND_MODIFIERS: Record<TrendDirection, number> = {
  improving: 10,
  stable: 0,
  declining: -10,
};

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Calculates the score for a single chemical reading
 */
export function getReadingScore(reading: ChemicalReading): number {
  return READING_SCORES[reading] ?? 50;
}

/**
 * Determines the trend direction from a series of readings
 */
export function calculateTrend(readings: ChemicalReading[]): TrendDirection {
  if (readings.length < 2) {
    return 'stable';
  }

  // Count transitions
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

/**
 * Calculates weighted average score with recency bias
 * More recent readings have higher weight
 */
export function calculateWeightedAverage(
  scores: number[],
  recencyBias: number
): number {
  if (scores.length === 0) {
    return 50; // Neutral score for no data
  }

  if (scores.length === 1) {
    return scores[0];
  }

  let totalWeight = 0;
  let weightedSum = 0;

  // Apply exponential recency weighting
  for (let i = 0; i < scores.length; i++) {
    // More recent entries (higher index) get higher weight
    const recencyWeight = Math.pow(1 + recencyBias, i);
    weightedSum += scores[i] * recencyWeight;
    totalWeight += recencyWeight;
  }

  return weightedSum / totalWeight;
}

/**
 * Extracts chemical readings from service logs for a specific chemical
 */
export function extractChemicalReadings(
  logs: ServiceLog[],
  chemical: keyof Pick<ServiceLog, 'ph' | 'chlorine' | 'alkalinity' | 'stabilizer'>
): ChemicalReading[] {
  return logs
    .filter(log => log[chemical] !== undefined)
    .map(log => log[chemical] as ChemicalReading);
}

/**
 * Determines data quality based on number of service logs
 */
export function determineDataQuality(logCount: number): DataQuality {
  if (logCount >= 10) return 'excellent';
  if (logCount >= 5) return 'good';
  if (logCount >= 3) return 'fair';
  return 'limited';
}

/**
 * Calculates confidence based on data quality and consistency
 */
export function calculateConfidence(
  logCount: number,
  dataQuality: DataQuality
): number {
  // Base confidence from data quantity
  const baseConfidence = Math.min(logCount * 10, 80);
  
  // Quality modifier
  const qualityModifiers: Record<DataQuality, number> = {
    excellent: 20,
    good: 15,
    fair: 10,
    limited: 0,
  };

  const confidence = baseConfidence + qualityModifiers[dataQuality];
  
  // Clamp to 0-100
  return Math.max(0, Math.min(100, confidence));
}

// ============================================================================
// Main Health Score Calculator
// ============================================================================

export interface HealthScoreInput {
  serviceLogs: ServiceLog[];
  config?: Partial<PoolHealthScorerConfig>;
}

export interface HealthScoreResult {
  healthScore: PoolHealthScore;
  dataQuality: DataQuality;
}

/**
 * Calculates the complete pool health score from service logs
 * 
 * Requirements:
 * - 1.2: Include Pool_Health_Score as prominent numerical indicator (0-100)
 * - 1.3: Highlight critical issues with specific chemical names and values
 * - 1.5: Indicate limited confidence when insufficient data exists
 */
export function calculateHealthScore(input: HealthScoreInput): HealthScoreResult {
  const { serviceLogs } = input;
  // Deep merge config to properly merge nested weights object
  const config: PoolHealthScorerConfig = {
    ...DEFAULT_HEALTH_SCORER_CONFIG,
    ...input.config,
    weights: {
      ...DEFAULT_HEALTH_SCORER_CONFIG.weights,
      ...input.config?.weights,
    },
  };
  
  // Determine data quality
  const dataQuality = determineDataQuality(serviceLogs.length);
  
  // Handle insufficient data case (Requirement 1.5)
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

  // Calculate breakdown for each chemical
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

  // Normalize score if not all chemicals present
  let baseScore = totalWeight > 0 
    ? totalWeightedScore / totalWeight 
    : 50;

  // Calculate overall trend from all readings
  const allReadings: ChemicalReading[] = [];
  for (const chemical of chemicals) {
    allReadings.push(...extractChemicalReadings(serviceLogs, chemical.key));
  }
  const trend = calculateTrend(allReadings);

  // Apply trend modifier
  const trendModifier = TREND_MODIFIERS[trend] * config.trendWeight;
  const finalScore = Math.max(0, Math.min(100, baseScore + trendModifier));

  // Calculate confidence (Requirement 1.5)
  const confidence = calculateConfidence(serviceLogs.length, dataQuality);
  
  // Reduce confidence for limited data
  const adjustedConfidence = dataQuality === 'limited' 
    ? Math.min(confidence, 49) // Below 50 for limited data
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

/**
 * Checks if a pool has all 'good' readings
 * Used for Property 2: Health Score Monotonicity
 */
export function hasAllGoodReadings(logs: ServiceLog[]): boolean {
  for (const log of logs) {
    if (log.ph !== 'good') return false;
    if (log.chlorine !== 'good') return false;
    if (log.alkalinity !== 'good') return false;
    if (log.stabilizer !== 'good') return false;
  }
  return true;
}

/**
 * Checks if a pool has any non-good readings
 */
export function hasMixedReadings(logs: ServiceLog[]): boolean {
  for (const log of logs) {
    if (log.ph !== 'good') return true;
    if (log.chlorine !== 'good') return true;
    if (log.alkalinity !== 'good') return true;
    if (log.stabilizer !== 'good') return true;
  }
  return false;
}
