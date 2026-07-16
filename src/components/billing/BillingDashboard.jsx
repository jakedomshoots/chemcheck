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
        <Loader2 className="w-8 h-8 animate-spin text-ink-muted" />
      </div>
    );
  }

  const statusConfig = {
    active: { icon: CheckCircle2, color: 'text-ok', bg: 'bg-[var(--status-ok-soft)]', label: 'Active' },
    trialing: { icon: Clock, color: 'text-info', bg: 'bg-[var(--status-info-soft)]', label: 'Trial' },
    past_due: { icon: AlertTriangle, color: 'text-watch', bg: 'bg-[var(--status-watch-soft)]', label: 'Past Due' },
    unpaid: { icon: AlertTriangle, color: 'text-critical', bg: 'bg-[var(--status-critical-soft)]', label: 'Unpaid' },
    incomplete: { icon: AlertTriangle, color: 'text-critical', bg: 'bg-[var(--status-critical-soft)]', label: 'Incomplete' },
    incomplete_expired: { icon: AlertTriangle, color: 'text-critical', bg: 'bg-[var(--status-critical-soft)]', label: 'Expired' },
    canceled: { icon: AlertTriangle, color: 'text-critical', bg: 'bg-[var(--status-critical-soft)]', label: 'Canceled' },
  };

  const status = statusConfig[subscription?.status] || statusConfig.active;
  const StatusIcon = status.icon;

  return (
    <div className="space-y-6">
      {/* Current Plan Card */}
      <div className="rounded-sheet border border-line bg-surface-1 p-5 shadow-card sm:p-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-brand-ink">
              Subscription
            </p>
            <h2 className="text-xl font-semibold tracking-[-0.035em] text-ink sm:text-2xl">Current Plan</h2>
            <p className="mt-1 text-sm font-medium text-ink-secondary">Manage your subscription and billing</p>
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
                <span className="text-3xl font-semibold tracking-[-0.04em] text-ink sm:text-4xl">{currentPlan.name}</span>
                <span className="text-sm font-medium text-ink-muted">Plan</span>
              </div>

              <div className="space-y-3 text-sm font-medium text-ink-secondary">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-softer text-brand-ink">
                    <CreditCard className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span>{formatPrice(currentPlan.price)}/month</span>
                </div>

                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-2 text-ink-secondary">
                    <Calendar className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span>
                    {isTrialing ? 'Trial ends' : 'Renews'} on{' '}
                    {subscription.currentPeriodEnd.toLocaleDateString()}
                  </span>
                </div>

                {isTrialing && (
                  <div className="flex items-center gap-3 text-brand-ink">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-softer text-brand-ink">
                      <Clock className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span>{daysRemaining} days remaining in trial</span>
                  </div>
                )}

                {subscription.cancelAtPeriodEnd && (
                  <div className="flex items-center gap-3 text-watch">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--status-watch-soft)] text-watch">
                      <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span>Cancels at end of billing period</span>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="mb-2 text-sm font-semibold tracking-[-0.02em] text-ink">Plan Features</h3>
              <ul className="space-y-2">
                {currentPlan.features.slice(0, 4).map((feature, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm font-medium leading-6 text-ink-secondary">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-ink" aria-hidden="true" />
                    {feature}
                  </li>
                ))}
              </ul>
              <a
                href="/pricing"
                className="inline-flex items-center gap-1 text-sm font-semibold text-brand-ink transition-colors hover:text-brand-ink"
              >
                View all plans
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            </div>
          </div>
        ) : (
          <div className="py-8 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-2 text-ink-muted">
              <CreditCard className="h-8 w-8" aria-hidden="true" />
            </div>
            <h3 className="mb-2 text-lg font-semibold tracking-[-0.03em] text-ink">No Active Subscription</h3>
            <p className="mb-4 text-sm font-medium text-ink-secondary">Choose a plan to unlock all features</p>
            <Button
              asChild
              className="h-11 rounded-full bg-brand px-6 font-semibold text-white shadow-cta hover:bg-brand-strong focus-visible:ring-2 focus-visible:ring-ring"
            >
              <a href="/pricing">View Plans</a>
            </Button>
          </div>
        )}
      </div>

      {/* Billing Actions */}
      {subscription && (
        <div className="rounded-sheet border border-line bg-surface-1 p-5 shadow-card sm:p-6">
          <h3 className="mb-4 text-base font-semibold tracking-[-0.02em] text-ink">Billing Actions</h3>

          <div className="flex flex-wrap gap-3">
            {isNativeIos ? (
              <p className="text-sm font-medium text-ink-secondary">
                Billing changes are handled outside the iOS app.
              </p>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={handleManageBilling}
                  className="h-11 rounded-full border-line bg-white px-5 text-ink hover:border-[var(--status-info-line)] hover:bg-brand-softer hover:text-brand-ink"
                >
                  <CreditCard className="h-4 w-4" aria-hidden="true" />
                  Manage Subscription
                </Button>
                <p className="self-center text-sm font-medium text-ink-secondary">
                  Update payment details, invoices, and cancellation in the secure Stripe portal.
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {/* Usage Stats */}
      {subscription && currentPlan && (
        <div className="rounded-sheet border border-line bg-surface-1 p-5 shadow-card sm:p-6">
          <h3 className="mb-4 text-base font-semibold tracking-[-0.02em] text-ink">Usage</h3>

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
        <div className="rounded-2xl border border-[var(--status-critical-line)] bg-[var(--status-critical-soft)] p-4 text-sm font-medium text-critical shadow-sm">
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
        <span className="font-medium text-ink-secondary">{label}</span>
        <span className={cn("font-semibold tabular-nums", isNearLimit ? "text-watch" : "text-ink")}>
          {displayCurrent} / {isUnlimited ? '∞' : limit}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-2">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            isNearLimit ? "bg-[var(--status-watch-soft)]0" : "bg-brand"
          )}
          style={{ width: isUnlimited ? '10%' : `${percentage}%` }}
        />
      </div>
      {isCapped && (
        <p className="mt-1 text-xs font-medium text-ink-muted">
          Display count is capped
        </p>
      )}
      {isNearLimit && (
        <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-watch">
          <TrendingUp className="h-3 w-3" aria-hidden="true" />
          Approaching limit - consider upgrading
        </p>
      )}
    </div>
  );
}
