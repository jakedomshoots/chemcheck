import {
  type ChemicalCorrelation,
  type RootCause,
  type RootCauseAnalysis,
  type ChronicIssue,
  type ServiceLog,
  type ChemicalReading,
  type CorrelationType,
} from './types';
import {
  validateServiceLogs,
  validateCorrelationStrength,
  validateEvidence,
  calculateBoundedConfidence,
  generateSecureId,
  isValidDateString,
  escapeHtml,
  CORRELATION_STRENGTH_THRESHOLD,
  type ValidChemical,
  VALID_CHEMICALS,
} from './validation';

const CHRONIC_ISSUE_THRESHOLD = 3;

const MAX_EVIDENCE_COUNT = 100;

const KNOWN_CORRELATIONS: Array<{
  chemicals: [string, string];
  type: CorrelationType;
  description: string;
  implication: string;
  condition: (a: ChemicalReading, b: ChemicalReading) => boolean;
}> = [
  {
    chemicals: ['ph', 'alkalinity'],
    type: 'causal',
    description: 'pH and alkalinity are chemically linked - alkalinity buffers pH',
    implication: 'Low alkalinity causes pH instability; high alkalinity makes pH difficult to adjust',
    condition: (ph, alk) => 
      (ph === 'low' && alk === 'low') || 
      (ph === 'high' && alk === 'high') ||
      (ph !== 'good' && alk !== 'good'),
  },
  {
    chemicals: ['chlorine', 'stabilizer'],
    type: 'negative',
    description: 'High stabilizer reduces chlorine effectiveness',
    implication: 'Over-stabilized pools require higher chlorine levels to maintain sanitation',
    condition: (chlorine, stabilizer) => 
      (chlorine === 'low' && stabilizer === 'high') ||
      (chlorine === 'critical' && stabilizer === 'high'),
  },
  {
    chemicals: ['chlorine', 'ph'],
    type: 'causal',
    description: 'pH affects chlorine effectiveness',
    implication: 'High pH reduces chlorine sanitizing power; low pH increases chlorine aggressiveness',
    condition: (chlorine, ph) =>
      (chlorine === 'low' && ph === 'high') ||
      (chlorine !== 'good' && ph !== 'good'),
  },
];

const ROOT_CAUSE_PATTERNS: Array<{
  id: string;
  symptom: string;
  cause: string;
  condition: (logs: ServiceLog[]) => { matches: boolean; evidence: string[]; count: number };
  solution: {
    immediate: string;
    longTerm: string;
    equipmentCheck: string | null;
  };
}> = [
  {
    id: 'ph-alkalinity-imbalance',
    symptom: 'Persistent pH instability',
    cause: 'Alkalinity levels not properly buffering pH',
    condition: (logs) => {
      const evidence: string[] = [];
      let count = 0;
      for (const log of logs) {
        if (log.ph !== 'good' && log.alkalinity !== 'good') {
          count++;
          evidence.push(createEvidenceString(log, ['ph', 'alkalinity']));
        }
      }
      return { matches: count >= CHRONIC_ISSUE_THRESHOLD, evidence, count };
    },
    solution: {
      immediate: 'Adjust alkalinity first, then fine-tune pH',
      longTerm: 'Establish regular alkalinity testing and adjustment schedule',
      equipmentCheck: 'Check for acid feeder malfunction or improper chemical storage',
    },
  },
  {
    id: 'chlorine-lock',
    symptom: 'Chlorine not holding despite regular additions',
    cause: 'Over-stabilization (cyanuric acid too high)',
    condition: (logs) => {
      const evidence: string[] = [];
      let count = 0;
      for (const log of logs) {
        if ((log.chlorine === 'low' || log.chlorine === 'critical') && log.stabilizer === 'high') {
          count++;
          evidence.push(createEvidenceString(log, ['chlorine', 'stabilizer']));
        }
      }
      return { matches: count >= CHRONIC_ISSUE_THRESHOLD, evidence, count };
    },
    solution: {
      immediate: 'Partial drain and refill to reduce stabilizer levels',
      longTerm: 'Switch to unstabilized chlorine or reduce stabilized chlorine usage',
      equipmentCheck: 'Review chlorinator settings and tablet type',
    },
  },
  {
    id: 'persistent-low-chlorine',
    symptom: 'Consistently low chlorine levels',
    cause: 'Insufficient chlorine production or high demand',
    condition: (logs) => {
      const evidence: string[] = [];
      let count = 0;
      for (const log of logs) {
        if (log.chlorine === 'low' || log.chlorine === 'critical') {
          count++;
          evidence.push(createEvidenceString(log, ['chlorine']));
        }
      }
      return { matches: count >= CHRONIC_ISSUE_THRESHOLD, evidence, count };
    },
    solution: {
      immediate: 'Shock treatment to restore chlorine levels',
      longTerm: 'Increase chlorine dosage or adjust chlorinator output',
      equipmentCheck: 'Inspect salt cell, chlorinator, or chemical feeder for proper operation',
    },
  },
  {
    id: 'persistent-high-ph',
    symptom: 'pH consistently rising',
    cause: 'High alkalinity or aeration issues',
    condition: (logs) => {
      const evidence: string[] = [];
      let count = 0;
      for (const log of logs) {
        if (log.ph === 'high') {
          count++;
          evidence.push(createEvidenceString(log, ['ph']));
        }
      }
      return { matches: count >= CHRONIC_ISSUE_THRESHOLD, evidence, count };
    },
    solution: {
      immediate: 'Add muriatic acid or pH decreaser',
      longTerm: 'Address alkalinity levels and reduce aeration sources',
      equipmentCheck: 'Check for excessive water features, fountains, or spa jets causing aeration',
    },
  },
  {
    id: 'persistent-low-alkalinity',
    symptom: 'Alkalinity consistently low',
    cause: 'Acid overuse or rainwater dilution',
    condition: (logs) => {
      const evidence: string[] = [];
      let count = 0;
      for (const log of logs) {
        if (log.alkalinity === 'low' || log.alkalinity === 'critical') {
          count++;
          evidence.push(createEvidenceString(log, ['alkalinity']));
        }
      }
      return { matches: count >= CHRONIC_ISSUE_THRESHOLD, evidence, count };
    },
    solution: {
      immediate: 'Add sodium bicarbonate to raise alkalinity',
      longTerm: 'Review acid dosing procedures and consider pool cover for rain protection',
      equipmentCheck: null,
    },
  },
];

function createEvidenceString(log: ServiceLog, chemicals: string[]): string {
  const safeDate = escapeHtml(log.service_date);
  const chemicalReadings = chemicals.map(chem => {
    const reading = log[chem as keyof ServiceLog];
    return `${escapeHtml(chem)} ${escapeHtml(String(reading))}`;
  }).join(', ');
  return `Service on ${safeDate}: ${chemicalReadings}`;
}

export function calculateCorrelationStrength(
  logs: ServiceLog[],
  chemicalA: keyof Pick<ServiceLog, 'ph' | 'chlorine' | 'alkalinity' | 'stabilizer'>,
  chemicalB: keyof Pick<ServiceLog, 'ph' | 'chlorine' | 'alkalinity' | 'stabilizer'>
): number {
  if (logs.length === 0) {
    return 0;
  }

  let bothIssues = 0;
  let eitherIssue = 0;

  for (const log of logs) {
    const aHasIssue = log[chemicalA] !== 'good';
    const bHasIssue = log[chemicalB] !== 'good';

    if (aHasIssue || bHasIssue) {
      eitherIssue++;
      if (aHasIssue && bHasIssue) {
        bothIssues++;
      }
    }
  }

  if (eitherIssue === 0) {
    return 0;
  }

  return bothIssues / eitherIssue;
}

export function countChemicalIssues(
  logs: ServiceLog[],
  chemical: keyof Pick<ServiceLog, 'ph' | 'chlorine' | 'alkalinity' | 'stabilizer'>,
  issueType?: ChemicalReading
): number {
  return logs.filter(log => {
    const reading = log[chemical];
    if (issueType) {
      return reading === issueType;
    }
    return reading !== 'good';
  }).length;
}

export function getMostCommonIssue(
  logs: ServiceLog[],
  chemical: keyof Pick<ServiceLog, 'ph' | 'chlorine' | 'alkalinity' | 'stabilizer'>
): ChemicalReading | null {
  const counts: Record<ChemicalReading, number> = {
    good: 0,
    low: 0,
    high: 0,
    critical: 0,
  };

  for (const log of logs) {
    const reading = log[chemical];
    if (reading && reading !== 'good') {
      counts[reading]++;
    }
  }

  let maxCount = 0;
  let mostCommon: ChemicalReading | null = null;

  for (const [reading, count] of Object.entries(counts)) {
    if (reading !== 'good' && count > maxCount) {
      maxCount = count;
      mostCommon = reading as ChemicalReading;
    }
  }

  return mostCommon;
}

function generateRootCauseId(baseId: string, index: number): string {
  return generateSecureId('rootcause', baseId, index);
}

export function detectCorrelations(logs: ServiceLog[]): ChemicalCorrelation[] {
  const correlations: ChemicalCorrelation[] = [];

  if (logs.length < 2) {
    return correlations;
  }

  for (const known of KNOWN_CORRELATIONS) {
    const [chemA, chemB] = known.chemicals as [
      keyof Pick<ServiceLog, 'ph' | 'chlorine' | 'alkalinity' | 'stabilizer'>,
      keyof Pick<ServiceLog, 'ph' | 'chlorine' | 'alkalinity' | 'stabilizer'>
    ];

    let conditionMetCount = 0;
    for (const log of logs) {
      const readingA = log[chemA];
      const readingB = log[chemB];
      if (known.condition(readingA, readingB)) {
        conditionMetCount++;
      }
    }

    if (conditionMetCount >= 2) {
      const strength = calculateCorrelationStrength(logs, chemA, chemB);
      const validatedStrength = validateCorrelationStrength(strength);
      if (validatedStrength === null) {
        console.warn(`Invalid correlation strength: ${strength}`);
        continue;
      }
      
      if (validatedStrength > CORRELATION_STRENGTH_THRESHOLD) {
        correlations.push({
          chemicals: known.chemicals,
          correlationType: known.type,
          strength: validatedStrength,
          description: known.description,
          implication: known.implication,
        });
      }
    }
  }

  return correlations;
}

export function detectChronicIssues(logs: ServiceLog[]): ChronicIssue[] {
  const chronicIssues: ChronicIssue[] = [];
  const chemicals: ValidChemical[] = [...VALID_CHEMICALS];

  for (const chemical of chemicals) {
    const issueCount = countChemicalIssues(logs, chemical);
    
    if (issueCount > CHRONIC_ISSUE_THRESHOLD) {
      const mostCommon = getMostCommonIssue(logs, chemical);
      const pattern = mostCommon
        ? `Frequently ${mostCommon}`
        : 'Recurring issues';

      let suggestedInvestigation: string;
      switch (chemical) {
        case 'ph':
          suggestedInvestigation = 'Check alkalinity levels, water source, and acid/base feeder calibration';
          break;
        case 'chlorine':
          suggestedInvestigation = 'Inspect sanitizer system, check stabilizer levels, review bather load';
          break;
        case 'alkalinity':
          suggestedInvestigation = 'Review acid usage, check for rainwater intrusion, test source water';
          break;
        case 'stabilizer':
          suggestedInvestigation = 'Evaluate chlorine product type, consider partial drain if over-stabilized';
          break;
        default:
          suggestedInvestigation = 'Conduct comprehensive water analysis';
      }

      chronicIssues.push({
        chemical,
        occurrences: issueCount,
        pattern,
        suggestedInvestigation,
      });
    }
  }

  return chronicIssues;
}

export function identifyRootCauses(logs: ServiceLog[]): RootCause[] {
  const rootCauses: RootCause[] = [];

  for (let i = 0; i < ROOT_CAUSE_PATTERNS.length; i++) {
    const pattern = ROOT_CAUSE_PATTERNS[i];
    const result = pattern.condition(logs);

    if (result.matches) {
      const boundedCount = Math.min(result.count - CHRONIC_ISSUE_THRESHOLD, MAX_EVIDENCE_COUNT);
      const confidence = calculateBoundedConfidence(50, boundedCount * 10, 95);

      rootCauses.push({
        id: generateRootCauseId(pattern.id, i),
        symptom: pattern.symptom,
        cause: pattern.cause,
        confidence,
        evidence: validateEvidence(result.evidence, 5),
        solution: pattern.solution,
        recurrenceCount: result.count,
      });
    }
  }

  return rootCauses;
}

export interface RootCauseAnalyzerInput {
  serviceLogs: ServiceLog[];
}

export function analyzeRootCauses(input: RootCauseAnalyzerInput): RootCauseAnalysis {
  const { serviceLogs } = input;

  const validatedLogs = validateServiceLogs(serviceLogs);

  if (validatedLogs.length === 0) {
    return {
      correlations: [],
      rootCauses: [],
      chronicIssues: [],
    };
  }

  const sortedLogs = validatedLogs
    .filter(log => isValidDateString(log.service_date))
    .sort((a, b) => new Date(a.service_date).getTime() - new Date(b.service_date).getTime());

  const correlations = detectCorrelations(sortedLogs);

  const chronicIssues = detectChronicIssues(sortedLogs);

  const rootCauses = identifyRootCauses(sortedLogs);

  return {
    correlations,
    rootCauses,
    chronicIssues,
  };
}

export function getChronicIssueThreshold(): number {
  return CHRONIC_ISSUE_THRESHOLD;
}

export function hasChronicIssue(occurrences: number): boolean {
  return occurrences > CHRONIC_ISSUE_THRESHOLD;
}

export function validateCorrelationSymmetry(
  logs: ServiceLog[],
  chemicalA: keyof Pick<ServiceLog, 'ph' | 'chlorine' | 'alkalinity' | 'stabilizer'>,
  chemicalB: keyof Pick<ServiceLog, 'ph' | 'chlorine' | 'alkalinity' | 'stabilizer'>
): boolean {
  const strengthAB = calculateCorrelationStrength(logs, chemicalA, chemicalB);
  const strengthBA = calculateCorrelationStrength(logs, chemicalB, chemicalA);

  return Math.abs(strengthAB - strengthBA) < 0.0001;
}
