import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { BillingDashboard } from './BillingDashboard';

const createPortalSession = vi.fn();
const cancelSubscription = vi.fn();
let nativePlatform = true;
let platform = 'ios';

vi.mock('convex/react', () => ({
  useQuery: vi.fn(() => ({ count: 2, isCapped: false })),
}));

vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: () => ({
    subscription: {
      id: 'sub_test',
      status: 'active',
      planId: 'professional',
      currentPeriodStart: new Date('2026-01-01T00:00:00Z'),
      currentPeriodEnd: new Date('2026-02-01T00:00:00Z'),
      cancelAtPeriodEnd: false,
    },
    isLoading: false,
    error: null,
    isTrialing: false,
    isBillingBackendConfigured: true,
    currentPlan: {
      name: 'Professional',
      price: 79,
      features: ['Route optimization', 'Advanced reporting', 'Priority support', 'Chemical tracking'],
      limits: { users: 3, customers: 200 },
    },
    daysRemaining: 10,
    createPortalSession,
    cancelSubscription,
  }),
}));

vi.mock('@/lib/stripe', () => ({
  SUBSCRIPTION_PLANS: {},
  formatPrice: (amount) => `$${amount}`,
  isStripeConfigured: () => true,
}));

vi.mock('@/lib/native/platform', () => ({
  isNativePlatform: () => nativePlatform,
  getPlatform: () => platform,
}));

describe('BillingDashboard', () => {
  beforeEach(() => {
    createPortalSession.mockReset();
    cancelSubscription.mockReset();
    nativePlatform = true;
    platform = 'ios';
  });

  it('does not expose Stripe portal or cancellation actions inside the native iOS shell', () => {
    render(<BillingDashboard />);

    expect(screen.queryByRole('button', { name: /manage payment method/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /view invoices/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cancel subscription/i })).not.toBeInTheDocument();
    expect(screen.getByText(/billing changes are handled outside the ios app/i)).toBeInTheDocument();
  });

  it('keeps Stripe billing portal actions available on the web PWA path', () => {
    nativePlatform = false;
    platform = 'web';

    render(<BillingDashboard />);

    fireEvent.click(screen.getByRole('button', { name: /manage payment method/i }));

    expect(createPortalSession).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /view invoices/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel subscription/i })).toBeInTheDocument();
  });
});
