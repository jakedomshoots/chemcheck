import { describe, expect, it } from 'vitest';
import {
  buildDosingPlan,
  chooseSanitizer,
  fcFloorForCya,
  getDosingTargets,
  hasMinimumReadings,
  type DoseStep,
} from './index';
import { ACID_LAST_SAFETY_NOTE, GENERAL_CHEMICAL_SAFETY_NOTE } from './products';

const find = (steps: DoseStep[], chemical: DoseStep['chemical']) => steps.find((step) => step.chemical === chemical);

describe('getDosingTargets', () => {
  it('uses salt and plaster specific ranges', () => {
    const salt = getDosingTargets('Salt', 'Plaster');
    expect(salt.chlorine).toMatchObject({ min: 3, max: 5 });
    expect(salt.stabilizer).toMatchObject({ min: 60, max: 80 });
    expect(salt.hardness).toMatchObject({ min: 250, max: 450 });

    const chlorine = getDosingTargets('Chlorine', 'Vinyl');
    expect(chlorine.chlorine).toMatchObject({ min: 2, max: 4 });
    expect(chlorine.stabilizer).toMatchObject({ min: 30, max: 50 });
    expect(chlorine.hardness).toMatchObject({ min: 200, max: 400 });
    expect(chlorine.ph).toMatchObject({ min: 7.4, max: 7.6 });
    expect(chlorine.alkalinity).toMatchObject({ min: 80, max: 120 });
  });

  it('raises the FC band to 7.5% of CYA with a 2 ppm floor', () => {
    expect(fcFloorForCya(undefined)).toBe(2);
    expect(fcFloorForCya(20)).toBe(2);
    expect(fcFloorForCya(80)).toBe(6);
    expect(getDosingTargets('Chlorine', 'Plaster', 80).chlorine).toMatchObject({ min: 6, max: 8 });
    expect(getDosingTargets('Chlorine', 'Plaster', 40).chlorine).toMatchObject({ min: 3, max: 5 });
  });
});

describe('buildDosingPlan', () => {
  it('sizes soda ash and liquid chlorine for a 10k gallon plaster pool with low pH', () => {
    const plan = buildDosingPlan({
      readings: { ph_value: 7.0, chlorine_value: 1, alkalinity_value: 90, stabilizer_value: 40, hardness_value: 300 },
      poolGallons: 10000,
      poolType: 'Chlorine',
      surfaceType: 'Plaster',
    });

    expect(plan.missing).toEqual([]);
    expect(plan.warnings).toEqual([]);
    expect(plan.steps.map((step) => step.chemical)).toEqual(['ph', 'chlorine']);

    const ph = find(plan.steps, 'ph')!;
    expect(ph.product).toBe('sodium_carbonate');
    expect(ph.direction).toBe('raise');
    // 1.875 lb per 1.0 pH per 10k gallons; pH 7.0 -> 7.5 = 0.94 lb = 15 oz
    expect(ph.amount?.text).toBe('15 oz');
    expect(ph.chemicalUsage).toEqual({ chemical_type: 'Soda Ash', quantity: '15 oz' });
    expect(ph.target).toMatchObject({ min: 7.4, max: 7.6 });
    expect(ph.order).toBe(1);

    const fc = find(plan.steps, 'chlorine')!;
    expect(fc.product).toBe('liquid_chlorine');
    // CYA 40 -> FC band 3-5, target 4, deficit 3 -> 31.5 fl oz
    expect(fc.targetValue).toBe(4);
    expect(fc.amount).toEqual({ value: 32, unit: 'fl oz', text: '32 fl oz' });
    expect(fc.chemicalUsage).toEqual({ chemical_type: 'Liquid Chlorine', quantity: '32 fl oz' });
    expect(fc.cap?.splits).toBe(1);
    expect(fc.instructions).toMatch(/one addition/);
    expect(fc.order).toBe(2);
    expect(plan.notes).toContain(GENERAL_CHEMICAL_SAFETY_NOTE);
    expect(plan.notes).not.toContain(ACID_LAST_SAFETY_NOTE);
  });

  it('recommends bagged salt for a 20k gallon salt pool that is low on salt', () => {
    const plan = buildDosingPlan({
      readings: { ph_value: 7.5, chlorine_value: 6, alkalinity_value: 100, stabilizer_value: 70, hardness_value: 300, salt: 2400 },
      poolGallons: 20000,
      poolType: 'Salt',
      surfaceType: 'Pebble',
    });

    expect(plan.steps).toHaveLength(1);
    const salt = plan.steps[0];
    expect(salt.chemical).toBe('salt');
    expect(salt.product).toBe('salt');
    expect(salt.targetValue).toBe(3200);
    // 83.4 lb per 1000 ppm per 10k gal; 800 ppm in 20k gal = 133 lb -> 135 lb, 3.5 bags
    expect(salt.amount?.text).toBe('135 lb (3.5 × 40 lb bags)');
    expect(salt.chemicalUsage).toEqual({ chemical_type: 'Salt', quantity: '135 lb' });
    expect(salt.cap?.splits).toBe(1);
    expect(salt.wait).toMatch(/24 hours/);
  });

  it('requires the salt reading on salt pools and shows the salt field targets', () => {
    const plan = buildDosingPlan({
      readings: { ph_value: 7.5, chlorine_value: 4 },
      poolGallons: 20000,
      poolType: 'Salt',
    });
    expect(plan.missing).toContain('salt');
    expect(plan.targets.chlorine).toMatchObject({ min: 3, max: 5 });
  });

  it('raises the chlorine target, uses unstabilized chlorine, and plans a drain when CYA is high', () => {
    const plan = buildDosingPlan({
      readings: { ph_value: 7.5, chlorine_value: 2, alkalinity_value: 100, stabilizer_value: 120, hardness_value: 300 },
      poolGallons: 10000,
      poolType: 'Chlorine',
      surfaceType: 'Plaster',
    });

    const fc = find(plan.steps, 'chlorine')!;
    expect(fc.target).toMatchObject({ min: 9, max: 11 });
    expect(fc.product).toBe('liquid_chlorine');
    // deficit 8 ppm * 10.5 fl oz
    expect(fc.amount?.text).toBe('84 fl oz');
    expect(fc.why).toMatch(/raised to 9–11 ppm because CYA is 120 ppm/);

    const cya = find(plan.steps, 'stabilizer')!;
    expect(cya.kind).toBe('drain');
    expect(cya.product).toBeNull();
    expect(cya.amount).toBeNull();
    expect(cya.chemicalUsage).toBeNull();
    expect(cya.productLabel).toBe('Partial drain ~58%');
    // Dose steps come before informational drain steps.
    expect(plan.steps.indexOf(fc)).toBeLessThan(plan.steps.indexOf(cya));
    // Only one sanitizer product is ever recommended.
    expect(plan.steps.filter((step) => step.chemical === 'chlorine')).toHaveLength(1);
  });

  it('flags FC 0 with very high CYA as physically unlikely', () => {
    const plan = buildDosingPlan({
      readings: { ph_value: 7.5, chlorine_value: 0, stabilizer_value: 150 },
      poolGallons: 10000,
      poolType: 'Chlorine',
    });
    expect(plan.warnings.some((warning) => /chlorine lock/i.test(warning))).toBe(true);
  });

  it('keeps the steps but cannot size doses when pool gallons are missing', () => {
    const plan = buildDosingPlan({
      readings: { ph_value: 7.0, chlorine_value: 0.5, alkalinity_value: 60 },
      poolGallons: null,
      poolType: 'Chlorine',
    });

    expect(plan.gallons).toBeNull();
    expect(plan.warnings[0]).toMatch(/pool gallons/i);
    expect(plan.steps.length).toBeGreaterThan(0);
    for (const step of plan.steps) {
      expect(step.amount).toBeNull();
      expect(step.cap).toBeNull();
      expect(step.chemicalUsage).toBeNull();
      expect(step.instructions).toMatch(/Enter pool gallons/);
    }
    // Unrealistic gallons are treated the same as missing.
    expect(buildDosingPlan({ readings: { ph_value: 7, chlorine_value: 1 }, poolGallons: 5 }).gallons).toBeNull();
  });

  it('splits an oversized acid dose into capped add/circulate/retest rounds', () => {
    const plan = buildDosingPlan({
      readings: { ph_value: 7.8, chlorine_value: 3, alkalinity_value: 200, stabilizer_value: 40, hardness_value: 300 },
      poolGallons: 10000,
      poolType: 'Chlorine',
      surfaceType: 'Plaster',
    });

    const acidSteps = plan.steps.filter((step) => step.product === 'muriatic_acid');
    // High pH and high TA share a single acid dose.
    expect(acidSteps).toHaveLength(1);
    const ta = acidSteps[0];
    expect(ta.chemical).toBe('alkalinity');
    // 2.6 fl oz per ppm for 80 ppm = 208 fl oz, capped at 64 fl oz per addition.
    expect(ta.amount?.text).toBe('208 fl oz (1.63 gal)');
    expect(ta.cap).toMatchObject({ splits: 4, circulateMinutes: 60 });
    expect(ta.cap?.perAddition.text).toBe('64 fl oz');
    expect(ta.cap?.perSplit.text).toBe('52 fl oz');
    expect(ta.instructions).toMatch(/Add 52 fl oz \(max 64 fl oz per addition\), circulate 1 hour, retest, and repeat up to 4 times/);
    expect(plan.notes.some((note) => /acid dose covers it/.test(note))).toBe(true);
  });

  it('orders chlorine before acid and attaches the acid-last safety note', () => {
    const plan = buildDosingPlan({
      readings: { ph_value: 7.9, chlorine_value: 0.5, alkalinity_value: 100, stabilizer_value: 40, hardness_value: 300 },
      poolGallons: 15000,
      poolType: 'Chlorine',
      surfaceType: 'Plaster',
    });

    const chemicals = plan.steps.map((step) => step.chemical);
    expect(chemicals.indexOf('chlorine')).toBeLessThan(chemicals.indexOf('ph'));
    const acid = find(plan.steps, 'ph')!;
    expect(acid.product).toBe('muriatic_acid');
    expect(acid.wait).toMatch(/Add LAST/);
    // 60 fl oz per 1.0 pH per 10k; 0.4 pH in 15k gal = 36 fl oz
    expect(acid.amount?.text).toBe('36 fl oz');
    expect(plan.notes).toContain(ACID_LAST_SAFETY_NOTE);
    expect(plan.steps.map((step) => step.order)).toEqual([1, 2]);
  });

  it('holds acid for high alkalinity when pH is already low', () => {
    const plan = buildDosingPlan({
      readings: { ph_value: 7.0, chlorine_value: 3, alkalinity_value: 160 },
      poolGallons: 10000,
      poolType: 'Chlorine',
    });
    expect(plan.steps.some((step) => step.product === 'muriatic_acid')).toBe(false);
    expect(plan.warnings.some((warning) => /Hold the acid/.test(warning))).toBe(true);
  });

  it('lets bicarbonate lift a mildly low pH instead of stacking soda ash', () => {
    const plan = buildDosingPlan({
      readings: { ph_value: 7.2, chlorine_value: 3, alkalinity_value: 60 },
      poolGallons: 10000,
      poolType: 'Chlorine',
    });
    expect(find(plan.steps, 'alkalinity')?.product).toBe('sodium_bicarbonate');
    // 0.15 lb per ppm for 40 ppm = 6 lb; cap 2.5 lb per 10k -> 3 rounds
    expect(find(plan.steps, 'alkalinity')?.amount?.text).toBe('6 lb');
    expect(find(plan.steps, 'alkalinity')?.cap?.splits).toBe(3);
    expect(find(plan.steps, 'ph')).toBeUndefined();
    expect(plan.warnings.some((warning) => /bicarbonate first/.test(warning))).toBe(true);
  });

  it('adds calcium chloride on a soft plaster pool but not when LSI is scale-forming', () => {
    const readings = { ph_value: 7.5, chlorine_value: 3, alkalinity_value: 100, stabilizer_value: 40, hardness_value: 150 };
    const plan = buildDosingPlan({ readings, poolGallons: 10000, poolType: 'Chlorine', surfaceType: 'Plaster', lsi: -0.5 });
    const ch = find(plan.steps, 'hardness')!;
    expect(ch.product).toBe('calcium_chloride');
    // 0.125 lb per ppm, 200 ppm to reach 350 = 25 lb, capped at 5 lb per addition
    expect(ch.amount?.text).toBe('25 lb');
    expect(ch.cap?.splits).toBe(5);
    expect(plan.notes.some((note) => /aggressive/.test(note))).toBe(true);

    const scaling = buildDosingPlan({ readings, poolGallons: 10000, poolType: 'Chlorine', surfaceType: 'Plaster', lsi: 0.6 });
    expect(find(scaling.steps, 'hardness')).toBeUndefined();
    expect(scaling.warnings.some((warning) => /scale-forming/.test(warning))).toBe(true);
  });

  it('skips chemicals whose readings are missing and reports them', () => {
    const plan = buildDosingPlan({
      readings: { ph_value: 7.5, chlorine_value: 3 },
      poolGallons: 10000,
      poolType: 'Chlorine',
    });
    expect(plan.steps).toEqual([]);
    expect(plan.missing).toEqual(['total alkalinity', 'CYA', 'calcium hardness']);
  });

  it('tells the tech to skip chlorine when FC is already high', () => {
    const plan = buildDosingPlan({
      readings: { ph_value: 7.5, chlorine_value: 8, stabilizer_value: 40 },
      poolGallons: 10000,
      poolType: 'Chlorine',
    });
    const fc = find(plan.steps, 'chlorine')!;
    expect(fc.kind).toBe('wait');
    expect(fc.productLabel).toBe('No chlorine today');
    expect(plan.notes).not.toContain(GENERAL_CHEMICAL_SAFETY_NOTE);
  });

  it('reports which readings are required before a plan is shown', () => {
    expect(hasMinimumReadings({ ph_value: 7.4 })).toBe(false);
    expect(hasMinimumReadings({ ph_value: 7.4, chlorine_value: 2 })).toBe(true);
    expect(hasMinimumReadings(null)).toBe(false);
  });
});

describe('chooseSanitizer', () => {
  const targets = getDosingTargets('Chlorine', 'Plaster');

  it('always uses liquid chlorine on salt pools', () => {
    expect(chooseSanitizer({ poolType: 'Salt', deficit: 6, cya: 20, hardness: 200, targets })).toBe('liquid_chlorine');
  });

  it('uses trichlor for a small top-up on an under-stabilized pool', () => {
    expect(chooseSanitizer({ poolType: 'Chlorine', deficit: 2, cya: 10, hardness: 300, targets })).toBe('trichlor');
  });

  it('uses cal-hypo for a shock-level deficit unless calcium or CYA is high', () => {
    expect(chooseSanitizer({ poolType: 'Chlorine', deficit: 6, cya: 40, hardness: 300, targets })).toBe('calcium_hypochlorite');
    expect(chooseSanitizer({ poolType: 'Chlorine', deficit: 6, cya: 40, hardness: 600, targets })).toBe('liquid_chlorine');
    expect(chooseSanitizer({ poolType: 'Chlorine', deficit: 6, cya: 90, hardness: 300, targets })).toBe('liquid_chlorine');
  });
});
