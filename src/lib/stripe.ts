export const SUBSCRIPTION_PLANS = {
  starter: {
    id: 'starter',
    name: 'Starter',
    price: 29,
    features: ['1 team member', 'Up to 50 customers', 'Basic reporting', 'Email support', 'Mobile app access'],
    limits: { users: 1, customers: 50 },
  },
  professional: {
    id: 'professional',
    name: 'Professional',
    price: 79,
    features: ['3 team members', 'Up to 200 customers', 'Advanced reporting & analytics', 'Priority email support', 'Route optimization', 'Chemical usage tracking'],
    limits: { users: 3, customers: 200 },
    popular: true,
  },
  business: {
    id: 'business',
    name: 'Business',
    price: 149,
    features: ['Unlimited team members', 'Unlimited customers', 'Custom reporting', 'Phone & email support', 'API access', 'White-label options', 'Dedicated account manager'],
    limits: { users: -1, customers: -1 },
  },
} as const;

export type PlanId = keyof typeof SUBSCRIPTION_PLANS;

export type SubscriptionStatus =
  | 'active'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'past_due'
  | 'trialing'
  | 'unpaid';

export interface Subscription {
  id: string;
  status: SubscriptionStatus;
  planId: PlanId;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  trialEnd?: Date;
}

export function formatPrice(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
  }).format(amount);
}

export function getAnnualPrice(monthlyPrice: number, discountPercent = 20): number {
  return Math.round(monthlyPrice * 12 * (1 - discountPercent / 100));
}
