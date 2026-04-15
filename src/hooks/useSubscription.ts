import { useState, useEffect, useCallback } from 'react';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import {
  getStripe,
  SUBSCRIPTION_PLANS,
  PlanId,
  Subscription,
  isStripeConfigured,
  getBillingApiConfig,
  isBillingBackendConfigured as isStripeBillingBackendConfigured,
} from '@/lib/stripe';
import { useAuthContext } from '@/components/auth/ClerkAuthProvider';

const SUBSCRIPTION_STORAGE_KEY = 'chemcheck_subscription';

interface UseSubscriptionReturn {
  subscription: Subscription | null;
  isLoading: boolean;
  error: string | null;
  isTrialing: boolean;
  isActive: boolean;
  isBillingBackendConfigured: boolean;
  currentPlan: typeof SUBSCRIPTION_PLANS[PlanId] | null;
  daysRemaining: number;
  canAccessFeature: (feature: string) => boolean;
  checkLimit: (type: 'users' | 'customers', count: number) => boolean;
  createCheckoutSession: (planId: PlanId, isAnnual?: boolean) => Promise<void>;
  createPortalSession: () => Promise<void>;
  cancelSubscription: () => Promise<void>;
}

// Free tier limits for users without subscription
const FREE_TIER_LIMITS = {
  users: 1,
  customers: 10,
};

export function useSubscription(): UseSubscriptionReturn {
  const { localUser, clerkUser } = useAuthContext();
  const convexSubscription = useQuery(api.subscriptions.get);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const billingApiConfig = getBillingApiConfig();
  const isBillingBackendConfigured = isStripeBillingBackendConfigured();

  // Load subscription from storage/API
  useEffect(() => {
    const loadSubscription = async () => {
      setIsLoading(true);
      try {
        if (convexSubscription) {
          const rawPlanId = convexSubscription.plan_id as string;
          const planId: PlanId = rawPlanId in SUBSCRIPTION_PLANS
            ? (rawPlanId as PlanId)
            : 'starter';
          setSubscription({
            id: convexSubscription.stripe_subscription_id,
            status: convexSubscription.status as Subscription['status'],
            planId,
            currentPeriodStart: new Date(convexSubscription.current_period_start),
            currentPeriodEnd: new Date(convexSubscription.current_period_end),
            cancelAtPeriodEnd: convexSubscription.cancel_at_period_end,
            trialEnd: convexSubscription.trial_end
              ? new Date(convexSubscription.trial_end)
              : undefined,
          });
          setError(null);
          return;
        }

        if (convexSubscription === null && isStripeConfigured()) {
          setSubscription(null);
          setError(null);
          return;
        }

        // In production, this would fetch from your backend
        // For now, check local storage for demo purposes
        const stored = localStorage.getItem(SUBSCRIPTION_STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          setSubscription({
            ...parsed,
            currentPeriodStart: new Date(parsed.currentPeriodStart),
            currentPeriodEnd: new Date(parsed.currentPeriodEnd),
            trialEnd: parsed.trialEnd ? new Date(parsed.trialEnd) : undefined,
          });
        }
      } catch (err) {
        console.error('Failed to load subscription:', err);
        setError('Failed to load subscription status');
      } finally {
        setIsLoading(false);
      }
    };

    loadSubscription();
  }, [convexSubscription, localUser, clerkUser]);

  // Computed values
  const isActive = subscription?.status === 'active' || subscription?.status === 'trialing';
  const isTrialing = subscription?.status === 'trialing';
  
  const currentPlan = subscription?.planId 
    ? SUBSCRIPTION_PLANS[subscription.planId] 
    : null;

  const daysRemaining = subscription?.currentPeriodEnd
    ? Math.max(0, Math.ceil((subscription.currentPeriodEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : 0;

  // Check if user can access a feature based on their plan
  const canAccessFeature = useCallback((feature: string): boolean => {
    if (!currentPlan) return false;
    
    // Map features to plan requirements
    const featurePlanRequirements: Record<string, PlanId[]> = {
      'route-optimization': ['professional', 'business'],
      'chemical-tracking': ['professional', 'business'],
      'advanced-reporting': ['professional', 'business'],
      'api-access': ['business'],
      'white-label': ['business'],
      'custom-reporting': ['business'],
    };

    const requiredPlans = featurePlanRequirements[feature];
    if (!requiredPlans) return true; // Feature available to all plans
    
    return requiredPlans.includes(subscription?.planId as PlanId);
  }, [currentPlan, subscription]);

  // Check if user is within their plan limits
  const checkLimit = useCallback((type: 'users' | 'customers', count: number): boolean => {
    const limits = currentPlan?.limits || FREE_TIER_LIMITS;
    const limit = limits[type];
    
    if (limit === -1) return true; // Unlimited
    return count <= limit;
  }, [currentPlan]);

  // Create Stripe checkout session
  const createCheckoutSession = useCallback(async (planId: PlanId, isAnnual = false) => {
    if (!isStripeConfigured()) {
      // Demo mode - simulate subscription
      const plan = SUBSCRIPTION_PLANS[planId];
      const now = new Date();
      const trialEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000); // 14 day trial
      
      const demoSubscription: Subscription = {
        id: `sub_demo_${Date.now()}`,
        status: 'trialing',
        planId,
        currentPeriodStart: now,
        currentPeriodEnd: trialEnd,
        cancelAtPeriodEnd: false,
        trialEnd,
      };
      
      localStorage.setItem(SUBSCRIPTION_STORAGE_KEY, JSON.stringify(demoSubscription));
      setSubscription(demoSubscription);
      return;
    }

    if (!billingApiConfig) {
      setError('Billing checkout is not configured yet.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const stripe = await getStripe();
      if (!stripe) throw new Error('Stripe not initialized');

      const authToken = await clerkUser?.getToken?.().catch(() => null);
      const response = await fetch(billingApiConfig.checkoutUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ planId, isAnnual }),
      });

      if (!response.ok) {
        const fallbackMessage = 'Unable to start checkout.';
        const payload = await response.json().catch(() => null);
        const message = payload?.error || fallbackMessage;
        throw new Error(message);
      }

      const payload = await response.json();
      if (typeof payload?.url === 'string' && payload.url.length > 0) {
        window.location.assign(payload.url);
        return;
      }

      if (typeof payload?.sessionId === 'string' && payload.sessionId.length > 0) {
        const result = await stripe.redirectToCheckout({ sessionId: payload.sessionId });
        if (result.error) {
          throw result.error;
        }
        return;
      }

      throw new Error('Checkout session response was invalid.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create checkout session');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [billingApiConfig, clerkUser]);

  // Create Stripe customer portal session
  const createPortalSession = useCallback(async () => {
    if (!isStripeConfigured()) {
      setError('Billing portal not available in demo mode');
      return;
    }

    if (!billingApiConfig) {
      setError('Billing portal is not configured yet.');
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const authToken = await clerkUser?.getToken?.().catch(() => null);
      const response = await fetch(billingApiConfig.portalUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
      });

      if (!response.ok) {
        const fallbackMessage = 'Unable to open billing portal.';
        const payload = await response.json().catch(() => null);
        const message = payload?.error || fallbackMessage;
        throw new Error(message);
      }

      const payload = await response.json();
      if (typeof payload?.url !== 'string' || payload.url.length === 0) {
        throw new Error('Billing portal response was invalid.');
      }

      window.location.assign(payload.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open billing portal');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [billingApiConfig, clerkUser]);

  // Cancel subscription
  const cancelSubscription = useCallback(async () => {
    if (!subscription) return;

    if (!isStripeConfigured()) {
      // Demo mode - cancel locally
      const updated = { ...subscription, cancelAtPeriodEnd: true };
      localStorage.setItem(SUBSCRIPTION_STORAGE_KEY, JSON.stringify(updated));
      setSubscription(updated);
      return;
    }

    if (!billingApiConfig) {
      setError('Subscription cancellation is not configured yet.');
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const authToken = await clerkUser?.getToken?.().catch(() => null);
      const response = await fetch(billingApiConfig.cancelUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ subscriptionId: subscription.id }),
      });

      if (!response.ok) {
        const fallbackMessage = 'Unable to cancel subscription.';
        const payload = await response.json().catch(() => null);
        const message = payload?.error || fallbackMessage;
        throw new Error(message);
      }

      setSubscription((prev) => prev ? { ...prev, cancelAtPeriodEnd: true } : prev);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel subscription');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [billingApiConfig, clerkUser, subscription]);

  return {
    subscription,
    isLoading,
    error,
    isTrialing,
    isActive,
    isBillingBackendConfigured,
    currentPlan,
    daysRemaining,
    canAccessFeature,
    checkLimit,
    createCheckoutSession,
    createPortalSession,
    cancelSubscription,
  };
}
