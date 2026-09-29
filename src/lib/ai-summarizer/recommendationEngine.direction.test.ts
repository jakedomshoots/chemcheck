/**
 * Direction safety: every recommendation must move the reading toward ideal.
 * Regression for: pH > 8.2 recommending sodium carbonate, TA > 200
 * recommending sodium bicarbonate, and chlorine > 10 ppm recommending "shock".
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  generateRecommendations,
  flattenRecommendations,
  getPriorityLevels,
  calculateDosage,
  resolveDirectionalReading,
} from './recommendationEngine';
import type { ServiceLog, ChemicalReading } from './types';

type Chem = 'ph' | 'chlorine' | 'alkalinity' | 'stabilizer';
const CHEMS: Chem[] = ['ph', 'chlorine', 'alkalinity', 'stabilizer'];

/** Words that indicate advice which RAISES / LOWERS each reading. */
const RAISERS: Record<Chem, RegExp> = {
  ph: /sodium carbonate|soda ash|pH increaser/i,
  chlorine: /(?<!not )add chlorine|liquid chlorine \(|cal-hypo|shock treatment/i,
  alkalinity: /sodium bicarbonate/i,
  stabilizer: /add cyanuric|cyanuric acid \(stabilizer\) for/i,
};
const LOWERERS: Record<Chem, RegExp> = {
  ph: /muriatic acid/i,
  chlorine: /do not add chlorine|dissipate|stop all chlorine/i,
  alkalinity: /muriatic acid/i,
  stabilizer: /partial drain|replace about/i,
};

const VALUE_ARBS: Record<Chem, fc.Arbitrary<number>> = {
  ph: fc.double({ min: 4, max: 10, noNaN: true }),
  chlorine: fc.double({ min: 0, max: 40, noNaN: true }),
  alkalinity: fc.double({ min: 0, max: 400, noNaN: true }),
  stabilizer: fc.double({ min: 0, max: 250, noNaN: true }),
};

function recsFor(chem: Chem, value: number | undefined, status: ChemicalReading, gallons = 15000) {
  const log = {
    id: 1,
    service_date: '2026-09-01',
    ph: 'good',
    chlorine: 'good',
    alkalinity: 'good',
    stabilizer: 'good',
    [chem]: status,
    [`${chem}_value`]: value,
  } as ServiceLog;
  return flattenRecommendations(generateRecommendations({ serviceLogs: [log], poolGallons: gallons }))
    .filter((r) => r.chemical === chem);
}

describe('Recommendation Engine - direction safety', () => {
  for (const chem of CHEMS) {
    it(`${chem}: numeric readings in every band get correctly-directed advice`, () => {
      fc.assert(
        fc.property(VALUE_ARBS[chem], fc.integer({ min: 2000, max: 60000 }), (value, gallons) => {
          const directional = resolveDirectionalReading(chem, undefined, value)!;
          // The form stores the display status: 'critical' for both critical bands.
          const display = (directional.startsWith('critical') ? 'critical' : directional) as ChemicalReading;
          const recs = recsFor(chem, value, display, gallons);
          if (directional === 'good') {
            expect(recs).toHaveLength(0);
            return;
          }
          expect(recs).toHaveLength(1);
          const text = `${recs[0].action} ${recs[0].dosage ?? ''}`;
          const raise = directional === 'low' || directional === 'critical_low';
          if (raise) {
            expect(text).toMatch(RAISERS[chem]);
            expect(text).not.toMatch(LOWERERS[chem]);
          } else {
            expect(text).toMatch(LOWERERS[chem]);
            expect(text).not.toMatch(RAISERS[chem]);
          }
          expect(recs[0].dosage).not.toBeNull();
        }),
        { numRuns: 300 }
      );
    });

    it(`${chem}: every status word (no value) gets correctly-directed advice`, () => {
      for (const status of ['low', 'high'] as const) {
        const [rec] = recsFor(chem, undefined, status);
        const text = `${rec.action} ${rec.dosage ?? ''}`;
        if (status === 'low') {
          expect(text).toMatch(RAISERS[chem]);
          expect(text).not.toMatch(LOWERERS[chem]);
        } else {
          expect(text).toMatch(LOWERERS[chem]);
          expect(text).not.toMatch(RAISERS[chem]);
        }
      }
      expect(recsFor(chem, undefined, 'good')).toHaveLength(0);
    });
  }

  it('regressions: critical-high readings never get a raising chemical', () => {
    const ph = recsFor('ph', 8.6, 'critical')[0];
    expect(ph.action).toMatch(/muriatic/i);
    expect(ph.dosage).toMatch(/muriatic acid/);
    expect(ph.dosage).not.toMatch(/sodium carbonate/);

    const ta = recsFor('alkalinity', 240, 'critical')[0];
    expect(`${ta.action} ${ta.dosage}`).not.toMatch(/bicarbonate/);
    expect(ta.dosage).toMatch(/muriatic acid/);

    const cl = recsFor('chlorine', 15, 'critical')[0];
    expect(`${cl.action} ${cl.dosage}`).not.toMatch(/shock treatment|calcium hypochlorite|liquid chlorine \(/i);
    expect(cl.action).toMatch(/no swimming/i);
    expect(cl.dosage).toMatch(/Do NOT add chlorine/);

    const cya = recsFor('stabilizer', 150, 'critical')[0];
    expect(`${cya.action} ${cya.dosage}`).toMatch(/drain/i);
  });

  it('a bare "critical" with no numeric value asks for a retest and gives no dose', () => {
    for (const chem of CHEMS) {
      const recs = recsFor(chem, undefined, 'critical');
      expect(recs).toHaveLength(1);
      expect(recs[0].action).toMatch(/Retest/);
      expect(recs[0].dosage).toBeNull();
      expect(recs[0].priority).toBe(getPriorityLevels().critical);
    }
  });

  it('untested chemicals produce no recommendation (not assumed good or bad)', () => {
    const log = { id: 1, service_date: '2026-09-01', ph: 'low' } as unknown as ServiceLog;
    const recs = flattenRecommendations(generateRecommendations({ serviceLogs: [log], poolGallons: 10000 }));
    expect(recs.map((r) => r.chemical)).toEqual(['ph']);
  });

  it('dose is proportional to deviation, not a fixed amount', () => {
    const slight = calculateDosage('alkalinity', 'low', 10000, { value: 75 })!;
    const large = calculateDosage('alkalinity', 'low', 10000, { value: 62 })!;
    expect(slight).toMatch(/3\.5 lbs sodium bicarbonate/); // +25 ppm × 1.4 lb / 10 ppm
    expect(large).toMatch(/5\.3 lbs sodium bicarbonate/); // +38 ppm
  });

  it('calculateDosage accepts direction-aware readings and returns null for a bare critical', () => {
    expect(calculateDosage('ph', 'critical_high', 10000)).toMatch(/muriatic/);
    expect(calculateDosage('ph', 'critical_low', 10000)).toMatch(/sodium carbonate/);
    expect(calculateDosage('ph', 'critical', 10000)).toBeNull();
    expect(calculateDosage('ph', 'critical', 10000, { value: 8.5 })).toMatch(/muriatic/);
  });

  it('salt pools use the 60-80 ppm CYA band', () => {
    const log: ServiceLog = {
      id: 1, service_date: '2026-09-01', ph: 'good', chlorine: 'good', alkalinity: 'good', stabilizer: 'high', stabilizer_value: 70,
    };
    const saltRecs = flattenRecommendations(generateRecommendations({ serviceLogs: [log], poolGallons: 10000, poolType: 'Salt' }));
    expect(saltRecs).toHaveLength(0);
    const stdRecs = flattenRecommendations(generateRecommendations({ serviceLogs: [log], poolGallons: 10000 }));
    expect(stdRecs[0].action).toMatch(/drain/i);
  });
});
