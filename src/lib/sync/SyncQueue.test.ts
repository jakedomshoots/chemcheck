import { describe, it, expect, beforeEach, vi } from 'vitest';
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

  it('dead-letters an item after max failed attempts instead of retrying forever', () => {
    const queue = new SyncQueue();

    queue.enqueue({ table: 'chemicalUsage', localId: 7, operation: 'create', data: { id: 7 } });
    const item = queue.getPending()[0];
    queue.markFailed(item, 'temporary issue');
    queue.markFailed(item, 'temporary issue');
    expect(queue.getPending()[0]).toMatchObject({ retryCount: 2, status: 'pending' });
    queue.markFailed(item, 'permanent issue');

    expect(queue.getPendingCount()).toBe(0);
    expect(queue.getRetryableItems()).toHaveLength(0);
    expect(queue.getDeadLetterItems()).toHaveLength(1);
    expect(queue.getDeadLetterItems()[0]).toMatchObject({
      localId: 7, status: 'dead', retryCount: 3, error: 'permanent issue', deadAt: expect.any(Number),
    });

    // Dead-letter state survives a reload.
    const reloaded = new SyncQueue();
    expect(reloaded.getPendingCount()).toBe(0);
    expect(reloaded.getDeadLetterItems()).toHaveLength(1);

    // A fresh edit of the record replaces the dead item with a live one.
    reloaded.enqueue({ table: 'chemicalUsage', localId: 7, operation: 'update', data: { id: 7, edited: true } });
    expect(reloaded.getDeadLetterItems()).toHaveLength(0);
    expect(reloaded.getPending()[0]).toMatchObject({ retryCount: 0, status: 'pending' });
  });

  it('can requeue a dead-letter item explicitly', () => {
    const queue = new SyncQueue();
    queue.enqueue({ table: 'notes', localId: 5, operation: 'update', data: { id: 5 } });
    const item = queue.getPending()[0];
    for (let i = 0; i < 3; i += 1) queue.markFailed(item, 'boom');
    expect(queue.getDeadLetterCount()).toBe(1);

    expect(queue.requeueDeadLetter('notes', 5)).toBe(true);
    expect(queue.getDeadLetterCount()).toBe(0);
    expect(queue.getRetryableItems()).toHaveLength(1);
    expect(queue.getRetryableItems()[0]).toMatchObject({ retryCount: 0, error: undefined });
  });

  it('keeps a pending delete separate from a later create that reuses the Dexie id', () => {
    const queue = new SyncQueue();

    queue.enqueue({ table: 'serviceLogs', localId: 9, operation: 'update', data: { id: 9, convex_id: 'log-a' } });
    queue.enqueue({ table: 'serviceLogs', localId: 9, operation: 'delete', data: { id: 9, convex_id: 'log-a' } });
    // The delete supersedes the earlier update for the same row.
    expect(queue.getPending()).toHaveLength(1);
    expect(queue.getPending()[0].operation).toBe('delete');

    queue.enqueue({ table: 'serviceLogs', localId: 9, operation: 'create', data: { id: 9 } });
    const operations = queue.getPending().map((item) => item.operation).sort();
    expect(operations).toEqual(['create', 'delete']);
    expect(queue.findItem('serviceLogs', 9)?.operation).toBe('create');
    expect(queue.findItem('serviceLogs', 9, 'delete')?.data.convex_id).toBe('log-a');

    // Reloading from storage preserves both entries.
    const reloaded = new SyncQueue();
    expect(reloaded.getPending().map((item) => item.operation).sort()).toEqual(['create', 'delete']);
  });

  it('never drops unsynced work on overflow; only dead-letter items are evicted', () => {
    const queue = new SyncQueue();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Fill above the soft cap with high-priority customers, then add low-priority logs.
    for (let id = 1; id <= 495; id += 1) {
      queue.enqueue({ table: 'customers', localId: id, operation: 'update', data: { id } });
    }
    for (let id = 1; id <= 10; id += 1) {
      queue.enqueue({ table: 'serviceLogs', localId: id, operation: 'create', data: { id } });
    }
    expect(queue.getPendingCount()).toBe(505);
    expect(queue.getItemsForTable('serviceLogs')).toHaveLength(10);

    // Dead-letter a few items; the next overflow evicts those first.
    for (let id = 1; id <= 3; id += 1) {
      const item = queue.findItem('customers', id)!;
      for (let attempt = 0; attempt < 3; attempt += 1) queue.markFailed(item, 'boom');
    }
    expect(queue.getDeadLetterCount()).toBe(3);
    queue.enqueue({ table: 'notes', localId: 1, operation: 'create', data: { id: 1 } });

    expect(queue.getDeadLetterCount()).toBeLessThan(3);
    expect(queue.getPendingCount()).toBe(503);
    expect(queue.getItemsForTable('serviceLogs')).toHaveLength(10);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('above the soft limit'));
    warn.mockRestore();
  });

  it('clear() also wipes the persisted queue', () => {
    const queue = new SyncQueue();
    queue.enqueue({ table: 'customers', localId: 1, operation: 'update', data: { id: 1 } });
    expect(JSON.parse(localStorage.getItem('chemcheck_sync_queue') || '[]')).toHaveLength(1);

    queue.clear();

    expect(JSON.parse(localStorage.getItem('chemcheck_sync_queue') || '[]')).toHaveLength(0);
    expect(new SyncQueue().getPendingCount()).toBe(0);
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
