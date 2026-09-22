import { describe, expect, it } from 'vitest';
import { parseCalibrationManifest } from './aquachek-calibration-lib.mjs';

const header = [
  'sample_id',
  'image',
  'device',
  'strip_lot',
  'seconds_after_dip',
  'lighting',
  'cohort',
  'truth_method',
  'truth_instrument',
  'total_hardness',
  'total_chlorine',
  'free_chlorine',
  'ph',
  'total_alkalinity',
  'cyanuric_acid',
].join(',');

describe('AquaChek calibration manifest', () => {
  it('parses quoted CSV fields and preserves blank optional truth readings', () => {
    const rows = parseCalibrationManifest([
      header,
      'visit-001,photos/visit-001.jpg,"iPhone 15, rear",LOT-A,15,"outdoor, shade",validation,drop-test,Taylor K-2006,250,3,3,7.4,100,',
    ].join('\n'));

    expect(rows).toEqual([{
      sampleId: 'visit-001',
      image: 'photos/visit-001.jpg',
      device: 'iPhone 15, rear',
      stripLot: 'LOT-A',
      secondsAfterDip: 15,
      lighting: 'outdoor, shade',
      cohort: 'validation',
      truthMethod: 'drop-test',
      truthInstrument: 'Taylor K-2006',
      truth: {
        totalHardness: 250,
        totalChlorine: 3,
        freeChlorine: 3,
        ph: 7.4,
        totalAlkalinity: 100,
      },
    }]);
  });

  it('rejects duplicate IDs and malformed numeric truth instead of silently scoring bad data', () => {
    expect(() => parseCalibrationManifest([
      header,
      'same,photos/a.jpg,iPhone 15,LOT-A,15,outdoor,validation,drop-test,Taylor K-2006,250,3,3,7.4,100,50',
      'same,photos/b.jpg,iPhone 15,LOT-A,15,outdoor,validation,drop-test,Taylor K-2006,250,3,3,7.4,100,50',
    ].join('\n'))).toThrow(/duplicate sample_id "same"/i);

    expect(() => parseCalibrationManifest([
      header,
      'bad,photos/a.jpg,iPhone 15,LOT-A,15,outdoor,validation,drop-test,Taylor K-2006,250,3,three,7.4,100,50',
    ].join('\n'))).toThrow(/free_chlorine.*number/i);
  });

  it('rejects impossible truth values and non-independent truth methods', () => {
    expect(() => parseCalibrationManifest([
      header,
      'bad-range,photos/a.jpg,iPhone 15,LOT-A,15,outdoor,validation,drop-test,Taylor K-2006,250,3,-1,7.4,100,50',
    ].join('\n'))).toThrow(/free_chlorine.*between 0 and 10/i);

    expect(() => parseCalibrationManifest([
      header,
      'bad-method,photos/a.jpg,iPhone 15,LOT-A,15,outdoor,validation,bottle-comparator,AquaChek bottle,250,3,3,7.4,100,50',
    ].join('\n'))).toThrow(/truth_method/i);
  });
});
