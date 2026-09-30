import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { BillingDashboard } from './BillingDashboard';

const createPortalSession = vi.fn();
let nativePlatform = true;
let platform = 'ios';
let subscriptionStatus = 'active';

vi.mock('convex/react', () => ({
  useQuery: vi.fn(() => ({ count: 2, isCapped: false })),
}));

vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: () => ({
    subscription: {
      id: 'sub_test',
      get status() { return subscriptionStatus; },
      rawStatus: 'weird_status',
      planId: 'professional',
      currentPeriodStart: new Date('2026-01-01T00:00:00Z'),
      currentPeriodEnd: new Date('2026-02-01T00:00:00Z'),
      cancelAtPeriodEnd: false,
    },
    isLoading: false,
    error: null,
    isTrialing: false,
    currentPlan: {
      name: 'Professional',
      price: 79,
      features: ['Route optimization', 'Advanced reporting', 'Priority support', 'Chemical tracking'],
      limits: { users: 3, customers: 200 },
    },
    daysRemaining: 10,
    createPortalSession,
  }),
}));

vi.mock('@/lib/stripe', () => ({
  SUBSCRIPTION_PLANS: {},
  formatPrice: (amount) => `$${amount}`,
}));

vi.mock('@/lib/native/platform', () => ({
  isNativePlatform: () => nativePlatform,
  getPlatform: () => platform,
}));

describe('BillingDashboard', () => {
  beforeEach(() => {
    createPortalSession.mockReset();
    nativePlatform = true;
    platform = 'ios';
    subscriptionStatus = 'active';
  });

  it('shows a neutral "unknown" badge instead of "Active" for unrecognized statuses', () => {
    subscriptionStatus = 'unknown';
    render(<BillingDashboard />);

    expect(screen.getByText(/unknown status/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Active$/)).not.toBeInTheDocument();
  });

  it('does not expose Stripe portal actions inside the native iOS shell', () => {
    render(<BillingDashboard />);

    expect(screen.queryByRole('button', { name: /manage subscription/i })).not.toBeInTheDocument();
    expect(screen.getByText(/billing changes are handled outside the ios app/i)).toBeInTheDocument();
  });

  it('keeps Stripe billing portal actions available on the web PWA path', () => {
    nativePlatform = false;
    platform = 'web';

    render(<BillingDashboard />);

    fireEvent.click(screen.getByRole('button', { name: /manage subscription/i }));

    expect(createPortalSession).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/secure Stripe portal/i)).toBeInTheDocument();
  });
});
