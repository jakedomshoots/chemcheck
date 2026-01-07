import { useState } from 'react';
import { Check, Zap, Building2, Rocket, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { SUBSCRIPTION_PLANS, formatPrice, getAnnualPrice, isStripeConfigured } from '@/lib/stripe';
import { useSubscription } from '@/hooks/useSubscription';
import { cn } from '@/lib/utils';

const planIcons = {
  starter: Zap,
  professional: Rocket,
  business: Building2,
};

export function PricingPage() {
  const [isAnnual, setIsAnnual] = useState(false);
  const [loadingPlan, setLoadingPlan] = useState(null);
  const { subscription, isActive, createCheckoutSession } = useSubscription();

  const handleSelectPlan = async (planId) => {
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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-cyan-50 py-12 px-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-slate-900 mb-4">
            Simple, Transparent Pricing
          </h1>
          <p className="text-lg text-slate-600 max-w-2xl mx-auto">
            Choose the plan that fits your pool service business. All plans include a 14-day free trial.
          </p>

          {/* Billing Toggle */}
          <div className="flex items-center justify-center gap-4 mt-8">
            <span className={cn("text-sm font-medium", !isAnnual ? "text-slate-900" : "text-slate-500")}>
              Monthly
            </span>
            <Switch
              checked={isAnnual}
              onCheckedChange={setIsAnnual}
            />
            <span className={cn("text-sm font-medium", isAnnual ? "text-slate-900" : "text-slate-500")}>
              Annual
              <span className="ml-2 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                Save 20%
              </span>
            </span>
          </div>
        </div>

        {/* Demo Mode Notice */}
        {!isStripeConfigured() && (
          <div className="mb-8 p-4 bg-amber-50 border border-amber-200 rounded-lg text-center">
            <p className="text-amber-800">
              <strong>Demo Mode:</strong> Stripe is not configured. Selecting a plan will start a simulated 14-day trial.
            </p>
          </div>
        )}

        {/* Pricing Cards */}
        <div className="grid md:grid-cols-3 gap-8">
          {Object.entries(SUBSCRIPTION_PLANS).map(([planId, plan]) => {
            const Icon = planIcons[planId];
            const isCurrentPlan = subscription?.planId === planId;
            const monthlyPrice = plan.price;
            const displayPrice = isAnnual 
              ? Math.round(getAnnualPrice(monthlyPrice) / 12) 
              : monthlyPrice;

            return (
              <Card
                key={planId}
                className={cn(
                  "relative p-6 flex flex-col",
                  plan.popular && "border-2 border-cyan-500 shadow-lg scale-105"
                )}
              >
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white text-xs font-semibold px-3 py-1 rounded-full">
                      Most Popular
                    </span>
                  </div>
                )}

                <div className="mb-6">
                  <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center mb-4">
                    <Icon className="w-6 h-6 text-slate-700" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-900">{plan.name}</h3>
                  <div className="mt-4">
                    <span className="text-4xl font-bold text-slate-900">
                      {formatPrice(displayPrice)}
                    </span>
                    <span className="text-slate-500">/month</span>
                  </div>
                  {isAnnual && (
                    <p className="text-sm text-green-600 mt-1">
                      {formatPrice(getAnnualPrice(monthlyPrice))}/year billed annually
                    </p>
                  )}
                </div>

                <ul className="space-y-3 mb-8 flex-grow">
                  {plan.features.map((feature, idx) => (
                    <li key={idx} className="flex items-start gap-3">
                      <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                      <span className="text-slate-600 text-sm">{feature}</span>
                    </li>
                  ))}
                </ul>

                <Button
                  onClick={() => handleSelectPlan(planId)}
                  disabled={loadingPlan || isCurrentPlan}
                  className={cn(
                    "w-full",
                    plan.popular
                      ? "bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700"
                      : ""
                  )}
                  variant={plan.popular ? "default" : "outline"}
                >
                  {loadingPlan === planId ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : isCurrentPlan ? (
                    "Current Plan"
                  ) : (
                    "Start Free Trial"
                  )}
                </Button>
              </Card>
            );
          })}
        </div>

        {/* FAQ Section */}
        <div className="mt-16 max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold text-slate-900 text-center mb-8">
            Frequently Asked Questions
          </h2>
          
          <div className="space-y-6">
            <div>
              <h3 className="font-semibold text-slate-900 mb-2">
                Can I change plans later?
              </h3>
              <p className="text-slate-600">
                Yes! You can upgrade or downgrade your plan at any time. Changes take effect immediately, and we'll prorate your billing.
              </p>
            </div>
            
            <div>
              <h3 className="font-semibold text-slate-900 mb-2">
                What happens after my trial ends?
              </h3>
              <p className="text-slate-600">
                After your 14-day trial, you'll be charged for your selected plan. You can cancel anytime before the trial ends to avoid charges.
              </p>
            </div>
            
            <div>
              <h3 className="font-semibold text-slate-900 mb-2">
                Is my data secure?
              </h3>
              <p className="text-slate-600">
                Absolutely. We use industry-standard encryption and security practices. Your data is stored securely and never shared with third parties.
              </p>
            </div>
            
            <div>
              <h3 className="font-semibold text-slate-900 mb-2">
                Do you offer refunds?
              </h3>
              <p className="text-slate-600">
                We offer a 30-day money-back guarantee. If you're not satisfied, contact us for a full refund.
              </p>
            </div>
          </div>
        </div>

        {/* Contact CTA */}
        <div className="mt-16 text-center">
          <p className="text-slate-600">
            Need a custom plan for your enterprise?{' '}
            <a href="mailto:sales@chemcheck.app" className="text-cyan-600 hover:text-cyan-700 font-medium">
              Contact our sales team
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

export default PricingPage;
