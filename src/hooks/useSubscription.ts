import { useCallback, useEffect, useState } from 'react';
import { useAction, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { PlanId, SUBSCRIPTION_PLANS, Subscription, SubscriptionStatus } from '@/lib/stripe';

/** Plan and status values coming from the server that this client does not recognise. */
export const UNKNOWN_PLAN_ID = 'unknown' as const;
export const UNKNOWN_SUBSCRIPTION_STATUS = 'unknown' as const;

export type ClientPlanId = PlanId | typeof UNKNOWN_PLAN_ID;
export type ClientSubscriptionStatus = SubscriptionStatus | typeof UNKNOWN_SUBSCRIPTION_STATUS;

export interface ClientSubscription extends Omit<Subscription, 'planId' | 'status'> {
  planId: ClientPlanId;
  status: ClientSubscriptionStatus;
  /** Raw values from the server, kept for display when they are not recognised. */
  rawPlanId: string;
  rawStatus: string;
}

const KNOWN_STATUSES: ReadonlySet<string> = new Set<SubscriptionStatus>([
  'active', 'canceled', 'incomplete', 'incomplete_expired', 'past_due', 'trialing', 'unpaid',
]);

export function normalizePlanId(rawPlanId: unknown): ClientPlanId {
  return typeof rawPlanId === 'string' && rawPlanId in SUBSCRIPTION_PLANS
    ? (rawPlanId as PlanId)
    : UNKNOWN_PLAN_ID;
}

export function normalizeSubscriptionStatus(rawStatus: unknown): ClientSubscriptionStatus {
  return typeof rawStatus === 'string' && KNOWN_STATUSES.has(rawStatus)
    ? (rawStatus as SubscriptionStatus)
    : UNKNOWN_SUBSCRIPTION_STATUS;
}

/** Statuses that mean the tenant has no paid access right now. */
export const LOCKED_SUBSCRIPTION_STATUSES: ReadonlySet<string> = new Set(['unpaid', 'incomplete_expired']);

/**
 * True when a subscription row exists and its state means feature access must
 * be locked: unpaid, incomplete_expired, or canceled once the paid period has
 * ended. A missing row (legacy users) or an unrecognised status never locks.
 */
export function isSubscriptionLocked(
  subscription: Pick<ClientSubscription, 'status' | 'currentPeriodEnd'> | null | undefined,
  now: number = Date.now()
): boolean {
  if (!subscription) return false;
  if (subscription.status === UNKNOWN_SUBSCRIPTION_STATUS) return true;
  if (LOCKED_SUBSCRIPTION_STATUSES.has(subscription.status)) return true;
  if (subscription.status === 'canceled') {
    const periodEnd = subscription.currentPeriodEnd?.getTime?.();
    return !Number.isFinite(periodEnd) || (periodEnd as number) <= now;
  }
  return false;
}

interface UseSubscriptionReturn {
  subscription: ClientSubscription | null;
  isLoading: boolean;
  error: string | null;
  isTrialing: boolean;
  isActive: boolean;
  /** True only once the subscription query has resolved and access is locked. */
  isLocked: boolean;
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
  const [subscription, setSubscription] = useState<ClientSubscription | null>(null);
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
      const rawPlanId = String(convexSubscription.plan_id ?? '');
      const rawStatus = String(convexSubscription.status ?? '');
      setSubscription({
        id: convexSubscription.stripe_subscription_id,
        status: normalizeSubscriptionStatus(rawStatus),
        planId: normalizePlanId(rawPlanId),
        rawPlanId,
        rawStatus,
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
  const isLocked = !isLoading && isSubscriptionLocked(subscription);
  const currentPlan = subscription && subscription.planId !== UNKNOWN_PLAN_ID
    ? SUBSCRIPTION_PLANS[subscription.planId]
    : null;
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
    isLocked,
    currentPlan,
    daysRemaining,
    canAccessFeature,
    checkLimit,
    createCheckoutSession,
    createPortalSession,
  };
}
