import { useCallback, useEffect, useRef, useState } from 'react';
import { useAction, useQuery } from 'convex/react';
import { CheckCircle2, CreditCard, ExternalLink, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { api } from '../../../convex/_generated/api';
import { Button } from '@/components/ui/button';

const STATE_COPY = {
  not_connected: {
    label: 'Not connected',
    badge: 'bg-surface-2 text-ink-secondary',
    message: 'Connect a Stripe account so customer invoice and deposit payments go straight to your business.',
    cta: 'Connect Stripe',
  },
  onboarding_incomplete: {
    label: 'Onboarding incomplete',
    badge: 'bg-[var(--status-watch-soft)] text-watch',
    message: 'Stripe needs more information before you can accept card payments.',
    cta: 'Continue onboarding',
  },
  active: {
    label: 'Active',
    badge: 'bg-[var(--status-ok-soft)] text-ok',
    message: 'Card payments from your customers are deposited into your Stripe account.',
    cta: 'Update Stripe details',
  },
};

function readConnectReturnParam() {
  if (typeof window === 'undefined') return null;
  try {
    return new URLSearchParams(window.location.search).get('stripe_connect');
  } catch {
    return null;
  }
}

function clearConnectReturnParam() {
  if (typeof window === 'undefined' || !window.history?.replaceState) return;
  const url = new URL(window.location.href);
  url.searchParams.delete('stripe_connect');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

/**
 * Stripe Connect status + onboarding for the current business.
 * Customer invoice/deposit payments require an active connected account.
 */
export function StripeConnectCard() {
  const status = useQuery(api.stripeConnect.getConnectStatus);
  const createOnboardingLink = useAction(api.stripeConnect.createOnboardingLink);
  const refreshAccountStatus = useAction(api.stripeConnect.refreshAccountStatus);
  const createDashboardLink = useAction(api.stripeConnect.createDashboardLink);

  const [pending, setPending] = useState(null);
  const [error, setError] = useState('');
  const handledReturn = useRef(false);

  const run = useCallback(async (kind, fn) => {
    setPending(kind);
    setError('');
    try {
      return await fn();
    } catch (err) {
      setError(err?.message || 'Something went wrong talking to Stripe.');
      return null;
    } finally {
      setPending(null);
    }
  }, []);

  const handleRefresh = useCallback(
    () => run('refresh', () => refreshAccountStatus({})),
    [run, refreshAccountStatus],
  );

  // Returning from Stripe onboarding (?stripe_connect=return|refresh): sync status once.
  useEffect(() => {
    if (handledReturn.current || !status?.can_manage) return;
    const param = readConnectReturnParam();
    if (param !== 'return' && param !== 'refresh') return;
    handledReturn.current = true;
    clearConnectReturnParam();
    if (status.connected) handleRefresh();
  }, [status, handleRefresh]);

  const handleConnect = async () => {
    const result = await run('connect', () => createOnboardingLink({}));
    if (result?.url) window.location.assign(result.url);
  };

  const handleDashboard = async () => {
    const result = await run('dashboard', () => createDashboardLink({}));
    if (result?.url) window.open(result.url, '_blank', 'noopener,noreferrer');
  };

  if (status === undefined) {
    return (
      <div className="rounded-lg border border-line p-4 text-sm text-ink-secondary">Loading Stripe payments status...</div>
    );
  }
  if (status === null) return null;

  const copy = STATE_COPY[status.state] || STATE_COPY.not_connected;
  const isActive = status.state === 'active';

  return (
    <div className="rounded-lg border border-line p-4 space-y-3" data-testid="stripe-connect-card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <CreditCard className="w-4 h-4 mt-1 text-ink-secondary" aria-hidden="true" />
          <div>
            <p className="font-medium text-ink">Customer card payments</p>
            <p className="text-xs text-ink-secondary mt-1">{copy.message}</p>
          </div>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${copy.badge}`}>
          {isActive ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
          {copy.label}
        </span>
      </div>

      {status.connected && (
        <p className="text-xs text-ink-muted">
          Charges {status.charges_enabled ? 'enabled' : 'disabled'} · Payouts {status.payouts_enabled ? 'enabled' : 'disabled'}
        </p>
      )}

      {error && <p className="text-xs text-critical" role="alert">{error}</p>}

      {status.can_manage ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" onClick={handleConnect} disabled={pending !== null}>
            {pending === 'connect' ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
            {copy.cta}
          </Button>
          {status.connected && (
            <Button type="button" variant="outline" size="sm" onClick={handleRefresh} disabled={pending !== null}>
              {pending === 'refresh'
                ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
              Refresh status
            </Button>
          )}
          {status.details_submitted && (
            <Button type="button" variant="outline" size="sm" onClick={handleDashboard} disabled={pending !== null}>
              {pending === 'dashboard'
                ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                : <ExternalLink className="w-3.5 h-3.5 mr-1.5" />}
              Stripe dashboard
            </Button>
          )}
        </div>
      ) : (
        <p className="text-xs text-ink-muted">Only business owners and admins can manage Stripe payments.</p>
      )}
    </div>
  );
}

export default StripeConnectCard;
