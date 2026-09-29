import { describe, expect, it } from 'vitest';
import * as billingPlans from './billingPlans';

describe('subscription pricing display', () => {
  it('matches the server-side plan prices and limits', () => {
    expect(billingPlans.SUBSCRIPTION_PLANS.starter.price).toBe(29);
    expect(billingPlans.SUBSCRIPTION_PLANS.professional.price).toBe(79);
    expect(billingPlans.SUBSCRIPTION_PLANS.business.price).toBe(149);
    expect(billingPlans.SUBSCRIPTION_PLANS.professional.limits).toEqual({ users: 3, customers: 200 });
    expect(billingPlans.getAnnualPrice(29)).toBe(278);
    expect(billingPlans.getAnnualPrice(149)).toBe(1430);
    expect(billingPlans.formatPrice(79)).toBe('$79');
  });

  it('does not expose provider keys, plan variation IDs, or billing endpoints to the browser', () => {
    const exported = Object.keys(billingPlans).join(' ');
    expect(exported).not.toMatch(/square|stripe|variation|token|secret/i);
    expect(billingPlans).not.toHaveProperty('getBillingApiConfig');
  });
});
