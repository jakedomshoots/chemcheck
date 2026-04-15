/**
 * Predictive Analyzer
 * 
 * Generates forecasts for future chemical behavior based on historical patterns.
 * Implements trend extrapolation, critical threshold prediction, and confidence scoring.
 * 
 * Requirements: 2.1, 2.2, 2.4, 2.5
 */

import {
  type Prediction,
  type PredictiveInsights,
  type NextServiceRecommendation,
  type ServiceLog,
  type ChemicalReading,
  type TrendDirection,
  isValidConfidence,
} from './types';

// ============================================================================
// Constants
// ============================================================================

const MINIMUM_LOGS_FOR_PREDICTION = 5;
const LOW_CONFIDENCE_THRESHOLD = 60;

/**
 * Chemical reading severity order (higher = better)
 */
const READING_SEVERITY: Record<ChemicalReading, number> = {
  critical: 0,
  low: 1,
  high: 1,
  good: 2,
};

/**
 * Days until critical estimates based on trend patterns
 */
const DAYS_UNTIL_CRITICAL_ESTIMATES: Record<string, number> = {
  'declining_from_good': 14,
  'declining_from_low': 7,
  'declining_from_high': 7,
  'stable_low': 21,
  'stable_high': 21,
};

/**
 * Recommended actions based on chemical and predicted level
 */
const RECOMMENDED_ACTIONS: Record<string, Record<string, string>> = {
  ph: {
    low: 'Add pH increaser (sodium carbonate)',
    high: 'Add pH decreaser (muriatic acid or sodium bisulfate)',
    critical: 'Immediate pH adjustment required - test and balance',
  },
  chlorine: {
    low: 'Add chlorine shock treatment',
    high: 'Allow chlorine to dissipate naturally or add neutralizer',
    critical: 'Urgent chlorine adjustment needed - check sanitizer system',
  },
  alkalinity: {
    low: 'Add alkalinity increaser (sodium bicarbonate)',
    high: 'Add muriatic acid to lower alkalinity',
    critical: 'Alkalinity severely out of range - comprehensive water balance needed',
  },
  stabilizer: {
    low: 'Add cyanuric acid (stabilizer)',
    high: 'Partial drain and refill to reduce stabilizer levels',
    critical: 'Stabilizer levels critical - may need significant water replacement',
  },
};

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Extracts readings for a specific chemical from service logs
 */
function extractReadings(
  logs: ServiceLog[],
  chemical: 'ph' | 'chlorine' | 'alkalinity' | 'stabilizer'
): ChemicalReading[] {
  return logs
    .filter(log => log[chemical] !== undefined)
    .map(log => log[chemical] as ChemicalReading);
}

/**
 * Calculates the trend direction from readings
 */
function calculateTrend(readings: ChemicalReading[]): TrendDirection {
  if (readings.length < 2) {
    return 'stable';
  }

  let improvements = 0;
  let declines = 0;

  for (let i = 1; i < readings.length; i++) {
    const prevSeverity = READING_SEVERITY[readings[i - 1]];
    const currSeverity = READING_SEVERITY[readings[i]];
    
    if (currSeverity > prevSeverity) {
      improvements++;
    } else if (currSeverity < prevSeverity) {
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
 * Calculates variance in readings (0-1 scale)
 * Higher variance = lower confidence
 */
function calculateVariance(readings: ChemicalReading[]): number {
  if (readings.length < 2) {
    return 1; // Maximum variance for insufficient data
  }

  const severities = readings.map(r => READING_SEVERITY[r]);
  const mean = severities.reduce((a, b) => a + b, 0) / severities.length;
  const squaredDiffs = severities.map(s => Math.pow(s - mean, 2));
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / severities.length;
  
  // Normalize to 0-1 (max possible variance is ~1 for severity range 0-2)
  return Math.min(variance, 1);
}

/**
 * Calculates confidence score based on data quality and variance
 * 
 * Requirements:
 * - 2.4: Provide confidence percentage (0-100) for each prediction
 * - 2.5: Confidence below 60% when prediction confidence is low
 */
function calculatePredictionConfidence(
  logCount: number,
  variance: number,
  hasSeasonalData: boolean
): number {
  // Base confidence from data quantity
  // Requirement 2.1: Need 5+ logs for meaningful predictions
  if (logCount < MINIMUM_LOGS_FOR_PREDICTION) {
    // Cap confidence below 60% for insufficient data (Requirement 2.5)
    return Math.min(logCount * 10, LOW_CONFIDENCE_THRESHOLD - 1);
  }

  // Start with base confidence based on log count
  let confidence = Math.min(50 + (logCount - MINIMUM_LOGS_FOR_PREDICTION) * 5, 80);
  
  // Reduce confidence based on variance (high variance = less predictable)
  confidence -= variance * 20;
  
  // Boost confidence if seasonal data is available (Requirement 2.3)
  if (hasSeasonalData) {
    confidence += 10;
  }

  // Ensure confidence is within valid bounds
  return Math.max(0, Math.min(100, Math.round(confidence)));
}

/**
 * Predicts the next level based on current trend
 */
function predictNextLevel(
  currentLevel: ChemicalReading,
  trend: TrendDirection
): ChemicalReading {
  const currentSeverity = READING_SEVERITY[currentLevel];
  
  if (trend === 'improving') {
    // Move toward 'good'
    if (currentSeverity < 2) {
      return currentLevel === 'critical' ? 'low' : 'good';
    }
    return 'good';
  } else if (trend === 'declining') {
    // Move away from 'good'
    if (currentLevel === 'good') {
      return 'low'; // Could be low or high, default to low
    } else if (currentLevel === 'low' || currentLevel === 'high') {
      return 'critical';
    }
    return 'critical';
  }
  
  // Stable - maintain current level
  return currentLevel;
}

/**
 * Estimates days until critical threshold
 */
function estimateDaysUntilCritical(
  currentLevel: ChemicalReading,
  trend: TrendDirection
): number | null {
  // Already critical
  if (currentLevel === 'critical') {
    return 0;
  }
  
  // Improving or stable at good - no critical expected
  if (trend === 'improving' || (trend === 'stable' && currentLevel === 'good')) {
    return null;
  }
  
  // Calculate based on current level and trend
  const key = `${trend}_from_${currentLevel}`;
  if (key in DAYS_UNTIL_CRITICAL_ESTIMATES) {
    return DAYS_UNTIL_CRITICAL_ESTIMATES[key];
  }
  
  // Stable at non-good level
  const stableKey = `stable_${currentLevel}`;
  if (stableKey in DAYS_UNTIL_CRITICAL_ESTIMATES) {
    return DAYS_UNTIL_CRITICAL_ESTIMATES[stableKey];
  }
  
  return null;
}

/**
 * Gets recommended action for a chemical at a predicted level
 */
function getRecommendedAction(
  chemical: string,
  predictedLevel: ChemicalReading
): string | null {
  if (predictedLevel === 'good') {
    return null;
  }
  
  const chemicalActions = RECOMMENDED_ACTIONS[chemical];
  if (chemicalActions && chemicalActions[predictedLevel]) {
    return chemicalActions[predictedLevel];
  }
  
  return null;
}

/**
 * Generates factors that influenced the prediction
 */
function generateFactors(
  trend: TrendDirection,
  logCount: number,
  variance: number,
  hasSeasonalData: boolean
): string[] {
  const factors: string[] = [];
  
  factors.push(`Based on ${logCount} service records`);
  
  if (trend === 'declining') {
    factors.push('Declining trend detected in recent readings');
  } else if (trend === 'improving') {
    factors.push('Improving trend observed');
  } else {
    factors.push('Readings have been stable');
  }
  
  if (variance > 0.5) {
    factors.push('High variability in readings reduces prediction certainty');
  } else if (variance < 0.2) {
    factors.push('Consistent readings increase prediction confidence');
  }
  
  if (hasSeasonalData) {
    factors.push('Historical seasonal patterns incorporated');
  }
  
  return factors;
}

// ============================================================================
// Main Prediction Functions
// ============================================================================

/**
 * Generates a prediction for a single chemical
 */
export function generateChemicalPrediction(
  chemical: 'ph' | 'chlorine' | 'alkalinity' | 'stabilizer',
  logs: ServiceLog[],
  hasSeasonalData: boolean = false
): Prediction {
  const readings = extractReadings(logs, chemical);
  const currentLevel = readings.length > 0 ? readings[readings.length - 1] : 'good';
  const trend = calculateTrend(readings);
  const variance = calculateVariance(readings);
  const confidence = calculatePredictionConfidence(logs.length, variance, hasSeasonalData);
  
  const predictedLevel = predictNextLevel(currentLevel, trend);
  const daysUntilCritical = estimateDaysUntilCritical(currentLevel, trend);
  const recommendedAction = getRecommendedAction(chemical, predictedLevel);
  const factors = generateFactors(trend, logs.length, variance, hasSeasonalData);

  return {
    chemical,
    currentLevel,
    predictedLevel,
    daysUntilCritical,
    confidence,
    factors,
    recommendedAction,
  };
}

/**
 * Determines overall outlook based on predictions
 */
function determineOverallOutlook(
  predictions: Prediction[]
): 'stable' | 'attention-needed' | 'intervention-required' {
  const hasCritical = predictions.some(
    p => p.predictedLevel === 'critical' || p.daysUntilCritical === 0
  );
  
  if (hasCritical) {
    return 'intervention-required';
  }
  
  const hasIssues = predictions.some(
    p => p.predictedLevel !== 'good' || (p.daysUntilCritical !== null && p.daysUntilCritical < 14)
  );
  
  if (hasIssues) {
    return 'attention-needed';
  }
  
  return 'stable';
}

/**
 * Generates next service recommendation
 */
function generateServiceRecommendation(
  predictions: Prediction[],
  outlook: 'stable' | 'attention-needed' | 'intervention-required'
): NextServiceRecommendation {
  const today = new Date();
  
  if (outlook === 'intervention-required') {
    const urgentChemical = predictions.find(
      p => p.predictedLevel === 'critical' || p.daysUntilCritical === 0
    );
    return {
      urgency: 'urgent',
      suggestedDate: today.toISOString().split('T')[0],
      reason: urgentChemical 
        ? `${urgentChemical.chemical} requires immediate attention`
        : 'Critical issues detected requiring immediate service',
    };
  }
  
  if (outlook === 'attention-needed') {
    const soonDate = new Date(today);
    soonDate.setDate(soonDate.getDate() + 3);
    
    const issueChemical = predictions.find(p => p.predictedLevel !== 'good');
    return {
      urgency: 'soon',
      suggestedDate: soonDate.toISOString().split('T')[0],
      reason: issueChemical
        ? `${issueChemical.chemical} trending toward issues`
        : 'Chemical levels need attention before next routine visit',
    };
  }
  
  // Stable - routine service
  const routineDate = new Date(today);
  routineDate.setDate(routineDate.getDate() + 7);
  
  return {
    urgency: 'routine',
    suggestedDate: routineDate.toISOString().split('T')[0],
    reason: 'All chemicals stable - continue regular service schedule',
  };
}

/**
 * Identifies seasonal factors from service log dates
 */
function identifySeasonalFactors(logs: ServiceLog[]): string[] {
  if (logs.length < 10) {
    return [];
  }
  
  const factors: string[] = [];
  const currentMonth = new Date().getMonth();
  
  // Summer months (May-August) - higher chlorine demand
  if (currentMonth >= 4 && currentMonth <= 7) {
    factors.push('Summer season: expect increased chlorine demand');
    factors.push('Higher temperatures may accelerate chemical consumption');
  }
  
  // Fall months (September-November) - debris and pH changes
  if (currentMonth >= 8 && currentMonth <= 10) {
    factors.push('Fall season: watch for debris affecting water chemistry');
  }
  
  // Winter months (December-February) - reduced usage
  if (currentMonth === 11 || currentMonth <= 1) {
    factors.push('Winter season: reduced chemical consumption expected');
  }
  
  // Spring months (March-April) - opening season
  if (currentMonth >= 2 && currentMonth <= 3) {
    factors.push('Spring season: pools may need rebalancing after winter');
  }
  
  return factors;
}

// ============================================================================
// Main Export Function
// ============================================================================

export interface PredictiveAnalyzerInput {
  serviceLogs: ServiceLog[];
  includeSeasonalFactors?: boolean;
  weatherFactors?: string[];
}

/**
 * Generates complete predictive insights for a pool
 * 
 * Requirements:
 * - 2.1: Generate predictions for pools with 5+ service logs
 * - 2.2: Predict estimated date when chemical levels will reach critical
 * - 2.4: Provide confidence percentage (0-100) for each prediction
 * - 2.5: Indicate uncertainty when confidence is below 60%
 */
export function generatePredictiveInsights(
  input: PredictiveAnalyzerInput
): PredictiveInsights {
  const { serviceLogs, includeSeasonalFactors = true, weatherFactors = [] } = input;
  
  // Sort logs by date (oldest first for trend analysis)
  const sortedLogs = [...serviceLogs].sort(
    (a, b) => new Date(a.service_date).getTime() - new Date(b.service_date).getTime()
  );
  
  const hasSeasonalData = sortedLogs.length >= 10;
  
  // Generate predictions for each chemical
  const chemicals: Array<'ph' | 'chlorine' | 'alkalinity' | 'stabilizer'> = [
    'ph', 'chlorine', 'alkalinity', 'stabilizer'
  ];
  
  const predictions: Prediction[] = chemicals.map(chemical =>
    generateChemicalPrediction(chemical, sortedLogs, hasSeasonalData)
  );
  
  // Determine overall outlook
  const overallOutlook = determineOverallOutlook(predictions);
  
  // Generate service recommendation
  const nextServiceRecommendation = generateServiceRecommendation(predictions, overallOutlook);
  
  // Identify seasonal factors
  const seasonalFactors = includeSeasonalFactors 
    ? identifySeasonalFactors(sortedLogs)
    : [];

  return {
    predictions,
    overallOutlook,
    nextServiceRecommendation,
    seasonalFactors,
    weatherFactors,
  };
}

/**
 * Checks if there is sufficient data for predictions
 * Used for Property 5: Prediction Requires Minimum Data
 */
export function hasSufficientDataForPrediction(logCount: number): boolean {
  return logCount >= MINIMUM_LOGS_FOR_PREDICTION;
}

/**
 * Gets the minimum logs required for prediction
 */
export function getMinimumLogsForPrediction(): number {
  return MINIMUM_LOGS_FOR_PREDICTION;
}

/**
 * Gets the low confidence threshold
 */
export function getLowConfidenceThreshold(): number {
  return LOW_CONFIDENCE_THRESHOLD;
}

/**
 * Validates that all prediction confidences are within bounds
 */
export function validatePredictionConfidences(insights: PredictiveInsights): boolean {
  return insights.predictions.every(p => isValidConfidence(p.confidence));
}
