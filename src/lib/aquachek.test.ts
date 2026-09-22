import { describe, expect, it } from 'vitest';
import { isCompleteAquaChekReading, readingsToServiceLogPatch } from './aquachek';

const fullReading = {
  totalHardness: 250,
  totalChlorine: 3,
  totalBromine: 6,
  freeChlorine: 3,
  ph: 7.4,
  totalAlkalinity: 120,
  cyanuricAcid: 50,
};

describe('AquaChek Select mapping', () => {
  it('maps the complete strip suite into numeric service-log fields', () => {
    expect(readingsToServiceLogPatch(fullReading)).toMatchObject({
      hardness_value: 250,
      hardness_source: 'aquachek_total',
      total_chlorine_value: 3,
      total_bromine_value: 6,
      chlorine_value: 3,
      ph_value: 7.4,
      alkalinity_value: 120,
      stabilizer_value: 50,
      strip_scan_method: 'aquachek_select_photo',
    });
  });

  it('requires the sanitizer-specific reading', () => {
    expect(isCompleteAquaChekReading({ ...fullReading, totalChlorine: undefined }, 'chlorine')).toBe(false);
    expect(isCompleteAquaChekReading({ ...fullReading, totalChlorine: undefined }, 'bromine')).toBe(true);
  });
});
