import { useCallback, useEffect, useState } from 'react';
import { useAction, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { PlanId, SUBSCRIPTION_PLANS, Subscription } from '@/lib/stripe';

interface UseSubscriptionReturn {
  subscription: Subscription | null;
  isLoading: boolean;
  error: string | null;
  isTrialing: boolean;
  isActive: boolean;
  currentPlan: typeof SUBSCRIPTION_PLANS[PlanId] | null;
  daysRemaining: number;
  canAccessFeature: (feature: string) => boolean;
  checkLimit: (type: 'users' | 'customers', count: number) => boolean;
  createCheckoutSession: (planId: PlanId, isAnnual?: boolean) => Promise<void>;
  createPortalSession: () => Promise<void>;
}

const FREE_TIER_LIMITS = { users: 1, customers: 10 };

export function useSubscription(): UseSubscriptionReturn {
  const convexSubscription = useQuery(api.subscriptions.get);
  const createStripeCheckoutSession = useAction(api.subscriptions.createCheckoutSession);
  const createStripePortalSession = useAction(api.subscriptions.createPortalSession);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (convexSubscription === undefined) {
      setIsLoading(true);
      return;
    }
    if (!convexSubscription) {
      setSubscription(null);
    } else {
      const rawPlanId = convexSubscription.plan_id as string;
      const planId: PlanId = rawPlanId in SUBSCRIPTION_PLANS ? rawPlanId as PlanId : 'starter';
      setSubscription({
        id: convexSubscription.stripe_subscription_id,
        status: convexSubscription.status as Subscription['status'],
        planId,
        currentPeriodStart: new Date(convexSubscription.current_period_start),
        currentPeriodEnd: new Date(convexSubscription.current_period_end),
        cancelAtPeriodEnd: convexSubscription.cancel_at_period_end,
        trialEnd: convexSubscription.trial_end ? new Date(convexSubscription.trial_end) : undefined,
      });
    }
    setError(null);
    setIsLoading(false);
  }, [convexSubscription]);

  const isActive = subscription?.status === 'active' || subscription?.status === 'trialing';
  const isTrialing = subscription?.status === 'trialing';
  const currentPlan = subscription?.planId ? SUBSCRIPTION_PLANS[subscription.planId] : null;
  const daysRemaining = subscription?.currentPeriodEnd
    ? Math.max(0, Math.ceil((subscription.currentPeriodEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : 0;

  const canAccessFeature = useCallback((feature: string): boolean => {
    if (!currentPlan) return false;
    const featurePlanRequirements: Record<string, PlanId[]> = {
      'route-optimization': ['professional', 'business'],
      'chemical-tracking': ['professional', 'business'],
      'advanced-reporting': ['professional', 'business'],
      'api-access': ['business'],
      'white-label': ['business'],
      'custom-reporting': ['business'],
    };
    const requiredPlans = featurePlanRequirements[feature];
    return !requiredPlans || requiredPlans.includes(subscription?.planId as PlanId);
  }, [currentPlan, subscription]);

  const checkLimit = useCallback((type: 'users' | 'customers', count: number): boolean => {
    const limit = (currentPlan?.limits || FREE_TIER_LIMITS)[type];
    return limit === -1 || count <= limit;
  }, [currentPlan]);

  const createCheckoutSession = useCallback(async (planId: PlanId, isAnnual = false) => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await createStripeCheckoutSession({ plan_id: planId, interval: isAnnual ? 'year' : 'month' });
      if (!result?.url) throw new Error('Stripe Checkout did not return a URL.');
      window.location.assign(result.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create checkout session');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [createStripeCheckoutSession]);

  const createPortalSession = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await createStripePortalSession({});
      if (!result?.url) throw new Error('Stripe billing portal did not return a URL.');
      window.location.assign(result.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open billing portal');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [createStripePortalSession]);

  return {
    subscription,
    isLoading,
    error,
    isTrialing,
    isActive,
    currentPlan,
    daysRemaining,
    canAccessFeature,
    checkLimit,
    createCheckoutSession,
    createPortalSession,
  };
}
