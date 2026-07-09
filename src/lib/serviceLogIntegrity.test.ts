import { describe, expect, it } from 'vitest';
import {
  createInitialChemicalReadings,
  toLegacyServiceLogValidationInput,
  validateServiceStop,
} from './serviceLogIntegrity';

describe('service log integrity', () => {
  it('starts every chemical reading as explicitly not tested', () => {
    expect(createInitialChemicalReadings()).toEqual({
      ph: 'not_tested',
      chlorine: 'not_tested',
      alkalinity: 'not_tested',
      stabilizer: 'not_tested',
    });
  });

  it('preserves historical readings instead of replacing them with a default', () => {
    expect(createInitialChemicalReadings({ ph: 'good', chlorine: 'critical' })).toEqual({
      ph: 'good',
      chlorine: 'critical',
      alkalinity: 'not_tested',
      stabilizer: 'not_tested',
    });
  });

  it('requires a field explanation for an exception stop', () => {
    expect(validateServiceStop({ status: 'no_access', notes: '   ' })).toEqual({
      valid: false,
      error: 'Add a short explanation for this stop outcome.',
    });
  });

  it('allows a completed stop without forcing a fabricated note', () => {
    expect(validateServiceStop({ status: 'completed', notes: '' })).toEqual({ valid: true });
  });

  it('does not let the legacy local validator rewrite explicit field facts', () => {
    expect(toLegacyServiceLogValidationInput({
      status: 'green_pool',
      ph: 'not_tested',
      chlorine: 'critical',
      alkalinity: 'not_tested',
      stabilizer: 'low',
    })).toMatchObject({
      status: 'completed',
      ph: 'good',
      chlorine: 'critical',
      alkalinity: 'good',
      stabilizer: 'low',
    });
  });
});
