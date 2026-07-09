import { afterEach, describe, expect, it } from 'vitest';
import { hasOptedOut, optInAnalytics, optOutAnalytics } from './analytics';

describe('analytics consent', () => {
  afterEach(() => localStorage.clear());

  it('requires an explicit opt-in before analytics can initialize', () => {
    expect(hasOptedOut()).toBe(true);
    optInAnalytics();
    expect(hasOptedOut()).toBe(false);
    optOutAnalytics();
    expect(hasOptedOut()).toBe(true);
  });
});
