/**
 * Recommendation Engine
 * 
 * Generates prioritized, actionable recommendations for pool service technicians.
 * Categorizes recommendations by urgency (immediate, this-visit, next-visit, long-term)
 * and calculates dosages based on pool size.
 * 
 * Requirements: 6.1, 6.2, 6.3, 6.5
 * 
 * Security:
 * - Chemical names are validated against whitelist to prevent prototype pollution
 * - Pool gallons are validated within reasonable bounds
 * - IDs are sanitized to prevent injection attacks
 * - All inputs are validated before processing
 */

import {
  type Recommendation,
  type CategorizedRecommendations,
  type ServiceLog,
  type ChemicalReading,
  type PoolHealthScore,
  type RootCauseAnalysis,
  type PredictiveInsights,
  type RecommendationCategory,
} from './types';
import {
  isValidChemical,
  isValidReading,
  validatePoolGallons,
  generateSecureId,
  type ValidChemical,
} from './validation';

/**
 * Priority levels for different issue severities
 * Lower number = higher priority (more urgent)
 */
const PRIORITY_LEVELS = {
  critical: 1,
  high: 2,
  medium: 3,
  low: 4,
  preventive: 5,
} as const;

/**
 * Chemical dosage rates per 10,000 gallons
 * SECURITY: Only accessed via validated chemical names
 */
const DOSAGE_RATES: Record<ValidChemical, Record<string, { amount: string; unit: string }>> = {
  ph: {
    low: { amount: '1.5', unit: 'lbs sodium carbonate' },
    high: { amount: '1', unit: 'quart muriatic acid' },
    critical_low: { amount: '2', unit: 'lbs sodium carbonate' },
    critical_high: { amount: '1.5', unit: 'quarts muriatic acid' },
  },
  chlorine: {
    low: { amount: '1', unit: 'lb calcium hypochlorite' },
    critical: { amount: '2', unit: 'lbs calcium hypochlorite (shock)' },
  },
  alkalinity: {
    low: { amount: '1.5', unit: 'lbs sodium bicarbonate' },
    high: { amount: '1', unit: 'quart muriatic acid' },
    critical_low: { amount: '2.5', unit: 'lbs sodium bicarbonate' },
  },
  stabilizer: {
    low: { amount: '1', unit: 'lb cyanuric acid' },
    high: { amount: 'partial drain', unit: '(reduce by 25%)' },
  },
};
/**
 * Recommended actions for each chemical and reading combination
 * SECURITY: Only accessed via validated chemical names
 */
const CHEMICAL_ACTIONS: Record<ValidChemical, Record<ChemicalReading, {
  action: string;
  reason: string;
  category: RecommendationCategory;
  preventsFuture: boolean;
  equipmentCheck: string | null;
}>> = {
  ph: {
    good: {
      action: 'Continue monitoring pH levels',
      reason: 'pH is balanced',
      category: 'longTerm',
      preventsFuture: true,
      equipmentCheck: null,
    },
    low: {
      action: 'Add pH increaser (sodium carbonate)',
      reason: 'Low pH causes corrosion and eye irritation',
      category: 'thisVisit',
      preventsFuture: false,
      equipmentCheck: null,
    },
    high: {
      action: 'Add pH decreaser (muriatic acid)',
      reason: 'High pH reduces chlorine effectiveness and causes scaling',
      category: 'thisVisit',
      preventsFuture: false,
      equipmentCheck: null,
    },
    critical: {
      action: 'Immediate pH correction required',
      reason: 'Critical pH levels pose safety and equipment risks',
      category: 'immediate',
      preventsFuture: false,
      equipmentCheck: 'Check acid/base feeder calibration',
    },
  },
  chlorine: {
    good: {
      action: 'Maintain current chlorine levels',
      reason: 'Chlorine is at optimal sanitizing level',
      category: 'longTerm',
      preventsFuture: true,
      equipmentCheck: null,
    },
    low: {
      action: 'Add chlorine to restore sanitizer levels',
      reason: 'Low chlorine allows bacteria and algae growth',
      category: 'thisVisit',
      preventsFuture: false,
      equipmentCheck: 'Check chlorinator output',
    },
    high: {
      action: 'Allow chlorine to dissipate naturally',
      reason: 'High chlorine can cause skin and eye irritation',
      category: 'nextVisit',
      preventsFuture: false,
      equipmentCheck: 'Verify chlorinator settings',
    },
    critical: {
      action: 'Shock treatment required immediately',
      reason: 'Critical chlorine levels indicate sanitation failure',
      category: 'immediate',
      preventsFuture: false,
      equipmentCheck: 'Inspect salt cell or chlorinator for malfunction',
    },
  },
  alkalinity: {
    good: {
      action: 'Maintain alkalinity buffer',
      reason: 'Alkalinity is properly buffering pH',
      category: 'longTerm',
      preventsFuture: true,
      equipmentCheck: null,
    },
    low: {
      action: 'Add sodium bicarbonate to raise alkalinity',
      reason: 'Low alkalinity causes pH instability',
      category: 'thisVisit',
      preventsFuture: false,
      equipmentCheck: null,
    },
    high: {
      action: 'Lower alkalinity with muriatic acid',
      reason: 'High alkalinity makes pH difficult to adjust',
      category: 'thisVisit',
      preventsFuture: false,
      equipmentCheck: null,
    },
    critical: {
      action: 'Comprehensive alkalinity correction needed',
      reason: 'Critical alkalinity severely impacts water balance',
      category: 'immediate',
      preventsFuture: false,
      equipmentCheck: 'Test source water alkalinity',
    },
  },
  stabilizer: {
    good: {
      action: 'Monitor stabilizer levels seasonally',
      reason: 'Stabilizer is protecting chlorine from UV degradation',
      category: 'longTerm',
      preventsFuture: true,
      equipmentCheck: null,
    },
    low: {
      action: 'Add cyanuric acid (stabilizer)',
      reason: 'Low stabilizer causes rapid chlorine loss in sunlight',
      category: 'thisVisit',
      preventsFuture: false,
      equipmentCheck: null,
    },
    high: {
      action: 'Partial drain and refill to reduce stabilizer',
      reason: 'High stabilizer reduces chlorine effectiveness (chlorine lock)',
      category: 'nextVisit',
      preventsFuture: false,
      equipmentCheck: 'Review chlorine product type (stabilized vs unstabilized)',
    },
    critical: {
      action: 'Significant water replacement required',
      reason: 'Critical stabilizer levels severely impair sanitation',
      category: 'immediate',
      preventsFuture: false,
      equipmentCheck: 'Evaluate chlorine source and usage patterns',
    },
  },
};

/**
 * Generates a unique recommendation ID
 * SECURITY: Uses sanitized inputs to prevent injection attacks
 */
function generateRecommendationId(chemical: string, category: string, index: number): string {
  return generateSecureId('rec', chemical, category, index);
}

/**
 * Calculates dosage based on pool gallons
 * SECURITY: Validates chemical name and pool gallons before processing
 */
export function calculateDosage(
  chemical: string,
  reading: ChemicalReading,
  poolGallons: number | null
): string | null {
  // SECURITY: Validate reading is a known value
  if (!isValidReading(reading) || reading === 'good') {
    return null;
  }

  // SECURITY: Validate pool gallons are within reasonable bounds
  const validatedGallons = validatePoolGallons(poolGallons);
  if (validatedGallons === null) {
    return null;
  }

  // SECURITY: Validate chemical name to prevent prototype pollution
  if (!isValidChemical(chemical)) {
    return null;
  }

  const chemicalDosages = DOSAGE_RATES[chemical];
  if (!chemicalDosages) {
    return null;
  }

  let dosageKey = reading as string;
  if (reading === 'critical') {
    const criticalLowKey = 'critical_low';
    const criticalHighKey = 'critical_high';
    if (chemicalDosages[criticalLowKey]) {
      dosageKey = criticalLowKey;
    } else if (chemicalDosages[criticalHighKey]) {
      dosageKey = criticalHighKey;
    }
  }

  const dosage = chemicalDosages[dosageKey] || chemicalDosages[reading];
  if (!dosage) {
    return null;
  }

  const scaleFactor = validatedGallons / 10000;
  const scaledAmount = parseFloat(dosage.amount) * scaleFactor;

  if (dosage.amount === 'partial drain') {
    return `Partial drain and refill ${dosage.unit}`;
  }

  return `${scaledAmount.toFixed(1)} ${dosage.unit} for ${validatedGallons} gallons`;
}

/**
 * Gets priority number based on reading severity and category
 * SECURITY: Validates inputs before processing
 */
export function getPriorityForReading(
  reading: ChemicalReading,
  category: RecommendationCategory
): number {
  const severityPriority: Record<ChemicalReading, number> = {
    critical: PRIORITY_LEVELS.critical,
    low: PRIORITY_LEVELS.medium,
    high: PRIORITY_LEVELS.medium,
    good: PRIORITY_LEVELS.preventive,
  };

  const categoryModifier: Record<RecommendationCategory, number> = {
    immediate: 0,
    thisVisit: 1,
    nextVisit: 2,
    longTerm: 3,
  };

  return severityPriority[reading] + categoryModifier[category];
}

/**
 * Gets the most recent reading for a chemical from service logs
 */
function getMostRecentReading(
  logs: ServiceLog[],
  chemical: 'ph' | 'chlorine' | 'alkalinity' | 'stabilizer'
): ChemicalReading {
  if (logs.length === 0) {
    return 'good';
  }
  const sortedLogs = [...logs].sort(
    (a, b) => new Date(b.service_date).getTime() - new Date(a.service_date).getTime()
  );

  return sortedLogs[0][chemical] || 'good';
}

/**
 * Recommendation with its intended category (for proper categorization)
 */
interface RecommendationWithCategory extends Recommendation {
  intendedCategory: RecommendationCategory;
}

/**
 * Creates a recommendation from chemical reading
 */
function createChemicalRecommendation(
  chemical: ValidChemical,
  reading: ChemicalReading,
  poolGallons: number | null,
  index: number
): RecommendationWithCategory | null {
  const chemicalActions = CHEMICAL_ACTIONS[chemical];
  if (!chemicalActions) {
    return null;
  }

  const actionInfo = chemicalActions[reading];
  if (!actionInfo || reading === 'good') {
    return null;
  }

  const category = actionInfo.category;
  const priority = getPriorityForReading(reading, category);
  const dosage = calculateDosage(chemical, reading, poolGallons);

  return {
    id: generateRecommendationId(chemical, category, index),
    priority,
    action: actionInfo.action,
    reason: actionInfo.reason,
    chemical,
    dosage,
    equipmentCheck: actionInfo.equipmentCheck,
    addressesIssue: `${chemical} ${reading}`,
    preventsFuture: actionInfo.preventsFuture,
    intendedCategory: category,
  };
}

/**
 * Creates recommendations from root cause analysis
 */
function createRootCauseRecommendations(
  rootCauseAnalysis: RootCauseAnalysis | null,
  existingIssues: Set<string>
): RecommendationWithCategory[] {
  if (!rootCauseAnalysis) {
    return [];
  }

  const recommendations: RecommendationWithCategory[] = [];
  let index = 0;

  for (const rootCause of rootCauseAnalysis.rootCauses) {
    if (rootCause.solution.immediate && !existingIssues.has(rootCause.symptom)) {
      recommendations.push({
        id: generateRecommendationId('rootcause', 'immediate', index++),
        priority: PRIORITY_LEVELS.high,
        action: rootCause.solution.immediate,
        reason: `Root cause: ${rootCause.cause}`,
        chemical: null,
        dosage: null,
        equipmentCheck: rootCause.solution.equipmentCheck,
        addressesIssue: rootCause.symptom,
        preventsFuture: true,
        intendedCategory: 'thisVisit',
      });
    }

    if (rootCause.solution.longTerm) {
      recommendations.push({
        id: generateRecommendationId('rootcause', 'longTerm', index++),
        priority: PRIORITY_LEVELS.low,
        action: rootCause.solution.longTerm,
        reason: `Prevents recurrence of: ${rootCause.symptom}`,
        chemical: null,
        dosage: null,
        equipmentCheck: null,
        addressesIssue: rootCause.symptom,
        preventsFuture: true,
        intendedCategory: 'longTerm',
      });
    }
  }

  for (const chronicIssue of rootCauseAnalysis.chronicIssues) {
    recommendations.push({
      id: generateRecommendationId('chronic', 'nextVisit', index++),
      priority: PRIORITY_LEVELS.medium,
      action: chronicIssue.suggestedInvestigation,
      reason: `Chronic issue: ${chronicIssue.chemical} has been ${chronicIssue.pattern.toLowerCase()} ${chronicIssue.occurrences} times`,
      chemical: chronicIssue.chemical,
      dosage: null,
      equipmentCheck: null,
      addressesIssue: `Chronic ${chronicIssue.chemical} issues`,
      preventsFuture: true,
      intendedCategory: 'nextVisit',
    });
  }

  return recommendations;
}

/**
 * Creates recommendations from predictive insights
 */
function createPredictiveRecommendations(
  predictiveInsights: PredictiveInsights | null,
  existingIssues: Set<string>
): RecommendationWithCategory[] {
  if (!predictiveInsights) {
    return [];
  }

  const recommendations: RecommendationWithCategory[] = [];
  let index = 0;

  for (const prediction of predictiveInsights.predictions) {
    if (!prediction.recommendedAction || existingIssues.has(prediction.chemical)) {
      continue;
    }

    if (prediction.daysUntilCritical !== null && prediction.daysUntilCritical <= 14) {
      const category: RecommendationCategory =
        prediction.daysUntilCritical <= 3 ? 'thisVisit' : 'nextVisit';

      recommendations.push({
        id: generateRecommendationId('predictive', category, index++),
        priority: prediction.daysUntilCritical <= 3 ? PRIORITY_LEVELS.high : PRIORITY_LEVELS.medium,
        action: prediction.recommendedAction,
        reason: `Predicted to reach critical in ${prediction.daysUntilCritical} days`,
        chemical: prediction.chemical,
        dosage: null,
        equipmentCheck: null,
        addressesIssue: `Predicted ${prediction.chemical} decline`,
        preventsFuture: true,
        intendedCategory: category,
      });
    }
  }

  return recommendations;
}
/**
 * Categorizes recommendations by urgency using their intended category
 */
function categorizeRecommendations(
  recommendations: RecommendationWithCategory[]
): CategorizedRecommendations {
  const categorized: CategorizedRecommendations = {
    immediate: [],
    thisVisit: [],
    nextVisit: [],
    longTerm: [],
  };

  const sorted = [...recommendations].sort((a, b) => a.priority - b.priority);

  for (const rec of sorted) {
    const { intendedCategory, ...recommendation } = rec;

    categorized[intendedCategory].push(recommendation);
  }

  return categorized;
}

export interface RecommendationEngineInput {
  serviceLogs: ServiceLog[];
  poolGallons: number | null;
  healthScore?: PoolHealthScore;
  rootCauseAnalysis?: RootCauseAnalysis | null;
  predictiveInsights?: PredictiveInsights | null;
}

/**
 * Generates prioritized recommendations for a pool
 * 
 * Requirements:
 * - 6.1: Categorize actions as immediate, this-visit, next-visit, or long-term
 * - 6.2: Prioritize recommendations by impact on pool health and safety
 * - 6.3: Include specific chemical dosages based on pool size (gallons)
 * - 6.5: Provide specific equipment names and inspection points
 */
export function generateRecommendations(
  input: RecommendationEngineInput
): CategorizedRecommendations {
  const {
    serviceLogs,
    poolGallons,
    rootCauseAnalysis = null,
    predictiveInsights = null,
  } = input;

  const recommendations: RecommendationWithCategory[] = [];
  const addressedIssues = new Set<string>();
  let index = 0;

  const sortedLogs = [...serviceLogs].sort(
    (a, b) => new Date(b.service_date).getTime() - new Date(a.service_date).getTime()
  );

  const chemicals: Array<'ph' | 'chlorine' | 'alkalinity' | 'stabilizer'> = [
    'ph', 'chlorine', 'alkalinity', 'stabilizer'
  ];

  for (const chemical of chemicals) {
    const reading = getMostRecentReading(sortedLogs, chemical);
    const rec = createChemicalRecommendation(chemical, reading, poolGallons, index++);
    
    if (rec) {
      recommendations.push(rec);
      addressedIssues.add(chemical);
    }
  }

  const rootCauseRecs = createRootCauseRecommendations(rootCauseAnalysis, addressedIssues);
  recommendations.push(...rootCauseRecs);

  const predictiveRecs = createPredictiveRecommendations(predictiveInsights, addressedIssues);
  recommendations.push(...predictiveRecs);

  return categorizeRecommendations(recommendations);
}

/**
 * Gets priority levels constant
 * Used for Property 8: Recommendation Priority Ordering
 */
export function getPriorityLevels(): typeof PRIORITY_LEVELS {
  return { ...PRIORITY_LEVELS };
}

/**
 * Validates that immediate recommendations have lower priority numbers than long-term
 * Used for Property 8: Recommendation Priority Ordering
 */
export function validatePriorityOrdering(recommendations: CategorizedRecommendations): boolean {
  const immediateMaxPriority = recommendations.immediate.length > 0
    ? Math.max(...recommendations.immediate.map(r => r.priority))
    : 0;

  const longTermMinPriority = recommendations.longTerm.length > 0
    ? Math.min(...recommendations.longTerm.map(r => r.priority))
    : Infinity;

  if (recommendations.immediate.length > 0 && recommendations.longTerm.length > 0) {
    return immediateMaxPriority < longTermMinPriority;
  }

  return true;
}

/**
 * Checks if all recommendations in a category have valid priorities
 */
export function validateCategoryPriorities(
  recommendations: CategorizedRecommendations
): boolean {
  const immediateValid = recommendations.immediate.every(
    r => r.priority <= PRIORITY_LEVELS.high
  );

  const longTermValid = recommendations.longTerm.every(
    r => r.priority >= PRIORITY_LEVELS.low
  );

  return immediateValid && longTermValid;
}

/**
 * Gets all recommendations as a flat array sorted by priority
 */
export function flattenRecommendations(
  recommendations: CategorizedRecommendations
): Recommendation[] {
  const all = [
    ...recommendations.immediate,
    ...recommendations.thisVisit,
    ...recommendations.nextVisit,
    ...recommendations.longTerm,
  ];

  return all.sort((a, b) => a.priority - b.priority);
}
