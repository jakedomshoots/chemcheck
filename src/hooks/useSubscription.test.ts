import { describe, expect, it } from 'vitest';
import { isSubscriptionLocked, normalizePlanId, normalizeSubscriptionStatus } from './useSubscription';

describe('useSubscription helpers', () => {
  it('treats unknown plan ids and statuses as unknown instead of coercing them', () => {
    expect(normalizePlanId('starter')).toBe('starter');
    expect(normalizePlanId('enterprise_v9')).toBe('unknown');
    expect(normalizePlanId(undefined)).toBe('unknown');
    expect(normalizeSubscriptionStatus('active')).toBe('active');
    expect(normalizeSubscriptionStatus('paused')).toBe('unknown');
  });

  it('locks unpaid, incomplete_expired and ended canceled subscriptions only', () => {
    const now = Date.parse('2026-09-30T00:00:00Z');
    const future = new Date(now + 86_400_000);
    const past = new Date(now - 86_400_000);

    expect(isSubscriptionLocked(null, now)).toBe(false);
    expect(isSubscriptionLocked({ status: 'active', currentPeriodEnd: future }, now)).toBe(false);
    expect(isSubscriptionLocked({ status: 'trialing', currentPeriodEnd: future }, now)).toBe(false);
    expect(isSubscriptionLocked({ status: 'past_due', currentPeriodEnd: past }, now)).toBe(false);
    expect(isSubscriptionLocked({ status: 'unknown', currentPeriodEnd: past }, now)).toBe(false);
    expect(isSubscriptionLocked({ status: 'unpaid', currentPeriodEnd: future }, now)).toBe(true);
    expect(isSubscriptionLocked({ status: 'incomplete_expired', currentPeriodEnd: future }, now)).toBe(true);
    expect(isSubscriptionLocked({ status: 'canceled', currentPeriodEnd: future }, now)).toBe(false);
    expect(isSubscriptionLocked({ status: 'canceled', currentPeriodEnd: past }, now)).toBe(true);
  });
});
