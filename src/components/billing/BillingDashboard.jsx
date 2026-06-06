import { useState } from 'react';
import { 
  CreditCard, 
  Calendar, 
  AlertTriangle, 
  CheckCircle2, 
  Clock,
  ExternalLink,
  Loader2,
  Receipt,
  TrendingUp
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SUBSCRIPTION_PLANS, formatPrice, isStripeConfigured } from '@/lib/stripe';
import { useSubscription } from '@/hooks/useSubscription';
import { cn } from '@/lib/utils';

export function BillingDashboard() {
  const {
    subscription,
    isLoading,
    error,
    isTrialing,
    isBillingBackendConfigured,
    currentPlan,
    daysRemaining,
    createPortalSession,
    cancelSubscription,
  } = useSubscription();
  
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [isCanceling, setIsCanceling] = useState(false);

  const handleManageBilling = async () => {
    try {
      await createPortalSession();
    } catch (err) {
      console.error('Portal error:', err);
    }
  };

  const handleCancelSubscription = async () => {
    setIsCanceling(true);
    try {
      await cancelSubscription();
      setShowCancelConfirm(false);
    } catch (err) {
      console.error('Cancel error:', err);
    } finally {
      setIsCanceling(false);
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
      <Card className="p-6">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Current Plan</h2>
            <p className="text-sm text-slate-500">Manage your subscription and billing</p>
          </div>
          {subscription && (
            <div className={cn("flex items-center gap-2 px-3 py-1.5 rounded-full", status.bg)}>
              <StatusIcon className={cn("w-4 h-4", status.color)} />
              <span className={cn("text-sm font-medium", status.color)}>{status.label}</span>
            </div>
          )}
        </div>

        {subscription && currentPlan ? (
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <div className="flex items-baseline gap-2 mb-4">
                <span className="text-3xl font-bold text-slate-900">{currentPlan.name}</span>
                <span className="text-slate-500">Plan</span>
              </div>
              
              <div className="space-y-3">
                <div className="flex items-center gap-3 text-slate-600">
                  <CreditCard className="w-5 h-5" />
                  <span>{formatPrice(currentPlan.price)}/month</span>
                </div>
                
                <div className="flex items-center gap-3 text-slate-600">
                  <Calendar className="w-5 h-5" />
                  <span>
                    {isTrialing ? 'Trial ends' : 'Renews'} on{' '}
                    {subscription.currentPeriodEnd.toLocaleDateString()}
                  </span>
                </div>

                {isTrialing && (
                  <div className="flex items-center gap-3 text-blue-600">
                    <Clock className="w-5 h-5" />
                    <span>{daysRemaining} days remaining in trial</span>
                  </div>
                )}

                {subscription.cancelAtPeriodEnd && (
                  <div className="flex items-center gap-3 text-amber-600">
                    <AlertTriangle className="w-5 h-5" />
                    <span>Cancels at end of billing period</span>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="font-medium text-slate-900 mb-2">Plan Features</h3>
              <ul className="space-y-2">
                {currentPlan.features.slice(0, 4).map((feature, idx) => (
                  <li key={idx} className="flex items-center gap-2 text-sm text-slate-600">
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                    {feature}
                  </li>
                ))}
              </ul>
              <a href="/pricing" className="text-sm text-cyan-600 hover:text-cyan-700 inline-flex items-center gap-1">
                View all plans <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        ) : (
          <div className="text-center py-8">
            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <CreditCard className="w-8 h-8 text-slate-400" />
            </div>
            <h3 className="text-lg font-medium text-slate-900 mb-2">No Active Subscription</h3>
            <p className="text-slate-500 mb-4">Choose a plan to unlock all features</p>
            <Button asChild>
              <a href="/pricing">View Plans</a>
            </Button>
          </div>
        )}
      </Card>

      {/* Billing Actions */}
      {subscription && (
        <Card className="p-6">
          <h3 className="font-semibold text-slate-900 mb-4">Billing Actions</h3>
          
          <div className="flex flex-wrap gap-3">
            {isStripeConfigured() ? (
              isBillingBackendConfigured ? (
                <>
                  <Button variant="outline" onClick={handleManageBilling}>
                    <CreditCard className="w-4 h-4 mr-2" />
                    Manage Payment Method
                  </Button>

                  <Button variant="outline" onClick={handleManageBilling}>
                    <Receipt className="w-4 h-4 mr-2" />
                    View Invoices
                  </Button>
                </>
              ) : (
                <p className="text-sm text-red-600">
                  Billing backend URLs are missing. Portal and cancellation are currently disabled.
                </p>
              )
            ) : (
              <p className="text-sm text-slate-500">
                Billing management available when Stripe is configured.
              </p>
            )}

            {!subscription.cancelAtPeriodEnd && (!isStripeConfigured() || isBillingBackendConfigured) && (
              <Button 
                variant="ghost" 
                className="text-red-600 hover:text-red-700 hover:bg-red-50"
                onClick={() => setShowCancelConfirm(true)}
              >
                Cancel Subscription
              </Button>
            )}
          </div>

          {/* Cancel Confirmation */}
          {showCancelConfirm && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <h4 className="font-medium text-red-900 mb-2">Cancel Subscription?</h4>
              <p className="text-sm text-red-700 mb-4">
                Your subscription will remain active until the end of your current billing period. 
                You won't be charged again, but you'll lose access to premium features after that date.
              </p>
              <div className="flex gap-3">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleCancelSubscription}
                  disabled={isCanceling}
                >
                  {isCanceling ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    'Yes, Cancel'
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowCancelConfirm(false)}
                >
                  Keep Subscription
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Usage Stats */}
      {subscription && currentPlan && (
        <Card className="p-6">
          <h3 className="font-semibold text-slate-900 mb-4">Usage</h3>
          
          <div className="grid md:grid-cols-2 gap-6">
            <UsageBar
              label="Team Members"
              current={1}
              limit={currentPlan.limits.users}
            />
            <UsageBar
              label="Customers"
              current={25}
              limit={currentPlan.limits.customers}
            />
          </div>
        </Card>
      )}

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}
    </div>
  );
}

function UsageBar({ label, current, limit }) {
  const isUnlimited = limit === -1;
  const percentage = isUnlimited ? 0 : Math.min(100, (current / limit) * 100);
  const isNearLimit = !isUnlimited && percentage >= 80;

  return (
    <div>
      <div className="flex justify-between text-sm mb-2">
        <span className="text-slate-600">{label}</span>
        <span className={cn("font-medium", isNearLimit ? "text-amber-600" : "text-slate-900")}>
          {current} / {isUnlimited ? '∞' : limit}
        </span>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            isNearLimit ? "bg-amber-500" : "bg-cyan-500"
          )}
          style={{ width: isUnlimited ? '10%' : `${percentage}%` }}
        />
      </div>
      {isNearLimit && (
        <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
          <TrendingUp className="w-3 h-3" />
          Approaching limit - consider upgrading
        </p>
      )}
    </div>
  );
}
