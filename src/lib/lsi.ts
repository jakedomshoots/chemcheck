import { AQUACHEK_READING_LEVELS } from './aquachek';

export const LSI_BALANCED_MIN = -0.3;
export const LSI_BALANCED_MAX = 0.3;

export type LsiStatus = 'aggressive' | 'balanced' | 'scale-forming';
export type LsiConfidence = 'estimated' | 'detailed';
export type HardnessSource = 'aquachek_total' | 'calcium';
export type ReadingSource = 'measured' | 'assumed';
export const LSI_CALCULATION_VERSION = 'aquachek-epa-v1';
export const AQUACHEK_CYA_CORRECTION_FACTOR = 1 / 3;

export interface LsiInputs {
  ph: number;
  totalAlkalinity: number;
  cyanuricAcid: number;
  hardness: number;
  waterTemperatureF: number;
  tds: number;
  hardnessSource: HardnessSource;
  tdsEstimated?: boolean;
  temperatureEstimated?: boolean;
}

export interface LsiResult {
  value: number;
  status: LsiStatus;
  confidence: LsiConfidence;
  carbonateAlkalinity: number;
  cyaCorrectionFactor: number;
}

export interface AquaChekLsiEstimate {
  result: LsiResult;
  range: {
    min: number;
    max: number;
    crossesBalanceBoundary: boolean;
    includesInvalidChemistry: boolean;
  };
}

export function getLsiStatus(value: number): LsiStatus {
  if (value < LSI_BALANCED_MIN) return 'aggressive';
  if (value > LSI_BALANCED_MAX) return 'scale-forming';
  return 'balanced';
}

export function calculateLsi(inputs: LsiInputs): LsiResult | null {
  const values = [
    inputs.ph,
    inputs.totalAlkalinity,
    inputs.cyanuricAcid,
    inputs.hardness,
    inputs.waterTemperatureF,
    inputs.tds,
  ];
  if (values.some((value) => !Number.isFinite(value))) return null;
  if (inputs.hardness <= 0 || inputs.totalAlkalinity <= 0 || inputs.tds <= 0) return null;
  if (inputs.ph < 0 || inputs.ph > 14 || inputs.waterTemperatureF < 32 || inputs.waterTemperatureF > 140) {
    return null;
  }

  // AquaChek's published LSI calculator uses corrected alkalinity = TA - CYA/3.
  const cyaCorrectionFactor = AQUACHEK_CYA_CORRECTION_FACTOR;
  const carbonateAlkalinity = inputs.totalAlkalinity - (inputs.cyanuricAcid * cyaCorrectionFactor);
  if (carbonateAlkalinity <= 0) return null;

  const temperatureC = (inputs.waterTemperatureF - 32) * (5 / 9);
  const tdsFactor = (Math.log10(inputs.tds) - 1) / 10;
  const temperatureFactor = -13.12 * Math.log10(temperatureC + 273) + 34.55;
  const calciumFactor = Math.log10(inputs.hardness) - 0.4;
  const alkalinityFactor = Math.log10(carbonateAlkalinity);
  const saturationPh = (9.3 + tdsFactor + temperatureFactor) - (calciumFactor + alkalinityFactor);
  const value = Number((inputs.ph - saturationPh).toFixed(2));

  return {
    value,
    status: getLsiStatus(value),
    confidence: inputs.hardnessSource === 'calcium' && !inputs.tdsEstimated && !inputs.temperatureEstimated
      ? 'detailed'
      : 'estimated',
    carbonateAlkalinity: Number(carbonateAlkalinity.toFixed(1)),
    cyaCorrectionFactor: Number(cyaCorrectionFactor.toFixed(3)),
  };
}

function comparatorInterval(value: number, levels: readonly number[]): [number, number] {
  const index = levels.indexOf(value);
  if (index < 0) return [value, value];
  const lower = index === 0 ? value : (levels[index - 1] + value) / 2;
  const upper = index === levels.length - 1 ? value : (value + levels[index + 1]) / 2;
  return [lower, upper];
}

/**
 * Calculates the range created by the AquaChek comparator's discrete color
 * steps. The range intentionally does not claim to resolve the separate
 * total-hardness vs calcium-hardness limitation; callers must keep the result
 * labelled as estimated when AquaChek total hardness is used.
 */
export function calculateAquaChekLsiEstimate(inputs: LsiInputs): AquaChekLsiEstimate | null {
  const result = calculateLsi(inputs);
  if (!result) return null;

  const [phMin, phMax] = comparatorInterval(inputs.ph, AQUACHEK_READING_LEVELS.ph);
  const [alkalinityMin, alkalinityMax] = comparatorInterval(inputs.totalAlkalinity, AQUACHEK_READING_LEVELS.totalAlkalinity);
  const [cyaMin, cyaMax] = comparatorInterval(inputs.cyanuricAcid, AQUACHEK_READING_LEVELS.cyanuricAcid);
  const [hardnessMin, hardnessMax] = comparatorInterval(inputs.hardness, AQUACHEK_READING_LEVELS.totalHardness);
  const candidates: number[] = [];
  let invalidCandidateCount = 0;

  for (const ph of [phMin, phMax]) {
    for (const totalAlkalinity of [alkalinityMin, alkalinityMax]) {
      for (const cyanuricAcid of [cyaMin, cyaMax]) {
        for (const hardness of [hardnessMin, hardnessMax]) {
          const candidate = calculateLsi({
            ...inputs,
            ph,
            totalAlkalinity,
            cyanuricAcid,
            hardness,
          });
          if (candidate) candidates.push(candidate.value);
          else invalidCandidateCount += 1;
        }
      }
    }
  }

  if (candidates.length === 0) return null;
  const min = Number(Math.min(...candidates).toFixed(2));
  const max = Number(Math.max(...candidates).toFixed(2));
  return {
    result,
    range: {
      min,
      max,
      crossesBalanceBoundary: getLsiStatus(min) !== getLsiStatus(max),
      includesInvalidChemistry: invalidCandidateCount > 0,
    },
  };
}

export interface ServiceLogForLsi {
  ph_value?: number;
  alkalinity_value?: number;
  stabilizer_value?: number;
  hardness_value?: number;
  hardness_source?: HardnessSource;
  water_temperature?: number;
  water_temperature_source?: ReadingSource;
  tds_value?: number;
  tds_source?: ReadingSource;
  salt?: number;
  strip_scan_method?: 'aquachek_select_photo';
}

export interface ServiceLogLsiResult {
  result: LsiResult | null;
  missing: string[];
  assumedTds?: number;
  assumedTemperature?: number;
}

export function calculateServiceLogLsi(log: ServiceLogForLsi): ServiceLogLsiResult {
  const missing: string[] = [];
  if (!Number.isFinite(log.ph_value)) missing.push('pH');
  if (!Number.isFinite(log.alkalinity_value)) missing.push('alkalinity');
  if (!Number.isFinite(log.stabilizer_value)) missing.push('CYA');
  if (!Number.isFinite(log.hardness_value)) missing.push('hardness');
  const isStripScan = log.strip_scan_method === 'aquachek_select_photo';
  const hasTemperature = Number.isFinite(log.water_temperature);
  const assumedTemperature = hasTemperature
    ? (log.water_temperature_source === 'assumed' ? log.water_temperature : undefined)
    : (isStripScan ? 80 : undefined);
  if (!hasTemperature && assumedTemperature === undefined) missing.push('temperature');
  if (Number.isFinite(log.hardness_value) && log.hardness_value! <= 0) missing.push('hardness above 0 ppm');
  if (Number.isFinite(log.alkalinity_value) && log.alkalinity_value! <= 0) missing.push('alkalinity above 0 ppm');
  if (missing.length > 0) return { result: null, missing };

  const hasTds = Number.isFinite(log.tds_value) && (log.tds_value ?? 0) > 0;
  const tdsIsAssumed = !hasTds || log.tds_source === 'assumed';
  const assumedTds = hasTds
    ? (log.tds_source === 'assumed' ? log.tds_value : undefined)
    : ((log.salt ?? 0) > 0 ? (log.salt ?? 0) + 500 : 1000);
  const tds = hasTds ? log.tds_value! : assumedTds!;
  const temperature = hasTemperature ? log.water_temperature! : assumedTemperature!;
  const result = calculateLsi({
    ph: log.ph_value!,
    totalAlkalinity: log.alkalinity_value!,
    cyanuricAcid: log.stabilizer_value!,
    hardness: log.hardness_value!,
    waterTemperatureF: temperature,
    tds,
    hardnessSource: log.hardness_source ?? 'aquachek_total',
    tdsEstimated: tdsIsAssumed,
    temperatureEstimated: !hasTemperature || log.water_temperature_source === 'assumed',
  });

  return {
    result,
    missing: result ? [] : ['valid carbonate alkalinity'],
    assumedTds,
    assumedTemperature,
  };
}

export function formatLsi(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
}
