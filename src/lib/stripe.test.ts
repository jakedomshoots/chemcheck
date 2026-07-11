import { describe, expect, it } from 'vitest';
import * as stripe from './stripe';

describe('subscription pricing display', () => {
  it('does not expose Stripe keys, price IDs, or external billing endpoints to the browser', () => {
    expect(stripe).not.toHaveProperty('getStripe');
    expect(stripe).not.toHaveProperty('getSubscriptionPriceId');
    expect(stripe).not.toHaveProperty('getBillingApiConfig');
    expect(stripe).not.toHaveProperty('isStripeConfigured');
  });
});
