import { loadStripe, Stripe } from '@stripe/stripe-js';

// Stripe publishable key from environment
const stripePublishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
const stripeCheckoutUrl = import.meta.env.VITE_STRIPE_CHECKOUT_URL;
const stripePortalUrl = import.meta.env.VITE_STRIPE_PORTAL_URL;
const stripeCancelUrl = import.meta.env.VITE_STRIPE_CANCEL_URL;

// Singleton stripe instance
let stripePromise: Promise<Stripe | null> | null = null;

export function getStripe(): Promise<Stripe | null> {
  if (!stripePromise && stripePublishableKey) {
    stripePromise = loadStripe(stripePublishableKey);
  }
  return stripePromise || Promise.resolve(null);
}

// Subscription plan definitions
export const SUBSCRIPTION_PLANS = {
  starter: {
    id: 'starter',
    name: 'Starter',
    price: 29,
    priceId: import.meta.env.VITE_STRIPE_STARTER_PRICE_ID || 'price_starter',
    features: [
      '1 team member',
      'Up to 50 customers',
      'Basic reporting',
      'Email support',
      'Mobile app access',
    ],
    limits: {
      users: 1,
      customers: 50,
    },
  },
  professional: {
    id: 'professional',
    name: 'Professional',
    price: 79,
    priceId: import.meta.env.VITE_STRIPE_PRO_PRICE_ID || 'price_professional',
    features: [
      '3 team members',
      'Up to 200 customers',
      'Advanced reporting & analytics',
      'Priority email support',
      'Route optimization',
      'Chemical usage tracking',
    ],
    limits: {
      users: 3,
      customers: 200,
    },
    popular: true,
  },
  business: {
    id: 'business',
    name: 'Business',
    price: 149,
    priceId: import.meta.env.VITE_STRIPE_BUSINESS_PRICE_ID || 'price_business',
    features: [
      'Unlimited team members',
      'Unlimited customers',
      'Custom reporting',
      'Phone & email support',
      'API access',
      'White-label options',
      'Dedicated account manager',
    ],
    limits: {
      users: -1, // unlimited
      customers: -1, // unlimited
    },
  },
} as const;

export type PlanId = keyof typeof SUBSCRIPTION_PLANS;

// Subscription status types
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

// Check if Stripe is configured
export function isStripeConfigured(): boolean {
  return !!stripePublishableKey && stripePublishableKey !== 'pk_test_placeholder';
}

export interface BillingApiConfig {
  checkoutUrl: string;
  portalUrl: string;
  cancelUrl: string;
}

export function getBillingApiConfig(): BillingApiConfig | null {
  if (!stripeCheckoutUrl || !stripePortalUrl || !stripeCancelUrl) {
    return null;
  }
  return {
    checkoutUrl: stripeCheckoutUrl,
    portalUrl: stripePortalUrl,
    cancelUrl: stripeCancelUrl,
  };
}

export function isBillingBackendConfigured(): boolean {
  return getBillingApiConfig() !== null;
}

// Format price for display
export function formatPrice(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
  }).format(amount);
}

// Calculate annual price with discount
export function getAnnualPrice(monthlyPrice: number, discountPercent = 20): number {
  const annualTotal = monthlyPrice * 12;
  return Math.round(annualTotal * (1 - discountPercent / 100));
}
