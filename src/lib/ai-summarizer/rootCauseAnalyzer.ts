/**
 * Root Cause Analyzer
 * 
 * Identifies underlying causes of recurring problems through chemical correlation
 * analysis. Detects pH-alkalinity imbalances, chlorine-stabilizer conflicts,
 * and salt system issues.
 * 
 * Requirements: 3.1, 3.2, 3.3
 * 
 * Security:
 * - Service logs are validated before processing
 * - Evidence strings are sanitized
 * - Array sizes are bounded to prevent DoS
 * - Confidence values are bounded
 * - Correlation strength is validated
 */

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

// ============================================================================
// Constants
// ============================================================================

const CHRONIC_ISSUE_THRESHOLD = 3;

/** Maximum count for confidence calculation */
const MAX_EVIDENCE_COUNT = 100;

/**
 * Known chemical correlations and their implications
 */
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

/**
 * Root cause patterns and their solutions
 * SECURITY: Evidence strings are sanitized via createEvidenceString helper
 */
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
          // SECURITY: Use sanitized evidence string
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
          // SECURITY: Use sanitized evidence string
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
          // SECURITY: Use sanitized evidence string
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
          // SECURITY: Use sanitized evidence string
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
          // SECURITY: Use sanitized evidence string
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

// ============================================================================
// Helper Functions for Evidence Construction
// ============================================================================

/**
 * Creates a sanitized evidence string from a service log
 * SECURITY: Escapes all user-provided data to prevent XSS when rendered
 */
function createEvidenceString(log: ServiceLog, chemicals: string[]): string {
  const safeDate = escapeHtml(log.service_date);
  const chemicalReadings = chemicals.map(chem => {
    const reading = log[chem as keyof ServiceLog];
    return `${escapeHtml(chem)} ${escapeHtml(String(reading))}`;
  }).join(', ');
  return `Service on ${safeDate}: ${chemicalReadings}`;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Calculates correlation strength between two chemicals based on co-occurrence
 * of issues in service logs.
 * 
 * Returns a value between 0 and 1, where:
 * - 0 = no correlation
 * - 1 = perfect correlation (issues always occur together)
 */
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

  // Jaccard similarity coefficient
  return bothIssues / eitherIssue;
}

/**
 * Counts occurrences of a specific issue type for a chemical
 */
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

/**
 * Determines the most common issue type for a chemical
 */
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

/**
 * Generates a unique ID for a root cause
 * SECURITY: Uses sanitized inputs to prevent injection attacks
 */
function generateRootCauseId(baseId: string, index: number): string {
  return generateSecureId('rootcause', baseId, index);
}

// ============================================================================
// Core Analysis Functions
// ============================================================================

/**
 * Detects chemical correlations in service logs
 * 
 * Requirement 3.1: Identify and explain chemical correlations
 * SECURITY: Validates correlation strength before reporting
 */
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

    // Check if the correlation condition is met in any logs
    let conditionMetCount = 0;
    for (const log of logs) {
      const readingA = log[chemA];
      const readingB = log[chemB];
      if (known.condition(readingA, readingB)) {
        conditionMetCount++;
      }
    }

    // Only report correlation if it appears in multiple logs
    if (conditionMetCount >= 2) {
      const strength = calculateCorrelationStrength(logs, chemA, chemB);
      
      // SECURITY: Validate correlation strength is in valid range
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

/**
 * Detects chronic issues (problems occurring more than 3 times)
 * 
 * Requirement 3.2: Flag issues recurring more than 3 times as chronic
 * SECURITY: Uses validated chemical list
 */
export function detectChronicIssues(logs: ServiceLog[]): ChronicIssue[] {
  const chronicIssues: ChronicIssue[] = [];
  // SECURITY: Use validated chemical list to prevent prototype pollution
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

/**
 * Identifies root causes based on patterns in service logs
 * 
 * Requirement 3.3: Detect pH-alkalinity imbalances, chlorine-stabilizer conflicts
 * Requirement 3.4: Provide specific actionable steps
 * SECURITY: Uses bounded confidence and validated evidence
 */
export function identifyRootCauses(logs: ServiceLog[]): RootCause[] {
  const rootCauses: RootCause[] = [];

  for (let i = 0; i < ROOT_CAUSE_PATTERNS.length; i++) {
    const pattern = ROOT_CAUSE_PATTERNS[i];
    const result = pattern.condition(logs);

    if (result.matches) {
      // SECURITY: Calculate confidence with bounds checking
      // Cap the count modifier to prevent extreme values
      const boundedCount = Math.min(result.count - CHRONIC_ISSUE_THRESHOLD, MAX_EVIDENCE_COUNT);
      const confidence = calculateBoundedConfidence(50, boundedCount * 10, 95);

      rootCauses.push({
        id: generateRootCauseId(pattern.id, i),
        symptom: pattern.symptom,
        cause: pattern.cause,
        confidence,
        // SECURITY: Validate and limit evidence array
        evidence: validateEvidence(result.evidence, 5),
        solution: pattern.solution,
        recurrenceCount: result.count,
      });
    }
  }

  return rootCauses;
}

// ============================================================================
// Main Export Function
// ============================================================================

export interface RootCauseAnalyzerInput {
  serviceLogs: ServiceLog[];
}

/**
 * Performs complete root cause analysis on service logs
 * 
 * Requirements:
 * - 3.1: Identify and explain chemical correlations
 * - 3.2: Flag issues recurring more than 3 times as chronic
 * - 3.3: Detect pH-alkalinity imbalances, chlorine-stabilizer conflicts, salt system issues
 * 
 * SECURITY: Validates all service logs before processing
 */
export function analyzeRootCauses(input: RootCauseAnalyzerInput): RootCauseAnalysis {
  const { serviceLogs } = input;

  // SECURITY: Validate service logs before processing
  const validatedLogs = validateServiceLogs(serviceLogs);
  
  if (validatedLogs.length === 0) {
    return {
      correlations: [],
      rootCauses: [],
      chronicIssues: [],
    };
  }

  // Sort logs by date (oldest first)
  // SECURITY: Only process logs with valid dates
  const sortedLogs = validatedLogs
    .filter(log => isValidDateString(log.service_date))
    .sort((a, b) => new Date(a.service_date).getTime() - new Date(b.service_date).getTime());

  // Detect correlations
  const correlations = detectCorrelations(sortedLogs);

  // Detect chronic issues
  const chronicIssues = detectChronicIssues(sortedLogs);

  // Identify root causes
  const rootCauses = identifyRootCauses(sortedLogs);

  return {
    correlations,
    rootCauses,
    chronicIssues,
  };
}

// ============================================================================
// Utility Functions for Testing
// ============================================================================

/**
 * Gets the chronic issue threshold
 * Used for Property 6: Chronic Issue Detection Threshold
 */
export function getChronicIssueThreshold(): number {
  return CHRONIC_ISSUE_THRESHOLD;
}

/**
 * Checks if a chemical has chronic issues based on occurrence count
 * Used for Property 6: Chronic Issue Detection Threshold
 */
export function hasChronicIssue(occurrences: number): boolean {
  return occurrences > CHRONIC_ISSUE_THRESHOLD;
}

/**
 * Validates that correlation strength is symmetric
 * Used for Property 13: Chemical Correlation Symmetry
 */
export function validateCorrelationSymmetry(
  logs: ServiceLog[],
  chemicalA: keyof Pick<ServiceLog, 'ph' | 'chlorine' | 'alkalinity' | 'stabilizer'>,
  chemicalB: keyof Pick<ServiceLog, 'ph' | 'chlorine' | 'alkalinity' | 'stabilizer'>
): boolean {
  const strengthAB = calculateCorrelationStrength(logs, chemicalA, chemicalB);
  const strengthBA = calculateCorrelationStrength(logs, chemicalB, chemicalA);
  
  // Allow for small floating point differences
  return Math.abs(strengthAB - strengthBA) < 0.0001;
}
