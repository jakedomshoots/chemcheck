import { afterEach, describe, it, expect, beforeEach } from 'vitest';
import { SyncQueue } from './SyncQueue';
import { clearActiveTenantScope, setActiveTenantScope } from '@/lib/tenantScope';

describe('SyncQueue', () => {
  beforeEach(() => {
    localStorage.clear();
    setActiveTenantScope({ userEmail: 'owner@chemcheck.test', businessId: 'business_test' });
  });

  afterEach(() => clearActiveTenantScope());

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
    expect(queue.markSynced('notes', 12)).toBe(true);
    expect(queue.markSynced('notes', 12)).toBe(false);
  });

  it('supports idempotent clear of full queue', () => {
    const queue = new SyncQueue();

    queue.enqueue({ table: 'serviceLogs', localId: 99, operation: 'create', data: { id: 99 } });

    expect(queue.clear()).toBe(true);
    expect(queue.clear()).toBe(false);
    expect(queue.getPendingCount()).toBe(0);
  });

  it('retains an exhausted item for explicit recovery instead of silently dropping field work', () => {
    const queue = new SyncQueue();

    queue.enqueue({ table: 'chemicalUsage', localId: 7, operation: 'create', data: { id: 7 } });
    queue.markFailed('chemicalUsage', 7, 'temporary issue');
    queue.markFailed('chemicalUsage', 7, 'temporary issue');
    queue.markFailed('chemicalUsage', 7, 'temporary issue');

    expect(queue.getPendingCount()).toBe(1);
    expect(queue.getRetryableItems()).toHaveLength(0);
    expect(queue.retryBlocked('chemicalUsage', 7)).toBe(true);
    expect(queue.getRetryableItems()).toHaveLength(1);
  });

  it('purges legacy plaintext queue payloads instead of loading customer data from localStorage', () => {
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

    expect(queue.getPendingCount()).toBe(0);
    expect(localStorage.getItem('chemcheck_sync_queue')).toBeNull();
  });

  it('does not write queue payloads back to localStorage', () => {
    localStorage.setItem('chemcheck_sync_queue', '{ invalid-json');
    const queue = new SyncQueue();
    queue.enqueue({ table: 'notes', localId: 3, operation: 'update', data: { title: 'private note' } });

    expect(localStorage.getItem('chemcheck_sync_queue')).toBeNull();
  });
});
