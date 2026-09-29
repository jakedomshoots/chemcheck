import { describe, it, expect, beforeEach } from 'vitest';
import { SyncQueue } from './SyncQueue';

describe('SyncQueue', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('deduplicates items by table and localId with latest operation winning', () => {
    const queue = new SyncQueue();

    queue.enqueue({ table: 'customers', localId: 1, operation: 'create', data: { id: 1, source: 'first' } });
    queue.enqueue({ table: 'customers', localId: 1, operation: 'update', data: { id: 1, source: 'second' } });

    expect(queue.getPendingCount()).toBe(1);
    expect(queue.getPending()[0].operation).toBe('update');
  });

  it('clears queue entries idempotently by item', () => {
    const queue = new SyncQueue();

    queue.enqueue({ table: 'notes', localId: 11, operation: 'create', data: { id: 11 } });

    expect(queue.clearForItem('notes', 11)).toBe(true);
    expect(queue.clearForItem('notes', 11)).toBe(false);
    expect(queue.getPendingCount()).toBe(0);

    queue.enqueue({ table: 'notes', localId: 12, operation: 'create', data: { id: 12 } });
    const item = queue.getPending()[0];
    expect(queue.markSynced(item)).toBe(true);
    expect(queue.markSynced(item)).toBe(false);
  });

  it('supports idempotent clear of full queue', () => {
    const queue = new SyncQueue();

    queue.enqueue({ table: 'serviceLogs', localId: 99, operation: 'create', data: { id: 99 } });

    expect(queue.clear()).toBe(true);
    expect(queue.clear()).toBe(false);
    expect(queue.getPendingCount()).toBe(0);
  });

  it('parks an item in the persisted failed list after max failed attempts instead of dropping it', () => {
    const queue = new SyncQueue();

    queue.enqueue({ table: 'chemicalUsage', localId: 7, operation: 'create', data: { id: 7 } });
    const item = queue.getPending()[0];
    queue.markFailed(item, 'temporary issue');
    queue.markFailed(item, 'temporary issue');
    queue.markFailed(item, 'permanent issue');

    expect(queue.getPendingCount()).toBe(0);
    expect(queue.getRetryableItems()).toHaveLength(0);
    expect(queue.getFailedCount()).toBe(1);
    expect(queue.getFailedItems()[0]).toMatchObject({ table: 'chemicalUsage', localId: 7, error: 'permanent issue', failedCount: 1 });

    // Survives a reload.
    const reloaded = new SyncQueue();
    expect(reloaded.getFailedItems()).toHaveLength(1);
  });

  it('retries failed items on demand with a fresh retry budget', () => {
    const queue = new SyncQueue();
    queue.enqueue({ table: 'notes', localId: 4, operation: 'delete', data: { convex_id: 'notes:4' } });
    const item = queue.getPending()[0];
    for (let attempt = 0; attempt < 3; attempt += 1) queue.markFailed(item, 'down');

    expect(queue.retryFailed()).toBe(1);
    expect(queue.getFailedCount()).toBe(0);
    expect(queue.getPending()).toHaveLength(1);
    expect(queue.getPending()[0]).toMatchObject({ localId: 4, operation: 'delete', retryCount: 0, data: { convex_id: 'notes:4' } });
    expect(queue.getPending()[0].revision).not.toBe(item.revision);
  });

  it('auto-revives failed items only after their failed-list backoff elapsed', () => {
    const queue = new SyncQueue();
    queue.enqueue({ table: 'notes', localId: 5, operation: 'update', data: { id: 5 } });
    const item = queue.getPending()[0];
    for (let attempt = 0; attempt < 3; attempt += 1) queue.markFailed(item, 'down');
    const failedAt = queue.getFailedItems()[0].failedAt!;

    expect(queue.retryFailed({ onlyDue: true, now: failedAt + 1_000 })).toBe(0);
    expect(queue.retryFailed({ onlyDue: true, now: failedAt + 60_000 })).toBe(1);
  });

  it('lets a newer local edit supersede a failed item', () => {
    const queue = new SyncQueue();
    queue.enqueue({ table: 'notes', localId: 6, operation: 'update', data: { id: 6, title: 'old' } });
    const item = queue.getPending()[0];
    for (let attempt = 0; attempt < 3; attempt += 1) queue.markFailed(item, 'down');

    queue.enqueue({ table: 'notes', localId: 6, operation: 'update', data: { id: 6, title: 'new' } });

    expect(queue.getFailedCount()).toBe(0);
    expect(queue.getPending()[0].data.title).toBe('new');
  });

  it('never evicts unsynced items beyond the capacity warning threshold', () => {
    const queue = new SyncQueue();
    for (let localId = 1; localId <= 520; localId += 1) {
      queue.enqueue({ table: 'serviceLogs', localId, operation: 'create', data: { id: localId } });
    }

    expect(queue.getPendingCount()).toBe(520);
    expect(queue.getCapacityStatus().usagePercent).toBeGreaterThan(100);
    expect(new SyncQueue().getPendingCount()).toBe(520);
  });

  it('does not let a stale completion remove a newer revision of the same record', () => {
    const queue = new SyncQueue();
    queue.enqueue({ table: 'customers', localId: 1, operation: 'update', data: { id: 1, sort_order: 1 } });
    const olderRevision = queue.getPending()[0];

    queue.enqueue({ table: 'customers', localId: 1, operation: 'update', data: { id: 1, sort_order: 0 } });

    expect(queue.markSynced(olderRevision)).toBe(false);
    expect(queue.getPending()).toHaveLength(1);
    expect(queue.getPending()[0].data.sort_order).toBe(0);
  });

  it('does not let a stale failure penalize a newer revision of the same record', () => {
    const queue = new SyncQueue();
    queue.enqueue({ table: 'customers', localId: 1, operation: 'update', data: { id: 1, sort_order: 1 } });
    const olderRevision = queue.getPending()[0];

    queue.enqueue({ table: 'customers', localId: 1, operation: 'update', data: { id: 1, sort_order: 0 } });
    queue.markFailed(olderRevision, 'old request failed');

    expect(queue.getPending()).toHaveLength(1);
    expect(queue.getPending()[0]).toMatchObject({ retryCount: 0, error: undefined });
    expect(queue.getPending()[0].data.sort_order).toBe(0);
  });

  it('keeps only the newest reorder through repeated stale completions and failures', () => {
    const queue = new SyncQueue();
    const staleRevisions = [];

    for (let sortOrder = 0; sortOrder < 100; sortOrder += 1) {
      queue.enqueue({
        table: 'customers',
        localId: 1,
        operation: 'update',
        data: { id: 1, sort_order: sortOrder },
      });
      staleRevisions.push(queue.getPending()[0]);
    }

    const newestRevision = staleRevisions.pop()!;
    for (const [index, staleRevision] of staleRevisions.entries()) {
      if (index % 2 === 0) expect(queue.markSynced(staleRevision)).toBe(false);
      else queue.markFailed(staleRevision, 'stale request');
    }

    expect(queue.getPending()).toHaveLength(1);
    expect(queue.getPending()[0]).toMatchObject({
      revision: newestRevision.revision,
      retryCount: 0,
      error: undefined,
      data: { sort_order: 99 },
    });
  });

  it('loads valid queue payload from localStorage on startup', () => {
    localStorage.setItem('chemcheck_sync_queue', JSON.stringify([
      {
        table: 'notes',
        localId: 3,
        operation: 'update',
        data: { id: 3, title: 'From disk' },
        retryCount: 0,
        priority: 12,
        lastAttempt: Date.now() - 100,
      },
    ]));

    const queue = new SyncQueue();

    expect(queue.getPendingCount()).toBe(1);
    expect(queue.getPending()[0].table).toBe('notes');
    expect(queue.getPending()[0].localId).toBe(3);
    expect(queue.getPending()[0].revision).toEqual(expect.any(String));
  });

  it('recovers gracefully from invalid storage by starting empty', () => {
    localStorage.setItem('chemcheck_sync_queue', '{ invalid-json');
    const queue = new SyncQueue();

    expect(queue.getPendingCount()).toBe(0);
  });
});
