import { describe, it, expect } from 'vitest';
import {
  chemToneClasses,
  isNotTested,
  isTestedReading,
  readingToDirectionalStatus,
  readingToStatus,
  statusToTone,
} from './chemStatus';

describe('chemStatus not_tested handling', () => {
  it('resolves not_tested to no status (neither good nor a problem)', () => {
    for (const key of ['ph', 'chlorine', 'alkalinity', 'stabilizer']) {
      expect(readingToStatus(key, 'not_tested')).toBeUndefined();
      expect(readingToDirectionalStatus(key, 'not_tested')).toBeUndefined();
    }
  });

  it('maps not_tested to a neutral tone', () => {
    expect(statusToTone('not_tested')).toBe('neutral');
    expect(statusToTone(readingToStatus('ph', 'not_tested'))).not.toBe('ok');
    expect(chemToneClasses('ph', 'not_tested')).toBe('border-line bg-surface-1 text-ink-secondary');
  });

  it('keeps existing status words and numeric readings working', () => {
    expect(readingToStatus('ph', 'good')).toBe('good');
    expect(readingToStatus('ph', 7.4)).toBe('good');
    expect(readingToStatus('ph', 8.6)).toBe('critical');
    expect(statusToTone('good')).toBe('ok');
  });

  it('distinguishes tested readings from not_tested/missing ones', () => {
    expect(isNotTested('not_tested')).toBe(true);
    expect(isNotTested('good')).toBe(false);
    expect(isTestedReading('not_tested')).toBe(false);
    expect(isTestedReading('')).toBe(false);
    expect(isTestedReading('high')).toBe(true);
  });
});
