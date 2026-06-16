import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { PricingPage } from './PricingPage';

const createCheckoutSession = vi.fn();
let nativePlatform = true;
let platform = 'ios';

vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: () => ({
    subscription: null,
    error: null,
    isBillingBackendConfigured: true,
    createCheckoutSession,
  }),
}));

vi.mock('@/lib/native/platform', () => ({
  isNativePlatform: () => nativePlatform,
  getPlatform: () => platform,
}));

describe('PricingPage', () => {
  beforeEach(() => {
    createCheckoutSession.mockReset();
    nativePlatform = true;
    platform = 'ios';
  });

  it('does not expose Stripe checkout actions inside the native iOS shell', () => {
    render(<PricingPage />);

    expect(screen.queryByRole('button', { name: /start free trial/i })).not.toBeInTheDocument();
    expect(screen.getAllByText(/plan changes are handled outside the ios app/i)).toHaveLength(3);

    fireEvent.click(screen.getByText('Starter').closest('div'));

    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it('keeps Stripe checkout available for the web PWA path', async () => {
    nativePlatform = false;
    platform = 'web';

    render(<PricingPage />);

    const checkoutButtons = screen.getAllByRole('button', { name: /start free trial/i });
    expect(checkoutButtons).toHaveLength(3);

    await act(async () => {
      fireEvent.click(checkoutButtons[0]);
    });

    expect(createCheckoutSession).toHaveBeenCalledWith('starter', false);
  });
});
