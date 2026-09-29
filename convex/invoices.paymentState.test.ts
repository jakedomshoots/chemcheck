import { describe, expect, it } from 'vitest';
import { canManuallyMarkInvoicePaid } from './invoices';

describe('canManuallyMarkInvoicePaid', () => {
  it('rejects every invoice linked to a Square payment link', () => {
    expect(canManuallyMarkInvoicePaid({ square_payment_link_id: 'PLINK_123' })).toBe(false);
  });

  it('allows legacy pre-Square invoices, which are no longer confirmed automatically', () => {
    expect(canManuallyMarkInvoicePaid({ stripe_checkout_session_id: 'cs_live_123' } as any)).toBe(true);
  });

  it('allows a manually collected payment with no provider link', () => {
    expect(canManuallyMarkInvoicePaid({})).toBe(true);
  });
});
