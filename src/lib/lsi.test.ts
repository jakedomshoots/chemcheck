import { describe, expect, it } from 'vitest';
import {
  calculateLsi,
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
    expect(result!.value).toBeCloseTo(0.02, 2);
    expect(result!.status).toBe('balanced');
    expect(result!.confidence).toBe('measured');
    expect(result!.carbonateAlkalinity).toBeCloseTo(72, 1);
  });

  it('corrects total alkalinity by 30% of CYA for stabilized pool water', () => {
    const result = calculateLsi({
      ph: 7.5,
      totalAlkalinity: 100,
      cyanuricAcid: 60,
      hardness: 250,
      waterTemperatureF: 80,
      tds: 1000,
      hardnessSource: 'calcium',
    });

    expect(result?.cyaCorrectionFactor).toBe(0.3);
    expect(result?.carbonateAlkalinity).toBe(82);
  });

  it('classifies the recommended -0.30 to +0.30 balance band', () => {
    expect(getLsiStatus(-0.31)).toBe('aggressive');
    expect(getLsiStatus(-0.3)).toBe('balanced');
    expect(getLsiStatus(0.3)).toBe('balanced');
    expect(getLsiStatus(0.31)).toBe('scale-forming');
  });

  it('requires measured calcium hardness, temperature, and TDS', () => {
    const output = calculateServiceLogLsi({
      ph_value: 7.6,
      alkalinity_value: 90,
      stabilizer_value: 60,
      hardness_value: 300,
      hardness_source: 'calcium',
      water_temperature: 84,
    });

    expect(output.result).toBeNull();
    expect(output.missing).toContain('TDS');
  });

  it('does not calculate when temperature or TDS provenance is unknown', () => {
    const output = calculateServiceLogLsi({
      ph_value: 7.6,
      alkalinity_value: 90,
      stabilizer_value: 60,
      hardness_value: 300,
      hardness_source: 'calcium',
      water_temperature: 84,
      tds_value: 1200,
    });

    expect(output.result).toBeNull();
    expect(output.missing).toEqual(['temperature', 'TDS']);
  });

  it('reports missing readings instead of fabricating a result', () => {
    const output = calculateServiceLogLsi({ ph_value: 7.5 });
    expect(output.result).toBeNull();
    expect(output.missing).toEqual(['alkalinity', 'CYA', 'calcium hardness', 'temperature', 'TDS']);
  });

  it('records a zero calcium-hardness reading without pretending an LSI can be calculated', () => {
    const output = calculateServiceLogLsi({
      ph_value: 7.5,
      alkalinity_value: 90,
      stabilizer_value: 30,
      hardness_value: 0,
      hardness_source: 'calcium',
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

});
