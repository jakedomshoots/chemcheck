import { beforeEach, describe, expect, it, vi } from 'vitest';

const stores: Record<string, any[]> = {
  customers: [],
  pools: [],
  equipment: [],
  serviceLogs: [],
  chemicalUsage: [],
  notes: [],
  saltCellLogs: [],
};

function table(name: string) {
  return {
    count: vi.fn(async () => stores[name].length),
    get: vi.fn(async (id: number) => stores[name].find((record) => record.id === id)),
    add: vi.fn(async (record: any) => {
      const id = record.id ?? stores[name].length + 1;
      stores[name].push({ ...record, id });
      return id;
    }),
    update: vi.fn(async (id: number, update: any) => {
      const index = stores[name].findIndex((record) => record.id === id);
      if (index >= 0) stores[name][index] = { ...stores[name][index], ...update };
    }),
    delete: vi.fn(async (id: number) => {
      const index = stores[name].findIndex((record) => record.id === id);
      if (index >= 0) stores[name].splice(index, 1);
    }),
    where: vi.fn((field: string) => ({
      equals: vi.fn((value: any) => ({
        first: vi.fn(async () => stores[name].find((record) => record[field] === value)),
        toArray: vi.fn(async () => stores[name].filter((record) => record[field] === value)),
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
    withoutSyncHooks: async (operation: () => Promise<unknown>) => operation(),
  },
}));

vi.mock('../../../convex/_generated/api', () => ({
  api: { sync: { pull: 'sync.pull' } },
}));

vi.mock('./SyncQueue', () => ({
  SyncQueue: class {
    enqueue = vi.fn();
    getPending = vi.fn(() => []);
    getPendingCount = vi.fn(() => 0);
    getRetryableItems = vi.fn(() => []);
    getBatchSize = vi.fn(() => 20);
    getCapacityStatus = vi.fn(() => ({ current: 0, max: 500, warningThreshold: 400, usagePercent: 0 }));
    findItem = vi.fn();
    markSynced = vi.fn();
    markFailed = vi.fn();
  },
}));

vi.mock('./ConflictResolver', () => ({
  ConflictResolver: class {
    createBackup(record: any) {
      record.conflict_backup = JSON.stringify({ timestamp: Date.now(), data: { ...record } });
      return true;
    }
  },
}));

describe('SyncService remote pull', () => {
  beforeEach(() => {
    Object.values(stores).forEach((records) => records.splice(0));
    localStorage.clear();
  });

  it('resumes cursor pages and applies remote records without re-enqueueing them', async () => {
    stores.customers.push({
      id: 1,
      convex_id: 'customer-1',
      full_name: 'Local name',
      local_updated_at: 10,
      remote_updated_at: 10,
      sync_status: 'synced',
    });

    const { SyncService } = await import('./SyncService');
    const service = new SyncService();
    const query = vi.fn()
      .mockResolvedValueOnce({
        customers: [{ _id: 'customer-1', full_name: 'Remote name', updated_at: 20 }],
        serviceLogs: [], chemicalUsage: [], notes: [], saltCellLogs: [],
        cursor: 'page-2', hasMore: true, watermark: 20,
      })
      .mockResolvedValueOnce({
        customers: [], serviceLogs: [], chemicalUsage: [], notes: [], saltCellLogs: [],
        cursor: null, hasMore: false, watermark: 20,
      });

    service.initialize({ query, mutation: vi.fn() } as any);
    const result = await service.pullRemoteChanges();

    expect(result).toMatchObject({ pulledCount: 1, conflictCount: 0 });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][1]).toMatchObject({ cursor: 'page-2' });
    expect(stores.customers[0]).toMatchObject({ full_name: 'Remote name', sync_status: 'synced', remote_updated_at: 20 });
    expect(JSON.parse(localStorage.getItem('chemcheck_sync_pull_state_v1:anonymous') || '{}')).toMatchObject({ since: 20, cursor: null });

    service.destroy();
  });

  it('fully rehydrates when the local customer cache is empty but a stale watermark exists', async () => {
    localStorage.setItem(
      'chemcheck_sync_pull_state_v1:owner@example.com',
      JSON.stringify({ since: 999, cursor: null }),
    );

    const { SyncService } = await import('./SyncService');
    const service = new SyncService();
    const query = vi.fn().mockResolvedValue({
      customers: [{ _id: 'customer-1', full_name: 'Recovered customer', updated_at: 1000 }],
      pools: [], equipment: [], serviceLogs: [], chemicalUsage: [], notes: [], saltCellLogs: [],
      cursor: null, hasMore: false, watermark: 1000,
    });

    service.initialize({ query, mutation: vi.fn() } as any, 'owner@example.com');
    const result = await service.pullRemoteChanges();

    expect(query).toHaveBeenCalledWith('sync.pull', expect.objectContaining({ since: 0 }));
    expect(result.pulledCount).toBe(1);
    expect(stores.customers).toHaveLength(1);
    expect(stores.customers[0]).toMatchObject({ full_name: 'Recovered customer' });
    service.destroy();
  });

  it('reconciles a full cloud snapshot without deleting unsynced local customers', async () => {
    stores.customers.push(
      {
        id: 1,
        convex_id: 'stale-customer',
        full_name: 'Old cached customer',
        local_updated_at: 10,
        remote_updated_at: 10,
        sync_status: 'synced',
      },
      {
        id: 2,
        full_name: 'Offline customer awaiting upload',
        local_updated_at: 30,
        sync_status: 'pending',
      },
    );

    const { SyncService } = await import('./SyncService');
    const service = new SyncService();
    const query = vi.fn().mockResolvedValue({
      customers: [{ _id: 'current-customer', full_name: 'Current production customer', updated_at: 40 }],
      pools: [], equipment: [], serviceLogs: [], chemicalUsage: [], notes: [], saltCellLogs: [],
      cursor: null, hasMore: false, watermark: 40,
    });

    service.initialize({ query, mutation: vi.fn() } as any, 'owner@example.com');
    await service.pullRemoteChanges();

    expect(stores.customers.map((customer) => customer.full_name)).toEqual([
      'Offline customer awaiting upload',
      'Current production customer',
    ]);
    service.destroy();
  });
});
