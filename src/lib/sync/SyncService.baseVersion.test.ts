import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Optimistic concurrency on the base version (base_updated_at).
 *
 * The server compares its own `updated_at` with the base the device last saw,
 * never with the device clock. These tests simulate that server: a push is
 * rejected as a conflict only when base_updated_at mismatches the server row.
 */

const stores: Record<string, any[]> = {
  customers: [], pools: [], equipment: [], serviceLogs: [], chemicalUsage: [], notes: [], saltCellLogs: [],
};
const hookState = vi.hoisted(() => ({ suppressed: 0 }));
const writeLog = vi.hoisted(() => [] as Array<{ table: string; op: string; changes: any; suppressed: boolean }>);

function table(name: string) {
  return {
    get: vi.fn(async (id: number) => stores[name].find((record) => record.id === id)),
    add: vi.fn(async (record: any) => {
      const id = record.id ?? (stores[name].reduce((max, row) => Math.max(max, row.id || 0), 0) + 1);
      stores[name].push({ ...record, id });
      return id;
    }),
    update: vi.fn(async (id: number, update: any) => {
      const index = stores[name].findIndex((record) => record.id === id);
      writeLog.push({ table: name, op: 'update', changes: update, suppressed: hookState.suppressed > 0 });
      if (index < 0) return 0;
      stores[name][index] = { ...stores[name][index], ...update };
      return 1;
    }),
    delete: vi.fn(async (id: number) => { stores[name] = stores[name].filter((record) => record.id !== id); }),
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
    customers: table('customers'), pools: table('pools'), equipment: table('equipment'),
    serviceLogs: table('serviceLogs'), chemicalUsage: table('chemicalUsage'), notes: table('notes'),
    saltCellLogs: table('saltCellLogs'),
    setSyncService: vi.fn(),
    withoutSyncHooks: async (operation: () => Promise<unknown>) => {
      hookState.suppressed += 1;
      try { return await operation(); } finally { hookState.suppressed -= 1; }
    },
  },
}));

vi.mock('../../../convex/_generated/api', () => ({
  api: { sync: { pull: 'sync.pull', deleteRecord: 'sync.deleteRecord', syncCustomer: 'sync.syncCustomer' } },
}));

const emptyPage = {
  customers: [], pools: [], equipment: [], serviceLogs: [], chemicalUsage: [], notes: [], saltCellLogs: [],
  cursor: null, hasMore: false, watermark: 0,
};

/** Fake server row + mutation implementing the base-version check. */
function fakeServer(initialUpdatedAt: number) {
  const server = { _id: 'cust-1', full_name: 'Alice', sort_order: 1, updated_at: initialUpdatedAt };
  const mutation = vi.fn(async (_name: string, args: any) => {
    if (args.convex_id && args.base_updated_at !== server.updated_at) {
      return {
        success: false,
        operation: 'conflict',
        convex_id: server._id,
        local_id: args.local_id,
        conflict: { remote_data: { ...server }, remote_updated_at: server.updated_at, local_updated_at: args.local_updated_at },
      };
    }
    Object.assign(server, args.data);
    server.updated_at += 100;
    return { success: true, operation: 'update', convex_id: server._id, local_id: args.local_id, updated_at: server.updated_at };
  });
  return { server, mutation };
}

async function createService(mutation: any) {
  const { SyncService } = await import('./SyncService');
  const service = new SyncService();
  const query = vi.fn(async (): Promise<any> => ({ ...emptyPage }));
  service.initialize({ query, mutation } as any);
  return { service, query };
}

describe('SyncService base-version concurrency', () => {
  beforeEach(() => {
    for (const key of Object.keys(stores)) stores[key] = [];
    writeLog.splice(0);
    localStorage.clear();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  });

  it('pushes a quick second edit whose device stamp is older than the server stamp when the base matches', async () => {
    // Previous push returned server updated_at 150 (network latency); the
    // user's second edit was stamped 120 by the device clock.
    const { server, mutation } = fakeServer(150);
    stores.customers.push({
      id: 1, convex_id: 'cust-1', full_name: 'Alice', address: '1 Main St', service_day: 'Monday',
      pool_type: 'Salt', surface_type: 'Plaster', created_by: 'owner@example.com', sort_order: 0,
      sync_status: 'pending', local_updated_at: 120, remote_updated_at: 150,
    });
    const { service } = await createService(mutation);
    service.enqueueRecord('customers', 1, 'update', { ...stores.customers[0] });

    const result = await service.syncNow();

    expect(result.success).toBe(true);
    expect(mutation).toHaveBeenCalledTimes(1);
    expect(mutation.mock.calls[0][1]).toMatchObject({
      convex_id: 'cust-1', local_updated_at: 120, base_updated_at: 150, data: { sort_order: 0 },
    });
    expect(server).toMatchObject({ sort_order: 0, updated_at: 250 });
    expect(stores.customers[0]).toMatchObject({
      sort_order: 0, sync_status: 'synced', local_updated_at: 120, remote_updated_at: 250,
    });
    expect(stores.customers[0].conflict_backup).toBeUndefined();
    expect(service.getQueueStatus().items).toHaveLength(0);
    service.destroy();
  });

  it('omits base_updated_at for a row that was never pushed', async () => {
    const { mutation } = fakeServer(0);
    stores.customers.push({
      id: 1, full_name: 'New', address: '1 Main St', service_day: 'Monday', pool_type: 'Salt',
      surface_type: 'Plaster', created_by: 'owner@example.com', sync_status: 'pending', local_updated_at: 120,
    });
    const { service } = await createService(mutation);
    service.enqueueRecord('customers', 1, 'create', { ...stores.customers[0] });

    await service.syncNow();

    expect(mutation).toHaveBeenCalledTimes(1);
    expect(mutation.mock.calls[0][1].convex_id).toBeUndefined();
    expect(mutation.mock.calls[0][1].base_updated_at).toBeUndefined();
    service.destroy();
  });

  it('on a true concurrent edit: backs up, advances the base and re-pushes the local data', async () => {
    // Another device pushed after this device last synced (base 150 -> 200).
    const { server, mutation } = fakeServer(200);
    server.sort_order = 5;
    stores.customers.push({
      id: 1, convex_id: 'cust-1', full_name: 'Alice', address: '1 Main St', service_day: 'Monday',
      pool_type: 'Salt', surface_type: 'Plaster', created_by: 'owner@example.com', sort_order: 0,
      sync_status: 'pending', local_updated_at: 120, remote_updated_at: 150,
    });
    const { service } = await createService(mutation);
    service.enqueueRecord('customers', 1, 'update', { ...stores.customers[0] });

    const result = await service.syncNow();

    expect(result.success).toBe(true);
    expect(mutation).toHaveBeenCalledTimes(2);
    expect(mutation.mock.calls[0][1]).toMatchObject({ base_updated_at: 150, data: { sort_order: 0 } });
    expect(mutation.mock.calls[1][1]).toMatchObject({ base_updated_at: 200, data: { sort_order: 0 }, local_updated_at: 120 });

    // The base advance happened with the Dexie hooks suppressed and without
    // touching local_updated_at or sync_status.
    const baseAdvance = writeLog.find((entry) => entry.changes?.remote_updated_at === 200);
    expect(baseAdvance?.suppressed).toBe(true);
    expect(baseAdvance?.changes).not.toHaveProperty('local_updated_at');
    expect(baseAdvance?.changes).not.toHaveProperty('sync_status');

    expect(server).toMatchObject({ sort_order: 0, updated_at: 300 });
    expect(stores.customers[0]).toMatchObject({
      sort_order: 0, sync_status: 'synced', local_updated_at: 120, remote_updated_at: 300,
    });
    expect(typeof stores.customers[0].conflict_backup).toBe('string');
    expect(JSON.parse(stores.customers[0].conflict_backup).data).toMatchObject({ sort_order: 0, remote_updated_at: 150 });
    expect(service.getQueueStatus().items).toHaveLength(0);
    service.destroy();
  }, 10_000);

  it('drops the local row when the conflict payload carries a tombstone', async () => {
    const mutation = vi.fn(async () => ({
      success: false, operation: 'conflict',
      conflict: { remote_data: { _id: 'cust-1', deleted_at: 999, updated_at: 999 }, remote_updated_at: 999 },
    }));
    stores.customers.push({
      id: 1, convex_id: 'cust-1', full_name: 'Alice', address: '1 Main St', service_day: 'Monday',
      pool_type: 'Salt', surface_type: 'Plaster', created_by: 'owner@example.com',
      sync_status: 'pending', local_updated_at: 120, remote_updated_at: 150,
    });
    const { service } = await createService(mutation);
    service.enqueueRecord('customers', 1, 'update', { ...stores.customers[0] });

    await service.syncNow();

    expect(mutation).toHaveBeenCalledTimes(1);
    expect(stores.customers).toHaveLength(0);
    expect(service.getQueueStatus().items).toHaveLength(0);
    service.destroy();
  });

  it('pull never overwrites a pending row even when the remote stamp is later than the device stamp', async () => {
    const { mutation } = fakeServer(200);
    stores.customers.push({
      id: 1, convex_id: 'cust-1', full_name: 'Local', sort_order: 0,
      sync_status: 'pending', local_updated_at: 120, remote_updated_at: 150,
    });
    const { service, query } = await createService(mutation);
    service.enqueueRecord('customers', 1, 'update', { ...stores.customers[0] });
    query.mockResolvedValueOnce({
      ...emptyPage,
      customers: [{ _id: 'cust-1', full_name: 'Remote', sort_order: 5, updated_at: 200 }],
      watermark: 200,
    });

    const result = await service.pullRemoteChanges();

    expect(result).toMatchObject({ pulledCount: 0, conflictCount: 1 });
    expect(stores.customers[0]).toMatchObject({
      full_name: 'Local', sort_order: 0, sync_status: 'pending', local_updated_at: 120, remote_updated_at: 200,
    });
    expect(typeof stores.customers[0].conflict_backup).toBe('string');
    expect(service.getQueueStatus().items).toHaveLength(1);
    service.destroy();
  });
});
