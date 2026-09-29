import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { BillingDashboard } from './BillingDashboard';

const cancelSubscription = vi.fn();
let canManageInApp = true;
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
    currentPlan: {
      name: 'Professional',
      price: 79,
      features: ['Route optimization', 'Advanced reporting', 'Priority support', 'Chemical tracking'],
      limits: { users: 3, customers: 200 },
    },
    daysRemaining: 10,
    canManageInApp,
    cancelSubscription,
  }),
}));

vi.mock('@/lib/billingPlans', () => ({
  SUBSCRIPTION_PLANS: {},
  formatPrice: (amount) => `$${amount}`,
}));

vi.mock('@/lib/native/platform', () => ({
  isNativePlatform: () => nativePlatform,
  getPlatform: () => platform,
}));

describe('BillingDashboard', () => {
  beforeEach(() => {
    cancelSubscription.mockReset();
    cancelSubscription.mockResolvedValue({ canceled: true });
    nativePlatform = true;
    platform = 'ios';
    canManageInApp = true;
  });

  it('does not expose billing actions inside the native iOS shell', () => {
    render(<BillingDashboard />);

    expect(screen.queryByRole('button', { name: /cancel subscription/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /change plan/i })).not.toBeInTheDocument();
    expect(screen.getByText(/billing changes are handled outside the ios app/i)).toBeInTheDocument();
  });

  it('offers change plan and a confirmed Square cancellation on the web PWA path', async () => {
    nativePlatform = false;
    platform = 'web';

    render(<BillingDashboard />);

    expect(screen.getByRole('link', { name: /change plan/i })).toHaveAttribute('href', '/pricing');
    expect(screen.getByText(/processed securely by Square/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /cancel subscription/i }));
    expect(cancelSubscription).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /confirm cancellation/i }));
    });
    expect(cancelSubscription).toHaveBeenCalledTimes(1);
  });

  it('hides in-app cancellation for subscriptions not managed in Square', () => {
    nativePlatform = false;
    platform = 'web';
    canManageInApp = false;

    render(<BillingDashboard />);

    expect(screen.queryByRole('button', { name: /cancel subscription/i })).not.toBeInTheDocument();
  });
});
