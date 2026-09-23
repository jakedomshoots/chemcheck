import { describe, expect, it } from 'vitest';
import {
  advanceMonthly,
  clampBillingDay,
  computeNextRunDate,
} from './servicePlans';

describe('clampBillingDay', () => {
  it('keeps billing days inside the safe 1-28 window', () => {
    expect(clampBillingDay(1)).toBe(1);
    expect(clampBillingDay(15)).toBe(15);
    expect(clampBillingDay(28)).toBe(28);
    expect(clampBillingDay(0)).toBe(1);
    expect(clampBillingDay(31)).toBe(28);
    expect(clampBillingDay(14.7)).toBe(14);
  });
});

describe('computeNextRunDate', () => {
  it('bills later this month when the day has not passed', () => {
    expect(computeNextRunDate('2026-09-10', 15)).toBe('2026-09-15');
  });

  it('bills today when today is the billing day', () => {
    expect(computeNextRunDate('2026-09-15', 15)).toBe('2026-09-15');
  });

  it('rolls to next month when the day has passed', () => {
    expect(computeNextRunDate('2026-09-20', 15)).toBe('2026-10-15');
  });

  it('rolls across the year boundary', () => {
    expect(computeNextRunDate('2026-12-20', 5)).toBe('2027-01-05');
  });
});

describe('advanceMonthly', () => {
  it('advances one month on the same billing day', () => {
    expect(advanceMonthly('2026-09-01', 1)).toBe('2026-10-01');
    expect(advanceMonthly('2027-01-28', 28)).toBe('2027-02-28');
  });
});
