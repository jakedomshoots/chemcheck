import { describe, expect, it } from 'vitest';
import { calculateHealthScore, extractChemicalReadings } from './healthScorer';
import { generateChemicalPrediction } from './predictiveAnalyzer';
import { analyzeChemicalUsage } from './costProjector';
import type { ServiceLog } from './types';

const untestedLog = {
  id: 'log-1',
  service_date: '2026-07-09',
  ph: 'not_tested',
  chlorine: 'not_tested',
  alkalinity: 'not_tested',
  stabilizer: 'not_tested',
} as unknown as ServiceLog;

describe('AI handling for untested readings', () => {
  it('excludes an untested reading from measured chemical history', () => {
    expect(extractChemicalReadings([untestedLog], 'ph')).toEqual([]);
    expect(calculateHealthScore({ serviceLogs: [untestedLog] }).healthScore.breakdown).toEqual([]);
  });

  it('does not make a chemical prediction from an unmeasured value', () => {
    expect(generateChemicalPrediction('chlorine', [untestedLog])).toMatchObject({
      currentLevel: 'not_tested',
      predictedLevel: 'not_tested',
      confidence: 0,
      recommendedAction: null,
    });
  });

  it('does not treat an untested reading as chemical usage or an issue', () => {
    const usage = analyzeChemicalUsage([untestedLog]);
    expect(usage.get('ph')).toEqual({ count: 0, readings: [] });
  });
});
