import {
  type PoolAnalysisResult,
  type FleetInsights,
  type ServiceLog,
  type PoolHealthScore,
  type ChemicalTrend,
  type PoolProblem,
  type RootCauseAnalysis,
  type PredictiveInsights,
  type CostAnalysis,
  type GeneratedSummary,
  type CustomerReport,
  type CategorizedRecommendations,
  type LearningInsights,
  type WeatherImpact,
  type WeatherForecast,
  type DataQuality,
  type TrendDirection,
  type ChemicalReading,
  type ProblemSeverity,
} from './types';

import { calculateHealthScore, type HealthScoreResult } from './healthScorer';
import { generatePredictiveInsights } from './predictiveAnalyzer';
import { analyzeRootCauses } from './rootCauseAnalyzer';
import { generateSummaries, type LanguageGeneratorInput } from './languageGenerator';
import { generateRecommendations } from './recommendationEngine';
import { generateCostAnalysis } from './costProjector';
import { analyzeFleet, type PoolData } from './fleetAnalyzer';
import { analyzeLearning } from './learningEngine';
import { analyzeWeatherImpact } from './weatherAnalyzer';

export interface PoolAnalysisInput {
  customerId: string;
  customerName: string;
  poolType?: string;
  poolGallons?: number | null;
  serviceLogs: ServiceLog[];
  weatherForecast?: WeatherForecast[] | null;
  includeWeather?: boolean;
  includeCosts?: boolean;
  includeLearning?: boolean;
}

export interface FleetAnalysisInput {
  pools: Array<{
    customerId: string;
    customerName: string;
    serviceLogs: ServiceLog[];
    serviceDay: string;
    previousHealthScore?: number;
  }>;
  config?: {
    priorityPoolCount?: number;
    scoreDropThreshold?: number;
    overdueThresholdDays?: number;
    estimatedTimePerPool?: number;
  };
}

function calculateDateRange(logs: ServiceLog[]): { start: string; end: string } {
  if (logs.length === 0) {
    const today = new Date().toISOString().split('T')[0];
    return { start: today, end: today };
  }

  const sortedLogs = [...logs].sort(
    (a, b) => new Date(a.service_date).getTime() - new Date(b.service_date).getTime()
  );

  return {
    start: sortedLogs[0].service_date,
    end: sortedLogs[sortedLogs.length - 1].service_date,
  };
}

function extractChemicalTrends(logs: ServiceLog[]): ChemicalTrend[] {
  const chemicals: Array<'ph' | 'chlorine' | 'alkalinity' | 'stabilizer'> = [
    'ph', 'chlorine', 'alkalinity', 'stabilizer'
  ];

  const sortedLogs = [...logs].sort(
    (a, b) => new Date(a.service_date).getTime() - new Date(b.service_date).getTime()
  );

  return chemicals.map(chemical => {
    const history = sortedLogs
      .filter(log => log[chemical] !== undefined)
      .map(log => log[chemical] as ChemicalReading);

    const currentStatus = history.length > 0 ? history[history.length - 1] : 'good';
    const trend = calculateTrendDirection(history);
    const confidence = Math.min(history.length * 15, 100);

    return {
      chemical,
      trend,
      currentStatus,
      history,
      confidence,
    };
  });
}

function calculateTrendDirection(readings: ChemicalReading[]): TrendDirection {
  if (readings.length < 2) {
    return 'stable';
  }

  const severityOrder: Record<ChemicalReading, number> = {
    critical: 0,
    low: 1,
    high: 1,
    good: 2,
  };

  let improvements = 0;
  let declines = 0;

  for (let i = 1; i < readings.length; i++) {
    const prevScore = severityOrder[readings[i - 1]];
    const currScore = severityOrder[readings[i]];

    if (currScore > prevScore) {
      improvements++;
    } else if (currScore < prevScore) {
      declines++;
    }
  }

  if (improvements > declines) return 'improving';
  if (declines > improvements) return 'declining';
  return 'stable';
}

function extractProblems(
  logs: ServiceLog[],
  rootCauseAnalysis: RootCauseAnalysis
): PoolProblem[] {
  const problems: PoolProblem[] = [];
  const chemicals: Array<'ph' | 'chlorine' | 'alkalinity' | 'stabilizer'> = [
    'ph', 'chlorine', 'alkalinity', 'stabilizer'
  ];

  const sortedLogs = [...logs].sort(
    (a, b) => new Date(a.service_date).getTime() - new Date(b.service_date).getTime()
  );

  for (const chemical of chemicals) {
    const issueOccurrences: Array<{ date: string; reading: ChemicalReading }> = [];

    for (const log of sortedLogs) {
      const reading = log[chemical];
      if (reading && reading !== 'good') {
        issueOccurrences.push({ date: log.service_date, reading });
      }
    }

    if (issueOccurrences.length > 0) {
      const mostRecentReading = issueOccurrences[issueOccurrences.length - 1].reading;
      const severity = determineSeverity(mostRecentReading, issueOccurrences.length);

      problems.push({
        id: `problem-${chemical}-${Date.now()}`,
        chemical,
        severity,
        description: generateProblemDescription(chemical, mostRecentReading),
        occurrences: issueOccurrences.length,
        firstDetected: issueOccurrences[0].date,
        lastDetected: issueOccurrences[issueOccurrences.length - 1].date,
      });
    }
  }

  for (const chronic of rootCauseAnalysis.chronicIssues) {
    const existingProblem = problems.find(p => p.chemical === chronic.chemical);
    if (existingProblem) {
      if (existingProblem.severity === 'low') {
        existingProblem.severity = 'medium';
      } else if (existingProblem.severity === 'medium') {
        existingProblem.severity = 'high';
      }
    }
  }

  const severityOrder: Record<ProblemSeverity, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };

  return problems.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
}

function determineSeverity(reading: ChemicalReading, occurrences: number): ProblemSeverity {
  if (reading === 'critical') return 'critical';
  if (occurrences > 5) return 'high';
  if (occurrences > 3) return 'medium';
  return 'low';
}

function generateProblemDescription(chemical: string, reading: ChemicalReading): string {
  const chemicalNames: Record<string, string> = {
    ph: 'pH',
    chlorine: 'Chlorine',
    alkalinity: 'Alkalinity',
    stabilizer: 'Stabilizer',
  };

  const readingDescriptions: Record<ChemicalReading, string> = {
    low: 'below optimal range',
    high: 'above optimal range',
    critical: 'at critical levels',
    good: 'within optimal range',
  };

  return `${chemicalNames[chemical] || chemical} is ${readingDescriptions[reading]}`;
}

function calculateOverallTrend(chemicalTrends: ChemicalTrend[]): TrendDirection {
  let improving = 0;
  let declining = 0;

  for (const trend of chemicalTrends) {
    if (trend.trend === 'improving') improving++;
    if (trend.trend === 'declining') declining++;
  }

  if (improving > declining) return 'improving';
  if (declining > improving) return 'declining';
  return 'stable';
}

function calculateOverallConfidence(
  healthScore: PoolHealthScore,
  dataQuality: DataQuality,
  logCount: number
): number {
  let confidence = healthScore.confidence;

  const qualityModifiers: Record<DataQuality, number> = {
    excellent: 10,
    good: 5,
    fair: 0,
    limited: -15,
  };

  confidence += qualityModifiers[dataQuality];

  if (logCount < 3) {
    confidence -= 20;
  } else if (logCount >= 10) {
    confidence += 10;
  }

  return Math.max(0, Math.min(100, confidence));
}

function identifyPrimaryIssue(problems: PoolProblem[]): string | null {
  if (problems.length === 0) return null;

  const severityOrder: Record<ProblemSeverity, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };

  const sorted = [...problems].sort(
    (a, b) => severityOrder[a.severity] - severityOrder[b.severity]
  );

  return sorted[0].description;
}

export function analyzePool(input: PoolAnalysisInput): PoolAnalysisResult {
  const {
    customerId,
    customerName,
    poolType = 'standard',
    poolGallons = null,
    serviceLogs,
    weatherForecast = null,
    includeWeather = true,
    includeCosts = true,
    includeLearning = true,
  } = input;

  const generatedAt = new Date().toISOString();
  const dataRange = calculateDateRange(serviceLogs);
  const totalServices = serviceLogs.length;

  let healthScoreResult: HealthScoreResult;
  try {
    healthScoreResult = calculateHealthScore({ serviceLogs });
  } catch (error) {
    healthScoreResult = {
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

  const { healthScore, dataQuality } = healthScoreResult;

  let chemicalTrends: ChemicalTrend[];
  try {
    chemicalTrends = extractChemicalTrends(serviceLogs);
  } catch (error) {
    chemicalTrends = [];
  }

  const overallTrend = calculateOverallTrend(chemicalTrends);

  let rootCauseAnalysis: RootCauseAnalysis;
  try {
    rootCauseAnalysis = analyzeRootCauses({ serviceLogs });
  } catch (error) {
    rootCauseAnalysis = {
      correlations: [],
      rootCauses: [],
      chronicIssues: [],
    };
  }

  let problems: PoolProblem[];
  try {
    problems = extractProblems(serviceLogs, rootCauseAnalysis);
  } catch (error) {
    problems = [];
  }

  let predictiveInsights: PredictiveInsights;
  try {
    predictiveInsights = generatePredictiveInsights({
      serviceLogs,
      includeSeasonalFactors: true,
      weatherFactors: [],
    });
  } catch (error) {
    predictiveInsights = {
      predictions: [],
      overallOutlook: 'stable',
      nextServiceRecommendation: {
        urgency: 'routine',
        suggestedDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        reason: 'Unable to generate predictions',
      },
      seasonalFactors: [],
      weatherFactors: [],
    };
  }

  let weatherImpact: WeatherImpact | null = null;
  if (includeWeather && weatherForecast) {
    try {
      weatherImpact = analyzeWeatherImpact(weatherForecast, serviceLogs);
    } catch (error) {
      weatherImpact = null;
    }
  }

  let costAnalysis: CostAnalysis | null = null;
  if (includeCosts) {
    try {
      costAnalysis = generateCostAnalysis({ serviceLogs, poolGallons });
    } catch (error) {
      costAnalysis = null;
    }
  }

  let recommendations: CategorizedRecommendations;
  try {
    recommendations = generateRecommendations({
      serviceLogs,
      poolGallons,
      healthScore,
      rootCauseAnalysis,
      predictiveInsights,
    });
  } catch (error) {
    recommendations = {
      immediate: [],
      thisVisit: [],
      nextVisit: [],
      longTerm: [],
    };
  }

  let professionalSummary: GeneratedSummary;
  let customerReport: CustomerReport;
  try {
    const languageInput: LanguageGeneratorInput = {
      customerName,
      healthScore,
      chemicalTrends,
      problems,
      recommendations,
      rootCauseAnalysis,
      predictiveInsights,
      costAnalysis: costAnalysis || undefined,
      weatherImpact: weatherImpact || undefined,
    };

    const summaries = generateSummaries(languageInput);
    professionalSummary = summaries.professionalSummary;
    customerReport = summaries.customerReport;
  } catch (error) {
    professionalSummary = {
      headline: `Pool Analysis for ${customerName}`,
      paragraph: 'Unable to generate detailed summary. Please review the data manually.',
      bulletPoints: [`Health Score: ${healthScore.score}/100`],
      callToAction: null,
      tone: 'neutral',
    };
    customerReport = {
      greeting: `Hi ${customerName.split(' ')[0]}!`,
      healthSummary: 'Your pool analysis is ready.',
      whatWeDid: [],
      whatToExpect: 'We will continue monitoring your pool.',
      recommendations: [],
      closingNote: 'Thank you for your trust.',
      shareableText: `Pool Update: Score ${healthScore.score}/100`,
    };
  }

  let learningInsights: LearningInsights | null = null;
  if (includeLearning && serviceLogs.length >= 3) {
    try {
      learningInsights = analyzeLearning({ serviceLogs, poolId: customerId });
    } catch (error) {
      learningInsights = null;
    }
  }

  const confidence = calculateOverallConfidence(healthScore, dataQuality, totalServices);

  return {
    customerId,
    customerName,
    poolType,
    poolGallons,
    analysisDate: generatedAt.split('T')[0],
    dataRange,
    totalServices,

    healthScore,

    chemicalTrends,
    overallTrend,

    problems,
    rootCauseAnalysis,

    predictiveInsights,
    weatherImpact,

    costAnalysis,

    professionalSummary,
    customerReport,

    recommendations,

    learningInsights,

    confidence,
    dataQuality,
    generatedAt,
  };
}
export function analyzeFleetPools(input: FleetAnalysisInput): FleetInsights {
  const { pools, config } = input;

  const poolDataArray: PoolData[] = pools.map(pool => {
    let healthScore: PoolHealthScore;
    let primaryIssue: string | null = null;

    try {
      const healthResult = calculateHealthScore({ serviceLogs: pool.serviceLogs });
      healthScore = healthResult.healthScore;

      const rootCauseAnalysis = analyzeRootCauses({ serviceLogs: pool.serviceLogs });
      const problems = extractProblems(pool.serviceLogs, rootCauseAnalysis);
      primaryIssue = identifyPrimaryIssue(problems);
    } catch (error) {
      healthScore = {
        score: 50,
        grade: 'C',
        breakdown: [],
        trend: 'stable',
        confidence: 0,
      };
    }

    const sortedLogs = [...pool.serviceLogs].sort(
      (a, b) => new Date(b.service_date).getTime() - new Date(a.service_date).getTime()
    );
    const lastService = sortedLogs.length > 0 
      ? sortedLogs[0].service_date 
      : new Date().toISOString().split('T')[0];

    return {
      customerId: pool.customerId,
      customerName: pool.customerName,
      healthScore,
      primaryIssue,
      serviceDay: pool.serviceDay,
      lastService,
      previousHealthScore: pool.previousHealthScore,
    };
  });

  return analyzeFleet(poolDataArray, config);
}

export {
  type PoolAnalysisResult,
  type FleetInsights,
  type ServiceLog,
  type PoolHealthScore,
  type ChemicalTrend,
  type PoolProblem,
  type RootCauseAnalysis,
  type PredictiveInsights,
  type CostAnalysis,
  type GeneratedSummary,
  type CustomerReport,
  type CategorizedRecommendations,
  type LearningInsights,
  type WeatherImpact,
  type WeatherForecast,
  type DataQuality,
  type ExportOptions,
  type ExportResult,
} from './types';

export { calculateHealthScore } from './healthScorer';
export { generatePredictiveInsights } from './predictiveAnalyzer';
export { analyzeRootCauses } from './rootCauseAnalyzer';
export { generateSummaries, generateProfessionalSummary, generateCustomerReport } from './languageGenerator';
export { generateRecommendations } from './recommendationEngine';
export { generateCostAnalysis } from './costProjector';
export { analyzeFleet } from './fleetAnalyzer';
export { analyzeLearning } from './learningEngine';
export { analyzeWeatherImpact } from './weatherAnalyzer';
export { exportPoolAnalysis, exportFleetInsights, downloadExport } from './exportEngine';

export {
  isValidChemical,
  isValidReading,
  validatePoolGallons,
  validateServiceLog,
  validateServiceLogs,
  escapeHtml,
  escapeCsvValue,
  sanitizeId,
  VALID_CHEMICALS,
  VALID_READINGS,
  BOUNDS,
} from './validation';
