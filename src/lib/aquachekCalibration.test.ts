import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AQUACHEK_CALIBRATION_POLICY,
  scoreAquaChekCalibration,
  type AquaChekCalibrationSample,
} from './aquachekCalibration';

const sample = (
  id: string,
  actualPh: number,
  predictedPh: number,
  device = 'iPhone 15',
  stripLot = 'LOT-A',
): AquaChekCalibrationSample => ({
  sampleId: id,
  image: `${id}.jpg`,
  device,
  stripLot,
  secondsAfterDip: 15,
  lighting: 'outdoor-shade',
  cohort: 'validation',
  truthMethod: 'drop-test',
  truthInstrument: 'Taylor K-2006',
  truth: { ph: actualPh },
  outcome: {
    kind: 'accepted',
    readings: { ph: predictedPh },
    confidence: 'high',
    analysisVersion: 'aquachek-select-v3',
  },
});

describe('AquaChek calibration scoring', () => {
  it('scores exact, adjacent-level, numeric-error, and rejected-photo behavior independently', () => {
    const samples: AquaChekCalibrationSample[] = [
      sample('exact', 7.2, 7.2),
      sample('adjacent', 7.6, 7.2, 'Pixel 10', 'LOT-B'),
      sample('miss', 8.4, 6.8),
      {
        sampleId: 'rejected',
        image: 'rejected.jpg',
        device: 'Pixel 10',
        stripLot: 'LOT-B',
        secondsAfterDip: 15,
        lighting: 'indoor-led',
        cohort: 'validation',
        truthMethod: 'photometer',
        truthInstrument: 'LaMotte Spin Touch',
        truth: { ph: 7.2 },
        outcome: { kind: 'rejected', code: 'uneven-lighting', message: 'Retake in even light.' },
      },
    ];

    const report = scoreAquaChekCalibration(samples);

    expect(report.summary).toMatchObject({
      totalPhotos: 4,
      acceptedPhotos: 3,
      acceptedValidationPhotos: 3,
      acceptedCalibrationPhotos: 0,
      rejectedPhotos: 1,
      acceptanceRate: 0.75,
      deviceCount: 2,
      stripLotCount: 2,
    });
    expect(report.analytes.ph).toMatchObject({
      truthCount: 3,
      exactLevelHits: 1,
      withinOneLevelHits: 2,
      exactLevelRate: 1 / 3,
      withinOneLevelRate: 2 / 3,
    });
    expect(report.analytes.ph.meanAbsoluteError).toBeCloseTo(2 / 3, 6);
    expect(report.rejections).toEqual({ 'uneven-lighting': 1 });
    expect(report.readiness.status).toBe('needs-data');
    expect(report.readiness.reasons).toContain(
      `Collect at least ${DEFAULT_AQUACHEK_CALIBRATION_POLICY.minimumAcceptedPhotos} accepted held-out validation photos.`,
    );
  });

  it('does not claim calibrated readiness unless every required analyte and coverage gate passes', () => {
    const samples: AquaChekCalibrationSample[] = [
      {
        ...sample('one', 7.2, 7.2, 'iPhone 15', 'LOT-A'),
        truth: {
          totalHardness: 250,
          totalChlorine: 3,
          freeChlorine: 3,
          ph: 7.2,
          totalAlkalinity: 120,
          cyanuricAcid: 50,
        },
        outcome: {
          kind: 'accepted',
          readings: {
            totalHardness: 250,
            totalChlorine: 3,
            freeChlorine: 3,
            ph: 7.2,
            totalAlkalinity: 120,
            cyanuricAcid: 50,
          },
          confidence: 'high',
          analysisVersion: 'aquachek-select-v3',
        },
      },
      {
        ...sample('two', 7.2, 7.2, 'Pixel 10', 'LOT-B'),
        truth: {
          totalHardness: 250,
          totalChlorine: 3,
          freeChlorine: 3,
          ph: 7.2,
          totalAlkalinity: 120,
          cyanuricAcid: 50,
        },
        outcome: {
          kind: 'accepted',
          readings: {
            totalHardness: 250,
            totalChlorine: 3,
            freeChlorine: 3,
            ph: 7.2,
            totalAlkalinity: 120,
            cyanuricAcid: 50,
          },
          confidence: 'high',
          analysisVersion: 'aquachek-select-v3',
        },
      },
    ];

    const report = scoreAquaChekCalibration(samples, {
      ...DEFAULT_AQUACHEK_CALIBRATION_POLICY,
      minimumAcceptedPhotos: 2,
      minimumCalibrationAcceptedPhotos: 0,
      minimumCalibrationTruthPerAnalyte: 0,
      minimumTruthPerAnalyte: 2,
      minimumLightingConditions: 1,
    });

    expect(report.readiness).toEqual({ status: 'ready', reasons: [] });
  });

  it('uses only accepted held-out validation photos for accuracy and diversity gates', () => {
    const validation = sample('validation', 7.2, 7.2, 'iPhone 15', 'LOT-A');
    const rejectedAlternative: AquaChekCalibrationSample = {
      ...sample('rejected-alternative', 7.2, 7.2, 'Pixel 10', 'LOT-B'),
      lighting: 'indoor-led',
      outcome: { kind: 'rejected', code: 'uneven-lighting', message: 'Retake.' },
    };
    const training = {
      ...sample('training', 7.2, 6.2, 'Pixel 10', 'LOT-B'),
      cohort: 'calibration' as const,
      lighting: 'garage-open-door',
    };

    const report = scoreAquaChekCalibration([validation, rejectedAlternative, training], {
      ...DEFAULT_AQUACHEK_CALIBRATION_POLICY,
      minimumAcceptedPhotos: 1,
      minimumCalibrationAcceptedPhotos: 1,
      minimumCalibrationTruthPerAnalyte: 1,
      minimumTruthPerAnalyte: 0,
      minimumDevices: 2,
      minimumStripLots: 2,
      minimumLightingConditions: 2,
    });

    expect(report.analytes.ph.exactLevelRate).toBe(1);
    expect(report.summary.deviceCount).toBe(1);
    expect(report.summary.stripLotCount).toBe(1);
    expect(report.summary.lightingConditionCount).toBe(1);
    expect(report.readiness.status).toBe('needs-data');
    expect(report.readiness.reasons).toContain('Collect at least 1 accepted calibration truth pair for freeChlorine.');
  });
});
