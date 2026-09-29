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

  it('drops item after max failed attempts', () => {
    const queue = new SyncQueue();

    queue.enqueue({ table: 'chemicalUsage', localId: 7, operation: 'create', data: { id: 7 } });
    const item = queue.getPending()[0];
    queue.markFailed(item, 'temporary issue');
    queue.markFailed(item, 'temporary issue');
    queue.markFailed(item, 'temporary issue');

    expect(queue.getPendingCount()).toBe(0);
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
