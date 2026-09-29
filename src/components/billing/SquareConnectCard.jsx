import { useCallback, useEffect, useRef, useState } from 'react';
import { useAction, useMutation, useQuery } from 'convex/react';
import { CheckCircle2, CreditCard, Loader2, RefreshCw, Unlink, XCircle } from 'lucide-react';
import { api } from '../../../convex/_generated/api';
import { Button } from '@/components/ui/button';

const STATE_COPY = {
  not_connected: {
    label: 'Not connected',
    badge: 'bg-surface-2 text-ink-secondary',
    message: 'Connect your Square account so customer invoice and deposit payments go straight to your business.',
    cta: 'Connect Square',
  },
  needs_reconnect: {
    label: 'Needs attention',
    badge: 'bg-[var(--status-watch-soft)] text-watch',
    message: 'Square needs to be reconnected (or needs an active card-processing location) before you can accept card payments.',
    cta: 'Reconnect Square',
  },
  connected: {
    label: 'Connected',
    badge: 'bg-[var(--status-ok-soft)] text-ok',
    message: 'Card payments from your customers are deposited into your Square account.',
    cta: 'Reconnect Square',
  },
};

const ERROR_COPY = {
  access_denied: 'Square connection was cancelled.',
  expired_state: 'The Square connection link expired. Please try again.',
  unknown_state: 'The Square connection link is no longer valid. Please try again.',
  invalid_state: 'The Square connection link is no longer valid. Please try again.',
  not_authorized: 'Only business owners and admins can connect Square.',
  merchant_in_use: 'That Square account is already connected to another ChemCheck business.',
  no_card_location: 'Your Square account has no active US location that accepts cards.',
};

function readReturnParams() {
  if (typeof window === 'undefined') return { result: null, reason: null };
  try {
    const params = new URLSearchParams(window.location.search);
    return { result: params.get('square_connect'), reason: params.get('reason') };
  } catch {
    return { result: null, reason: null };
  }
}

function clearReturnParams() {
  if (typeof window === 'undefined' || !window.history?.replaceState) return;
  const url = new URL(window.location.href);
  url.searchParams.delete('square_connect');
  url.searchParams.delete('reason');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

/**
 * Square seller connection (OAuth) for the current business.
 * Customer invoice/deposit payments require a connected Square account.
 */
export function SquareConnectCard() {
  const status = useQuery(api.squareConnect.getSquareConnectStatus);
  const createAuthorizeUrl = useMutation(api.squareConnect.createAuthorizeUrl);
  const refreshConnection = useAction(api.squareConnect.refreshConnection);
  const disconnect = useAction(api.squareConnect.disconnect);

  const [pending, setPending] = useState(null);
  const [error, setError] = useState('');
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const handledReturn = useRef(false);

  const run = useCallback(async (kind, fn) => {
    setPending(kind);
    setError('');
    try {
      return await fn();
    } catch (err) {
      setError(err?.message || 'Something went wrong talking to Square.');
      return null;
    } finally {
      setPending(null);
    }
  }, []);

  // Returning from Square OAuth (?square_connect=return|error&reason=...).
  useEffect(() => {
    if (handledReturn.current || status === undefined) return;
    const { result, reason } = readReturnParams();
    if (result !== 'return' && result !== 'error') return;
    handledReturn.current = true;
    clearReturnParams();
    if (result === 'error') {
      setError(ERROR_COPY[reason] || 'Square could not be connected. Please try again.');
    }
  }, [status]);

  const handleConnect = async () => {
    const result = await run('connect', () => createAuthorizeUrl({}));
    if (result?.url) window.location.assign(result.url);
  };

  const handleRefresh = () => run('refresh', () => refreshConnection({}));

  const handleDisconnect = async () => {
    const result = await run('disconnect', () => disconnect({}));
    if (result) setConfirmingDisconnect(false);
  };

  if (status === undefined) {
    return (
      <div className="rounded-lg border border-line p-4 text-sm text-ink-secondary">Loading Square payments status...</div>
    );
  }
  if (status === null) return null;

  const copy = STATE_COPY[status.state] || STATE_COPY.not_connected;
  const isConnected = status.state === 'connected';

  return (
    <div className="rounded-lg border border-line p-4 space-y-3" data-testid="square-connect-card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <CreditCard className="w-4 h-4 mt-1 text-ink-secondary" aria-hidden="true" />
          <div>
            <p className="font-medium text-ink">Customer card payments</p>
            <p className="text-xs text-ink-secondary mt-1">{copy.message}</p>
          </div>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${copy.badge}`}>
          {isConnected ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
          {copy.label}
        </span>
      </div>

      {status.connected && (
        <p className="text-xs text-ink-muted">
          Square merchant {status.merchant_id || 'connected'}
          {status.location_name ? ` · Location: ${status.location_name}` : ''}
        </p>
      )}

      {error && <p className="text-xs text-critical" role="alert">{error}</p>}

      {status.can_manage ? (
        <div className="flex flex-wrap items-center gap-2">
          {(!isConnected || !status.connected) && (
            <Button type="button" size="sm" onClick={handleConnect} disabled={pending !== null}>
              {pending === 'connect' ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
              {copy.cta}
            </Button>
          )}
          {status.connected && (
            <Button type="button" variant="outline" size="sm" onClick={handleRefresh} disabled={pending !== null}>
              {pending === 'refresh'
                ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
              Refresh status
            </Button>
          )}
          {status.connected && (confirmingDisconnect ? (
            <>
              <Button type="button" variant="outline" size="sm" onClick={handleDisconnect} disabled={pending !== null}>
                {pending === 'disconnect' ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
                Confirm disconnect
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmingDisconnect(false)}>
                Keep connected
              </Button>
            </>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={() => setConfirmingDisconnect(true)} disabled={pending !== null}>
              <Unlink className="w-3.5 h-3.5 mr-1.5" />
              Disconnect
            </Button>
          ))}
        </div>
      ) : (
        <p className="text-xs text-ink-muted">Only business owners and admins can manage Square payments.</p>
      )}
    </div>
  );
}

export default SquareConnectCard;
