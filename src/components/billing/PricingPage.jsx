import { useState } from 'react';
import { Check, Zap, Building2, Rocket, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { SUBSCRIPTION_PLANS, formatPrice, getAnnualPrice } from '@/lib/stripe';
import { useSubscription } from '@/hooks/useSubscription';
import { getPlatform, isNativePlatform } from '@/lib/native/platform';
import { cn } from '@/lib/utils';

const planIcons = {
  starter: Zap,
  professional: Rocket,
  business: Building2,
};

export function PricingPage() {
  const [isAnnual, setIsAnnual] = useState(false);
  const [loadingPlan, setLoadingPlan] = useState(null);
  const {
    subscription,
    error,
    createCheckoutSession,
  } = useSubscription();
  const isNativeIos = isNativePlatform() && getPlatform() === 'ios';

  const handleSelectPlan = async (planId) => {
    if (isNativeIos) return;

    setLoadingPlan(planId);
    try {
      await createCheckoutSession(planId, isAnnual);
    } catch (err) {
      console.error('Checkout error:', err);
    } finally {
      setLoadingPlan(null);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-surface-0 text-ink">
      <div
        className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_18%_12%,rgba(8,145,178,0.16),transparent_32%),radial-gradient(circle_at_82%_18%,rgba(14,116,144,0.12),transparent_28%),linear-gradient(180deg,#f8fdff_0%,#eef8f9_55%,#f8fbfc_100%)]"
        aria-hidden="true"
      />
      <div className="pointer-events-none fixed inset-0 -z-10 opacity-[0.05] [background-image:linear-gradient(rgba(15,23,42,0.75)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.75)_1px,transparent_1px)] [background-size:44px_44px]" />
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-12 text-center">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-brand-ink">
            Pricing
          </p>
          <h1 className="mx-auto max-w-3xl text-balance text-4xl font-semibold tracking-[-0.05em] text-ink sm:text-5xl">
            Simple, transparent pricing
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base font-medium leading-7 text-ink-secondary">
            {isNativeIos
              ? 'ChemCheck for iOS is available for existing workspaces. Plan selection is unavailable in this iOS build.'
              : 'Choose the plan that fits your pool service business. All plans include a 14-day free trial.'}
          </p>

          {/* Billing Toggle */}
          {!isNativeIos && (
            <div className="mt-8 flex items-center justify-center gap-4">
              <span className={cn("text-sm font-semibold", !isAnnual ? "text-ink" : "text-ink-muted")}>
                Monthly
              </span>
              <Switch
                checked={isAnnual}
                onCheckedChange={setIsAnnual}
              />
              <span className={cn("text-sm font-semibold", isAnnual ? "text-ink" : "text-ink-muted")}>
                Annual
                <span className="ml-2 inline-flex items-center rounded-full bg-brand-softer px-2.5 py-0.5 text-xs font-semibold uppercase tracking-[0.14em] text-brand-ink">
                  Save 20%
                </span>
              </span>
            </div>
          )}
        </div>

        {/* Pricing Cards */}
        <div className="grid items-stretch gap-6 md:grid-cols-3 md:gap-7">
          {Object.entries(SUBSCRIPTION_PLANS).map(([planId, plan]) => {
            const Icon = planIcons[planId];
            const isCurrentPlan = subscription?.planId === planId;
            const monthlyPrice = plan.price;
            const displayPrice = isAnnual
              ? Math.round(getAnnualPrice(monthlyPrice) / 12)
              : monthlyPrice;

            return (
              <div
                key={planId}
                className={cn(
                  "relative flex flex-col rounded-sheet border bg-surface-1 p-6 shadow-card transition-all duration-300 hover:-translate-y-1 hover:bg-surface-1",
                  plan.popular
                    ? "border-[var(--status-info-line)] ring-1 ring-cyan-300/40"
                    : "border-line"
                )}
              >
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="inline-flex items-center rounded-full bg-brand px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-white shadow-cta">
                      Most Popular
                    </span>
                  </div>
                )}

                <div className="mb-6">
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-softer text-brand-ink">
                    <Icon className="h-6 w-6" aria-hidden="true" />
                  </div>
                  <h3 className="text-xl font-semibold tracking-[-0.025em] text-ink">{plan.name}</h3>
                  <div className="mt-4 flex items-baseline gap-1">
                    <span className="text-4xl font-semibold tracking-[-0.04em] text-ink">
                      {formatPrice(displayPrice)}
                    </span>
                    <span className="text-sm font-medium text-ink-muted">/month</span>
                  </div>
                  {isAnnual && (
                    <p className="mt-1 text-sm font-medium text-brand-ink">
                      {formatPrice(getAnnualPrice(monthlyPrice))}/year billed annually
                    </p>
                  )}
                </div>

                <ul className="mb-8 flex-grow space-y-3">
                  {plan.features.map((feature, idx) => (
                    <li key={idx} className="flex items-start gap-3 text-sm font-medium leading-6 text-ink-secondary">
                      <Check className="mt-0.5 h-5 w-5 shrink-0 text-brand-ink" aria-hidden="true" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>

                <Button
                  onClick={() => handleSelectPlan(planId)}
                  disabled={isNativeIos || loadingPlan || isCurrentPlan}
                  className={cn(
                    "h-11 w-full rounded-full px-6 font-semibold shadow-cta focus-visible:ring-2 focus-visible:ring-ring",
                    plan.popular
                      ? "bg-brand text-white hover:bg-brand-strong"
                      : "bg-ink text-surface-0 hover:bg-brand-strong"
                  )}
                >
                  {loadingPlan === planId ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : isCurrentPlan ? (
                    "Current Plan"
                  ) : isNativeIos ? (
                    "Plan changes are handled outside the iOS app"
                  ) : (
                    "Start Free Trial"
                  )}
                </Button>
              </div>
            );
          })}
        </div>

        {error && (
          <div className="mt-6 rounded-2xl border border-[var(--status-critical-line)] bg-[var(--status-critical-soft)] p-4 text-center text-sm font-medium text-critical shadow-sm">
            {error}
          </div>
        )}

        {/* FAQ Section */}
        {!isNativeIos && (
          <div className="mx-auto mt-16 max-w-3xl">
            <div className="mb-8 text-center">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-brand-ink">
                FAQ
              </p>
              <h2 className="text-balance text-3xl font-semibold tracking-[-0.045em] text-ink sm:text-4xl">
                Frequently asked questions
              </h2>
            </div>

            <div className="grid gap-3">
              {[
                {
                  q: 'Can I change plans later?',
                  a: 'Yes. Upgrade or downgrade at any time. Changes take effect immediately and we prorate your billing.',
                },
                {
                  q: 'What happens after my trial ends?',
                  a: 'After your 14-day trial, you are charged for the selected plan. Cancel anytime before the trial ends to avoid charges.',
                },
                {
                  q: 'Is my data secure?',
                  a: 'Yes. We use industry-standard encryption and security practices. Data is stored securely and never shared with third parties.',
                },
                {
                  q: 'Do you offer refunds?',
                  a: 'Yes. We offer a 30-day money-back guarantee. If you are not satisfied, contact us for a full refund.',
                },
              ].map((item) => (
                <details
                  key={item.q}
                  className="group rounded-2xl border border-line bg-surface-1 p-4 shadow-card open:shadow-card"
                >
                  <summary className="cursor-pointer list-none text-sm font-semibold tracking-[-0.02em] text-ink marker:hidden">
                    {item.q}
                  </summary>
                  <p className="mt-2 text-sm font-medium leading-6 text-ink-secondary">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        )}

        {/* Contact CTA */}
        <div className="mt-16 text-center">
          <p className="text-sm font-medium text-ink-secondary">
            Need a custom plan for your enterprise?{' '}
            <a
              href="mailto:sales@chemcheck.app"
              className="font-semibold text-brand-ink underline-offset-4 transition-colors hover:text-brand-ink hover:underline"
            >
              Contact our sales team
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
