import { CHEMICAL_CONFIGS, mapNumericValueToStatus } from './chemStatus';

export const AQUACHEK_SELECT_LIMITS = {
  totalHardness: { min: 0, max: 1000, unit: 'ppm' },
  totalChlorine: { min: 0, max: 10, unit: 'ppm' },
  totalBromine: { min: 0, max: 20, unit: 'ppm' },
  freeChlorine: { min: 0, max: 10, unit: 'ppm' },
  ph: { min: 6.2, max: 8.4, unit: '' },
  totalAlkalinity: { min: 0, max: 240, unit: 'ppm' },
  cyanuricAcid: { min: 0, max: 300, unit: 'ppm' },
} as const;

export const AQUACHEK_READING_LEVELS = {
  totalHardness: [0, 100, 250, 500, 1000],
  totalChlorine: [0, 0.5, 1, 3, 5, 10],
  totalBromine: [0, 1, 2, 6, 10, 20],
  freeChlorine: [0, 0.5, 1, 3, 5, 10],
  ph: [6.2, 6.8, 7.2, 7.8, 8.4],
  totalAlkalinity: [0, 40, 80, 120, 180, 240],
  cyanuricAcid: [0, 50, 100, 150, 300],
} as const;

export type AquaChekReadingKey = keyof typeof AQUACHEK_SELECT_LIMITS;

export interface AquaChekReadings {
  totalHardness?: number;
  totalChlorine?: number;
  totalBromine?: number;
  freeChlorine?: number;
  ph?: number;
  totalAlkalinity?: number;
  cyanuricAcid?: number;
}

function statusForReading(key: keyof typeof CHEMICAL_CONFIGS, value?: number) {
  return value === undefined ? undefined : mapNumericValueToStatus(value, CHEMICAL_CONFIGS[key].ranges);
}

export function readingsToServiceLogPatch(readings: AquaChekReadings) {
  return {
    ph: statusForReading('ph', readings.ph),
    chlorine: statusForReading('chlorine', readings.freeChlorine),
    alkalinity: statusForReading('alkalinity', readings.totalAlkalinity),
    stabilizer: statusForReading('stabilizer', readings.cyanuricAcid),
    hardness_value: readings.totalHardness ?? '',
    hardness_source: 'aquachek_total' as const,
    total_chlorine_value: readings.totalChlorine ?? '',
    total_bromine_value: readings.totalBromine ?? '',
    chlorine_value: readings.freeChlorine ?? '',
    ph_value: readings.ph ?? '',
    alkalinity_value: readings.totalAlkalinity ?? '',
    stabilizer_value: readings.cyanuricAcid ?? '',
    ph_mode: 'numeric',
    chlorine_mode: 'numeric',
    alkalinity_mode: 'numeric',
    stabilizer_mode: 'numeric',
    strip_scan_method: 'aquachek_select_photo' as const,
  };
}

export function isCompleteAquaChekReading(readings: AquaChekReadings, sanitizer: 'chlorine' | 'bromine') {
  const required: AquaChekReadingKey[] = [
    'totalHardness',
    sanitizer === 'bromine' ? 'totalBromine' : 'totalChlorine',
    'freeChlorine',
    'ph',
    'totalAlkalinity',
    'cyanuricAcid',
  ];
  return required.every((key) => Number.isFinite(readings[key]));
}
