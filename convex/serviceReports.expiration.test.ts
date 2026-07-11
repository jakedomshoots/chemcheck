import { describe, expect, it } from 'vitest';
import { isReportExpired } from './serviceReports';

describe('isReportExpired', () => {
  it('rejects legacy reports that have no expiry', () => {
    expect(isReportExpired(undefined, 1_000)).toBe(true);
  });

  it('rejects a report at its exact expiry boundary', () => {
    expect(isReportExpired(1_000, 1_000)).toBe(true);
  });

  it('allows a report before expiry', () => {
    expect(isReportExpired(1_001, 1_000)).toBe(false);
  });
});
