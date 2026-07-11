import { describe, expect, it } from 'vitest';
import { canManuallyMarkInvoicePaid } from './invoices';

describe('canManuallyMarkInvoicePaid', () => {
  it('rejects every invoice linked to a Stripe Checkout session', () => {
    expect(canManuallyMarkInvoicePaid({ stripe_checkout_session_id: 'cs_live_123' })).toBe(false);
  });

  it('allows a manually collected payment with no Stripe session', () => {
    expect(canManuallyMarkInvoicePaid({})).toBe(true);
  });
});
