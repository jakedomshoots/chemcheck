import { describe, expect, it } from 'vitest';
import { CHEMICAL_CONFIGS, readingToStatus } from './chemStatus';

describe('chemStatus thresholds match the displayed hints', () => {
  it('alkalinity: ok 80-120, low 60-79, critical below 60, symmetric high side', () => {
    expect(CHEMICAL_CONFIGS.alkalinity.hint).toContain('80-120');
    expect(readingToStatus('alkalinity', 59)).toBe('critical');
    expect(readingToStatus('alkalinity', 60)).toBe('low');
    expect(readingToStatus('alkalinity', 79)).toBe('low');
    expect(readingToStatus('alkalinity', 80)).toBe('good');
    expect(readingToStatus('alkalinity', 100)).toBe('good');
    expect(readingToStatus('alkalinity', 120)).toBe('good');
    expect(readingToStatus('alkalinity', 121)).toBe('high');
    expect(readingToStatus('alkalinity', 140)).toBe('high');
    expect(readingToStatus('alkalinity', 141)).toBe('critical');
  });

  it('pH: ok 7.2-7.8, low 7.0-7.19, critical below 7.0, symmetric high side', () => {
    expect(CHEMICAL_CONFIGS.ph.hint).toContain('7.2-7.8');
    expect(readingToStatus('ph', 6.9)).toBe('critical');
    expect(readingToStatus('ph', 7.0)).toBe('low');
    expect(readingToStatus('ph', 7.19)).toBe('low');
    expect(readingToStatus('ph', 7.2)).toBe('good');
    expect(readingToStatus('ph', 7.79)).toBe('good');
    expect(readingToStatus('ph', 7.8)).toBe('high');
    expect(readingToStatus('ph', 7.99)).toBe('high');
    expect(readingToStatus('ph', 8.0)).toBe('critical');
  });

  it('allows recording readings outside the ideal band', () => {
    expect(CHEMICAL_CONFIGS.ph.min).toBeLessThan(7.0);
    expect(CHEMICAL_CONFIGS.ph.max).toBeGreaterThan(8.0);
    expect(CHEMICAL_CONFIGS.alkalinity.min).toBeLessThan(60);
    expect(CHEMICAL_CONFIGS.alkalinity.max).toBeGreaterThan(141);
  });

  it('every configured chemical has contiguous ranges covering the whole number line', () => {
    for (const [key, config] of Object.entries(CHEMICAL_CONFIGS)) {
      const ranges = config.ranges;
      expect(ranges[0].min, key).toBe(-Infinity);
      expect(ranges[ranges.length - 1].max, key).toBe(Infinity);
      for (let index = 1; index < ranges.length; index++) {
        expect(ranges[index].min, `${key} range ${index}`).toBe(ranges[index - 1].max);
      }
    }
  });
});
