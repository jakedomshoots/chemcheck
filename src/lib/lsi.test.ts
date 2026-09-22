import { describe, expect, it } from 'vitest';
import {
  calculateLsi,
  calculateAquaChekLsiEstimate,
  calculateServiceLogLsi,
  formatLsi,
  getLsiStatus,
} from './lsi';

describe('LSI calculator', () => {
  it('matches the published balanced-water example within rounding tolerance', () => {
    const result = calculateLsi({
      ph: 7.6,
      totalAlkalinity: 90,
      cyanuricAcid: 60,
      hardness: 300,
      waterTemperatureF: 84,
      tds: 1000,
      hardnessSource: 'calcium',
    });

    expect(result).not.toBeNull();
    expect(result!.value).toBeCloseTo(0.01, 2);
    expect(result!.status).toBe('balanced');
    expect(result!.confidence).toBe('detailed');
    expect(result!.carbonateAlkalinity).toBeCloseTo(70, 1);
  });

  it('matches AquaChek by subtracting one-third of CYA from alkalinity', () => {
    const result = calculateLsi({
      ph: 7.5,
      totalAlkalinity: 100,
      cyanuricAcid: 60,
      hardness: 250,
      waterTemperatureF: 80,
      tds: 1000,
      hardnessSource: 'calcium',
    });

    expect(result?.cyaCorrectionFactor).toBeCloseTo(1 / 3, 3);
    expect(result?.carbonateAlkalinity).toBe(80);
  });

  it('classifies the recommended -0.30 to +0.30 balance band', () => {
    expect(getLsiStatus(-0.31)).toBe('aggressive');
    expect(getLsiStatus(-0.3)).toBe('balanced');
    expect(getLsiStatus(0.3)).toBe('balanced');
    expect(getLsiStatus(0.31)).toBe('scale-forming');
  });

  it('marks strip hardness or an assumed TDS as estimated', () => {
    const { result, assumedTds } = calculateServiceLogLsi({
      ph_value: 7.6,
      alkalinity_value: 90,
      stabilizer_value: 60,
      hardness_value: 300,
      hardness_source: 'aquachek_total',
      water_temperature: 84,
    });

    expect(result?.confidence).toBe('estimated');
    expect(assumedTds).toBe(1000);
  });

  it('reports missing readings instead of fabricating a result', () => {
    const output = calculateServiceLogLsi({ ph_value: 7.5 });
    expect(output.result).toBeNull();
    expect(output.missing).toEqual(['alkalinity', 'CYA', 'hardness', 'temperature']);
  });

  it('reconstructs assumptions for a legacy strip scan without temperature or TDS', () => {
    const output = calculateServiceLogLsi({
      ph_value: 7.4,
      alkalinity_value: 120,
      stabilizer_value: 50,
      hardness_value: 250,
      hardness_source: 'aquachek_total',
      strip_scan_method: 'aquachek_select_photo',
      salt: 3200,
    });

    expect(output.result).not.toBeNull();
    expect(output.assumedTemperature).toBe(80);
    expect(output.assumedTds).toBe(3700);
    expect(output.result?.confidence).toBe('estimated');
  });

  it('records a zero strip reading without pretending an LSI can be calculated', () => {
    const output = calculateServiceLogLsi({
      ph_value: 7.5,
      alkalinity_value: 90,
      stabilizer_value: 30,
      hardness_value: 0,
      hardness_source: 'aquachek_total',
      water_temperature: 80,
    });
    expect(output.result).toBeNull();
    expect(output.missing).toContain('hardness above 0 ppm');
  });

  it('rejects impossible corrected alkalinity and formats signed values', () => {
    expect(calculateLsi({
      ph: 7.6,
      totalAlkalinity: 10,
      cyanuricAcid: 100,
      hardness: 250,
      waterTemperatureF: 80,
      tds: 1000,
      hardnessSource: 'calcium',
    })).toBeNull();
    expect(formatLsi(0.2)).toBe('+0.20');
    expect(formatLsi(-0.2)).toBe('-0.20');
  });

  it('reports the uncertainty created by AquaChek comparator steps', () => {
    const estimate = calculateAquaChekLsiEstimate({
      ph: 7.2,
      totalAlkalinity: 120,
      cyanuricAcid: 50,
      hardness: 250,
      waterTemperatureF: 80,
      tds: 1000,
      hardnessSource: 'aquachek_total',
      tdsEstimated: true,
      temperatureEstimated: true,
    });

    expect(estimate).not.toBeNull();
    expect(estimate!.result.value).toBe(-0.34);
    expect(estimate!.range.min).toBeLessThan(estimate!.result.value);
    expect(estimate!.range.max).toBeGreaterThan(estimate!.result.value);
    expect(estimate!.range.crossesBalanceBoundary).toBe(true);
    expect(estimate!.range.includesInvalidChemistry).toBe(false);
  });

  it('flags when nearby strip steps can make corrected alkalinity invalid', () => {
    const estimate = calculateAquaChekLsiEstimate({
      ph: 7.2,
      totalAlkalinity: 80,
      cyanuricAcid: 150,
      hardness: 250,
      waterTemperatureF: 80,
      tds: 1000,
      hardnessSource: 'aquachek_total',
    });

    expect(estimate).not.toBeNull();
    expect(estimate!.range.includesInvalidChemistry).toBe(true);
  });
});
