import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  CHEMISTRY_CONFIGS,
  DOSING_CONSTANTS,
  PRODUCT_EFFECTS,
  acidMeqForPhDrop,
  chlorineTargetFor,
  classifyReading,
  directionOf,
  getChemistryConfig,
  planDose,
  representativeValue,
  sodaAshMmolForPhRise,
  type ChemicalKey,
  type DirectionalStatus,
} from './poolChemistry';
import { calculateLsi } from './lsi';

const CHEMICALS: ChemicalKey[] = ['ph', 'chlorine', 'alkalinity', 'stabilizer'];
const STATUSES: DirectionalStatus[] = ['critical_low', 'low', 'good', 'high', 'critical_high'];

/** Plausible measured values per chemical (covers every band). */
const VALUE_ARB: Record<ChemicalKey, fc.Arbitrary<number>> = {
  ph: fc.double({ min: 4, max: 10, noNaN: true }),
  chlorine: fc.double({ min: 0, max: 40, noNaN: true }),
  alkalinity: fc.double({ min: 0, max: 400, noNaN: true }),
  stabilizer: fc.double({ min: 0, max: 250, noNaN: true }),
};

const GALLONS_ARB = fc.integer({ min: 2000, max: 60000 });

describe('poolChemistry ranges', () => {
  it('ideal band, hint and good range agree for every chemical', () => {
    for (const key of CHEMICALS) {
      for (const poolType of [null, 'Salt']) {
        const config = getChemistryConfig(key, { poolType });
        const good = config.ranges.find((r) => r.status === 'good')!;
        expect(good.min).toBe(config.idealMin);
        expect(good.max).toBe(config.idealMax);
        const match = config.hint.match(/(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)/);
        expect(match).not.toBeNull();
        expect(Number(match![1])).toBe(config.idealMin);
        expect(Number(match![2])).toBe(config.idealMax);
        expect(config.target).toBeGreaterThanOrEqual(config.idealMin);
        expect(config.target).toBeLessThanOrEqual(config.idealMax);
      }
    }
  });

  it('uses industry-standard ideal bands', () => {
    expect([CHEMISTRY_CONFIGS.ph.idealMin, CHEMISTRY_CONFIGS.ph.idealMax]).toEqual([7.2, 7.8]);
    expect([CHEMISTRY_CONFIGS.alkalinity.idealMin, CHEMISTRY_CONFIGS.alkalinity.idealMax]).toEqual([80, 120]);
    expect([CHEMISTRY_CONFIGS.chlorine.idealMin, CHEMISTRY_CONFIGS.chlorine.idealMax]).toEqual([1, 4]);
    expect([CHEMISTRY_CONFIGS.stabilizer.idealMin, CHEMISTRY_CONFIGS.stabilizer.idealMax]).toEqual([30, 50]);
    const salt = getChemistryConfig('stabilizer', { poolType: 'Salt' });
    expect([salt.idealMin, salt.idealMax]).toEqual([60, 80]);
  });

  it('classifies with direction on both sides of critical', () => {
    expect(classifyReading('ph', 6.5)).toBe('critical_low');
    expect(classifyReading('ph', 8.4)).toBe('critical_high');
    expect(classifyReading('ph', 7.8)).toBe('good');
    expect(classifyReading('alkalinity', 90)).toBe('good'); // was 'low' before the fix
    expect(classifyReading('alkalinity', 70)).toBe('low');
    expect(classifyReading('alkalinity', 250)).toBe('critical_high');
    expect(classifyReading('chlorine', 0)).toBe('critical_low');
    expect(classifyReading('chlorine', 10)).toBe('high');
    expect(classifyReading('chlorine', 15)).toBe('critical_high');
    expect(classifyReading('stabilizer', 120)).toBe('critical_high');
    expect(classifyReading('stabilizer', 70, { poolType: 'Salt' })).toBe('good');
    expect(classifyReading('stabilizer', 70)).toBe('high');
    expect(classifyReading('ph', '')).toBeUndefined();
    expect(classifyReading('ph', 'abc')).toBeUndefined();
  });

  it('classification is monotonic in value', () => {
    const order: Record<DirectionalStatus, number> = { critical_low: 0, low: 1, good: 2, high: 3, critical_high: 4 };
    for (const key of CHEMICALS) {
      fc.assert(
        fc.property(VALUE_ARB[key], VALUE_ARB[key], (a, b) => {
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          expect(order[classifyReading(key, lo)!]).toBeLessThanOrEqual(order[classifyReading(key, hi)!]);
        }),
      );
    }
  });
});

describe('planDose — direction safety (property)', () => {
  for (const key of CHEMICALS) {
    it(`${key}: every non-good reading gets a plan that moves it toward ideal`, () => {
      fc.assert(
        fc.property(VALUE_ARB[key], GALLONS_ARB, fc.constantFrom(null, 'Salt'), (value, gallons, poolType) => {
          const status = classifyReading(key, value, { poolType })!;
          const plan = planDose({ chemical: key, status, gallons, value, poolType });
          if (status === 'good') {
            expect(plan).toBeNull();
            return;
          }
          expect(plan).not.toBeNull();
          const needed = directionOf(status);
          expect(plan!.effect).toBe(needed);
          if (plan!.product) {
            expect(PRODUCT_EFFECTS[plan!.product][key]).toBe(needed);
          }
          if (plan!.amount !== null) {
            expect(plan!.amount).toBeGreaterThan(0);
          }
          expect(plan!.text.length).toBeGreaterThan(0);
        }),
        { numRuns: 300 },
      );
    });
  }

  it('every status (value unknown) gets a plan in the right direction', () => {
    for (const key of CHEMICALS) {
      for (const status of STATUSES) {
        const plan = planDose({ chemical: key, status, gallons: 15000 });
        if (status === 'good') {
          expect(plan).toBeNull();
          continue;
        }
        expect(plan!.effect).toBe(directionOf(status));
        expect(plan!.valueAssumed).toBe(true);
        expect(directionOf(classifyReading(key, representativeValue(key, status)))).toBe(directionOf(status));
        if (plan!.product) expect(PRODUCT_EFFECTS[plan!.product][key]).toBe(directionOf(status));
      }
    }
  });

  it('high pH / TA never recommend a base; low pH / TA never recommend acid', () => {
    for (const status of ['high', 'critical_high'] as const) {
      for (const key of ['ph', 'alkalinity'] as const) {
        const text = planDose({ chemical: key, status, gallons: 10000 })!.text;
        expect(text).toMatch(/muriatic acid/);
        expect(text).not.toMatch(/sodium carbonate|soda ash \(|bicarbonate for/);
      }
    }
    for (const status of ['low', 'critical_low'] as const) {
      expect(planDose({ chemical: 'ph', status, gallons: 10000 })!.text).toMatch(/sodium carbonate/);
      expect(planDose({ chemical: 'alkalinity', status, gallons: 10000 })!.text).toMatch(/sodium bicarbonate/);
      for (const key of ['ph', 'alkalinity'] as const) {
        expect(planDose({ chemical: key, status, gallons: 10000 })!.text).not.toMatch(/muriatic/);
      }
    }
  });

  it('high chlorine never adds chlorine; critical high says do not swim', () => {
    for (const value of [5, 9, 12, 30]) {
      const status = classifyReading('chlorine', value)!;
      const plan = planDose({ chemical: 'chlorine', status, gallons: 20000, value })!;
      expect(plan.product).toBeNull();
      expect(plan.amount).toBeNull();
      expect(plan.text).toMatch(/Do NOT add chlorine/);
      expect(plan.text).not.toMatch(/shock/i);
      if (status === 'critical_high') expect(plan.text).toMatch(/no swimming/i);
    }
  });

  it('high CYA recommends a partial drain sized to the deviation', () => {
    const plan = planDose({ chemical: 'stabilizer', status: 'critical_high', gallons: 20000, value: 120 })!;
    expect(plan.product).toBeNull();
    expect(plan.text).toMatch(/Partial drain/);
    // 1 - 40/120 = 66.7% -> rounded up to 70%
    expect(plan.amount).toBe(70);
    const salt = planDose({ chemical: 'stabilizer', status: 'high', gallons: 20000, value: 90, poolType: 'Salt' })!;
    // 1 - 70/90 = 22% -> 25%
    expect(salt.amount).toBe(25);
  });
});

describe('planDose — proportional amounts', () => {
  it('sodium bicarbonate: 1.4 lb per 10 ppm TA per 10k gal', () => {
    const plan = planDose({ chemical: 'alkalinity', status: 'low', gallons: 10000, value: 70 })!;
    expect(plan.amount).toBeCloseTo(4.2, 5); // +30 ppm
    const bigger = planDose({ chemical: 'alkalinity', status: 'low', gallons: 20000, value: 70 })!;
    expect(bigger.amount).toBeCloseTo(8.4, 5);
  });

  it('bicarb dose is capped per addition', () => {
    const plan = planDose({ chemical: 'alkalinity', status: 'critical_low', gallons: 10000, value: 0 })!;
    expect(plan.amount).toBeLessThanOrEqual(DOSING_CONSTANTS.maxBicarbLbPerAddition);
    expect(plan.capped).toBe(true);
    expect(plan.text).toMatch(/split/);
  });

  it('muriatic acid for TA: 25.6 fl oz per 10 ppm per 10k gal, capped at ~1 qt', () => {
    // 130 -> 100 ppm: 3 × 25.6 = 76.8 fl oz full correction, capped at 32 fl oz now.
    const plan = planDose({ chemical: 'alkalinity', status: 'high', gallons: 10000, value: 130 })!;
    expect(plan.amount).toBe(32);
    expect(plan.capped).toBe(true);
    expect(plan.text).toMatch(/77 fl oz/);
    const big = planDose({ chemical: 'alkalinity', status: 'high', gallons: 40000, value: 130 })!;
    expect(big.amount).toBe(128);
  });

  it('liquid chlorine: ~10.2 fl oz (12.5%) per 1 ppm per 10k gal; target rises with CYA', () => {
    const plan = planDose({ chemical: 'chlorine', status: 'critical_low', gallons: 10000, value: 0 })!;
    expect(plan.amount).toBe(Math.round(3 * 10.2));
    expect(plan.text).toMatch(/cal-hypo/);
    expect(chlorineTargetFor(null)).toBe(3);
    expect(chlorineTargetFor(80)).toBe(8);
    const withCya = planDose({ chemical: 'chlorine', status: 'low', gallons: 10000, value: 0.8, stabilizer: 80 })!;
    expect(withCya.target).toBe(8);
    expect(withCya.amount).toBe(Math.round(7.2 * 10.2));
  });

  it('dose grows with deviation (until capped)', () => {
    for (const key of CHEMICALS) {
      fc.assert(
        fc.property(VALUE_ARB[key], VALUE_ARB[key], (a, b) => {
          const sa = classifyReading(key, a)!;
          const sb = classifyReading(key, b)!;
          if (sa === 'good' || sb === 'good' || directionOf(sa) !== directionOf(sb)) return;
          const pa = planDose({ chemical: key, status: sa, gallons: 10000, value: a })!;
          const pb = planDose({ chemical: key, status: sb, gallons: 10000, value: b })!;
          if (pa.amount === null || pb.amount === null) return;
          const target = pa.target;
          if (Math.abs(a - target) <= Math.abs(b - target)) {
            expect(pa.amount).toBeLessThanOrEqual(pb.amount + 1e-9);
          }
        }),
        { numRuns: 200 },
      );
    }
  });

  it('pH acid dose depends on TA and is labelled approximate', () => {
    const lowTa = planDose({ chemical: 'ph', status: 'high', gallons: 10000, value: 8.0, alkalinity: 60 })!;
    const highTa = planDose({ chemical: 'ph', status: 'high', gallons: 10000, value: 8.0, alkalinity: 140 })!;
    expect(highTa.amount!).toBeGreaterThan(lowTa.amount!);
    expect(highTa.text).toMatch(/Approx\./);
    // Sanity vs field rule of thumb: 7.8 -> 7.5 at TA 100 in 10k gal is roughly 8–16 fl oz.
    const typical = planDose({ chemical: 'ph', status: 'high', gallons: 10000, value: 7.9, alkalinity: 100 })!;
    expect(typical.amount!).toBeGreaterThanOrEqual(6);
    expect(typical.amount!).toBeLessThanOrEqual(16);
    expect(planDose({ chemical: 'ph', status: 'critical_high', gallons: 10000, value: 9.5 })!.amount)
      .toBeLessThanOrEqual(DOSING_CONSTANTS.maxAcidFlOzPerAddition);
  });

  it('soda ash dose is capped at 1 lb per 10k gal per addition', () => {
    const plan = planDose({ chemical: 'ph', status: 'critical_low', gallons: 10000, value: 6.0, alkalinity: 100 })!;
    expect(plan.amount!).toBeLessThanOrEqual(16);
    expect(plan.capped).toBe(true);
  });

  it('carbonate model helpers return 0 for no-op / wrong-direction requests', () => {
    expect(acidMeqForPhDrop(7.4, 7.6, 100)).toBe(0);
    expect(sodaAshMmolForPhRise(7.6, 7.4, 100)).toBe(0);
    expect(acidMeqForPhDrop(8, 7.5, 0)).toBe(0);
  });

  it('returns null for invalid pool size', () => {
    expect(planDose({ chemical: 'ph', status: 'high', gallons: 0 })).toBeNull();
    expect(planDose({ chemical: 'ph', status: 'high', gallons: Number.NaN })).toBeNull();
  });
});

describe('units agree with LSI', () => {
  it('LSI consumes the same pH / TA (ppm as CaCO3) / CYA values the dosing engine does', () => {
    // A pool balanced by the dosing targets should be near LSI 0 with typical Ca/temp/TDS.
    const lsi = calculateLsi({
      ph: CHEMISTRY_CONFIGS.ph.target,
      totalAlkalinity: CHEMISTRY_CONFIGS.alkalinity.target,
      cyanuricAcid: CHEMISTRY_CONFIGS.stabilizer.target,
      hardness: 300,
      waterTemperatureF: 82,
      tds: 1000,
      hardnessSource: 'calcium',
    })!;
    expect(lsi).not.toBeNull();
    expect(Math.abs(lsi.value)).toBeLessThan(0.3);
    expect(lsi.status).toBe('balanced');
    // Raising pH (the direction soda ash moves it) raises LSI; acid lowers it.
    const higher = calculateLsi({
      ph: 7.9, totalAlkalinity: 100, cyanuricAcid: 40, hardness: 300, waterTemperatureF: 82, tds: 1000, hardnessSource: 'calcium',
    })!;
    expect(higher.value).toBeGreaterThan(lsi.value);
  });
});

describe('soda ash calibration', () => {
  it('matches the ~6 oz per 10k gal per +0.2 pH rule of thumb at TA 100', () => {
    const plan = planDose({ chemical: 'ph', status: 'low', gallons: 10000, value: 7.2, alkalinity: 100 })!;
    expect(plan.product).toBe('sodium carbonate (soda ash)');
    const ozPerTwoTenths = (plan.amount / ((plan.target as number) - 7.2)) * 0.2;
    expect(ozPerTwoTenths).toBeGreaterThanOrEqual(4.5);
    expect(ozPerTwoTenths).toBeLessThanOrEqual(7.5);
  });
});
