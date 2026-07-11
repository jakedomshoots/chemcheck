import { useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { 
  CreditCard, 
  Calendar, 
  AlertTriangle, 
  CheckCircle2, 
  Clock,
  ExternalLink,
  Loader2,
  TrendingUp
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useSubscription } from '@/hooks/useSubscription';
import { formatPrice } from '@/lib/stripe';
import { getPlatform, isNativePlatform } from '@/lib/native/platform';
import { cn } from '@/lib/utils';

export function BillingDashboard() {
  const {
    subscription,
    isLoading,
    error,
    isTrialing,
    currentPlan,
    daysRemaining,
    createPortalSession,
  } = useSubscription();

  const customerCountData = useQuery(api.customers.count);
  const teamMemberCountData = useQuery(api.teamMembers.count);
  
  const isNativeIos = isNativePlatform() && getPlatform() === 'ios';

  const handleManageBilling = async () => {
    try {
      await createPortalSession();
    } catch (err) {
      console.error('Portal error:', err);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
      </div>
    );
  }

  const statusConfig = {
    active: { icon: CheckCircle2, color: 'text-green-600', bg: 'bg-green-50', label: 'Active' },
    trialing: { icon: Clock, color: 'text-blue-600', bg: 'bg-blue-50', label: 'Trial' },
    past_due: { icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-50', label: 'Past Due' },
    unpaid: { icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-50', label: 'Unpaid' },
    incomplete: { icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-50', label: 'Incomplete' },
    incomplete_expired: { icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-50', label: 'Expired' },
    canceled: { icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-50', label: 'Canceled' },
  };

  const status = statusConfig[subscription?.status] || statusConfig.active;
  const StatusIcon = status.icon;

  return (
    <div className="space-y-6">
      {/* Current Plan Card */}
      <div className="rounded-[1.5rem] border border-white/80 bg-white/85 p-5 shadow-[0_18px_60px_-44px_rgba(8,47,73,0.75)] backdrop-blur sm:p-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">
              Subscription
            </p>
            <h2 className="text-xl font-semibold tracking-[-0.035em] text-slate-950 sm:text-2xl">Current Plan</h2>
            <p className="mt-1 text-sm font-medium text-slate-600">Manage your subscription and billing</p>
          </div>
          {subscription && (
            <div className={cn("flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold", status.bg, status.color)}>
              <StatusIcon className="h-4 w-4" aria-hidden="true" />
              <span>{status.label}</span>
            </div>
          )}
        </div>

        {subscription && currentPlan ? (
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <div className="mb-4 flex items-baseline gap-2">
                <span className="text-3xl font-semibold tracking-[-0.04em] text-slate-950 sm:text-4xl">{currentPlan.name}</span>
                <span className="text-sm font-medium text-slate-500">Plan</span>
              </div>

              <div className="space-y-3 text-sm font-medium text-slate-700">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-50 text-cyan-700">
                    <CreditCard className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span>{formatPrice(currentPlan.price)}/month</span>
                </div>

                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                    <Calendar className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span>
                    {isTrialing ? 'Trial ends' : 'Renews'} on{' '}
                    {subscription.currentPeriodEnd.toLocaleDateString()}
                  </span>
                </div>

                {isTrialing && (
                  <div className="flex items-center gap-3 text-cyan-800">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-50 text-cyan-700">
                      <Clock className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span>{daysRemaining} days remaining in trial</span>
                  </div>
                )}

                {subscription.cancelAtPeriodEnd && (
                  <div className="flex items-center gap-3 text-amber-700">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                      <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span>Cancels at end of billing period</span>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="mb-2 text-sm font-semibold tracking-[-0.02em] text-slate-950">Plan Features</h3>
              <ul className="space-y-2">
                {currentPlan.features.slice(0, 4).map((feature, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm font-medium leading-6 text-slate-700">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-cyan-600" aria-hidden="true" />
                    {feature}
                  </li>
                ))}
              </ul>
              <a
                href="/pricing"
                className="inline-flex items-center gap-1 text-sm font-semibold text-cyan-700 transition-colors hover:text-cyan-800"
              >
                View all plans
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            </div>
          </div>
        ) : (
          <div className="py-8 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
              <CreditCard className="h-8 w-8" aria-hidden="true" />
            </div>
            <h3 className="mb-2 text-lg font-semibold tracking-[-0.03em] text-slate-950">No Active Subscription</h3>
            <p className="mb-4 text-sm font-medium text-slate-600">Choose a plan to unlock all features</p>
            <Button
              asChild
              className="h-11 rounded-full bg-cyan-600 px-6 font-semibold text-white shadow-[0_18px_38px_-24px_rgba(8,145,178,0.95)] hover:bg-cyan-700 focus-visible:ring-2 focus-visible:ring-cyan-500"
            >
              <a href="/pricing">View Plans</a>
            </Button>
          </div>
        )}
      </div>

      {/* Billing Actions */}
      {subscription && (
        <div className="rounded-[1.5rem] border border-white/80 bg-white/85 p-5 shadow-[0_18px_60px_-44px_rgba(8,47,73,0.75)] backdrop-blur sm:p-6">
          <h3 className="mb-4 text-base font-semibold tracking-[-0.02em] text-slate-950">Billing Actions</h3>

          <div className="flex flex-wrap gap-3">
            {isNativeIos ? (
              <p className="text-sm font-medium text-slate-600">
                Billing changes are handled outside the iOS app.
              </p>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={handleManageBilling}
                  className="h-11 rounded-full border-slate-300 bg-white px-5 text-slate-800 hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-800"
                >
                  <CreditCard className="h-4 w-4" aria-hidden="true" />
                  Manage Subscription
                </Button>
                <p className="self-center text-sm font-medium text-slate-600">
                  Update payment details, invoices, and cancellation in the secure Stripe portal.
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {/* Usage Stats */}
      {subscription && currentPlan && (
        <div className="rounded-[1.5rem] border border-white/80 bg-white/85 p-5 shadow-[0_18px_60px_-44px_rgba(8,47,73,0.75)] backdrop-blur sm:p-6">
          <h3 className="mb-4 text-base font-semibold tracking-[-0.02em] text-slate-950">Usage</h3>

          <div className="grid gap-6 md:grid-cols-2">
            {customerCountData === undefined || teamMemberCountData === undefined ? (
              <>
                <div className="space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-2 w-full" />
                </div>
                <div className="space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-2 w-full" />
                </div>
              </>
            ) : (
              <>
                <UsageBar
                  label="Team Members"
                  current={teamMemberCountData?.count ?? 0}
                  limit={currentPlan.limits.users}
                  isCapped={teamMemberCountData?.isCapped}
                />
                <UsageBar
                  label="Customers"
                  current={customerCountData?.count ?? 0}
                  limit={currentPlan.limits.customers}
                  isCapped={customerCountData?.isCapped}
                />
              </>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50/80 p-4 text-sm font-medium text-red-700 shadow-sm">
          {error}
        </div>
      )}
    </div>
  );
}

function UsageBar({ label, current, limit, isCapped }) {
  const isUnlimited = limit === -1;
  const displayCurrent = isCapped ? `${current}+` : current;
  const percentage = isUnlimited ? 0 : Math.min(100, (current / limit) * 100);
  const isNearLimit = !isUnlimited && percentage >= 80;

  return (
    <div>
      <div className="mb-2 flex justify-between text-sm">
        <span className="font-medium text-slate-700">{label}</span>
        <span className={cn("font-semibold tabular-nums", isNearLimit ? "text-amber-700" : "text-slate-950")}>
          {displayCurrent} / {isUnlimited ? '∞' : limit}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            isNearLimit ? "bg-amber-500" : "bg-cyan-600"
          )}
          style={{ width: isUnlimited ? '10%' : `${percentage}%` }}
        />
      </div>
      {isCapped && (
        <p className="mt-1 text-xs font-medium text-slate-500">
          Display count is capped
        </p>
      )}
      {isNearLimit && (
        <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-amber-700">
          <TrendingUp className="h-3 w-3" aria-hidden="true" />
          Approaching limit - consider upgrading
        </p>
      )}
    </div>
  );
}
