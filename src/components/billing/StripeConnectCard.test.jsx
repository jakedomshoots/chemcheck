import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StripeConnectCard } from './StripeConnectCard';

let status;
const createOnboardingLink = vi.fn();
const refreshAccountStatus = vi.fn();
const createDashboardLink = vi.fn();

vi.mock('../../../convex/_generated/api', () => ({
  api: {
    stripeConnect: {
      getConnectStatus: 'getConnectStatus',
      createOnboardingLink: 'createOnboardingLink',
      refreshAccountStatus: 'refreshAccountStatus',
      createDashboardLink: 'createDashboardLink',
    },
  },
}));

vi.mock('convex/react', () => ({
  useQuery: vi.fn(() => status),
  useAction: vi.fn((name) => ({
    createOnboardingLink,
    refreshAccountStatus,
    createDashboardLink,
  })[name]),
}));

const baseStatus = {
  state: 'not_connected',
  connected: false,
  charges_enabled: false,
  payouts_enabled: false,
  details_submitted: false,
  can_manage: true,
};

describe('StripeConnectCard', () => {
  beforeEach(() => {
    status = { ...baseStatus };
    createOnboardingLink.mockReset();
    refreshAccountStatus.mockReset();
    createDashboardLink.mockReset();
    window.history.replaceState(null, '', '/settings#integrations');
  });

  it('starts onboarding and redirects to Stripe', async () => {
    const assign = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, assign, href: originalLocation.href, search: '' },
    });
    createOnboardingLink.mockResolvedValue({ url: 'https://connect.stripe.com/setup/e/acct_1/abc' });

    render(<StripeConnectCard />);
    expect(screen.getByText('Not connected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Connect Stripe' }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://connect.stripe.com/setup/e/acct_1/abc'));
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  });

  it('shows onboarding incomplete and refreshes status on return from Stripe', async () => {
    status = { ...baseStatus, state: 'onboarding_incomplete', connected: true };
    refreshAccountStatus.mockResolvedValue({ state: 'active' });
    window.history.replaceState(null, '', '/settings?stripe_connect=return#integrations');

    render(<StripeConnectCard />);
    expect(screen.getByText('Onboarding incomplete')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue onboarding' })).toBeInTheDocument();
    await waitFor(() => expect(refreshAccountStatus).toHaveBeenCalledTimes(1));
    expect(window.location.search).toBe('');
  });

  it('shows active state with a Stripe dashboard link', () => {
    status = {
      ...baseStatus,
      state: 'active',
      connected: true,
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
    };
    render(<StripeConnectCard />);
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Stripe dashboard/ })).toBeInTheDocument();
  });

  it('surfaces errors and hides management controls from non-managers', async () => {
    createOnboardingLink.mockRejectedValue(new Error('Only business owners and admins can manage Stripe payments.'));
    const { rerender } = render(<StripeConnectCard />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect Stripe' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Only business owners');

    status = { ...baseStatus, can_manage: false };
    rerender(<StripeConnectCard />);
    expect(screen.queryByRole('button', { name: 'Connect Stripe' })).not.toBeInTheDocument();
  });
});
