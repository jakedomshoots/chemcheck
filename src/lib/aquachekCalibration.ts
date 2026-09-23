import {
  AQUACHEK_READING_LEVELS,
  type AquaChekReadings,
} from './aquachek';

export const AQUACHEK_CALIBRATION_ANALYTES = [
  'totalHardness',
  'totalChlorine',
  'freeChlorine',
  'ph',
  'totalAlkalinity',
  'cyanuricAcid',
] as const;

export type AquaChekCalibrationAnalyte = typeof AQUACHEK_CALIBRATION_ANALYTES[number];

export interface AquaChekCalibrationPolicy {
  minimumCalibrationAcceptedPhotos: number;
  minimumCalibrationTruthPerAnalyte: number;
  minimumAcceptedPhotos: number;
  minimumTruthPerAnalyte: number;
  minimumDevices: number;
  minimumStripLots: number;
  minimumLightingConditions: number;
  minimumAcceptanceRate: number;
  minimumExactLevelRate: number;
  minimumWithinOneLevelRate: number;
  targetSecondsAfterDip: { min: number; max: number };
  minimumTimingComplianceRate: number;
}

export const DEFAULT_AQUACHEK_CALIBRATION_POLICY: AquaChekCalibrationPolicy = {
  minimumCalibrationAcceptedPhotos: 40,
  minimumCalibrationTruthPerAnalyte: 20,
  minimumAcceptedPhotos: 10,
  minimumTruthPerAnalyte: 10,
  minimumDevices: 2,
  minimumStripLots: 2,
  minimumLightingConditions: 3,
  minimumAcceptanceRate: 0.85,
  minimumExactLevelRate: 0.65,
  minimumWithinOneLevelRate: 0.9,
  targetSecondsAfterDip: { min: 14, max: 16 },
  minimumTimingComplianceRate: 0.9,
};

interface AcceptedOutcome {
  kind: 'accepted';
  readings: AquaChekReadings;
  confidence: 'low' | 'medium' | 'high';
  analysisVersion: string;
}

interface RejectedOutcome {
  kind: 'rejected';
  code: string;
  message: string;
}

export interface AquaChekCalibrationSample {
  sampleId: string;
  image: string;
  device: string;
  stripLot: string;
  secondsAfterDip: number;
  lighting: string;
  cohort: 'calibration' | 'validation';
  truthMethod: 'drop-test' | 'photometer' | 'laboratory' | 'mixed';
  truthInstrument: string;
  truth: Partial<Record<AquaChekCalibrationAnalyte, number>>;
  outcome: AcceptedOutcome | RejectedOutcome;
}

export interface AquaChekAnalyteCalibrationMetrics {
  truthCount: number;
  exactLevelHits: number;
  withinOneLevelHits: number;
  exactLevelRate: number | null;
  withinOneLevelRate: number | null;
  meanAbsoluteError: number | null;
}

export interface AquaChekCalibrationReport {
  policy: AquaChekCalibrationPolicy;
  summary: {
    totalPhotos: number;
    acceptedPhotos: number;
    acceptedCalibrationPhotos: number;
    acceptedValidationPhotos: number;
    rejectedPhotos: number;
    acceptanceRate: number;
    deviceCount: number;
    stripLotCount: number;
    lightingConditionCount: number;
    timingComplianceRate: number;
  };
  analytes: Record<AquaChekCalibrationAnalyte, AquaChekAnalyteCalibrationMetrics>;
  calibrationTruthCounts: Record<AquaChekCalibrationAnalyte, number>;
  rejections: Record<string, number>;
  readiness: {
    status: 'ready' | 'needs-data' | 'fails-accuracy';
    reasons: string[];
  };
}

function nearestLevelIndex(value: number, levels: readonly number[]) {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  levels.forEach((level, index) => {
    const distance = Math.abs(value - level);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

const rate = (hits: number, total: number) => total === 0 ? null : hits / total;
const formatPercent = (value: number) => `${Math.round(value * 100)}%`;

export function scoreAquaChekCalibration(
  samples: AquaChekCalibrationSample[],
  policy: AquaChekCalibrationPolicy = DEFAULT_AQUACHEK_CALIBRATION_POLICY,
): AquaChekCalibrationReport {
  const accepted = samples.filter((sample) => sample.outcome.kind === 'accepted');
  const calibrationAccepted = accepted.filter((sample) => sample.cohort === 'calibration');
  const validationSamples = samples.filter((sample) => sample.cohort === 'validation');
  const validationAccepted = accepted.filter((sample) => sample.cohort === 'validation');
  const rejected = samples.filter((sample) => sample.outcome.kind === 'rejected');
  const rejections: Record<string, number> = {};
  rejected.forEach((sample) => {
    const code = sample.outcome.kind === 'rejected' ? sample.outcome.code : 'unknown';
    rejections[code] = (rejections[code] ?? 0) + 1;
  });

  const analytes = Object.fromEntries(AQUACHEK_CALIBRATION_ANALYTES.map((analyte) => {
    const levels = AQUACHEK_READING_LEVELS[analyte];
    const comparisons = validationAccepted.flatMap((sample) => {
      if (sample.outcome.kind !== 'accepted') return [];
      const truth = sample.truth[analyte];
      const predicted = sample.outcome.readings[analyte];
      if (!Number.isFinite(truth) || !Number.isFinite(predicted)) return [];
      const truthIndex = nearestLevelIndex(truth!, levels);
      const predictedIndex = nearestLevelIndex(predicted!, levels);
      return [{ truth: truth!, predicted: predicted!, levelDistance: Math.abs(truthIndex - predictedIndex) }];
    });
    const exactLevelHits = comparisons.filter(({ levelDistance }) => levelDistance === 0).length;
    const withinOneLevelHits = comparisons.filter(({ levelDistance }) => levelDistance <= 1).length;
    const absoluteError = comparisons.reduce((sum, item) => sum + Math.abs(item.truth - item.predicted), 0);
    return [analyte, {
      truthCount: comparisons.length,
      exactLevelHits,
      withinOneLevelHits,
      exactLevelRate: rate(exactLevelHits, comparisons.length),
      withinOneLevelRate: rate(withinOneLevelHits, comparisons.length),
      meanAbsoluteError: comparisons.length === 0 ? null : absoluteError / comparisons.length,
    }];
  })) as Record<AquaChekCalibrationAnalyte, AquaChekAnalyteCalibrationMetrics>;

  const calibrationTruthCounts = Object.fromEntries(AQUACHEK_CALIBRATION_ANALYTES.map((analyte) => [
    analyte,
    calibrationAccepted.filter((sample) => Number.isFinite(sample.truth[analyte])).length,
  ])) as Record<AquaChekCalibrationAnalyte, number>;

  const acceptanceRate = validationSamples.length === 0 ? 0 : validationAccepted.length / validationSamples.length;
  const timedPhotos = validationSamples.filter((sample) => Number.isFinite(sample.secondsAfterDip));
  const timingHits = timedPhotos.filter((sample) => (
    sample.secondsAfterDip >= policy.targetSecondsAfterDip.min
    && sample.secondsAfterDip <= policy.targetSecondsAfterDip.max
  )).length;
  const timingComplianceRate = timedPhotos.length === 0 ? 0 : timingHits / timedPhotos.length;
  const summary = {
    totalPhotos: samples.length,
    acceptedPhotos: accepted.length,
    acceptedCalibrationPhotos: calibrationAccepted.length,
    acceptedValidationPhotos: validationAccepted.length,
    rejectedPhotos: rejected.length,
    acceptanceRate,
    deviceCount: new Set(validationAccepted.map((sample) => sample.device.trim().toLowerCase())).size,
    stripLotCount: new Set(validationAccepted.map((sample) => sample.stripLot.trim().toLowerCase())).size,
    lightingConditionCount: new Set(validationAccepted.map((sample) => sample.lighting.trim().toLowerCase())).size,
    timingComplianceRate,
  };

  const dataReasons: string[] = [];
  if (summary.acceptedCalibrationPhotos < policy.minimumCalibrationAcceptedPhotos) {
    dataReasons.push(`Collect at least ${policy.minimumCalibrationAcceptedPhotos} accepted calibration photos for anchor fitting.`);
  }
  for (const analyte of AQUACHEK_CALIBRATION_ANALYTES) {
    if (calibrationTruthCounts[analyte] < policy.minimumCalibrationTruthPerAnalyte) {
      dataReasons.push(`Collect at least ${policy.minimumCalibrationTruthPerAnalyte} accepted calibration truth pair${policy.minimumCalibrationTruthPerAnalyte === 1 ? '' : 's'} for ${analyte}.`);
    }
  }
  if (summary.acceptedValidationPhotos < policy.minimumAcceptedPhotos) {
    dataReasons.push(`Collect at least ${policy.minimumAcceptedPhotos} accepted held-out validation photos.`);
  }
  if (summary.deviceCount < policy.minimumDevices) {
    dataReasons.push(`Cover at least ${policy.minimumDevices} camera devices.`);
  }
  if (summary.stripLotCount < policy.minimumStripLots) {
    dataReasons.push(`Cover at least ${policy.minimumStripLots} strip lots.`);
  }
  if (summary.lightingConditionCount < policy.minimumLightingConditions) {
    dataReasons.push(`Cover at least ${policy.minimumLightingConditions} lighting conditions.`);
  }
  for (const analyte of AQUACHEK_CALIBRATION_ANALYTES) {
    if (analytes[analyte].truthCount < policy.minimumTruthPerAnalyte) {
      dataReasons.push(`Collect at least ${policy.minimumTruthPerAnalyte} accepted truth pairs for ${analyte}.`);
    }
  }

  const accuracyReasons: string[] = [];
  if (summary.acceptanceRate < policy.minimumAcceptanceRate) {
    accuracyReasons.push(`Photo acceptance is ${formatPercent(summary.acceptanceRate)}; target is ${formatPercent(policy.minimumAcceptanceRate)}.`);
  }
  if (summary.timingComplianceRate < policy.minimumTimingComplianceRate) {
    accuracyReasons.push(`Dip timing compliance is ${formatPercent(summary.timingComplianceRate)}; target is ${formatPercent(policy.minimumTimingComplianceRate)}.`);
  }
  for (const analyte of AQUACHEK_CALIBRATION_ANALYTES) {
    const metrics = analytes[analyte];
    if (metrics.exactLevelRate !== null && metrics.exactLevelRate < policy.minimumExactLevelRate) {
      accuracyReasons.push(`${analyte} exact-level accuracy is ${formatPercent(metrics.exactLevelRate)}; target is ${formatPercent(policy.minimumExactLevelRate)}.`);
    }
    if (metrics.withinOneLevelRate !== null && metrics.withinOneLevelRate < policy.minimumWithinOneLevelRate) {
      accuracyReasons.push(`${analyte} within-one-level accuracy is ${formatPercent(metrics.withinOneLevelRate)}; target is ${formatPercent(policy.minimumWithinOneLevelRate)}.`);
    }
  }

  const readiness = dataReasons.length > 0
    ? { status: 'needs-data' as const, reasons: [...dataReasons, ...accuracyReasons] }
    : accuracyReasons.length > 0
      ? { status: 'fails-accuracy' as const, reasons: accuracyReasons }
      : { status: 'ready' as const, reasons: [] };

  return { policy, summary, analytes, calibrationTruthCounts, rejections, readiness };
}
