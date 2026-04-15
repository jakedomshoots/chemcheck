/**
 * AI Pool Summarizer - Type Definitions
 * 
 * Core types and interfaces for the AI-powered pool analysis system.
 * These types define the data structures used throughout the analysis pipeline.
 */

// ============================================================================
// Pool Health Score Types
// ============================================================================

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
  score: number;              // 0-100
  grade: HealthGrade;
  breakdown: ChemicalBreakdown[];
  trend: TrendDirection;
  confidence: number;         // 0-100
}

export interface PoolHealthScorerConfig {
  weights: {
    ph: number;
    chlorine: number;
    alkalinity: number;
    stabilizer: number;
    salt: number;
  };
  trendWeight: number;        // How much trend affects score
  recencyBias: number;        // Weight recent readings more
}

// ============================================================================
// Prediction Types
// ============================================================================

export interface Prediction {
  chemical: string;
  currentLevel: string;
  predictedLevel: string;
  daysUntilCritical: number | null;
  confidence: number;         // 0-100
  factors: string[];          // What influenced this prediction
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

// ============================================================================
// Root Cause Analysis Types
// ============================================================================

export type CorrelationType = 'positive' | 'negative' | 'causal';

export interface ChemicalCorrelation {
  chemicals: [string, string];
  correlationType: CorrelationType;
  strength: number;           // 0-1
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

// ============================================================================
// Natural Language Generation Types
// ============================================================================

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
  headline: string;           // One-line status
  paragraph: string;          // Full narrative summary
  bulletPoints: string[];     // Key takeaways
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
  shareableText: string;      // SMS/email friendly version
}


// ============================================================================
// Cost Projection Types
// ============================================================================

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
  period: string;             // e.g., "December 2025"
  estimate: CostEstimate;
  breakdown: ChemicalCostBreakdown[];
  factors: string[];          // What influenced this projection
  comparedToAverage: 'below' | 'average' | 'above';
}

export interface CostAnalysis {
  monthlyProjections: CostProjection[];
  annualEstimate: CostEstimate;
  costTrend: 'decreasing' | 'stable' | 'increasing';
  highMaintenanceFlag: boolean;
  savingsOpportunities: string[];
}

// ============================================================================
// Fleet Analysis Types
// ============================================================================

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
  excellent: number;        // 80-100
  good: number;             // 60-79
  fair: number;             // 40-59
  poor: number;             // 0-39
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
  estimatedTime: number;    // minutes
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
  priorityPools: FleetPool[]; // Top 5 needing attention
  problemClusters: ProblemCluster[];
  byServiceDay: ServiceDayStats[];
  alerts: FleetAlert[];
}


// ============================================================================
// Learning Engine Types
// ============================================================================

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
  condition: string;          // e.g., "low chlorine + high stabilizer"
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

// ============================================================================
// Weather Analysis Types
// ============================================================================

export type WeatherCondition = 'sunny' | 'cloudy' | 'rain' | 'storm';
export type ImpactSeverity = 'low' | 'medium' | 'high';
export type OverallRisk = 'low' | 'moderate' | 'high';

export interface WeatherForecast {
  date: string;
  condition: WeatherCondition;
  highTemp: number;
  lowTemp: number;
  precipitation: number;      // inches
  humidity: number;           // percentage
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

// ============================================================================
// Export Engine Types
// ============================================================================

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


// ============================================================================
// Recommendation Types
// ============================================================================

export type RecommendationCategory = 'immediate' | 'thisVisit' | 'nextVisit' | 'longTerm';

export interface Recommendation {
  id: string;
  priority: number;           // 1 = highest
  action: string;
  reason: string;
  chemical: string | null;
  dosage: string | null;      // e.g., "2 lbs per 10,000 gallons"
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

// ============================================================================
// Chemical Trend Types
// ============================================================================

export interface ChemicalTrend {
  chemical: string;
  trend: TrendDirection;
  currentStatus: ChemicalReading;
  history: ChemicalReading[];
  confidence: number;
}

// ============================================================================
// Pool Problem Types
// ============================================================================

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

// ============================================================================
// Data Quality Types
// ============================================================================

export type DataQuality = 'excellent' | 'good' | 'fair' | 'limited';

// ============================================================================
// Main Pool Analysis Result Type
// ============================================================================

export interface PoolAnalysisResult {
  // Identification
  customerId: string;
  customerName: string;
  poolType: string;
  poolGallons: number | null;
  analysisDate: string;
  dataRange: { start: string; end: string };
  totalServices: number;

  // Core Scores
  healthScore: PoolHealthScore;
  
  // Trends & Patterns
  chemicalTrends: ChemicalTrend[];
  overallTrend: TrendDirection;
  
  // Problems & Root Causes
  problems: PoolProblem[];
  rootCauseAnalysis: RootCauseAnalysis;
  
  // Predictions
  predictiveInsights: PredictiveInsights;
  weatherImpact: WeatherImpact | null;
  
  // Costs
  costAnalysis: CostAnalysis | null;
  
  // Generated Content
  professionalSummary: GeneratedSummary;
  customerReport: CustomerReport;
  
  // Recommendations
  recommendations: CategorizedRecommendations;
  
  // Learning
  learningInsights: LearningInsights | null;
  
  // Metadata
  confidence: number;
  dataQuality: DataQuality;
  generatedAt: string;
}

// ============================================================================
// Service Log Input Type
// ============================================================================

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

// ============================================================================
// Utility Functions for Type Validation
// ============================================================================

/**
 * Converts a health score (0-100) to a letter grade
 * Handles NaN and non-finite numbers by returning 'F'
 */
export function scoreToGrade(score: number): HealthGrade {
  if (!Number.isFinite(score)) return 'F';
  if (score >= 80) return 'A';
  if (score >= 60) return 'B';
  if (score >= 40) return 'C';
  if (score >= 20) return 'D';
  return 'F';
}

/**
 * Validates that a health score is within bounds (0-100)
 */
export function isValidHealthScore(score: number): boolean {
  return typeof score === 'number' && score >= 0 && score <= 100;
}

/**
 * Validates that a confidence value is within bounds (0-100)
 */
export function isValidConfidence(confidence: number): boolean {
  return typeof confidence === 'number' && confidence >= 0 && confidence <= 100;
}

/**
 * Validates that cost projection ranges are properly ordered (low <= expected <= high)
 * Also validates that all values are finite and non-negative
 */
export function isValidCostRange(estimate: CostEstimate): boolean {
  const { low, expected, high } = estimate;
  
  // Check all values are finite numbers
  if (!Number.isFinite(low) || !Number.isFinite(expected) || !Number.isFinite(high)) {
    return false;
  }
  
  // Check all values are non-negative
  if (low < 0 || expected < 0 || high < 0) {
    return false;
  }
  
  // Check proper ordering
  return low <= expected && expected <= high;
}
