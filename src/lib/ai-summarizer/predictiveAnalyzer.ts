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

const MINIMUM_LOGS_FOR_PREDICTION = 5;
const LOW_CONFIDENCE_THRESHOLD = 60;

const READING_SEVERITY: Record<ChemicalReading, number> = {
  critical: 0,
  low: 1,
  high: 1,
  good: 2,
};

const DAYS_UNTIL_CRITICAL_ESTIMATES: Record<string, number> = {
  'declining_from_good': 14,
  'declining_from_low': 7,
  'declining_from_high': 7,
  'stable_low': 21,
  'stable_high': 21,
};

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

function extractReadings(
  logs: ServiceLog[],
  chemical: 'ph' | 'chlorine' | 'alkalinity' | 'stabilizer'
): ChemicalReading[] {
  return logs
    .filter(log => log[chemical] !== undefined)
    .map(log => log[chemical] as ChemicalReading);
}

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

function calculateVariance(readings: ChemicalReading[]): number {
  if (readings.length < 2) {
    return 1;
  }

  const severities = readings.map(r => READING_SEVERITY[r]);
  const mean = severities.reduce((a, b) => a + b, 0) / severities.length;
  const squaredDiffs = severities.map(s => Math.pow(s - mean, 2));
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / severities.length;
  return Math.min(variance, 1);
}

function calculatePredictionConfidence(
  logCount: number,
  variance: number,
  hasSeasonalData: boolean
): number {
  if (logCount < MINIMUM_LOGS_FOR_PREDICTION) {
    return Math.min(logCount * 10, LOW_CONFIDENCE_THRESHOLD - 1);
  }

  let confidence = Math.min(50 + (logCount - MINIMUM_LOGS_FOR_PREDICTION) * 5, 80);
  confidence -= variance * 20;
  if (hasSeasonalData) {
    confidence += 10;
  }

  return Math.max(0, Math.min(100, Math.round(confidence)));
}

function predictNextLevel(
  currentLevel: ChemicalReading,
  trend: TrendDirection
): ChemicalReading {
  const currentSeverity = READING_SEVERITY[currentLevel];
  if (trend === 'improving') {
    if (currentSeverity < 2) {
      return currentLevel === 'critical' ? 'low' : 'good';
    }
    return 'good';
  } else if (trend === 'declining') {
    if (currentLevel === 'good') {
      return 'low';
    } else if (currentLevel === 'low' || currentLevel === 'high') {
      return 'critical';
    }
    return 'critical';
  }

  return currentLevel;
}

function estimateDaysUntilCritical(
  currentLevel: ChemicalReading,
  trend: TrendDirection
): number | null {
  if (currentLevel === 'critical') {
    return 0;
  }

  if (trend === 'improving' || (trend === 'stable' && currentLevel === 'good')) {
    return null;
  }

  const key = `${trend}_from_${currentLevel}`;
  if (key in DAYS_UNTIL_CRITICAL_ESTIMATES) {
    return DAYS_UNTIL_CRITICAL_ESTIMATES[key];
  }

  const stableKey = `stable_${currentLevel}`;
  if (stableKey in DAYS_UNTIL_CRITICAL_ESTIMATES) {
    return DAYS_UNTIL_CRITICAL_ESTIMATES[stableKey];
  }
  
  return null;
}

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

  const routineDate = new Date(today);
  routineDate.setDate(routineDate.getDate() + 7);
  
  return {
    urgency: 'routine',
    suggestedDate: routineDate.toISOString().split('T')[0],
    reason: 'All chemicals stable - continue regular service schedule',
  };
}

function identifySeasonalFactors(logs: ServiceLog[]): string[] {
  if (logs.length < 10) {
    return [];
  }

  const factors: string[] = [];
  const currentMonth = new Date().getMonth();

  if (currentMonth >= 4 && currentMonth <= 7) {
    factors.push('Summer season: expect increased chlorine demand');
    factors.push('Higher temperatures may accelerate chemical consumption');
  }

  if (currentMonth >= 8 && currentMonth <= 10) {
    factors.push('Fall season: watch for debris affecting water chemistry');
  }

  if (currentMonth === 11 || currentMonth <= 1) {
    factors.push('Winter season: reduced chemical consumption expected');
  }

  if (currentMonth >= 2 && currentMonth <= 3) {
    factors.push('Spring season: pools may need rebalancing after winter');
  }
  
  return factors;
}

export interface PredictiveAnalyzerInput {
  serviceLogs: ServiceLog[];
  includeSeasonalFactors?: boolean;
  weatherFactors?: string[];
}

export function generatePredictiveInsights(
  input: PredictiveAnalyzerInput
): PredictiveInsights {
  const { serviceLogs, includeSeasonalFactors = true, weatherFactors = [] } = input;
  const sortedLogs = [...serviceLogs].sort(
    (a, b) => new Date(a.service_date).getTime() - new Date(b.service_date).getTime()
  );

  const hasSeasonalData = sortedLogs.length >= 10;

  const chemicals: Array<'ph' | 'chlorine' | 'alkalinity' | 'stabilizer'> = [
    'ph', 'chlorine', 'alkalinity', 'stabilizer'
  ];

  const predictions: Prediction[] = chemicals.map(chemical =>
    generateChemicalPrediction(chemical, sortedLogs, hasSeasonalData)
  );

  const overallOutlook = determineOverallOutlook(predictions);

  const nextServiceRecommendation = generateServiceRecommendation(predictions, overallOutlook);

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

export function hasSufficientDataForPrediction(logCount: number): boolean {
  return logCount >= MINIMUM_LOGS_FOR_PREDICTION;
}

export function getMinimumLogsForPrediction(): number {
  return MINIMUM_LOGS_FOR_PREDICTION;
}

export function getLowConfidenceThreshold(): number {
  return LOW_CONFIDENCE_THRESHOLD;
}

export function validatePredictionConfidences(insights: PredictiveInsights): boolean {
  return insights.predictions.every(p => isValidConfidence(p.confidence));
}
