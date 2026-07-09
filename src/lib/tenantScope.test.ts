import { afterEach, describe, expect, it } from 'vitest';
import {
  clearActiveTenantScope,
  getActiveTenantScope,
  setActiveTenantScope,
  subscribeTenantScope,
} from './tenantScope';

afterEach(() => clearActiveTenantScope());

describe('tenantScope', () => {
  it('fails closed until Clerk supplies an authenticated user and business', () => {
    expect(getActiveTenantScope()).toBeNull();
  });

  it('creates a stable scope key from the authenticated email and active business', () => {
    setActiveTenantScope({ userEmail: ' Tech@ChemCheck.test ', businessId: 'business_123' });

    expect(getActiveTenantScope()).toEqual({
      userEmail: 'tech@chemcheck.test',
      businessId: 'business_123',
      key: 'business_123:tech@chemcheck.test',
    });
  });

  it('notifies storage consumers when login, business switch, or logout changes scope', () => {
    const snapshots: Array<string | null> = [];
    const unsubscribe = subscribeTenantScope(() => snapshots.push(getActiveTenantScope()?.key ?? null));

    setActiveTenantScope({ userEmail: 'owner@chemcheck.test', businessId: 'business_a' });
    setActiveTenantScope({ userEmail: 'owner@chemcheck.test', businessId: 'business_b' });
    clearActiveTenantScope();
    unsubscribe();

    expect(snapshots).toEqual([
      'business_a:owner@chemcheck.test',
      'business_b:owner@chemcheck.test',
      null,
    ]);
  });
});
