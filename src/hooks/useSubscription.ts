import { useState, useEffect, useCallback } from 'react';
import { getStripe, SUBSCRIPTION_PLANS, PlanId, Subscription, isStripeConfigured } from '@/lib/stripe';
import { useAuthContext } from '@/components/auth/AuthProvider';

const SUBSCRIPTION_STORAGE_KEY = 'chemcheck_subscription';

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
  cancelSubscription: () => Promise<void>;
}

// Free tier limits for users without subscription
const FREE_TIER_LIMITS = {
  users: 1,
  customers: 10,
};

export function useSubscription(): UseSubscriptionReturn {
  const { localUser, clerkUser } = useAuthContext();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load subscription from storage/API
  useEffect(() => {
    const loadSubscription = async () => {
      setIsLoading(true);
      try {
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
  }, [localUser, clerkUser]);

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

    setIsLoading(true);
    setError(null);

    try {
      const stripe = await getStripe();
      if (!stripe) throw new Error('Stripe not initialized');

      // In production, call your backend to create a checkout session
      // const response = await fetch('/api/create-checkout-session', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify({ planId, isAnnual }),
      // });
      // const { sessionId } = await response.json();
      // await stripe.redirectToCheckout({ sessionId });

      // For now, show a message that Stripe needs backend setup
      throw new Error('Stripe checkout requires backend integration. Please configure your Stripe webhook endpoints.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create checkout session');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Create Stripe customer portal session
  const createPortalSession = useCallback(async () => {
    if (!isStripeConfigured()) {
      setError('Billing portal not available in demo mode');
      return;
    }

    setIsLoading(true);
    try {
      // In production, call your backend to create a portal session
      // const response = await fetch('/api/create-portal-session', { method: 'POST' });
      // const { url } = await response.json();
      // window.location.href = url;
      
      throw new Error('Billing portal requires backend integration');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open billing portal');
    } finally {
      setIsLoading(false);
    }
  }, []);

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

    setIsLoading(true);
    try {
      // In production, call your backend
      // await fetch('/api/cancel-subscription', { method: 'POST' });
      throw new Error('Subscription cancellation requires backend integration');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel subscription');
    } finally {
      setIsLoading(false);
    }
  }, [subscription]);

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
    cancelSubscription,
  };
}
