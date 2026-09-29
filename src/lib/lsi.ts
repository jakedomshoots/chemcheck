export const LSI_BALANCED_MIN = -0.3;
export const LSI_BALANCED_MAX = 0.3;

export type LsiStatus = 'aggressive' | 'balanced' | 'scale-forming';
export type LsiConfidence = 'measured';
export type HardnessSource = 'aquachek_total' | 'calcium';
export type ReadingSource = 'measured' | 'assumed';
export const LSI_CALCULATION_VERSION = 'lsi-v1';
// CDC MAHC pool guidance recommends deducting 30% of CYA from total alkalinity.
export const CYA_CORRECTION_FACTOR = 0.3;

export interface LsiInputs {
  ph: number;
  totalAlkalinity: number;
  cyanuricAcid: number;
  hardness: number;
  waterTemperatureF: number;
  tds: number;
  hardnessSource: 'calcium';
}

export interface LsiResult {
  value: number;
  status: LsiStatus;
  confidence: LsiConfidence;
  carbonateAlkalinity: number;
  cyaCorrectionFactor: number;
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

  // Correct total alkalinity for cyanurate alkalinity before calculating LSI.
  const cyaCorrectionFactor = CYA_CORRECTION_FACTOR;
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
    confidence: 'measured',
    carbonateAlkalinity: Number(carbonateAlkalinity.toFixed(1)),
    cyaCorrectionFactor: Number(cyaCorrectionFactor.toFixed(3)),
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
}

export interface ServiceLogLsiResult {
  result: LsiResult | null;
  missing: string[];
}

export function calculateServiceLogLsi(log: ServiceLogForLsi): ServiceLogLsiResult {
  const missing: string[] = [];
  if (!Number.isFinite(log.ph_value)) missing.push('pH');
  if (!Number.isFinite(log.alkalinity_value)) missing.push('alkalinity');
  if (!Number.isFinite(log.stabilizer_value)) missing.push('CYA');
  if (!Number.isFinite(log.hardness_value) || log.hardness_source !== 'calcium') missing.push('calcium hardness');
  const hasTemperature = Number.isFinite(log.water_temperature) && log.water_temperature_source === 'measured';
  if (!hasTemperature) missing.push('temperature');
  const hasTds = Number.isFinite(log.tds_value) && (log.tds_value ?? 0) > 0 && log.tds_source === 'measured';
  if (!hasTds) missing.push('TDS');
  if (Number.isFinite(log.hardness_value) && log.hardness_value! <= 0) missing.push('hardness above 0 ppm');
  if (Number.isFinite(log.alkalinity_value) && log.alkalinity_value! <= 0) missing.push('alkalinity above 0 ppm');
  if (missing.length > 0) return { result: null, missing };

  const result = calculateLsi({
    ph: log.ph_value!,
    totalAlkalinity: log.alkalinity_value!,
    cyanuricAcid: log.stabilizer_value!,
    hardness: log.hardness_value!,
    waterTemperatureF: log.water_temperature!,
    tds: log.tds_value!,
    hardnessSource: 'calcium',
  });

  return {
    result,
    missing: result ? [] : ['valid carbonate alkalinity'],
  };
}

export function formatLsi(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
}
