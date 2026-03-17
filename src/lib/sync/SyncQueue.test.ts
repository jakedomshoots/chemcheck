import { beforeEach, describe, expect, it } from 'vitest';
import { SyncQueue } from './SyncQueue';

describe('SyncQueue', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('persists updates to an existing queue item', () => {
    const queue = new SyncQueue();

    queue.enqueue({
      table: 'customers',
      localId: 7,
      operation: 'create',
      data: { full_name: 'Original' },
    });

    queue.updateItem('customers', 7, {
      operation: 'update',
      data: { full_name: 'Updated' },
      retryCount: 0,
      error: undefined,
      lastAttempt: undefined,
    });

    const reloadedQueue = new SyncQueue();
    const item = reloadedQueue.findItem('customers', 7);

    expect(item?.operation).toBe('update');
    expect(item?.data).toEqual({ full_name: 'Updated' });
  });
});
