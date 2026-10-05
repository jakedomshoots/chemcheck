import { beforeEach, describe, expect, it, vi } from 'vitest';
import { monitoring } from '@/lib/monitoring';

/**
 * Covers the offline-sync hardening work:
 *  - delete sync through api.sync.deleteRecord
 *  - server tombstones applied on pull and on push responses
 *  - failure handling: markFailed, dead-lettering, pull-after-failure
 *  - conflict path normalization (no raw Convex docs in Dexie)
 *  - pull/push race: pending rows kept, stale queue items dropped for synced rows
 *  - resetForAccountChange and auth error classification
 */

const stores: Record<string, any[]> = {
  customers: [],
  pools: [],
  equipment: [],
  serviceLogs: [],
  chemicalUsage: [],
  notes: [],
  saltCellLogs: [],
};

const hookState = vi.hoisted(() => ({ suppressed: 0 }));
/** Every write records whether the sync hooks were suppressed at the time. */
const writeLog = vi.hoisted(() => [] as Array<{ table: string; op: string; id: number; suppressed: boolean }>);

function table(name: string) {
  return {
    get: vi.fn(async (id: number) => stores[name].find((record) => record.id === id)),
    add: vi.fn(async (record: any) => {
      const id = record.id ?? (stores[name].reduce((max, row) => Math.max(max, row.id || 0), 0) + 1);
      stores[name].push({ ...record, id });
      writeLog.push({ table: name, op: 'add', id, suppressed: hookState.suppressed > 0 });
      return id;
    }),
    update: vi.fn(async (id: number, update: any) => {
      const index = stores[name].findIndex((record) => record.id === id);
      writeLog.push({ table: name, op: 'update', id, suppressed: hookState.suppressed > 0 });
      if (index >= 0) {
        stores[name][index] = { ...stores[name][index], ...update };
        return 1;
      }
      return 0;
    }),
    delete: vi.fn(async (id: number) => {
      writeLog.push({ table: name, op: 'delete', id, suppressed: hookState.suppressed > 0 });
      stores[name] = stores[name].filter((record) => record.id !== id);
      // Keep the shared reference used by the tests in sync.
      (stores as any)[name] = stores[name];
    }),
    where: vi.fn((field: string) => ({
      equals: vi.fn((value: any) => ({
        first: vi.fn(async () => stores[name].find((record) => record[field] === value)),
        toArray: vi.fn(async () => stores[name].filter((record) => record[field] === value)),
        count: vi.fn(async () => stores[name].filter((record) => record[field] === value).length),
      })),
    })),
    toCollection: vi.fn(() => ({ toArray: vi.fn(async () => [...stores[name]]) })),
  };
}

vi.mock('@/db/chemcheck-db', () => ({
  db: {
    customers: table('customers'),
    pools: table('pools'),
    equipment: table('equipment'),
    serviceLogs: table('serviceLogs'),
    chemicalUsage: table('chemicalUsage'),
    notes: table('notes'),
    saltCellLogs: table('saltCellLogs'),
    setSyncService: vi.fn(),
    withoutSyncHooks: async (operation: () => Promise<unknown>) => {
      hookState.suppressed += 1;
      try {
        return await operation();
      } finally {
        hookState.suppressed -= 1;
      }
    },
  },
}));

vi.mock('../../../convex/_generated/api', () => ({
  api: {
    sync: {
      pull: 'sync.pull',
      deleteRecord: 'sync.deleteRecord',
      syncCustomer: 'sync.syncCustomer',
      syncPool: 'sync.syncPool',
      syncEquipment: 'sync.syncEquipment',
      syncServiceLog: 'sync.syncServiceLog',
      syncChemicalUsage: 'sync.syncChemicalUsage',
      syncNote: 'sync.syncNote',
      syncSaltCellLog: 'sync.syncSaltCellLog',
    },
  },
}));

const emptyPage = {
  customers: [], pools: [], equipment: [], serviceLogs: [], chemicalUsage: [], notes: [], saltCellLogs: [],
  cursor: null, hasMore: false, watermark: 0,
};

function resetStores() {
  for (const key of Object.keys(stores)) stores[key] = [];
  writeLog.splice(0);
}

function ageQueueItems(service: any, ms = 60_000) {
  for (const item of service.syncQueue.getPending()) {
    if (item.lastAttempt) item.lastAttempt -= ms;
  }
}

async function createService() {
  const { SyncService } = await import('./SyncService');
  const service = new SyncService();
  const query = vi.fn(async (..._args: any[]): Promise<any> => ({ ...emptyPage }));
  const mutation = vi.fn(async (..._args: any[]): Promise<any> => ({ success: true, convex_id: 'new-id', updated_at: 1000 }));
  service.initialize({ query, mutation } as any);
  return { service, query, mutation };
}

describe('SyncService delete sync', () => {
  beforeEach(() => {
    resetStores();
    localStorage.clear();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  });

  it('pushes a queued delete through api.sync.deleteRecord and acks it', async () => {
    const { service, mutation } = await createService();

    service.enqueueRecord('serviceLogs', 7, 'delete', {
      id: 7, convex_id: 'log-1', customer_id: 1, notes: 'gone', local_updated_at: 10,
    });
    // Only what is needed to reach the server row is persisted.
    expect(service.getQueueStatus().items[0].data).toEqual({
      id: 7, convex_id: 'log-1', customer_id: 1, pool_id: undefined, local_updated_at: 10,
    });

    const result = await service.syncNow();

    expect(result.success).toBe(true);
    expect(result.syncedCount).toBe(1);
    expect(mutation).toHaveBeenCalledWith('sync.deleteRecord', expect.objectContaining({
      table: 'serviceLogs',
      id: 'log-1',
    }));
    expect(service.getQueueStatus().items).toHaveLength(0);
    service.destroy();
  });

  it('acks a delete for a row that never reached the server without calling Convex', async () => {
    const { service, mutation } = await createService();

    service.enqueueRecord('notes', 3, 'delete', { id: 3, title: 'local only' });
    const result = await service.syncNow();

    expect(result.success).toBe(true);
    expect(mutation).not.toHaveBeenCalledWith('sync.deleteRecord', expect.anything());
    expect(service.getQueueStatus().items).toHaveLength(0);
    service.destroy();
  });

  it('marks a failed delete for retry instead of acking it', async () => {
    const { service, mutation } = await createService();
    mutation.mockRejectedValueOnce(new Error('Server exploded'));

    service.enqueueRecord('customers', 1, 'delete', { id: 1, convex_id: 'cust-1' });
    const result = await service.syncNow();

    expect(result.failedCount).toBe(1);
    const [item] = service.getQueueStatus().items;
    expect(item).toMatchObject({ operation: 'delete', retryCount: 1, error: 'Server exploded' });
    service.destroy();
  });

  it('keeps a pending delete when Dexie reuses the id for a new create', async () => {
    const { service, mutation } = await createService();

    service.enqueueRecord('serviceLogs', 7, 'delete', { id: 7, convex_id: 'log-old' });
    stores.serviceLogs.push({ id: 7, customer_id: 1, service_date: '2026-01-01', status: 'done', sync_status: 'pending', local_updated_at: 5 });
    stores.customers.push({ id: 1, convex_id: 'cust-1', sync_status: 'synced', local_updated_at: 1 });
    service.enqueueRecord('serviceLogs', 7, 'create', stores.serviceLogs[0]);

    const items = service.getQueueStatus().items;
    expect(items.map((item) => item.operation).sort()).toEqual(['create', 'delete']);

    await service.syncNow();

    expect(mutation).toHaveBeenCalledWith('sync.deleteRecord', expect.objectContaining({ id: 'log-old' }));
    expect(mutation).toHaveBeenCalledWith('sync.syncServiceLog', expect.objectContaining({ local_id: 7 }));
    expect(service.getQueueStatus().items).toHaveLength(0);
    service.destroy();
  });

  it('preserves a tombstoned parent and pending child locally for review', async () => {
    const { service, query } = await createService();
    stores.customers.push({ id: 1, convex_id: 'cust-1', full_name: 'Gone', sync_status: 'synced', local_updated_at: 1 });
    stores.customers.push({ id: 2, convex_id: 'cust-2', full_name: 'Stays', sync_status: 'synced', local_updated_at: 1 });
    stores.serviceLogs.push({ id: 7, customer_id: 1, convex_id: 'log-1', sync_status: 'pending', local_updated_at: 50 });
    stores.pools.push({ id: 4, customer_id: 1, convex_id: 'pool-1', sync_status: 'synced', local_updated_at: 1 });
    stores.notes.push({ id: 9, customer_id: 2, convex_id: 'note-2', sync_status: 'synced', local_updated_at: 1 });
    service.enqueueRecord('serviceLogs', 7, 'update', stores.serviceLogs[0]);

    query.mockResolvedValueOnce({
      ...emptyPage,
      customers: [{ _id: 'cust-1', full_name: 'Gone', deleted_at: 900, updated_at: 900 }],
      watermark: 900,
    });

    const result = await service.pullRemoteChanges();

    expect(result).toMatchObject({ pulledCount: 0, conflictCount: 2 });
    expect(stores.customers.map((row) => row.id)).toEqual([1, 2]);
    expect(stores.customers[0]).toMatchObject({ sync_status: 'error' });
    expect(stores.serviceLogs[0]).toMatchObject({ sync_status: 'error' });
    expect(stores.pools).toHaveLength(1);
    expect(stores.notes).toHaveLength(1);
    expect(service.getQueueStatus().items).toHaveLength(0);
    service.destroy();
  });

  it('preserves the local row when a push reports the server row was deleted', async () => {
    const { service, mutation } = await createService();
    stores.customers.push({
      id: 1, convex_id: 'cust-1', full_name: 'Edited offline', address: 'x', service_day: 'Monday',
      pool_type: 'a', surface_type: 'b', created_by: 'me', sync_status: 'pending', local_updated_at: 100,
    });
    stores.serviceLogs.push({ id: 7, customer_id: 1, convex_id: 'log-1', sync_status: 'synced', local_updated_at: 1 });
    mutation.mockResolvedValueOnce({
      success: false, operation: 'deleted', deleted_at: 500, convex_id: 'cust-1', local_id: 1, remote_data: { deleted_at: 500 },
    });

    const result = await service.syncNow();

    expect(result.success).toBe(true);
    expect(stores.customers[0]).toMatchObject({
      full_name: 'Edited offline',
      sync_status: 'error',
      remote_updated_at: 500,
    });
    expect(typeof stores.customers[0].conflict_backup).toBe('string');
    expect(stores.serviceLogs).toHaveLength(1);
    expect(service.getQueueStatus().items).toHaveLength(0);
    service.destroy();
  });
});

describe('SyncService failure handling', () => {
  beforeEach(() => {
    resetStores();
    localStorage.clear();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  });

  it('marks non-network failures in the queue, dead-letters after the retry cap and keeps pulling', async () => {
    const { service, query, mutation } = await createService();
    stores.customers.push({
      id: 1, full_name: 'Broken', address: 'x', service_day: 'Monday', pool_type: 'a', surface_type: 'b',
      created_by: 'me', sync_status: 'pending', local_updated_at: 100,
    });
    mutation.mockImplementation(async (ref: string) => {
      if (ref === 'sync.syncCustomer') throw new Error('Validation failed: full_name too long');
      return { success: true };
    });

    const first = await service.syncNow();
    expect(first.failedCount).toBe(1);
    expect(query).toHaveBeenCalledTimes(1); // pull still ran after the failed push
    expect(service.getQueueStatus().items[0]).toMatchObject({
      retryCount: 1,
      error: 'Validation failed: full_name too long',
    });

    ageQueueItems(service);
    await service.syncNow();
    ageQueueItems(service);
    const third = await service.syncNow();

    expect(third.failedCount).toBe(1);
    expect(query).toHaveBeenCalledTimes(3);
    expect(mutation).toHaveBeenCalledTimes(3);
    expect(service.getQueueStatus().items).toHaveLength(0);
    expect(service.getQueueStatus().deadLetter).toHaveLength(1);
    expect(service.getQueueStatus().deadLetter[0]).toMatchObject({ status: 'dead', retryCount: 3 });
    expect(stores.customers[0]).toMatchObject({ sync_status: 'error' });

    // The dead item is not retried and no longer blocks the pull.
    const fourth = await service.syncNow();
    expect(fourth.success).toBe(true);
    expect(mutation).toHaveBeenCalledTimes(3);
    expect(query).toHaveBeenCalledTimes(4);
    service.destroy();
  });

  it('classifies only explicit auth/permission markers as auth errors', async () => {
    const { service } = await createService();
    const isAuth = (message: string) => (service as any).isAuthOrPermissionError(new Error(message));

    expect(isAuth('Not authenticated')).toBe(true);
    expect(isAuth('Unauthenticated request')).toBe(true);
    expect(isAuth('Unauthorized')).toBe(true);
    expect(isAuth('Access denied for business')).toBe(true);
    expect(isAuth('HTTP 403 Forbidden')).toBe(true);
    expect(isAuth('Request failed with status 401')).toBe(true);

    expect(isAuth('tokenizer failed on notes')).toBe(false);
    expect(isAuth('session_date is required')).toBe(false);
    expect(isAuth('author field is invalid')).toBe(false);
    expect(isAuth('Validation failed')).toBe(false);
    service.destroy();
  });
});

describe('SyncService conflict normalization', () => {
  beforeEach(() => {
    resetStores();
    localStorage.clear();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  });

  it('keeps local data on a conflict, advances the base without re-triggering hooks and re-pushes', async () => {
    const { service, mutation } = await createService();
    stores.customers.push({ id: 3, convex_id: 'cust-1', sync_status: 'synced', local_updated_at: 1 });
    stores.pools.push({ id: 11, customer_id: 3, convex_id: 'pool-1', sync_status: 'synced', local_updated_at: 1 });
    stores.serviceLogs.push({
      id: 5, customer_id: 3, convex_id: 'log-1', service_date: '2026-01-01', status: 'done',
      ph: 'good', chlorine: 'good', alkalinity: 'good', stabilizer: 'good', notes: 'local edit',
      sync_status: 'pending', local_updated_at: 100, remote_updated_at: 50,
    });
    service.enqueueRecord('serviceLogs', 5, 'update', { ...stores.serviceLogs[0] });
    // Another device changed the row on the server since base 50.
    mutation.mockResolvedValueOnce({
      success: false,
      operation: 'conflict',
      conflict: {
        remote_data: {
          _id: 'log-1',
          _creationTime: 1,
          business_id: 'biz-1',
          customer_id: 'cust-1',
          pool_id: 'pool-1',
          notes: 'remote edit',
          updated_at: 200,
        },
        remote_updated_at: 200,
        local_updated_at: 100,
      },
    });

    const result = await service.syncNow();
    expect(result.success).toBe(true);

    expect(mutation).toHaveBeenCalledTimes(2);
    expect(mutation.mock.calls[0][1]).toMatchObject({ convex_id: 'log-1', base_updated_at: 50, data: { notes: 'local edit' } });
    expect(mutation.mock.calls[1][1]).toMatchObject({ convex_id: 'log-1', base_updated_at: 200, data: { notes: 'local edit' } });

    const row = stores.serviceLogs[0];
    expect(row).toMatchObject({
      id: 5,
      customer_id: 3,
      // The harness's default success stub answers with this id/stamp.
      convex_id: 'new-id',
      notes: 'local edit',
      sync_status: 'synced',
      local_updated_at: 100,
      remote_updated_at: 1000,
    });
    expect(row).not.toHaveProperty('_id');
    expect(row).not.toHaveProperty('business_id');
    expect(typeof row.conflict_backup).toBe('string');

    const conflictWrite = writeLog.find((entry) => entry.table === 'serviceLogs' && entry.op === 'update');
    expect(conflictWrite?.suppressed).toBe(true);
    expect(service.getQueueStatus().items).toHaveLength(0);
    service.destroy();
  }, 10_000);
});

describe('SyncService pull/push race', () => {
  beforeEach(() => {
    resetStores();
    localStorage.clear();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  });

  it('never overwrites a pending row with remote data, even when the remote stamp is later', async () => {
    const metricSpy = vi.spyOn(monitoring, 'recordMetric');
    const { service, query } = await createService();
    stores.customers.push({
      id: 1, convex_id: 'cust-1', full_name: 'Local', sync_status: 'pending', local_updated_at: 100, remote_updated_at: 50,
    });
    service.enqueueRecord('customers', 1, 'update', { ...stores.customers[0] });
    expect(service.getQueueStatus().items).toHaveLength(1);

    query.mockResolvedValueOnce({
      ...emptyPage,
      customers: [{ _id: 'cust-1', full_name: 'Remote', updated_at: 200 }],
      watermark: 200,
    });

    const result = await service.pullRemoteChanges();

    expect(result).toMatchObject({ pulledCount: 0, conflictCount: 1 });
    expect(stores.customers[0]).toMatchObject({
      full_name: 'Local', sync_status: 'pending', local_updated_at: 100, remote_updated_at: 200,
    });
    expect(typeof stores.customers[0].conflict_backup).toBe('string');
    const baseWrite = writeLog.find((entry) => entry.table === 'customers' && entry.op === 'update');
    expect(baseWrite?.suppressed).toBe(true);
    // The pending push still carries the local edit.
    expect(service.getQueueStatus().items).toHaveLength(1);
    expect(metricSpy).toHaveBeenCalledWith('sync_pull_conflict_local_pending_kept', 1, expect.objectContaining({ table: 'customers', localId: 1 }));
    metricSpy.mockRestore();
    service.destroy();
  });

  it('leaves a pending row untouched when the remote stamp is not newer than its base', async () => {
    const { service, query } = await createService();
    stores.customers.push({
      id: 1, convex_id: 'cust-1', full_name: 'Local', sync_status: 'pending', local_updated_at: 100, remote_updated_at: 200,
    });
    service.enqueueRecord('customers', 1, 'update', { ...stores.customers[0] });

    query.mockResolvedValueOnce({
      ...emptyPage,
      customers: [{ _id: 'cust-1', full_name: 'Remote', updated_at: 200 }],
      watermark: 200,
    });

    const result = await service.pullRemoteChanges();

    expect(result).toMatchObject({ pulledCount: 0, conflictCount: 0 });
    expect(stores.customers[0]).toMatchObject({ full_name: 'Local', sync_status: 'pending', remote_updated_at: 200 });
    expect(stores.customers[0].conflict_backup).toBeUndefined();
    expect(writeLog.filter((entry) => entry.table === 'customers')).toHaveLength(0);
    expect(service.getQueueStatus().items).toHaveLength(1);
    service.destroy();
  });

  it('removes a stale queue item when the pull overwrites a non-pending row with remote data', async () => {
    const { service, query } = await createService();
    stores.customers.push({
      id: 1, convex_id: 'cust-1', full_name: 'Local', sync_status: 'synced', local_updated_at: 100, remote_updated_at: 100,
    });
    service.enqueueRecord('customers', 1, 'update', { ...stores.customers[0] });
    expect(service.getQueueStatus().items).toHaveLength(1);

    query.mockResolvedValueOnce({
      ...emptyPage,
      customers: [{ _id: 'cust-1', full_name: 'Remote', updated_at: 200 }],
      watermark: 200,
    });

    const result = await service.pullRemoteChanges();

    expect(result).toMatchObject({ pulledCount: 1, conflictCount: 0 });
    expect(stores.customers[0]).toMatchObject({ full_name: 'Remote', sync_status: 'synced', remote_updated_at: 200 });
    expect(service.getQueueStatus().items).toHaveLength(0);
    service.destroy();
  });

  it('keeps a queue item that carries a newer local edit than the row being overwritten', async () => {
    const { service, query } = await createService();
    stores.customers.push({
      id: 1, convex_id: 'cust-1', full_name: 'Local', sync_status: 'synced', local_updated_at: 100, remote_updated_at: 100,
    });
    service.enqueueRecord('customers', 1, 'update', { ...stores.customers[0], full_name: 'Newer', local_updated_at: 300 });

    query.mockResolvedValueOnce({
      ...emptyPage,
      customers: [{ _id: 'cust-1', full_name: 'Remote', updated_at: 200 }],
      watermark: 200,
    });

    await service.pullRemoteChanges();

    expect(service.getQueueStatus().items).toHaveLength(1);
    service.destroy();
  });
});

describe('SyncService.resetForAccountChange', () => {
  beforeEach(() => {
    resetStores();
    localStorage.clear();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  });

  it('clears the queue, persisted queue, pull watermark and in-flight state', async () => {
    const { SyncService } = await import('./SyncService');
    const service = new SyncService();
    const query = vi.fn(async (..._args: any[]): Promise<any> => ({ ...emptyPage, watermark: 400 }));
    service.initialize({ query, mutation: vi.fn() } as any, 'user@example.com');

    service.enqueueRecord('customers', 1, 'update', { id: 1 });
    await service.pullRemoteChanges();
    expect(localStorage.getItem('chemcheck_sync_pull_state_v1:user@example.com')).not.toBeNull();
    expect(JSON.parse(localStorage.getItem('chemcheck_sync_queue') || '[]')).toHaveLength(1);
    (service as any).isSyncCycleRunning = true;

    service.resetForAccountChange();

    expect(service.getQueueStatus().items).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem('chemcheck_sync_queue') || '[]')).toHaveLength(0);
    expect(localStorage.getItem('chemcheck_sync_pull_state_v1:user@example.com')).toBeNull();
    expect((service as any).isSyncCycleRunning).toBe(false);

    // The next pull starts from scratch (since: 0, no cursor).
    await service.pullRemoteChanges();
    expect(query.mock.calls[1][1]).toMatchObject({ since: 0 });
    service.destroy();
  });
});
