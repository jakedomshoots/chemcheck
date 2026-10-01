import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncService } from './SyncService';
import { SyncQueue } from './SyncQueue';

/**
 * Sync health APIs used by the SyncHealthPanel: dead-letter retry/discard,
 * last-successful-sync bookkeeping, pull-state reset and the health snapshot.
 * Uses the real SyncQueue (persisted to the mocked localStorage) and a mocked
 * Dexie layer.
 */

const dbState = vi.hoisted(() => {
  const makeTable = () => ({
    rows: new Map<number, any>(),
    get: vi.fn(async function (this: any, id: number) { return this.rows.get(id); }),
    update: vi.fn(async function (this: any, id: number, changes: any) {
      const row = this.rows.get(id);
      if (!row) return 0;
      Object.assign(row, changes);
      return 1;
    }),
    where: vi.fn(() => ({ equals: vi.fn(() => ({ toArray: vi.fn(async () => []), count: vi.fn(async () => 0) })) })),
    toCollection: vi.fn(() => ({ toArray: vi.fn(async () => []) })),
  });
  return {
    customers: makeTable(),
    pools: makeTable(),
    equipment: makeTable(),
    serviceLogs: makeTable(),
    chemicalUsage: makeTable(),
    notes: makeTable(),
    saltCellLogs: makeTable(),
    withoutSyncHooks: vi.fn(async (op: () => Promise<unknown>) => op()),
    setSyncService: vi.fn(),
  };
});

vi.mock('@/db/chemcheck-db', () => ({ db: dbState }));

vi.mock('../../../convex/_generated/api', () => ({
  api: { sync: { syncCustomer: 'syncCustomer', pull: 'pull', deleteRecord: 'deleteRecord' } },
}));

vi.mock('@/lib/monitoring', () => ({
  monitoring: { recordMetric: vi.fn(), reportError: vi.fn() },
}));

function makeClient(overrides: Partial<{ mutation: any; query: any }> = {}) {
  return {
    mutation: vi.fn(async () => ({ success: true, convex_id: 'c1', local_id: 1, operation: 'create', updated_at: 123 })),
    query: vi.fn(async () => ({ hasMore: false, watermark: 1_000, customers: [] })),
    ...overrides,
  } as any;
}

function seedDead(service: SyncService, table: 'customers' | 'notes', localId: number, error: string) {
  const queue: SyncQueue = (service as any).syncQueue;
  queue.enqueue({ table, localId, operation: 'create', data: { id: localId } });
  const item = queue.findItem(table, localId)!;
  queue.markFailed(item, error);
  queue.markFailed(item, error);
  queue.markFailed(item, error);
  expect(queue.getDeadLetterItems()).toHaveLength(1);
  return item;
}

describe('SyncService health APIs', () => {
  let service: SyncService;

  beforeEach(() => {
    localStorage.clear();
    for (const table of ['customers', 'pools', 'equipment', 'serviceLogs', 'chemicalUsage', 'notes', 'saltCellLogs'] as const) {
      dbState[table].rows.clear();
      dbState[table].get.mockClear();
      dbState[table].update.mockClear();
    }
    service = new SyncService();
  });

  it('exposes dead-letter items, failure and pull state in getQueueStatus and getHealthSnapshot', () => {
    service.initialize(makeClient(), 'Tech@Example.com');
    seedDead(service, 'customers', 1, 'Access denied: cannot sync data for another user\'s customer');

    const status = service.getQueueStatus();
    expect(status.deadLetterCount).toBe(1);
    expect(status.deadLetter[0]).toMatchObject({ table: 'customers', localId: 1, status: 'dead' });
    expect(status.pending).toBe(0);
    expect(status.lastSuccessfulSyncAt).toBeNull();

    const snapshot = service.getHealthSnapshot();
    expect(snapshot).toMatchObject({
      online: true,
      status: 'idle',
      scope: 'tech@example.com',
      initialized: true,
      lastSuccessfulSyncAt: null,
      pending: 0,
      pullState: { since: 0, cursor: null },
    });
    expect(snapshot.deadLetter).toHaveLength(1);
  });

  it('records and persists the last successful sync time per account', async () => {
    const client = makeClient();
    service.initialize(client, 'tech@example.com');

    const before = Date.now();
    const result = await service.syncNow();
    expect(result.success).toBe(true);

    const snapshot = service.getHealthSnapshot();
    expect(snapshot.lastSuccessfulSyncAt).toBeGreaterThanOrEqual(before);
    expect(localStorage.getItem('chemcheck_sync_last_success_v1:tech@example.com')).toBe(String(snapshot.lastSuccessfulSyncAt));

    // A fresh service for the same account reads it back; another account does not.
    const again = new SyncService();
    again.initialize(makeClient(), 'tech@example.com');
    expect(again.getHealthSnapshot().lastSuccessfulSyncAt).toBe(snapshot.lastSuccessfulSyncAt);
    const other = new SyncService();
    other.initialize(makeClient(), 'someone@example.com');
    expect(other.getHealthSnapshot().lastSuccessfulSyncAt).toBeNull();
  });

  it('does not advance the last successful sync time when the cycle fails', async () => {
    const client = makeClient({ query: vi.fn(async () => { throw new Error('Failed to fetch'); }) });
    service.initialize(client, 'tech@example.com');

    const result = await service.syncNow();
    expect(result.success).toBe(false);
    expect(service.getHealthSnapshot().lastSuccessfulSyncAt).toBeNull();
  });

  it('retryDeadLetter requeues the item and runs a sync cycle', async () => {
    const client = makeClient();
    service.initialize(client, 'tech@example.com');
    dbState.customers.rows.set(1, { id: 1, full_name: 'Alice', sync_status: 'pending', local_updated_at: 5 });
    seedDead(service, 'customers', 1, 'Failed to fetch');

    const requeued = await service.retryDeadLetter('customers', 1);
    expect(requeued).toBe(true);
    expect(client.mutation).toHaveBeenCalledWith('syncCustomer', expect.objectContaining({ local_id: 1 }));
    expect(service.getQueueStatus().deadLetterCount).toBe(0);
    expect(service.getQueueStatus().pending).toBe(0);
    expect(dbState.customers.rows.get(1)).toMatchObject({ sync_status: 'synced', convex_id: 'c1' });
  });

  it('retryDeadLetter returns false for unknown items and skips the cycle while offline', async () => {
    const client = makeClient();
    service.initialize(client, 'tech@example.com');
    expect(await service.retryDeadLetter('notes', 42)).toBe(false);

    seedDead(service, 'notes', 7, 'Failed to fetch');
    (service as any).isOnline = false;
    expect(await service.retryDeadLetter('notes', 7)).toBe(true);
    expect(client.mutation).not.toHaveBeenCalled();
    expect(service.getQueueStatus().pending).toBe(1);
  });

  it('retryAllDeadLetters requeues everything and reports the count', async () => {
    const client = makeClient();
    service.initialize(client, 'tech@example.com');
    const queue: SyncQueue = (service as any).syncQueue;
    for (const id of [1, 2]) {
      queue.enqueue({ table: 'notes', localId: id, operation: 'create', data: { id } });
      const item = queue.findItem('notes', id)!;
      queue.markFailed(item, 'x'); queue.markFailed(item, 'x'); queue.markFailed(item, 'x');
    }
    expect(queue.getDeadLetterCount()).toBe(2);
    (service as any).isOnline = false;

    expect(await service.retryAllDeadLetters()).toBe(2);
    expect(queue.getDeadLetterCount()).toBe(0);
    expect(queue.getPendingCount()).toBe(2);
    expect(await service.retryAllDeadLetters()).toBe(0);
  });

  it('discardDeadLetter drops the queue item and marks the row local_only without re-enqueueing it', async () => {
    service.initialize(makeClient(), 'tech@example.com');
    dbState.notes.rows.set(3, { id: 3, title: 'Gate code', sync_status: 'pending', local_updated_at: 1 });
    seedDead(service, 'notes', 3, 'Access denied');

    expect(await service.discardDeadLetter('notes', 3)).toBe(true);

    expect(service.getQueueStatus().deadLetterCount).toBe(0);
    expect(service.getQueueStatus().pending).toBe(0);
    expect(dbState.withoutSyncHooks).toHaveBeenCalled();
    expect(dbState.notes.rows.get(3)).toMatchObject({ sync_status: 'local_only' });

    // A local_only row is never treated as legacy-pending again.
    expect((service as any).isPendingRecord(dbState.notes.rows.get(3))).toBe(false);
    expect(await service.discardDeadLetter('notes', 3)).toBe(false);
  });

  it('getRecordSyncStatus reports local_only rows', async () => {
    dbState.serviceLogs.rows.set(9, { id: 9, sync_status: 'local_only', sync_error: 'Kept on this device only (sync discarded)' });
    expect(await service.getRecordSyncStatus('serviceLogs', 9)).toMatchObject({ status: 'local_only' });
  });

  it('resetPullState clears only the current account watermark; resetForAccountChange clears everything', () => {
    service.initialize(makeClient(), 'tech@example.com');
    localStorage.setItem('chemcheck_sync_pull_state_v1:tech@example.com', JSON.stringify({ since: 500, cursor: 'abc' }));
    localStorage.setItem('chemcheck_sync_pull_state_v1:other@example.com', JSON.stringify({ since: 900, cursor: null }));
    localStorage.setItem('chemcheck_sync_last_success_v1:tech@example.com', '777');
    (service as any).lastSuccessfulSyncAt = 777;

    expect(service.getPullState()).toEqual({ since: 500, cursor: 'abc' });
    service.resetPullState();
    expect(service.getPullState()).toEqual({ since: 0, cursor: null });
    expect(localStorage.getItem('chemcheck_sync_pull_state_v1:other@example.com')).not.toBeNull();
    // The last-success marker survives a pull reset; only an account change clears it.
    expect(service.getHealthSnapshot().lastSuccessfulSyncAt).toBe(777);

    service.resetForAccountChange();
    expect(service.getHealthSnapshot().lastSuccessfulSyncAt).toBeNull();
    expect(localStorage.getItem('chemcheck_sync_last_success_v1:tech@example.com')).toBeNull();
  });

  it('a full re-sync after resetPullState pulls from zero', async () => {
    const client = makeClient();
    service.initialize(client, 'tech@example.com');
    localStorage.setItem('chemcheck_sync_pull_state_v1:tech@example.com', JSON.stringify({ since: 500, cursor: null }));

    service.resetPullState();
    await service.syncNow();

    expect(client.query).toHaveBeenCalledWith('pull', expect.objectContaining({ since: 0 }));
    expect(service.getPullState()).toEqual({ since: 1_000, cursor: null });
  });
});
