import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SyncService } from './SyncService';
import { monitoring } from '@/lib/monitoring';

function createMockTable() {
  return {
    get: vi.fn(),
    add: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    where: vi.fn(() => ({
      equals: vi.fn(() => ({
        count: vi.fn(() => Promise.resolve(0)),
        toArray: vi.fn(() => Promise.resolve([])),
      })),
      notEqual: vi.fn(() => ({
        count: vi.fn(() => Promise.resolve(0)),
        toArray: vi.fn(() => Promise.resolve([])),
      })),
    })),
  };
}

vi.mock('@/db/chemcheck-db', () => ({
  db: {
    customers: createMockTable(),
    serviceLogs: createMockTable(),
    chemicalUsage: createMockTable(),
    notes: createMockTable(),
    saltCellLogs: createMockTable(),
    setSyncService: vi.fn(),
  },
}));

vi.mock('../../../convex/_generated/api', () => ({
  api: {
    sync: {
      syncCustomer: 'syncCustomer',
      syncServiceLog: 'syncServiceLog',
      syncChemicalUsage: 'syncChemicalUsage',
      syncNote: 'syncNote',
      syncSaltCellLog: 'syncSaltCellLog',
    },
  },
}));

vi.mock('./SyncQueue', () => {
  class MockSyncQueue {
    enqueue = vi.fn();
    dequeue = vi.fn();
    getPending = vi.fn(() => []);
    getPendingCount = vi.fn(() => 0);
    markSynced = vi.fn();
    markFailed = vi.fn();
    getRetryableItems = vi.fn(() => []);
    findItem = vi.fn(() => undefined);
    getBatchSize = vi.fn(() => 20);
    getCapacityStatus = vi.fn(() => ({
      current: 0,
      max: 500,
      warningThreshold: 400,
      usagePercent: 0,
    }));
  }

  return { SyncQueue: MockSyncQueue };
});

vi.mock('./ConflictResolver', () => {
  class MockConflictResolver {
    getConflictInfo = vi.fn(() => null);
    resolve = vi.fn(() => ({
      resolved: {},
      hadConflict: false,
      backupCreated: false,
    }));
    logConflict = vi.fn();
    detectConflict = vi.fn(() => false);
  }

  return { ConflictResolver: MockConflictResolver };
});

describe('SyncService conflict and telemetry hardening', () => {
  let metricSpy: any;

  beforeEach(() => {
    metricSpy = vi.spyOn(monitoring, 'recordMetric');
    monitoring.clearData();
    vi.clearAllMocks();

    Object.defineProperty(navigator, 'onLine', {
      writable: true,
      value: true,
    });
  });

  afterEach(() => {
    metricSpy.mockRestore();
  });

  it('limits sync cycle processing to configured batch size and keeps queue telemetry in sync-cycle order', async () => {
    const syncService = new SyncService();
    const mockConvexClient = { mutation: vi.fn() };
    const queue = (syncService as any).syncQueue;

    queue.getPendingCount.mockReturnValue(40);
    queue.getCapacityStatus.mockReturnValue({
      current: 40,
      max: 500,
      warningThreshold: 400,
      usagePercent: 8,
    });
    queue.getBatchSize.mockReturnValue(20);
    queue.getRetryableItems.mockReturnValue(
      Array.from({ length: 40 }, (_, index) => ({
        table: 'customers',
        localId: index + 1,
        operation: 'update',
        data: { id: index + 1 },
        retryCount: 0,
        priority: 12,
      }))
    );

    const queueSyncSpy = vi.spyOn(syncService as any, 'syncQueueItem').mockResolvedValue(true);

    syncService.initialize(mockConvexClient);
    const result = await syncService.syncNow();

    expect(result.success).toBe(true);
    expect(result.syncedCount).toBe(20);
    expect(result.failedCount).toBe(0);
    expect(queueSyncSpy).toHaveBeenCalledTimes(20);

    const depthCalls = metricSpy.mock.calls.filter(([name]: any[]) => name === 'sync_queue_depth');
    expect(depthCalls).toHaveLength(3);
    expect(depthCalls[0][1]).toBe(40);
    expect(depthCalls[0][2]).toMatchObject({
      phase: 'cycle_start',
      trigger: 'manual',
    });
    expect(depthCalls[1][2]).toMatchObject({
      phase: 'before_batch',
      trigger: 'manual',
    });
    expect(depthCalls[2][2]).toMatchObject({
      phase: 'after_batch',
      trigger: 'manual',
      success: true,
      syncedCount: 20,
      failedCount: 0,
    });

    syncService.destroy();
  });

  it('retries local-conflict resolution within bounds and emits conflict metrics and terminal failure', async () => {
    vi.useFakeTimers();

    const syncService = new SyncService();
    const conflictRecord = {
      id: 12,
      full_name: 'Route Test',
      local_updated_at: 2000,
      sync_status: 'pending' as const,
    };

    const mockConvexClient = {
      mutation: vi.fn().mockResolvedValue({
        success: false,
        operation: 'conflict',
        conflict: {
          remote_data: {
            id: 12,
            full_name: 'Remote Route Test',
            local_updated_at: 1000,
            remote_updated_at: 900,
          },
          remote_updated_at: 900,
        },
      }),
    };

    const { db } = await import('@/db/chemcheck-db');
    vi.mocked(db.customers.get).mockResolvedValue(conflictRecord as any);
    vi.mocked(db.customers.update).mockResolvedValue(1);

    syncService.initialize(mockConvexClient);

    const resolver = (syncService as any).conflictResolver;
    resolver.getConflictInfo = vi.fn(() => ({
      localTimestamp: 2000,
      remoteTimestamp: 900,
      conflictedFields: ['full_name'],
    }));
    resolver.resolve = vi.fn(() => ({
      hadConflict: true,
      backupCreated: true,
      resolved: { ...conflictRecord },
    }));

    try {
      const resultPromise = syncService.syncRecord('customers', 12);
      await vi.advanceTimersByTimeAsync(1600);
      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.failedCount).toBe(1);
      expect(result.syncedCount).toBe(0);
      expect(mockConvexClient.mutation).toHaveBeenCalledTimes(3);

      const detectedCalls = metricSpy.mock.calls.filter(([name]: any[]) => name === 'sync_conflict_detected');
      const retryCalls = metricSpy.mock.calls.filter(([name]: any[]) => name === 'sync_conflict_retry');
      const exhaustedCalls = metricSpy.mock.calls.filter(([name]: any[]) => name === 'sync_conflict_exhausted');

      expect(detectedCalls).toHaveLength(3);
      expect(retryCalls).toHaveLength(2);
      expect(exhaustedCalls).toHaveLength(1);

      expect(retryCalls[0][2]).toMatchObject({
        localId: 12,
        table: 'customers',
        retryAttempt: 1,
      });
      expect(retryCalls[1][2]).toMatchObject({
        localId: 12,
        table: 'customers',
        retryAttempt: 2,
      });
      expect(exhaustedCalls[0][2]).toMatchObject({
        localId: 12,
        table: 'customers',
        conflictRetryCount: 2,
      });
    } finally {
      vi.useRealTimers();
      syncService.destroy();
    }
  });
});
