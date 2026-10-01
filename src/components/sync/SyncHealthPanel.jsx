import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle, Clock, RefreshCw, RotateCcw, Trash2, Wifi, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { syncService } from '@/lib/sync/SyncService';
import { db } from '@/db/chemcheck-db';
import { useSyncState } from '@/hooks/useSyncState';
import { cn } from '@/lib/utils';
import { isSyncButtonDisabled, getStatusText } from './syncStatusUtils';
import {
  describePullState,
  describeQueueItem,
  describeSyncError,
  formatRelativeTime,
  getTableLabel,
} from './syncHealthUtils';

const REFRESH_INTERVAL_MS = 10_000;

function emptySnapshot() {
  return {
    online: typeof navigator !== 'undefined' ? navigator.onLine : true,
    status: 'idle',
    scope: 'anonymous',
    initialized: false,
    lastSuccessfulSyncAt: null,
    lastSyncFailure: undefined,
    pending: 0,
    deadLetter: [],
    pullState: { since: 0, cursor: null },
  };
}

function readSnapshot() {
  try {
    if (typeof syncService?.getHealthSnapshot === 'function') {
      return { ...emptySnapshot(), ...syncService.getHealthSnapshot() };
    }
  } catch (error) {
    console.error('Failed to read sync health snapshot:', error);
  }
  return emptySnapshot();
}

/**
 * Look up the local rows behind each dead-letter item so the list can show
 * "Alice Smith" instead of "customers[12]". Best effort: a missing row falls
 * back to the queued payload.
 */
async function loadDeadLetterLabels(items) {
  const labels = {};
  for (const item of items) {
    const key = `${item.table}:${item.localId}`;
    let record = null;
    let customerName = null;
    try {
      const table = db?.[item.table];
      record = table && typeof table.get === 'function' ? await table.get(item.localId) : null;
      const customerId = record?.customer_id ?? item.data?.customer_id;
      if (item.table !== 'customers' && customerId !== undefined && customerId !== null && db?.customers?.get) {
        const customer = await db.customers.get(customerId);
        customerName = customer?.full_name || null;
      }
    } catch {
      // Fall back to the queued payload below.
    }
    labels[key] = describeQueueItem(item, record, customerName);
  }
  return labels;
}

function DeadLetterRow({ item, label, busy, onRetry, onDiscard }) {
  const explanation = describeSyncError(item.error);
  return (
    <li
      data-testid="dead-letter-item"
      className="rounded-md border border-[var(--status-critical-line)] bg-[var(--status-critical-soft)] p-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{label}</p>
          <p className="text-xs text-ink-muted">
            {getTableLabel(item.table)} · {item.operation} · failed {formatRelativeTime(item.deadAt || item.lastAttempt)}
          </p>
        </div>
        <Badge variant="outline" className="shrink-0 text-xs text-critical border-[var(--status-critical-line)]">
          {item.retryCount} {item.retryCount === 1 ? 'try' : 'tries'}
        </Badge>
      </div>
      <p className="mt-2 text-sm font-medium text-critical">{explanation.reason}</p>
      <p className="text-xs text-ink-secondary">{explanation.hint}</p>
      <div className="mt-3 flex gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          disabled={busy}
          onClick={onRetry}
          aria-label={`Retry ${label}`}
        >
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
          Retry
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 text-critical hover:text-critical"
          disabled={busy}
          onClick={onDiscard}
          aria-label={`Discard ${label}`}
        >
          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
          Discard
        </Button>
      </div>
    </li>
  );
}

/**
 * Diagnostics and recovery for the offline sync queue. Rendered inside the
 * drawer opened from SyncStatusIndicator, but has no dependency on it so it
 * can be embedded anywhere (settings, support screens).
 */
export function SyncHealthPanel({ className }) {
  const { status, pendingCount, syncNow, refreshPendingCount } = useSyncState();
  const [snapshot, setSnapshot] = useState(readSnapshot);
  const [labels, setLabels] = useState({});
  const [busyKey, setBusyKey] = useState(null);
  const [message, setMessage] = useState(null);
  const [confirmResync, setConfirmResync] = useState(false);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    const next = readSnapshot();
    if (!mountedRef.current) return;
    setSnapshot(next);
    if (next.deadLetter.length > 0) {
      const nextLabels = await loadDeadLetterLabels(next.deadLetter);
      if (mountedRef.current) setLabels(nextLabels);
    } else {
      setLabels({});
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    const interval = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [refresh]);

  // Re-read whenever the service changes state (a cycle just finished, we
  // went offline, ...), so the panel never shows stale counts.
  useEffect(() => {
    refresh();
    try {
      const maybePromise = refreshPendingCount?.();
      if (maybePromise && typeof maybePromise.catch === 'function') maybePromise.catch(() => {});
    } catch {
      // Count refresh is best effort; the periodic poll will catch up.
    }
  }, [status, refresh, refreshPendingCount]);

  const runAction = useCallback(async (key, action, successMessage) => {
    setBusyKey(key);
    setMessage(null);
    try {
      const result = await action();
      if (successMessage) setMessage({ tone: 'ok', text: typeof successMessage === 'function' ? successMessage(result) : successMessage });
    } catch (error) {
      setMessage({ tone: 'critical', text: error instanceof Error ? error.message : 'Action failed' });
    } finally {
      if (mountedRef.current) {
        setBusyKey(null);
        await refresh();
        try { await refreshPendingCount?.(); } catch { /* count refresh is best effort */ }
      }
    }
  }, [refresh, refreshPendingCount]);

  const handleSyncNow = () => runAction('sync', () => syncNow(), null);
  const handleRetry = (item) => runAction(
    `${item.table}:${item.localId}`,
    () => syncService.retryDeadLetter(item.table, item.localId),
    'Retrying now',
  );
  const handleDiscard = (item) => runAction(
    `${item.table}:${item.localId}`,
    () => syncService.discardDeadLetter(item.table, item.localId),
    'Kept on this device only',
  );
  const handleRetryAll = () => runAction(
    'retry-all',
    () => syncService.retryAllDeadLetters(),
    (count) => (count > 0 ? `Retrying ${count} ${count === 1 ? 'record' : 'records'}` : 'Nothing to retry'),
  );
  const handleForceResync = () => runAction(
    'resync',
    async () => {
      syncService.resetPullState();
      setConfirmResync(false);
      if (snapshot.online && !isSyncButtonDisabled(status)) {
        await syncNow();
      }
    },
    'Full re-sync started',
  );

  const deadLetter = snapshot.deadLetter || [];
  const busy = busyKey !== null;
  const lastSuccessText = useMemo(
    () => formatRelativeTime(snapshot.lastSuccessfulSyncAt),
    [snapshot.lastSuccessfulSyncAt],
  );
  const lastFailure = snapshot.lastSyncFailure ? describeSyncError(snapshot.lastSyncFailure) : null;

  return (
    <section className={cn('space-y-4', className)} aria-label="Sync health" data-testid="sync-health-panel">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-md border border-line bg-surface-2 p-2">
          <p className="text-xs uppercase tracking-wide text-ink-muted">Connection</p>
          <p className="flex items-center gap-1.5 text-sm font-semibold text-ink" data-testid="sync-health-connection">
            {snapshot.online
              ? <Wifi className="h-4 w-4 text-ok" aria-hidden="true" />
              : <WifiOff className="h-4 w-4 text-ink-muted" aria-hidden="true" />}
            {snapshot.online ? 'Online' : 'Offline'}
          </p>
        </div>
        <div className="rounded-md border border-line bg-surface-2 p-2">
          <p className="text-xs uppercase tracking-wide text-ink-muted">Status</p>
          <p className="text-sm font-semibold text-ink">{getStatusText(status, pendingCount)}</p>
        </div>
        <div className="rounded-md border border-line bg-surface-2 p-2">
          <p className="text-xs uppercase tracking-wide text-ink-muted">Last successful sync</p>
          <p className="text-sm font-semibold text-ink" data-testid="sync-health-last-success">{lastSuccessText}</p>
        </div>
        <div className="rounded-md border border-line bg-surface-2 p-2">
          <p className="text-xs uppercase tracking-wide text-ink-muted">Pending</p>
          <p className="text-sm font-semibold text-ink" data-testid="sync-health-pending">
            {pendingCount}
            {snapshot.pending !== pendingCount && (
              <span className="ml-1 text-xs font-normal text-ink-muted">({snapshot.pending} queued)</span>
            )}
          </p>
        </div>
      </div>

      {lastFailure && (
        <div
          className="rounded-md border border-[var(--status-watch-line)] bg-yellow-100 px-3 py-2 text-xs text-watch"
          data-testid="sync-health-last-failure"
        >
          <p className="font-semibold">Last failure: {lastFailure.reason}</p>
          <p className="text-ink-secondary">{snapshot.lastSyncFailure}</p>
        </div>
      )}

      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-9 flex-1"
          onClick={handleSyncNow}
          disabled={busy || isSyncButtonDisabled(status)}
        >
          <RefreshCw className={cn('mr-2 h-3.5 w-3.5', status === 'syncing' && 'animate-spin')} aria-hidden="true" />
          Sync Now
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-9 flex-1"
          onClick={handleRetryAll}
          disabled={busy || deadLetter.length === 0 || !snapshot.online}
        >
          <RotateCcw className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
          Retry all
        </Button>
      </div>

      {message && (
        <p
          role="status"
          className={cn(
            'rounded-md px-2 py-1 text-xs',
            message.tone === 'ok'
              ? 'bg-[var(--status-ok-soft)] text-ok'
              : 'bg-[var(--status-critical-soft)] text-critical',
          )}
        >
          {message.text}
        </p>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Needs attention</p>
          <Badge
            variant={deadLetter.length > 0 ? 'destructive' : 'secondary'}
            className="text-xs"
            data-testid="sync-health-dead-count"
          >
            {deadLetter.length}
          </Badge>
        </div>
        {deadLetter.length === 0 ? (
          <p className="flex items-center gap-2 rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-ink-secondary">
            <CheckCircle className="h-4 w-4 text-ok" aria-hidden="true" />
            Nothing is stuck. Every change will sync automatically.
          </p>
        ) : (
          <ul className="space-y-2" aria-label="Records that failed to sync">
            {deadLetter.map((item) => {
              const key = `${item.table}:${item.localId}`;
              return (
                <DeadLetterRow
                  key={key}
                  item={item}
                  label={labels[key] || describeQueueItem(item, null, null)}
                  busy={busy}
                  onRetry={() => handleRetry(item)}
                  onDiscard={() => handleDiscard(item)}
                />
              );
            })}
          </ul>
        )}
      </div>

      <div className="rounded-md border border-line p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Server pull</p>
            <p className="flex items-center gap-1.5 text-sm text-ink" data-testid="sync-health-pull-state">
              <Clock className="h-3.5 w-3.5 text-ink-muted" aria-hidden="true" />
              {describePullState(snapshot.pullState)}
            </p>
            <p className="text-xs text-ink-muted">Account: {snapshot.scope}</p>
          </div>
        </div>
        {confirmResync ? (
          <div className="mt-3 rounded-md border border-[var(--status-watch-line)] bg-yellow-100 p-2 text-xs text-ink">
            <p className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-watch" aria-hidden="true" />
              This re-downloads every record for this account. Unsynced local changes are kept and pushed first.
            </p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="destructive" className="h-8" disabled={busy} onClick={handleForceResync}>
                Yes, re-sync everything
              </Button>
              <Button size="sm" variant="ghost" className="h-8" disabled={busy} onClick={() => setConfirmResync(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="mt-3 h-8"
            disabled={busy}
            onClick={() => setConfirmResync(true)}
          >
            Force full re-sync
          </Button>
        )}
      </div>
    </section>
  );
}

export default SyncHealthPanel;
