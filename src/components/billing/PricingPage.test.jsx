import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { PricingPage } from './PricingPage';

const createCheckoutSession = vi.fn();
const changePlan = vi.fn();
let canManageInApp = false;
let nativePlatform = true;
let platform = 'ios';

vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: () => ({
    subscription: null,
    error: null,
    canManageInApp,
    createCheckoutSession,
    changePlan,
  }),
}));

vi.mock('@/lib/native/platform', () => ({
  isNativePlatform: () => nativePlatform,
  getPlatform: () => platform,
}));

describe('PricingPage', () => {
  beforeEach(() => {
    createCheckoutSession.mockReset();
    changePlan.mockReset();
    canManageInApp = false;
    nativePlatform = true;
    platform = 'ios';
  });

  it('does not expose checkout actions inside the native iOS shell', () => {
    render(<PricingPage />);

    expect(screen.queryByRole('button', { name: /start free trial/i })).not.toBeInTheDocument();
    expect(screen.getAllByText(/plan changes are handled outside the ios app/i)).toHaveLength(3);

    fireEvent.click(screen.getByText('Starter').closest('div'));

    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it('keeps Square checkout available for the web PWA path', async () => {
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

  it('switches plans in Square for an existing subscriber instead of starting a new checkout', async () => {
    nativePlatform = false;
    platform = 'web';
    canManageInApp = true;
    changePlan.mockResolvedValue({ scheduled: true });

    render(<PricingPage />);

    const buttons = screen.getAllByRole('button', { name: /switch to this plan/i });
    await act(async () => {
      fireEvent.click(buttons[2]);
    });

    expect(changePlan).toHaveBeenCalledWith('business', false);
    expect(createCheckoutSession).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(/next billing period/i);
  });
});
