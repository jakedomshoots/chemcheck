import { describe, expect, it } from 'vitest';
import { analyzePool } from './index';
import { normalizeServiceLogReadings, validateServiceLogs } from './validation';
import type { ServiceLog } from './types';

const day = (n: number) => `2026-06-${String(n).padStart(2, '0')}`;

function logsWith(untested: string | undefined): ServiceLog[] {
  return Array.from({ length: 6 }, (_, i) => ({
    id: i + 1,
    service_date: day(i + 1),
    ph: 'good',
    chlorine: 'low',
    alkalinity: untested,
    stabilizer: untested,
  })) as unknown as ServiceLog[];
}

describe('ai-summarizer treats not_tested as missing', () => {
  it('normalizes not_tested readings to undefined without touching others', () => {
    const log = { id: 1, service_date: day(1), ph: 'not_tested', chlorine: 'good' };
    const normalized = normalizeServiceLogReadings(log);
    expect(normalized.ph).toBeUndefined();
    expect(normalized.chlorine).toBe('good');
    expect(log.ph).toBe('not_tested'); // input is not mutated
  });

  it('keeps logs that contain not_tested readings instead of dropping them', () => {
    const logs = validateServiceLogs([
      { id: 1, service_date: day(1), ph: 'not_tested', chlorine: 'low', alkalinity: 'good', stabilizer: 'not_tested' },
    ]);
    expect(logs).toHaveLength(1);
    expect(logs[0].ph).toBeUndefined();
    expect(logs[0].chlorine).toBe('low');
  });

  it('scores a pool with not_tested readings exactly like one with missing readings', () => {
    const withMarker = analyzePool({
      customerId: 'c1',
      customerName: 'Pool',
      poolGallons: 15000,
      serviceLogs: logsWith('not_tested'),
      includeWeather: false,
    });
    const withMissing = analyzePool({
      customerId: 'c1',
      customerName: 'Pool',
      poolGallons: 15000,
      serviceLogs: logsWith(undefined),
      includeWeather: false,
    });
    expect(withMarker.healthScore.score).toBe(withMissing.healthScore.score);
    expect(withMarker.healthScore.breakdown).toEqual(withMissing.healthScore.breakdown);
    expect(withMarker.chemicalTrends).toEqual(withMissing.chemicalTrends);
    expect(JSON.stringify(withMarker)).not.toContain('not_tested');
  });
});
