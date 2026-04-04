import { describe, it, expect, vi } from 'vitest';
import { SyncService } from './SyncService';

vi.mock('@/db/chemcheck-db', () => {
  const buildLegacyRecord = (id: number) => ({
    id,
    convex_id: undefined,
    sync_status: undefined,
  });

  const createTableMock = (legacyId: number) => ({
    where: vi.fn(() => ({
      equals: vi.fn((value: unknown) => {
        if (value === 'pending') {
          return {
            toArray: vi.fn(async () => []),
          };
        }

        if (value === undefined) {
          throw new TypeError(
            'Invalid key provided. Keys must be of type string, number, Date or Array<string | number | Date>.'
          );
        }

        return {
          toArray: vi.fn(async () => []),
        };
      }),
    })),
    toCollection: vi.fn(() => ({
      toArray: vi.fn(async () => [buildLegacyRecord(legacyId)]),
    })),
  });

  return {
    db: {
      customers: createTableMock(1),
      serviceLogs: createTableMock(2),
      chemicalUsage: createTableMock(3),
      notes: createTableMock(4),
      saltCellLogs: createTableMock(5),
      setSyncService: vi.fn(),
    },
  };
});

vi.mock('../../../convex/_generated/api', () => ({
  api: {
    sync: {},
  },
}));

vi.mock('./SyncQueue', () => {
  const MockSyncQueue = vi.fn();
  MockSyncQueue.prototype.enqueue = vi.fn();
  MockSyncQueue.prototype.dequeue = vi.fn();
  MockSyncQueue.prototype.getPending = vi.fn(() => []);
  MockSyncQueue.prototype.getPendingCount = vi.fn(() => 0);
  MockSyncQueue.prototype.markSynced = vi.fn();
  MockSyncQueue.prototype.markFailed = vi.fn();
  MockSyncQueue.prototype.getRetryableItems = vi.fn(() => []);
  MockSyncQueue.prototype.findItem = vi.fn(() => undefined);
  MockSyncQueue.prototype.getBatchSize = vi.fn(() => 10);
  MockSyncQueue.prototype.getCapacityStatus = vi.fn(() => ({
    current: 0,
    max: 1000,
    warningThreshold: 800,
    usagePercent: 0,
  }));

  return { SyncQueue: MockSyncQueue };
});

vi.mock('./ConflictResolver', () => {
  const MockConflictResolver = vi.fn();
  MockConflictResolver.prototype.detectConflict = vi.fn(() => false);
  MockConflictResolver.prototype.resolve = vi.fn();
  MockConflictResolver.prototype.createBackup = vi.fn();

  return { ConflictResolver: MockConflictResolver };
});

vi.mock('@/lib/monitoring', () => ({
  monitoring: {
    recordMetric: vi.fn(),
    reportError: vi.fn(),
  },
}));

describe('SyncService pending count legacy handling', () => {
  it('counts legacy rows when Dexie rejects equals(undefined)', async () => {
    const service = new SyncService();

    const pendingCount = await service.getPendingCount();

    expect(pendingCount).toBe(5);
    service.destroy();
  });
});
