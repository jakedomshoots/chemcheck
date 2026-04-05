/**
 * Learning Engine
 * 
 * Tracks intervention outcomes to improve recommendations over time.
 * Parses service notes for actions taken, tracks before/after readings,
 * calculates success rates, and generates recommendation adjustments.
 * 
 * Requirements: 8.1, 8.2, 8.3, 8.4
 */

import {
  type InterventionRecord,
  type LearnedPattern,
  type RecommendationAdjustment,
  type LearningInsights,
  type ServiceLog,
  type ChemicalReading,
  type InterventionSource,
} from './types';

const MIN_PATTERN_SAMPLE_SIZE = 3;

const MIN_EFFECTIVE_SUCCESS_RATE = 0.6;

const ACTION_KEYWORDS: Record<string, { chemical: string; action: string }[]> = {
  'shock': [{ chemical: 'chlorine', action: 'shock treatment' }],
  'shocked': [{ chemical: 'chlorine', action: 'shock treatment' }],
  'chlorine': [{ chemical: 'chlorine', action: 'added chlorine' }],
  'added chlorine': [{ chemical: 'chlorine', action: 'added chlorine' }],
  'liquid chlorine': [{ chemical: 'chlorine', action: 'added liquid chlorine' }],
  'tabs': [{ chemical: 'chlorine', action: 'added chlorine tablets' }],
  'tablets': [{ chemical: 'chlorine', action: 'added chlorine tablets' }],

  'acid': [{ chemical: 'ph', action: 'added acid' }],
  'muriatic': [{ chemical: 'ph', action: 'added muriatic acid' }],
  'ph down': [{ chemical: 'ph', action: 'added pH decreaser' }],
  'ph up': [{ chemical: 'ph', action: 'added pH increaser' }],
  'soda ash': [{ chemical: 'ph', action: 'added soda ash' }],

  'baking soda': [{ chemical: 'alkalinity', action: 'added baking soda' }],
  'sodium bicarbonate': [{ chemical: 'alkalinity', action: 'added sodium bicarbonate' }],
  'alkalinity up': [{ chemical: 'alkalinity', action: 'added alkalinity increaser' }],
  'bicarb': [{ chemical: 'alkalinity', action: 'added sodium bicarbonate' }],

  'stabilizer': [{ chemical: 'stabilizer', action: 'added stabilizer' }],
  'cyanuric': [{ chemical: 'stabilizer', action: 'added cyanuric acid' }],
  'cya': [{ chemical: 'stabilizer', action: 'added cyanuric acid' }],
  'conditioner': [{ chemical: 'stabilizer', action: 'added conditioner' }],
  'drained': [{ chemical: 'stabilizer', action: 'partial drain to reduce stabilizer' }],
  'drain': [{ chemical: 'stabilizer', action: 'partial drain to reduce stabilizer' }],

  'brushed': [{ chemical: 'chlorine', action: 'brushed pool surfaces' }],
  'vacuumed': [{ chemical: 'chlorine', action: 'vacuumed pool' }],
  'backwash': [{ chemical: 'chlorine', action: 'backwashed filter' }],
  'cleaned filter': [{ chemical: 'chlorine', action: 'cleaned filter' }],
};

const READING_SEVERITY: Record<ChemicalReading, number> = {
  critical: 0,
  low: 1,
  high: 1,
  good: 2,
};

function generateInterventionId(poolId: string, date: string, index: number): string {
  return `int-${poolId}-${date}-${index}`;
}

export function parseServiceNotes(notes: string): Array<{ chemical: string; action: string }> {
  if (!notes || notes.trim() === '') {
    return [];
  }

  const actions: Array<{ chemical: string; action: string }> = [];
  const lowerNotes = notes.toLowerCase();

  for (const [keyword, keywordActions] of Object.entries(ACTION_KEYWORDS)) {
    if (lowerNotes.includes(keyword)) {
      for (const action of keywordActions) {
        const exists = actions.some(
          a => a.chemical === action.chemical && a.action === action.action
        );
        if (!exists) {
          actions.push(action);
        }
      }
    }
  }

  return actions;
}

export function didReadingImprove(
  before: ChemicalReading,
  after: ChemicalReading
): boolean {
  return READING_SEVERITY[after] > READING_SEVERITY[before];
}

export function didReadingNotWorsen(
  before: ChemicalReading,
  after: ChemicalReading
): boolean {
  return READING_SEVERITY[after] >= READING_SEVERITY[before];
}

export function calculateInterventionSuccess(
  beforeReading: ChemicalReading,
  afterReading: ChemicalReading | null
): boolean | null {
  if (afterReading === null) {
    return null;
  }

  return didReadingImprove(beforeReading, afterReading);
}

function getChemicalReading(
  log: ServiceLog,
  chemical: string
): ChemicalReading | undefined {
  switch (chemical) {
    case 'ph':
      return log.ph;
    case 'chlorine':
      return log.chlorine;
    case 'alkalinity':
      return log.alkalinity;
    case 'stabilizer':
      return log.stabilizer;
    default:
      return undefined;
  }
}

function buildConditionString(log: ServiceLog): string {
  const conditions: string[] = [];

  if (log.ph !== 'good') {
    conditions.push(`${log.ph} ph`);
  }
  if (log.chlorine !== 'good') {
    conditions.push(`${log.chlorine} chlorine`);
  }
  if (log.alkalinity !== 'good') {
    conditions.push(`${log.alkalinity} alkalinity`);
  }
  if (log.stabilizer !== 'good') {
    conditions.push(`${log.stabilizer} stabilizer`);
  }

  return conditions.length > 0 ? conditions.join(' + ') : 'normal conditions';
}

export function extractInterventions(
  serviceLogs: ServiceLog[],
  poolId: string
): InterventionRecord[] {
  const interventions: InterventionRecord[] = [];

  const sortedLogs = [...serviceLogs].sort(
    (a, b) => new Date(a.service_date).getTime() - new Date(b.service_date).getTime()
  );

  for (let i = 0; i < sortedLogs.length; i++) {
    const currentLog = sortedLogs[i];
    const nextLog = sortedLogs[i + 1];

    const actions = parseServiceNotes(currentLog.notes || '');

    for (let j = 0; j < actions.length; j++) {
      const action = actions[j];
      const beforeReading = getChemicalReading(currentLog, action.chemical);
      
      if (!beforeReading) {
        continue;
      }

      const afterReading = nextLog 
        ? getChemicalReading(nextLog, action.chemical) || null
        : null;

      const success = calculateInterventionSuccess(
        beforeReading,
        afterReading
      );

      interventions.push({
        id: generateInterventionId(poolId, currentLog.service_date, j),
        poolId,
        date: currentLog.service_date,
        action: action.action,
        chemical: action.chemical,
        beforeReading,
        afterReading,
        success,
        source: 'note' as InterventionSource,
      });
    }

    if (nextLog) {
      const chemicals = ['ph', 'chlorine', 'alkalinity', 'stabilizer'] as const;

      for (const chemical of chemicals) {
        const before = getChemicalReading(currentLog, chemical);
        const after = getChemicalReading(nextLog, chemical);

        if (before && after && before !== 'good' && after === 'good') {
          const existingAction = interventions.find(
            int => int.date === currentLog.service_date && int.chemical === chemical
          );
          
          if (!existingAction) {
            interventions.push({
              id: generateInterventionId(poolId, currentLog.service_date, interventions.length),
              poolId,
              date: currentLog.service_date,
              action: `corrected ${chemical}`,
              chemical,
              beforeReading: before,
              afterReading: after,
              success: true,
              source: 'inferred' as InterventionSource,
            });
          }
        }
      }
    }
  }

  return interventions;
}

export function identifyPatterns(
  interventions: InterventionRecord[],
  serviceLogs: ServiceLog[]
): LearnedPattern[] {
  const patterns: LearnedPattern[] = [];

  const actionGroups = new Map<string, {
    condition: string;
    action: string;
    successes: number;
    failures: number;
    total: number;
  }>();

  const sortedLogs = [...serviceLogs].sort(
    (a, b) => new Date(a.service_date).getTime() - new Date(b.service_date).getTime()
  );

  for (const intervention of interventions) {
    if (intervention.success === null) {
      continue;
    }

    const log = sortedLogs.find(l => l.service_date === intervention.date);
    if (!log) {
      continue;
    }

    const condition = buildConditionString(log);
    const key = `${condition}|${intervention.action}`;

    const existing = actionGroups.get(key);
    if (existing) {
      existing.total++;
      if (intervention.success) {
        existing.successes++;
      } else {
        existing.failures++;
      }
    } else {
      actionGroups.set(key, {
        condition,
        action: intervention.action,
        successes: intervention.success ? 1 : 0,
        failures: intervention.success ? 0 : 1,
        total: 1,
      });
    }
  }

  for (const group of actionGroups.values()) {
    if (group.total >= MIN_PATTERN_SAMPLE_SIZE) {
      const successRate = group.successes / group.total;

      const sampleSizeConfidence = Math.min(group.total / 10, 1) * 50;
      const successRateConfidence = successRate * 50;
      const confidence = Math.round(sampleSizeConfidence + successRateConfidence);

      patterns.push({
        condition: group.condition,
        effectiveAction: group.action,
        successRate: Math.round(successRate * 100) / 100,
        sampleSize: group.total,
        confidence: Math.min(confidence, 100),
      });
    }
  }

  return patterns.sort((a, b) => b.confidence - a.confidence);
}

export function generateRecommendationAdjustments(
  patterns: LearnedPattern[]
): RecommendationAdjustment[] {
  const adjustments: RecommendationAdjustment[] = [];

  for (const pattern of patterns) {
    if (pattern.successRate < MIN_EFFECTIVE_SUCCESS_RATE && pattern.sampleSize >= MIN_PATTERN_SAMPLE_SIZE) {
      let adjusted: string;
      let reason: string;

      if (pattern.effectiveAction.includes('shock')) {
        adjusted = 'Consider double shock treatment or check stabilizer levels first';
        reason = `Standard shock treatment has ${Math.round(pattern.successRate * 100)}% success rate for this condition`;
      } else if (pattern.effectiveAction.includes('acid')) {
        adjusted = 'Check alkalinity before adjusting pH; consider smaller acid doses';
        reason = `Acid additions have ${Math.round(pattern.successRate * 100)}% success rate; alkalinity may be the root cause`;
      } else if (pattern.effectiveAction.includes('chlorine')) {
        adjusted = 'Check stabilizer levels; consider liquid chlorine instead of tablets';
        reason = `Chlorine additions have ${Math.round(pattern.successRate * 100)}% success rate; stabilizer lock may be present`;
      } else {
        adjusted = `Review ${pattern.effectiveAction} approach; consider alternative methods`;
        reason = `Current approach has ${Math.round(pattern.successRate * 100)}% success rate`;
      }

      adjustments.push({
        original: pattern.effectiveAction,
        adjusted,
        reason,
      });
    }

    if (pattern.successRate >= 0.8 && pattern.sampleSize >= MIN_PATTERN_SAMPLE_SIZE) {
      adjustments.push({
        original: pattern.effectiveAction,
        adjusted: `${pattern.effectiveAction} (proven effective)`,
        reason: `${Math.round(pattern.successRate * 100)}% success rate over ${pattern.sampleSize} interventions`,
      });
    }
  }

  return adjustments;
}

export interface LearningEngineInput {
  serviceLogs: ServiceLog[];
  poolId: string;
}

export function analyzeLearning(input: LearningEngineInput): LearningInsights {
  const { serviceLogs, poolId } = input;

  const interventions = extractInterventions(serviceLogs, poolId);

  const patterns = identifyPatterns(interventions, serviceLogs);

  const recommendationAdjustments = generateRecommendationAdjustments(patterns);

  return {
    interventions,
    patterns,
    recommendationAdjustments,
  };
}

export function validateInterventionOutcome(
  beforeReading: ChemicalReading,
  afterReading: ChemicalReading
): boolean {
  return calculateInterventionSuccess(beforeReading, afterReading) === didReadingImprove(beforeReading, afterReading);
}

export function getMinPatternSampleSize(): number {
  return MIN_PATTERN_SAMPLE_SIZE;
}

export function getMinEffectiveSuccessRate(): number {
  return MIN_EFFECTIVE_SUCCESS_RATE;
}
