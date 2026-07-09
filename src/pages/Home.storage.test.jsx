import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSkippedCustomers, getWeekKey, saveSkippedCustomers } from './Home';

describe('Home skipped-stop storage', () => {
  afterEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  it('keeps skipped stops inside the active tenant namespace', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-09T12:00:00.000Z'));

    saveSkippedCustomers('business-a:owner-a@chemcheck.test', ['customer-a']);

    expect(getSkippedCustomers('business-a:owner-a@chemcheck.test')).toEqual(['customer-a']);
    expect(getSkippedCustomers('business-b:owner-b@chemcheck.test')).toEqual([]);
    expect(getWeekKey('business-a:owner-a@chemcheck.test')).not.toContain('owner-a@chemcheck.test');
  });
});
