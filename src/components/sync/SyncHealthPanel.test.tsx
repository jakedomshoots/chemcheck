import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
// @ts-expect-error SyncHealthPanel is an untyped .jsx module.
import { SyncHealthPanel } from './SyncHealthPanel';
import { syncService } from '@/lib/sync/SyncService';
import { useSyncState } from '@/hooks/useSyncState';
import { db } from '@/db/chemcheck-db';

vi.mock('@/lib/sync/SyncService', () => ({
  syncService: {
    getHealthSnapshot: vi.fn(),
    retryDeadLetter: vi.fn(),
    retryAllDeadLetters: vi.fn(),
    discardDeadLetter: vi.fn(),
    resetPullState: vi.fn(),
  },
}));

vi.mock('@/hooks/useSyncState', () => ({
  useSyncState: vi.fn(),
}));

vi.mock('@/db/chemcheck-db', () => ({
  db: {
    customers: { get: vi.fn() },
    serviceLogs: { get: vi.fn() },
    notes: { get: vi.fn() },
  },
}));

const deadServiceLog = {
  table: 'serviceLogs',
  localId: 7,
  operation: 'create',
  data: { service_date: '2026-09-28', customer_id: 3 },
  retryCount: 3,
  lastAttempt: Date.now() - 60_000,
  deadAt: Date.now() - 60_000,
  error: 'Pool abc not found',
  priority: 40,
  revision: 'r1',
  status: 'dead',
};

const deadNote = {
  table: 'notes',
  localId: 9,
  operation: 'update',
  data: { title: 'Queued title' },
  retryCount: 3,
  lastAttempt: Date.now() - 5 * 60_000,
  deadAt: Date.now() - 5 * 60_000,
  error: "Access denied: cannot update another user's note",
  priority: 41,
  revision: 'r2',
  status: 'dead',
};

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    online: true,
    status: 'idle',
    scope: 'tech@example.com',
    initialized: true,
    lastSuccessfulSyncAt: Date.now() - 3 * 60_000,
    lastSyncFailure: undefined,
    pending: 0,
    deadLetter: [],
    pullState: { since: Date.now() - 120_000, cursor: null },
    ...overrides,
  };
}

function mockSyncState(overrides: Record<string, unknown> = {}) {
  const state = {
    status: 'idle',
    pendingCount: 0,
    lastSyncAt: null,
    error: null,
    syncNow: vi.fn().mockResolvedValue(undefined),
    isRecordSynced: vi.fn(),
    getRecordSyncStatus: vi.fn(),
    refreshPendingCount: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  (useSyncState as any).mockReturnValue(state);
  return state;
}

describe('SyncHealthPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (syncService.getHealthSnapshot as any).mockReturnValue(snapshot());
    (syncService.retryDeadLetter as any).mockResolvedValue(true);
    (syncService.retryAllDeadLetters as any).mockResolvedValue(2);
    (syncService.discardDeadLetter as any).mockResolvedValue(true);
    (db.serviceLogs.get as any).mockResolvedValue({ id: 7, service_date: '2026-09-28', customer_id: 3 });
    (db.customers.get as any).mockResolvedValue({ id: 3, full_name: 'Alice Smith' });
    (db.notes.get as any).mockResolvedValue(undefined);
    mockSyncState();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows connection, last successful sync, pending count and the pull watermark', async () => {
    mockSyncState({ pendingCount: 4 });
    render(<SyncHealthPanel />);

    expect(screen.getByTestId('sync-health-connection')).toHaveTextContent('Online');
    expect(screen.getByTestId('sync-health-last-success')).toHaveTextContent('3 min ago');
    expect(screen.getByTestId('sync-health-pending')).toHaveTextContent('4');
    expect(screen.getByTestId('sync-health-pull-state')).toHaveTextContent('Pulled through 2 min ago');
    expect(screen.getByText('Nothing is stuck. Every change will sync automatically.')).toBeInTheDocument();
    expect(screen.getByTestId('sync-health-dead-count')).toHaveTextContent('0');
    expect(screen.getByRole('button', { name: 'Retry all' })).toBeDisabled();
  });

  it('shows offline state and disables Sync Now while offline', () => {
    (syncService.getHealthSnapshot as any).mockReturnValue(snapshot({ online: false, status: 'offline', lastSuccessfulSyncAt: null }));
    mockSyncState({ status: 'offline' });
    render(<SyncHealthPanel />);

    expect(screen.getByTestId('sync-health-connection')).toHaveTextContent('Offline');
    expect(screen.getByTestId('sync-health-last-success')).toHaveTextContent('Never');
    expect(screen.getByRole('button', { name: 'Sync Now' })).toBeDisabled();
  });

  it('lists dead-letter items with a human label and a plain-English reason', async () => {
    (syncService.getHealthSnapshot as any).mockReturnValue(snapshot({
      deadLetter: [deadServiceLog, deadNote],
      lastSyncFailure: 'Pool abc not found',
    }));
    render(<SyncHealthPanel />);

    const items = await screen.findAllByTestId('dead-letter-item');
    expect(items).toHaveLength(2);

    await waitFor(() => {
      expect(within(items[0]).getByText('Service on 2026-09-28 · Alice Smith')).toBeInTheDocument();
    });
    expect(within(items[0]).getByText("The pool for this log hasn't synced yet")).toBeInTheDocument();
    expect(within(items[0]).getByText(/Service log · create · failed 1 min ago/)).toBeInTheDocument();

    // The note row has no local record any more, so the queued payload is used.
    expect(within(items[1]).getByText('Queued title')).toBeInTheDocument();
    expect(within(items[1]).getByText('This record belongs to another account')).toBeInTheDocument();

    expect(screen.getByTestId('sync-health-dead-count')).toHaveTextContent('2');
    expect(screen.getByTestId('sync-health-last-failure')).toHaveTextContent("Last failure: The pool for this log hasn't synced yet");
  });

  it('retries and discards individual items through the sync service', async () => {
    (syncService.getHealthSnapshot as any).mockReturnValue(snapshot({ deadLetter: [deadServiceLog] }));
    const state = mockSyncState();
    render(<SyncHealthPanel />);

    await screen.findAllByTestId('dead-letter-item');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry Service on 2026-09-28 · Alice Smith' })).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Retry Service on 2026-09-28 · Alice Smith' }));
    expect(syncService.retryDeadLetter).toHaveBeenCalledWith('serviceLogs', 7);
    await screen.findByText('Retrying now');
    expect(state.refreshPendingCount).toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Discard Service on 2026-09-28 · Alice Smith' }));
    expect(syncService.discardDeadLetter).toHaveBeenCalledWith('serviceLogs', 7);
    await screen.findByText('Kept on this device only');
  });

  it('retries everything with the Retry all button', async () => {
    (syncService.getHealthSnapshot as any).mockReturnValue(snapshot({ deadLetter: [deadServiceLog, deadNote] }));
    render(<SyncHealthPanel />);
    await screen.findAllByTestId('dead-letter-item');

    const retryAll = screen.getByRole('button', { name: 'Retry all' });
    expect(retryAll).not.toBeDisabled();
    await userEvent.click(retryAll);

    expect(syncService.retryAllDeadLetters).toHaveBeenCalledTimes(1);
    await screen.findByText('Retrying 2 records');
  });

  it('runs Sync Now through the shared sync state hook', async () => {
    const state = mockSyncState({ pendingCount: 1 });
    render(<SyncHealthPanel />);

    await userEvent.click(screen.getByRole('button', { name: 'Sync Now' }));
    expect(state.syncNow).toHaveBeenCalledTimes(1);
  });

  it('asks for confirmation before forcing a full re-sync, then resets the watermark and syncs', async () => {
    const state = mockSyncState();
    render(<SyncHealthPanel />);

    await userEvent.click(screen.getByRole('button', { name: 'Force full re-sync' }));
    expect(syncService.resetPullState).not.toHaveBeenCalled();
    expect(screen.getByText(/This re-downloads every record for this account/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText(/This re-downloads every record/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Force full re-sync' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, re-sync everything' }));

    expect(syncService.resetPullState).toHaveBeenCalledTimes(1);
    expect(state.syncNow).toHaveBeenCalledTimes(1);
    await screen.findByText('Full re-sync started');
  });

  it('does not trigger a sync after resetting the watermark while offline', async () => {
    (syncService.getHealthSnapshot as any).mockReturnValue(snapshot({ online: false, status: 'offline' }));
    const state = mockSyncState({ status: 'offline' });
    render(<SyncHealthPanel />);

    await userEvent.click(screen.getByRole('button', { name: 'Force full re-sync' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, re-sync everything' }));

    expect(syncService.resetPullState).toHaveBeenCalledTimes(1);
    expect(state.syncNow).not.toHaveBeenCalled();
  });

  it('surfaces action failures instead of swallowing them', async () => {
    (syncService.getHealthSnapshot as any).mockReturnValue(snapshot({ deadLetter: [deadNote] }));
    (syncService.retryDeadLetter as any).mockRejectedValue(new Error('Cannot sync while offline'));
    render(<SyncHealthPanel />);
    await screen.findAllByTestId('dead-letter-item');

    await userEvent.click(screen.getByRole('button', { name: 'Retry Queued title' }));
    await screen.findByText('Cannot sync while offline');
  });
});
