import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  customer: undefined as Record<string, any> | undefined,
}));

function emptyTable() {
  return {
    get: vi.fn(async () => undefined),
    update: vi.fn(async () => 0),
    where: vi.fn(() => ({
      equals: vi.fn(() => ({ toArray: vi.fn(async () => []) })),
    })),
    toCollection: vi.fn(() => ({ toArray: vi.fn(async () => []) })),
  };
}

const customers = vi.hoisted(() => ({
  get: vi.fn(async () => state.customer ? { ...state.customer } : undefined),
  update: vi.fn(async (_id: number, changes: Record<string, any>) => {
    if (!state.customer) return 0;
    state.customer = { ...state.customer, ...changes };
    return 1;
  }),
  where: vi.fn(() => ({
    equals: vi.fn(() => ({ toArray: vi.fn(async () => []) })),
  })),
  toCollection: vi.fn(() => ({ toArray: vi.fn(async () => state.customer ? [{ ...state.customer }] : []) })),
}));

vi.mock('@/db/chemcheck-db', () => ({
  db: {
    customers,
    pools: emptyTable(),
    equipment: emptyTable(),
    serviceLogs: emptyTable(),
    chemicalUsage: emptyTable(),
    notes: emptyTable(),
    saltCellLogs: emptyTable(),
    setSyncService: vi.fn(),
    withoutSyncHooks: async (operation: () => Promise<unknown>) => operation(),
  },
}));

vi.mock('../../../convex/_generated/api', () => ({
  api: {
    sync: {
      syncCustomer: 'syncCustomer',
      pull: 'pull',
    },
  },
}));

describe('SyncService reorder revision safety', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    state.customer = {
      id: 1,
      convex_id: 'customer-1',
      full_name: 'Alice',
      address: '1 Main St',
      service_day: 'Monday',
      sort_order: 1,
      created_by: 'owner@example.com',
      sync_status: 'pending',
      local_updated_at: 100,
    };
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  });

  it('does not let an older in-flight reorder acknowledge a newer reorder', async () => {
    const { SyncService } = await import('./SyncService');
    const service = new SyncService();
    let finishOldUpload!: (value: unknown) => void;
    const oldUpload = new Promise((resolve) => { finishOldUpload = resolve; });
    const mutation = vi.fn(() => oldUpload);
    const query = vi.fn(async () => ({
      customers: [], pools: [], equipment: [], serviceLogs: [], chemicalUsage: [], notes: [], saltCellLogs: [],
      cursor: null, hasMore: false, watermark: 100,
    }));

    service.initialize({ mutation, query } as any);
    service.enqueueRecord('customers', 1, 'update', { ...state.customer });

    const syncPromise = service.syncNow();
    await vi.waitFor(() => expect(mutation).toHaveBeenCalledTimes(1));

    state.customer = {
      ...state.customer!,
      sort_order: 0,
      sync_status: 'pending',
      local_updated_at: 200,
    };
    service.enqueueRecord('customers', 1, 'update', { ...state.customer });

    finishOldUpload({ success: true, convex_id: 'customer-1', updated_at: 150 });
    await syncPromise;

    expect(state.customer).toMatchObject({
      sort_order: 0,
      sync_status: 'pending',
      local_updated_at: 200,
    });
    expect(service.getQueueStatus().items).toHaveLength(1);
    expect(service.getQueueStatus().items[0].data).toMatchObject({
      sort_order: 0,
      local_updated_at: 200,
    });

    await service.syncNow();

    expect(mutation).toHaveBeenCalledTimes(2);
    const secondMutationArgs = mutation.mock.calls[1] as unknown as [unknown, Record<string, unknown>];
    expect(secondMutationArgs[1]).toMatchObject({
      data: { sort_order: 0 },
      local_updated_at: 200,
    });
    expect(state.customer).toMatchObject({ sort_order: 0, sync_status: 'synced' });
    expect(service.getQueueStatus().items).toHaveLength(0);

    service.destroy();
  });

  it('does not let an older conflict response overwrite a newer reorder', async () => {
    const { SyncService } = await import('./SyncService');
    const service = new SyncService();
    let finishOldUpload!: (value: unknown) => void;
    const oldUpload = new Promise((resolve) => { finishOldUpload = resolve; });
    const mutation = vi.fn(() => oldUpload);
    const query = vi.fn(async () => ({
      customers: [], pools: [], equipment: [], serviceLogs: [], chemicalUsage: [], notes: [], saltCellLogs: [],
      cursor: null, hasMore: false, watermark: 100,
    }));

    service.initialize({ mutation, query } as any);
    service.enqueueRecord('customers', 1, 'update', { ...state.customer });

    const syncPromise = service.syncNow();
    await vi.waitFor(() => expect(mutation).toHaveBeenCalledTimes(1));

    state.customer = {
      ...state.customer!,
      sort_order: 0,
      sync_status: 'pending',
      local_updated_at: 300,
    };
    service.enqueueRecord('customers', 1, 'update', { ...state.customer });

    finishOldUpload({
      success: false,
      operation: 'conflict',
      conflict: {
        remote_data: {
          ...state.customer,
          sort_order: 2,
          updated_at: 250,
        },
        remote_updated_at: 250,
        local_updated_at: 100,
      },
    });
    await syncPromise;

    expect(state.customer).toMatchObject({
      sort_order: 0,
      sync_status: 'pending',
      local_updated_at: 300,
    });
    expect(service.getQueueStatus().items).toHaveLength(1);
    expect(service.getQueueStatus().items[0].data).toMatchObject({
      sort_order: 0,
      local_updated_at: 300,
    });

    service.destroy();
  });
});
