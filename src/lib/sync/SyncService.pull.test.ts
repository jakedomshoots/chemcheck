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
});
