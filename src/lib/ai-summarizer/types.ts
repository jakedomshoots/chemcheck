export type HealthGrade = 'A' | 'B' | 'C' | 'D' | 'F';
export type TrendDirection = 'improving' | 'stable' | 'declining';
export type ChemicalReading = 'good' | 'low' | 'high' | 'critical';

export interface ChemicalBreakdown {
  chemical: string;
  score: number;
  weight: number;
  contribution: number;
}

export interface PoolHealthScore {
  score: number;
  grade: HealthGrade;
  breakdown: ChemicalBreakdown[];
  trend: TrendDirection;
  confidence: number;
}

export interface PoolHealthScorerConfig {
  weights: {
    ph: number;
    chlorine: number;
    alkalinity: number;
    stabilizer: number;
    salt: number;
  };
  trendWeight: number;
  recencyBias: number;
}

export interface Prediction {
  chemical: string;
  currentLevel: string;
  predictedLevel: string;
  daysUntilCritical: number | null;
  confidence: number;
  factors: string[];
  recommendedAction: string | null;
}

export interface NextServiceRecommendation {
  urgency: 'routine' | 'soon' | 'urgent';
  suggestedDate: string;
  reason: string;
}

export interface PredictiveInsights {
  predictions: Prediction[];
  overallOutlook: 'stable' | 'attention-needed' | 'intervention-required';
  nextServiceRecommendation: NextServiceRecommendation;
  seasonalFactors: string[];
  weatherFactors: string[];
}

export type CorrelationType = 'positive' | 'negative' | 'causal';

export interface ChemicalCorrelation {
  chemicals: [string, string];
  correlationType: CorrelationType;
  strength: number;
  description: string;
  implication: string;
}

export interface RootCauseSolution {
  immediate: string;
  longTerm: string;
  equipmentCheck: string | null;
}

export interface RootCause {
  id: string;
  symptom: string;
  cause: string;
  confidence: number;
  evidence: string[];
  solution: RootCauseSolution;
  recurrenceCount: number;
}

export interface ChronicIssue {
  chemical: string;
  occurrences: number;
  pattern: string;
  suggestedInvestigation: string;
}
export interface RootCauseAnalysis {
  correlations: ChemicalCorrelation[];
  rootCauses: RootCause[];
  chronicIssues: ChronicIssue[];
}

export type Audience = 'professional' | 'customer';
export type Verbosity = 'brief' | 'standard' | 'detailed';
export type SummaryTone = 'positive' | 'neutral' | 'concerned' | 'urgent';

export interface SummaryOptions {
  audience: Audience;
  verbosity: Verbosity;
  includeRecommendations: boolean;
  includeCosts: boolean;
  includeWeather: boolean;
}

export interface GeneratedSummary {
  headline: string;
  paragraph: string;
  bulletPoints: string[];
  callToAction: string | null;
  tone: SummaryTone;
}

export interface CustomerReport {
  greeting: string;
  healthSummary: string;
  whatWeDid: string[];
  whatToExpect: string;
  recommendations: string[];
  closingNote: string;
  shareableText: string;
}

export interface CostEstimate {
  low: number;
  expected: number;
  high: number;
}

export interface ChemicalCostBreakdown {
  chemical: string;
  quantity: string;
  cost: number;
}

export interface CostProjection {
  period: string;
  estimate: CostEstimate;
  breakdown: ChemicalCostBreakdown[];
  factors: string[];
  comparedToAverage: 'below' | 'average' | 'above';
}
export interface CostAnalysis {
  monthlyProjections: CostProjection[];
  annualEstimate: CostEstimate;
  costTrend: 'decreasing' | 'stable' | 'increasing';
  highMaintenanceFlag: boolean;
  savingsOpportunities: string[];
}

export type UrgencyLevel = 'none' | 'low' | 'medium' | 'high' | 'critical';

export interface FleetPool {
  customerId: string;
  customerName: string;
  healthScore: number;
  urgency: UrgencyLevel;
  primaryIssue: string | null;
  serviceDay: string;
  lastService: string;
  daysSinceService: number;
}

export interface HealthDistribution {
  excellent: number;
  good: number;
  fair: number;
  poor: number;
}

export interface ProblemCluster {
  issue: string;
  pools: string[];
  suggestedBatchAction: string;
}

export interface ServiceDayStats {
  day: string;
  poolCount: number;
  averageHealth: number;
  estimatedTime: number;
}

export type AlertType = 'score-drop' | 'overdue' | 'chronic-issue';

export interface FleetAlert {
  type: AlertType;
  poolId: string;
  message: string;
}

export interface FleetInsights {
  totalPools: number;
  averageHealthScore: number;
  healthDistribution: HealthDistribution;
  priorityPools: FleetPool[];
  problemClusters: ProblemCluster[];
  byServiceDay: ServiceDayStats[];
  alerts: FleetAlert[];
}

export type InterventionSource = 'note' | 'inferred';

export interface InterventionRecord {
  id: string;
  poolId: string;
  date: string;
  action: string;
  chemical: string;
  beforeReading: string;
  afterReading: string | null;
  success: boolean | null;
  source: InterventionSource;
}

export interface LearnedPattern {
  condition: string;
  effectiveAction: string;
  successRate: number;
  sampleSize: number;
  confidence: number;
}

export interface RecommendationAdjustment {
  original: string;
  adjusted: string;
  reason: string;
}
export interface LearningInsights {
  interventions: InterventionRecord[];
  patterns: LearnedPattern[];
  recommendationAdjustments: RecommendationAdjustment[];
}

export type WeatherCondition = 'sunny' | 'cloudy' | 'rain' | 'storm';
export type ImpactSeverity = 'low' | 'medium' | 'high';
export type OverallRisk = 'low' | 'moderate' | 'high';

export interface WeatherForecast {
  date: string;
  condition: WeatherCondition;
  highTemp: number;
  lowTemp: number;
  precipitation: number;
  humidity: number;
}

export interface WeatherChemicalImpact {
  chemical: string;
  expectedEffect: string;
  severity: ImpactSeverity;
  preemptiveAction: string;
}
export interface WeatherImpact {
  forecast: WeatherForecast[];
  impacts: WeatherChemicalImpact[];
  overallRisk: OverallRisk;
  summary: string;
}

export type ExportFormat = 'pdf' | 'csv' | 'json';
export interface ExportBranding {
  companyName: string;
  logo: string | null;
  primaryColor: string;
}

export interface ExportOptions {
  format: ExportFormat;
  includeCharts: boolean;
  branding: ExportBranding | null;
  dateRange: { start: string; end: string };
}

export interface ExportResult {
  format: string;
  filename: string;
  data: Blob | string;
  generatedAt: string;
  dataRange: { start: string; end: string };
}

export type RecommendationCategory = 'immediate' | 'thisVisit' | 'nextVisit' | 'longTerm';

export interface Recommendation {
  id: string;
  priority: number;
  action: string;
  reason: string;
  chemical: string | null;
  dosage: string | null;
  equipmentCheck: string | null;
  addressesIssue: string;
  preventsFuture: boolean;
}
export interface CategorizedRecommendations {
  immediate: Recommendation[];
  thisVisit: Recommendation[];
  nextVisit: Recommendation[];
  longTerm: Recommendation[];
}
export interface ChemicalTrend {
  chemical: string;
  trend: TrendDirection;
  currentStatus: ChemicalReading;
  history: ChemicalReading[];
  confidence: number;
}
export type ProblemSeverity = 'low' | 'medium' | 'high' | 'critical';
export interface PoolProblem {
  id: string;
  chemical: string;
  severity: ProblemSeverity;
  description: string;
  occurrences: number;
  firstDetected: string;
  lastDetected: string;
}
export type DataQuality = 'excellent' | 'good' | 'fair' | 'limited';

export interface PoolAnalysisResult {
  customerId: string;
  customerName: string;
  poolType: string;
  poolGallons: number | null;
  analysisDate: string;
  dataRange: { start: string; end: string };
  totalServices: number;
  healthScore: PoolHealthScore;
  chemicalTrends: ChemicalTrend[];
  overallTrend: TrendDirection;
  problems: PoolProblem[];
  rootCauseAnalysis: RootCauseAnalysis;
  predictiveInsights: PredictiveInsights;
  weatherImpact: WeatherImpact | null;
  costAnalysis: CostAnalysis | null;
  professionalSummary: GeneratedSummary;
  customerReport: CustomerReport;
  recommendations: CategorizedRecommendations;
  learningInsights: LearningInsights | null;
  confidence: number;
  dataQuality: DataQuality;
  generatedAt: string;
}
export interface ServiceLog {
  id: number | string;
  service_date: string;
  ph: ChemicalReading;
  chlorine: ChemicalReading;
  alkalinity: ChemicalReading;
  stabilizer: ChemicalReading;
  salt?: number;
  notes?: string;
}

export function scoreToGrade(score: number): HealthGrade {
  if (!Number.isFinite(score)) return 'F';
  if (score >= 80) return 'A';
  if (score >= 60) return 'B';
  if (score >= 40) return 'C';
  if (score >= 20) return 'D';
  return 'F';
}

export function isValidHealthScore(score: number): boolean {
  return typeof score === 'number' && score >= 0 && score <= 100;
}

export function isValidConfidence(confidence: number): boolean {
  return typeof confidence === 'number' && confidence >= 0 && confidence <= 100;
}

export function isValidCostRange(estimate: CostEstimate): boolean {
  const { low, expected, high } = estimate;
  if (!Number.isFinite(low) || !Number.isFinite(expected) || !Number.isFinite(high)) {
    return false;
  }
  if (low < 0 || expected < 0 || high < 0) {
    return false;
  }
  return low <= expected && expected <= high;
}
