import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, SYNC_TABLE_NAMES } from '@/db/chemcheck-db';
import { SyncService } from './SyncService';

vi.mock('../../../convex/_generated/api', () => ({
  api: {
    sync: {
      pull: 'pull',
      syncDelete: 'syncDelete',
      syncCustomer: 'syncCustomer',
      syncServiceLog: 'syncServiceLog',
      syncNote: 'syncNote',
    },
  },
}));

const emptyPage = {
  customers: [], pools: [], equipment: [], serviceLogs: [], chemicalUsage: [], notes: [], saltCellLogs: [], tombstones: [],
  cursor: null, hasMore: false, watermark: 5_000,
};

function customerRecord(overrides: Record<string, any> = {}) {
  return {
    full_name: 'Jane Doe',
    address: '123 Main St',
    phone: '555-0100',
    service_day: 'Monday',
    pool_type: 'Chlorine',
    surface_type: 'Plaster',
    created_by: 'owner@example.com',
    convex_id: 'customers:1',
    remote_updated_at: 1_000,
    local_updated_at: 1_000,
    sync_status: 'synced' as const,
    ...overrides,
  };
}

async function seed(operation: () => Promise<unknown>) {
  // Seed rows as if they had been pulled from the server.
  await db.withoutSyncHooks(async () => { await operation(); });
}

describe('SyncService offline sync (real Dexie + queue)', () => {
  let service: SyncService;
  let mutation: ReturnType<typeof vi.fn>;
  let query: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    localStorage.clear();
    for (const table of SYNC_TABLE_NAMES) await db.table(table).clear();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    mutation = vi.fn();
    query = vi.fn(async () => emptyPage);
    service = new SyncService();
    service.initialize({ mutation, query } as any, 'owner@example.com');
  });

  afterEach(() => {
    service.destroy();
    db.setSyncService(null);
    vi.useRealTimers();
  });

  describe('delete propagation', () => {
    it('pushes a customer delete with its server id and removes local children without extra deletes', async () => {
      let customerId = 0;
      await seed(async () => {
        customerId = await db.customers.add(customerRecord()) as number;
        await db.serviceLogs.add({
          customer_id: customerId, convex_id: 'serviceLogs:1', service_date: '2026-01-01', status: 'completed',
          ph: 'good', chlorine: 'good', alkalinity: 'good', stabilizer: 'good', sync_status: 'synced', local_updated_at: 1,
        });
      });

      await db.deleteCustomerWithChildren(customerId);

      expect(await db.serviceLogs.count()).toBe(0);
      const queued = service.getQueueStatus().items;
      expect(queued).toHaveLength(1);
      expect(queued[0]).toMatchObject({ table: 'customers', operation: 'delete', data: { convex_id: 'customers:1' } });
      expect(await service.getPendingCount()).toBe(1);

      mutation.mockResolvedValue({ success: true, operation: 'delete' });
      const result = await service.syncNow();

      expect(result.success).toBe(true);
      expect(mutation).toHaveBeenCalledWith('syncDelete', {
        table: 'customers',
        server_id: 'customers:1',
        idempotency_key: 'delete:customers:customers:1',
      });
      expect(service.getQueueStatus().items).toHaveLength(0);
    });

    it('drops deletes of records that never reached the server', async () => {
      const noteId = await db.notes.add({
        title: 'Local', content: 'only', category: 'General', priority: 'low', sync_status: 'pending', local_updated_at: 1,
      }) as number;
      await db.notes.delete(noteId);

      const result = await service.syncNow();

      expect(result.success).toBe(true);
      expect(mutation).not.toHaveBeenCalledWith('syncDelete', expect.anything());
      expect(service.getQueueStatus().items).toHaveLength(0);
    });

    it('queues the server delete when a record is deleted while its create is in flight', async () => {
      const noteId = await db.notes.add({
        title: 'Racing', content: 'create', category: 'General', priority: 'low', sync_status: 'pending', local_updated_at: 1,
      }) as number;
      let finishCreate!: (value: unknown) => void;
      mutation.mockImplementationOnce(() => new Promise((resolve) => { finishCreate = resolve; }));
      const syncing = service.syncNow();
      await vi.waitFor(() => expect(mutation).toHaveBeenCalledTimes(1));

      await db.notes.delete(noteId);
      finishCreate({ success: true, operation: 'create', convex_id: 'notes:7', updated_at: 2_000 });
      await syncing;

      const queued = service.getQueueStatus().items;
      expect(queued).toHaveLength(1);
      expect(queued[0]).toMatchObject({ table: 'notes', operation: 'delete', data: { convex_id: 'notes:7' } });
    });

    it('does not propagate local bulk clears (backup restore / local wipe)', async () => {
      await seed(async () => { await db.customers.add(customerRecord()); });
      await db.customers.clear();
      expect(service.getQueueStatus().items).toHaveLength(0);
    });

    it('applies pulled tombstones locally without echoing a delete back', async () => {
      let customerId = 0;
      await seed(async () => {
        customerId = await db.customers.add(customerRecord()) as number;
        await db.notes.add({
          customer_id: customerId, convex_id: 'notes:1', title: 'Gate', content: 'Dog', category: 'General',
          priority: 'low', sync_status: 'synced', local_updated_at: 1,
        });
      });
      query.mockResolvedValueOnce({ ...emptyPage, tombstones: [{ table: 'customers', server_id: 'customers:1', deleted_at: 4_000 }] });

      const pulled = await service.pullRemoteChanges();

      expect(pulled.pulledCount).toBe(1);
      expect(await db.customers.count()).toBe(0);
      expect(await db.notes.count()).toBe(0);
      expect(service.getQueueStatus().items).toHaveLength(0);
    });

    it('restores the record from the server when the server refuses the delete', async () => {
      let customerId = 0;
      await seed(async () => { customerId = await db.customers.add(customerRecord()) as number; });
      localStorage.setItem('chemcheck_sync_pull_state_v1:owner@example.com', JSON.stringify({ since: 4_000, cursor: null }));
      await db.customers.delete(customerId);
      mutation.mockRejectedValue(new Error('Insufficient role permissions'));

      await service.syncNow();

      expect(service.getQueueStatus().items).toHaveLength(0);
      // The follow-up pull starts from scratch so the refused delete is undone.
      expect(query).toHaveBeenCalledWith('pull', expect.objectContaining({ since: 0 }));
    });
  });

  describe('base-version conflict handling', () => {
    it('tracks the edited field base and sends the server version as base_updated_at', async () => {
      let customerId = 0;
      await seed(async () => { customerId = await db.customers.add(customerRecord()) as number; });
      await db.customers.update(customerId, { phone: '555-0199' });

      const edited = await db.customers.get(customerId);
      expect(edited).toMatchObject({ sync_status: 'pending', dirty_base: { phone: '555-0100' } });

      mutation.mockResolvedValue({ success: true, operation: 'update', convex_id: 'customers:1', updated_at: 3_000 });
      await service.syncNow();

      expect(mutation).toHaveBeenCalledWith('syncCustomer', expect.objectContaining({
        base_updated_at: 1_000,
        convex_id: 'customers:1',
        data: expect.objectContaining({ phone: '555-0199' }),
      }));
      const synced = await db.customers.get(customerId);
      expect(synced).toMatchObject({ sync_status: 'synced', remote_updated_at: 3_000 });
      expect(synced?.dirty_base).toBeUndefined();
    });

    it('merges non-overlapping remote edits and re-pushes only against the new base', async () => {
      let customerId = 0;
      await seed(async () => { customerId = await db.customers.add(customerRecord()) as number; });
      await db.customers.update(customerId, { phone: '555-0199' });

      mutation
        .mockResolvedValueOnce({
          success: false,
          operation: 'conflict',
          convex_id: 'customers:1',
          conflict: {
            // Office renamed the customer; the technician changed the phone.
            remote_data: { ...customerRecord(), _id: 'customers:1', full_name: 'Jane Smith', updated_at: 2_000 },
            remote_updated_at: 2_000,
          },
        })
        .mockResolvedValueOnce({ success: true, operation: 'update', convex_id: 'customers:1', updated_at: 2_500 });

      const result = await service.syncNow();

      expect(result.success).toBe(true);
      expect(mutation).toHaveBeenCalledTimes(2);
      expect(mutation.mock.calls[1][1]).toMatchObject({
        base_updated_at: 2_000,
        data: expect.objectContaining({ full_name: 'Jane Smith', phone: '555-0199' }),
      });
      const merged = await db.customers.get(customerId);
      expect(merged).toMatchObject({ full_name: 'Jane Smith', phone: '555-0199', sync_status: 'synced', remote_updated_at: 2_500 });
      expect(merged?.conflict_backup).toBeUndefined();
    });

    it('keeps the server value for a field edited on both sides, backing up the local value', async () => {
      let customerId = 0;
      await seed(async () => { customerId = await db.customers.add(customerRecord()) as number; });
      await db.customers.update(customerId, { phone: '555-0199' });

      mutation.mockResolvedValueOnce({
        success: false,
        operation: 'conflict',
        convex_id: 'customers:1',
        conflict: {
          remote_data: { ...customerRecord(), _id: 'customers:1', phone: '555-0777', updated_at: 2_000 },
          remote_updated_at: 2_000,
        },
      });

      const result = await service.syncNow();

      expect(result.success).toBe(true);
      expect(mutation).toHaveBeenCalledTimes(1); // nothing left to push
      const resolved = await db.customers.get(customerId);
      expect(resolved).toMatchObject({ phone: '555-0777', sync_status: 'synced', remote_updated_at: 2_000 });
      expect(JSON.parse(resolved!.conflict_backup!)).toMatchObject({ conflictedFields: ['phone'], data: { phone: '555-0199' } });
    });

    it('field-merges newer pulled versions into records with unsynced edits', async () => {
      let customerId = 0;
      await seed(async () => { customerId = await db.customers.add(customerRecord()) as number; });
      await db.customers.update(customerId, { phone: '555-0199' });
      query.mockResolvedValueOnce({
        ...emptyPage,
        customers: [{ ...customerRecord(), _id: 'customers:1', full_name: 'Jane Smith', updated_at: 2_000 }],
      });

      await service.pullRemoteChanges();

      const merged = await db.customers.get(customerId);
      expect(merged).toMatchObject({
        full_name: 'Jane Smith',
        phone: '555-0199',
        sync_status: 'pending',
        remote_updated_at: 2_000,
        dirty_base: { phone: '555-0100' },
      });
    });
  });

  describe('failed changes', () => {
    it('parks exhausted items in the failed list and retries them on demand', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(10_000_000);
      const noteId = await db.notes.add({
        title: 'Stuck', content: 'note', category: 'General', priority: 'low', sync_status: 'pending', local_updated_at: 1,
      }) as number;
      mutation.mockRejectedValue(new Error('Server validation failed'));

      for (let attempt = 0; attempt < 3; attempt += 1) {
        await service.syncNow();
        vi.setSystemTime(Date.now() + 10_000); // past the queue backoff
      }

      expect(service.getQueueStatus().items).toHaveLength(0);
      expect(await db.notes.get(noteId)).toMatchObject({ sync_status: 'error' });
      expect(await service.getFailedCount()).toBe(1);

      // The next automatic cycle leaves it parked (long backoff) ...
      await service.syncNow();
      expect(mutation).toHaveBeenCalledTimes(3);

      // ... until the user retries.
      mutation.mockReset();
      mutation.mockResolvedValue({ success: true, operation: 'create', convex_id: 'notes:9', updated_at: 20_000 });
      const retried = await service.retryFailed();

      expect(retried.success).toBe(true);
      expect(mutation).toHaveBeenCalledWith('syncNote', expect.objectContaining({ local_id: noteId }));
      expect(await db.notes.get(noteId)).toMatchObject({ sync_status: 'synced', convex_id: 'notes:9' });
      expect(await service.getFailedCount()).toBe(0);
    });

    it('re-queues errored records that are no longer in the queue', async () => {
      const noteId = await db.notes.add({
        title: 'Errored', content: 'note', category: 'General', priority: 'low', sync_status: 'pending', local_updated_at: 1,
      }) as number;
      await db.notes.update(noteId, { sync_status: 'error', sync_error: 'old failure' });
      localStorage.clear(); // queue lost (e.g. storage wiped)
      service.destroy();
      service = new SyncService();
      service.initialize({ mutation, query } as any, 'owner@example.com');
      mutation.mockResolvedValue({ success: true, operation: 'create', convex_id: 'notes:3', updated_at: 2 });

      await service.syncNow();

      expect(mutation).toHaveBeenCalledWith('syncNote', expect.objectContaining({ local_id: noteId }));
      expect(await db.notes.get(noteId)).toMatchObject({ sync_status: 'synced' });
    });
  });

  it('notifies sync-complete listeners after each cycle', async () => {
    const listener = vi.fn();
    service.onSyncComplete(listener);
    await service.syncNow();
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});
