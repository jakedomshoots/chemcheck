/**
 * Recommendation Engine
 * 
 * Generates prioritized, actionable recommendations for pool service technicians.
 * Categorizes recommendations by urgency (immediate, this-visit, next-visit, long-term)
 * and calculates dosages from pool size AND the deviation from target
 * (see src/lib/poolChemistry.ts for the dosing constants and their sources).
 * Dosing is direction-aware: a reading of 'critical' is resolved to
 * critical_low / critical_high from the numeric value; without a value the
 * engine asks for a retest instead of guessing.
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
  type DirectionalReading,
} from './types';
import { classifyReading, isChemicalKey, planDose } from '../poolChemistry';
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
 * Readings the engine can act on: direction-aware statuses, plus
 * 'critical_unknown' for a stored 'critical' word with no numeric value
 * (direction unknown — the only safe advice is to retest).
 */
export type ActionableReading = DirectionalReading | 'critical_unknown';

type ActionInfo = {
  action: string;
  reason: string;
  category: RecommendationCategory;
  preventsFuture: boolean;
  equipmentCheck: string | null;
};

/**
 * Recommended actions for each chemical and direction-aware reading.
 * SECURITY: Only accessed via validated chemical names
 *
 * SAFETY: every action must move the reading TOWARD the ideal band.
 * recommendationEngine.test.ts property-tests this.
 */
const CHEMICAL_ACTIONS: Record<ValidChemical, Record<ActionableReading, ActionInfo>> = {
  ph: {
    good: {
      action: 'Continue monitoring pH levels',
      reason: 'pH is balanced',
      category: 'longTerm',
      preventsFuture: true,
      equipmentCheck: null,
    },
    low: {
      action: 'Raise pH with pH increaser (sodium carbonate / soda ash)',
      reason: 'Low pH causes corrosion and eye irritation',
      category: 'thisVisit',
      preventsFuture: false,
      equipmentCheck: null,
    },
    high: {
      action: 'Lower pH with muriatic acid',
      reason: 'High pH reduces chlorine effectiveness and causes scaling',
      category: 'thisVisit',
      preventsFuture: false,
      equipmentCheck: null,
    },
    critical_low: {
      action: 'Raise pH now with sodium carbonate (soda ash); check alkalinity first',
      reason: 'Very low pH is corrosive to equipment and surfaces and irritates swimmers',
      category: 'immediate',
      preventsFuture: false,
      equipmentCheck: 'Check acid feeder / CO2 system for overfeed',
    },
    critical_high: {
      action: 'Lower pH now with muriatic acid (in stages)',
      reason: 'Very high pH makes chlorine largely ineffective and causes scaling',
      category: 'immediate',
      preventsFuture: false,
      equipmentCheck: 'Check acid feeder calibration and salt cell (SWG pools drive pH up)',
    },
    critical_unknown: {
      action: 'Retest pH and record the numeric value before adjusting',
      reason: 'pH was logged as critical without a value, so it is unknown whether it must be raised or lowered',
      category: 'immediate',
      preventsFuture: false,
      equipmentCheck: null,
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
      action: 'Do not add chlorine — let it dissipate naturally',
      reason: 'High chlorine can cause skin and eye irritation',
      category: 'nextVisit',
      preventsFuture: false,
      equipmentCheck: 'Verify chlorinator / salt-cell output settings',
    },
    critical_low: {
      action: 'Add chlorine immediately — pool is effectively unsanitized',
      reason: 'Free chlorine near zero allows bacteria and algae growth; not safe for swimming',
      category: 'immediate',
      preventsFuture: false,
      equipmentCheck: 'Inspect salt cell or chlorinator for malfunction',
    },
    critical_high: {
      action: 'Stop all chlorine additions; no swimming until free chlorine is 10 ppm or below',
      reason: 'Free chlorine above 10 ppm is unsafe for swimmers',
      category: 'immediate',
      preventsFuture: false,
      equipmentCheck: 'Turn down or off the chlorinator / salt cell and check for overfeed',
    },
    critical_unknown: {
      action: 'Retest free chlorine and record the numeric value before adding anything',
      reason: 'Chlorine was logged as critical without a value — it may be near zero or dangerously high',
      category: 'immediate',
      preventsFuture: false,
      equipmentCheck: null,
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
      action: 'Lower alkalinity with muriatic acid and aeration',
      reason: 'High alkalinity makes pH drift up and difficult to adjust',
      category: 'thisVisit',
      preventsFuture: false,
      equipmentCheck: null,
    },
    critical_low: {
      action: 'Raise alkalinity now with sodium bicarbonate',
      reason: 'Very low alkalinity lets pH crash, corroding equipment and surfaces',
      category: 'immediate',
      preventsFuture: false,
      equipmentCheck: 'Test source water alkalinity',
    },
    critical_high: {
      action: 'Lower alkalinity with muriatic acid over several visits, aerating between additions',
      reason: 'Very high alkalinity drives pH up and promotes scaling',
      category: 'immediate',
      preventsFuture: false,
      equipmentCheck: 'Test source water alkalinity',
    },
    critical_unknown: {
      action: 'Retest total alkalinity and record the numeric value before adjusting',
      reason: 'Alkalinity was logged as critical without a value, so the correction direction is unknown',
      category: 'immediate',
      preventsFuture: false,
      equipmentCheck: null,
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
    critical_low: {
      action: 'Add cyanuric acid (stabilizer)',
      reason: 'Without stabilizer, sunlight destroys most chlorine within hours',
      category: 'immediate',
      preventsFuture: false,
      equipmentCheck: null,
    },
    critical_high: {
      action: 'Significant partial drain and refill required to reduce stabilizer',
      reason: 'Very high stabilizer severely impairs sanitation',
      category: 'immediate',
      preventsFuture: false,
      equipmentCheck: 'Switch to unstabilized chlorine (liquid or cal-hypo); stop trichlor tabs',
    },
    critical_unknown: {
      action: 'Retest stabilizer (CYA) and record the numeric value before adjusting',
      reason: 'Stabilizer was logged as critical without a value, so the correction direction is unknown',
      category: 'immediate',
      preventsFuture: false,
      equipmentCheck: null,
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

const DIRECTIONAL_READINGS: ReadonlySet<string> = new Set([
  'critical_low', 'low', 'good', 'high', 'critical_high',
]);

/**
 * Resolves a stored status word and optional numeric value into a
 * direction-aware reading. A measured value always wins over the status
 * word. Returns null when the chemical was not tested.
 */
export function resolveDirectionalReading(
  chemical: string,
  reading: ChemicalReading | DirectionalReading | null | undefined,
  value?: number | string | null,
  poolType?: string | null
): ActionableReading | null {
  if (isChemicalKey(chemical)) {
    const measured = classifyReading(chemical, value, { poolType });
    if (measured) return measured;
  }
  if (typeof reading !== 'string') return null;
  if (reading === 'critical') return 'critical_unknown';
  if (DIRECTIONAL_READINGS.has(reading)) return reading as DirectionalReading;
  return null;
}

export interface DosageOptions {
  /** Measured value of this chemical. */
  value?: number | null;
  /** Measured TA (used for pH dosing). */
  alkalinity?: number | null;
  /** Measured CYA (used for the chlorine target). */
  stabilizer?: number | null;
  poolType?: string | null;
}

/**
 * Calculates a dose proportional to the deviation from target.
 * SECURITY: Validates chemical name and pool gallons before processing
 *
 * Returns null for good readings, unknown pool size, or a bare 'critical'
 * with no numeric value (direction unknown — never guess which way to dose).
 */
export function calculateDosage(
  chemical: string,
  reading: ChemicalReading | DirectionalReading,
  poolGallons: number | null,
  options: DosageOptions = {}
): string | null {
  // SECURITY: Validate chemical name to prevent prototype pollution
  if (!isValidChemical(chemical)) {
    return null;
  }
  // SECURITY: Validate reading is a known value
  if (!isValidReading(reading) && !DIRECTIONAL_READINGS.has(reading)) {
    return null;
  }

  // SECURITY: Validate pool gallons are within reasonable bounds
  const validatedGallons = validatePoolGallons(poolGallons);
  if (validatedGallons === null) {
    return null;
  }

  const resolved = resolveDirectionalReading(chemical, reading, options.value, options.poolType);
  if (!resolved || resolved === 'good' || resolved === 'critical_unknown') {
    return null;
  }

  const plan = planDose({
    chemical,
    status: resolved,
    gallons: validatedGallons,
    value: options.value,
    alkalinity: options.alkalinity,
    stabilizer: options.stabilizer,
    poolType: options.poolType,
  });
  return plan ? plan.text : null;
}

/**
 * Gets priority number based on reading severity and category
 * SECURITY: Validates inputs before processing
 */
export function getPriorityForReading(
  reading: ChemicalReading | ActionableReading,
  category: RecommendationCategory
): number {
  const severityPriority: Record<ChemicalReading | ActionableReading, number> = {
    critical: PRIORITY_LEVELS.critical,
    critical_low: PRIORITY_LEVELS.critical,
    critical_high: PRIORITY_LEVELS.critical,
    critical_unknown: PRIORITY_LEVELS.critical,
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

  return (severityPriority[reading] ?? PRIORITY_LEVELS.medium) + categoryModifier[category];
}

type ChemicalKeyName = 'ph' | 'chlorine' | 'alkalinity' | 'stabilizer';

const VALUE_FIELDS: Record<ChemicalKeyName, 'ph_value' | 'chlorine_value' | 'alkalinity_value' | 'stabilizer_value'> = {
  ph: 'ph_value',
  chlorine: 'chlorine_value',
  alkalinity: 'alkalinity_value',
  stabilizer: 'stabilizer_value',
};

function numericField(log: ServiceLog | undefined, chemical: ChemicalKeyName): number | null {
  if (!log) return null;
  const raw = log[VALUE_FIELDS[chemical]];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

/**
 * Gets the most recent log (the one whose readings describe the pool now).
 */
function getMostRecentLog(logs: ServiceLog[]): ServiceLog | undefined {
  if (logs.length === 0) {
    return undefined;
  }
  const sortedLogs = [...logs].sort(
    (a, b) => new Date(b.service_date).getTime() - new Date(a.service_date).getTime()
  );
  return sortedLogs[0];
}

/**
 * Recommendation with its intended category (for proper categorization)
 */
interface RecommendationWithCategory extends Recommendation {
  intendedCategory: RecommendationCategory;
}

/**
 * Creates a recommendation from a direction-aware chemical reading
 */
function createChemicalRecommendation(
  chemical: ValidChemical,
  reading: ActionableReading,
  poolGallons: number | null,
  index: number,
  dosageOptions: DosageOptions = {}
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
  const dosage = reading === 'critical_unknown'
    ? null
    : calculateDosage(chemical, reading, poolGallons, dosageOptions);

  return {
    id: generateRecommendationId(chemical, category, index),
    priority,
    action: actionInfo.action,
    reason: actionInfo.reason,
    chemical,
    dosage,
    equipmentCheck: actionInfo.equipmentCheck,
    addressesIssue: `${chemical} ${reading.replace('_', ' ')}`,
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
  /** Customer pool type (e.g. 'Salt') — selects SWG-appropriate CYA targets. */
  poolType?: string | null;
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
    poolType = null,
    rootCauseAnalysis = null,
    predictiveInsights = null,
  } = input;

  const recommendations: RecommendationWithCategory[] = [];
  const addressedIssues = new Set<string>();
  let index = 0;

  const latestLog = getMostRecentLog(serviceLogs);

  const chemicals: ChemicalKeyName[] = ['ph', 'chlorine', 'alkalinity', 'stabilizer'];

  for (const chemical of chemicals) {
    if (!latestLog) break;
    const value = numericField(latestLog, chemical);
    // Untested chemicals (no status, no value) get no recommendation —
    // never assume 'good' and never guess.
    const reading = resolveDirectionalReading(chemical, latestLog[chemical], value, poolType);
    if (!reading) {
      index++;
      continue;
    }
    const rec = createChemicalRecommendation(chemical, reading, poolGallons, index++, {
      value,
      alkalinity: numericField(latestLog, 'alkalinity'),
      stabilizer: numericField(latestLog, 'stabilizer'),
      poolType,
    });
    
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
