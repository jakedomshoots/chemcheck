/**
 * SyncQueue manages the queue of records pending synchronization
 * and persists only tenant-scoped metadata in Dexie. Record payloads never
 * enter localStorage; sync re-reads the authoritative local row by ID.
 */

import { db, type SyncOutboxItem } from '@/db/chemcheck-db';
import { getActiveTenantScope, subscribeTenantScope } from '@/lib/tenantScope';

export interface SyncQueueItem {
  table: 'customers' | 'serviceLogs' | 'chemicalUsage' | 'notes' | 'saltCellLogs';
  localId: number;
  operation: 'create' | 'update' | 'delete';
  data: Record<string, any>;
  retryCount: number;
  lastAttempt?: number;
  error?: string;
  priority: number; // Lower number = higher priority
}

const MAX_RETRIES = 3;
const MAX_QUEUE_SIZE = 500;
const QUEUE_WARNING_THRESHOLD = Math.floor(MAX_QUEUE_SIZE * 0.8);
const BATCH_SIZE = 20; // Process this many items per sync cycle

export class SyncQueue {
  private queue: SyncQueueItem[] = [];
  private highWatermarkWarned = false;
  private isPersisting = false;
  private activeTenantKey: string | null = null;
  private scopeUnsubscribe: (() => void) | null = null;

  constructor() {
    // Remove legacy plaintext queue data immediately. It may contain names,
    // gate codes, notes, and other customer content from previous releases.
    try {
      localStorage.removeItem('chemcheck_sync_queue');
    } catch {
      // Local storage may be unavailable in private browsing/test environments.
    }
    this.scopeUnsubscribe = subscribeTenantScope(() => {
      void this.reloadForActiveTenant();
    });
    void this.reloadForActiveTenant();
  }

  /**
   * Get batch size for sync operations
   */
  getBatchSize(): number {
    return BATCH_SIZE;
  }

  /**
   * Add record to sync queue
   */
  enqueue(item: Omit<SyncQueueItem, 'retryCount' | 'priority'>): void {
    const queueItem: SyncQueueItem = this.normalizeQueueItem({
      ...item,
      retryCount: 0,
      priority: this.getPriority(item.table, item.operation),
    });

    const nextQueue = [...this.queue];
    const existingIndex = nextQueue.findIndex(
      entry => entry.table === queueItem.table && entry.localId === queueItem.localId
    );

    if (existingIndex >= 0) {
      nextQueue[existingIndex] = queueItem;
    } else {
      nextQueue.push(queueItem);
    }

    this.queue = this.sanitizeQueue(nextQueue);

    // Never discard field work. Surface an explicit warning instead of removing
    // low-priority entries once the operating threshold is exceeded.
    if (this.queue.length > MAX_QUEUE_SIZE) {
      console.warn(
        `Sync queue exceeds ${MAX_QUEUE_SIZE} records. Keep the device online until it drains.`
      );
    }

    this.updateHighWatermarkState();
    this.persistQueueState('enqueue');

    console.log(`Enqueued ${item.table}[${item.localId}] for ${item.operation}`);
  }

  /**
   * Get next item to sync (without removing from queue)
   */
  peekNext(): SyncQueueItem | null {
    if (this.queue.length === 0) {
      return null;
    }
    return this.queue[0];
  }

  /**
   * Get all pending items
   */
  getPending(): SyncQueueItem[] {
    return [...this.queue];
  }

  /**
   * Get pending count
   */
  getPendingCount(): number {
    return this.queue.length;
  }

  getCapacityStatus(): { current: number; max: number; warningThreshold: number; usagePercent: number } {
    const current = this.queue.length;
    return {
      current,
      max: MAX_QUEUE_SIZE,
      warningThreshold: QUEUE_WARNING_THRESHOLD,
      usagePercent: Math.round((current / MAX_QUEUE_SIZE) * 100),
    };
  }

  /**
   * Get items ready for retry (past their backoff period)
   */
  getRetryableItems(): SyncQueueItem[] {
    const now = Date.now();

    const retryable = this.queue.filter((item) => {
      if (item.retryCount >= MAX_RETRIES) return false;
      if (item.retryCount === 0) return true; // Never attempted
      if (!item.lastAttempt) return true; // No last attempt recorded

      // Exponential backoff: 1s, 2s, 4s
      const backoffMs = Math.pow(2, item.retryCount - 1) * 1000;
      return (now - item.lastAttempt) >= backoffMs;
    });

    return [...retryable].sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return (a.lastAttempt || 0) - (b.lastAttempt || 0);
    });
  }

  /**
   * Remove all entries for a given record from queue
   */
  clearForItem(table: SyncQueueItem['table'], localId: number): boolean {
    const nextQueue = this.queue.filter(
      (item) => !(item.table === table && item.localId === localId)
    );
    if (nextQueue.length === this.queue.length) {
      return false;
    }

    this.queue = this.sanitizeQueue(nextQueue);
    this.updateHighWatermarkState();
    this.persistQueueState('clearForItem');
    return true;
  }

  /**
   * Mark item as synced (remove from queue)
   */
  markSynced(table: string, localId: number): boolean {
    if (this.queue.length === 0) {
      return false;
    }

    const nextQueue = this.queue.filter(
      item => !(item.table === table && item.localId === localId)
    );

    if (nextQueue.length === this.queue.length) {
      return false;
    }

    this.queue = this.sanitizeQueue(nextQueue);
    this.updateHighWatermarkState();

    try {
      this.persistQueueState('markSynced');
      console.log(`Marked ${table}[${localId}] as synced`);
    } catch (error) {
      console.error(`Failed to persist sync completion for ${table}[${localId}]:`, error);
      // Continue execution - the item is still removed from memory queue
    }

    return true;
  }

  /**
   * Mark item as failed and potentially retry
   */
  markFailed(table: string, localId: number, error: string): void {
    const itemIndex = this.queue.findIndex(
      item => item.table === table && item.localId === localId
    );

    if (itemIndex === -1) {
      console.warn(`Item ${table}[${localId}] not found in queue for failure marking`);
      return;
    }

    const item = this.queue[itemIndex];
    item.retryCount += 1;
    item.lastAttempt = Date.now();
    item.error = error;

    // Keep exhausted items for user-visible recovery. Deleting an outbox entry
    // after retries silently loses field work.
    console.log(`Marked ${table}[${localId}] as failed (attempt ${item.retryCount}/${MAX_RETRIES})`);

    this.queue = this.sanitizeQueue(this.queue);
    this.updateHighWatermarkState();
    this.persistQueueState('markFailed');
  }

  /**
   * Clear all items from queue
   */
  clear(): boolean {
    if (this.queue.length === 0) {
      this.highWatermarkWarned = false;
      return false;
    }

    this.queue = [];
    this.highWatermarkWarned = false;
    this.persistQueueState('clear');
    console.log('Sync queue cleared');
    return true;
  }

  /**
   * Find existing item in queue by table and localId
   */
  findItem(table: SyncQueueItem['table'], localId: number): SyncQueueItem | undefined {
    return this.queue.find(item => item.table === table && item.localId === localId);
  }

  /**
   * Get items for a specific table
   */
  getItemsForTable(table: string): SyncQueueItem[] {
    return this.queue.filter(item => item.table === table);
  }

  retryBlocked(table: SyncQueueItem['table'], localId: number): boolean {
    const item = this.findItem(table, localId);
    if (!item || item.retryCount < MAX_RETRIES) return false;
    item.retryCount = 0;
    item.lastAttempt = undefined;
    item.error = undefined;
    this.persistQueueState('retryBlocked');
    return true;
  }

  // ============================================
  // Private Methods
  // ============================================

  private getPriority(table: string, operation: string): number {
    // Priority order: customers first (dependencies), then others
    // Lower number = higher priority

    const tablePriority = {
      customers: 1,
      serviceLogs: 2,
      chemicalUsage: 2,
      notes: 2,
      saltCellLogs: 2,
    };

    const operationPriority = {
      create: 0,
      update: 1,
      delete: 2,
    };

    return (tablePriority[table as keyof typeof tablePriority] || 3) * 10 +
      (operationPriority[operation as keyof typeof operationPriority] || 3);
  }

  private sanitizeQueue(items: unknown, log = true): SyncQueueItem[] {
    if (!Array.isArray(items)) {
      if (log) {
        console.warn('Invalid sync queue data in storage, resetting');
      }
      return [];
    }

    const valid = items.filter(this.isValidQueueItem).map((item) => this.normalizeQueueItem(item));
    const deduped: SyncQueueItem[] = [];
    const seen = new Set<string>();

    for (const item of valid) {
      const key = `${item.table}:${item.localId}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      deduped.push(item);
    }

    const sorted = deduped.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return (a.lastAttempt || 0) - (b.lastAttempt || 0);
    });

    if (sorted.length !== valid.length && log) {
      console.warn(`Sync queue stored with duplicate/invalid records. Loaded ${sorted.length}/${valid.length} unique items.`);
    }

    return sorted;
  }

  private normalizeQueueItem(item: SyncQueueItem): SyncQueueItem {
    return {
      ...item,
      retryCount: Number.isFinite(item.retryCount) ? Math.max(0, item.retryCount) : 0,
      priority: Number.isFinite(item.priority) ? item.priority : this.getPriority(item.table, item.operation),
      lastAttempt: item.lastAttempt && Number.isFinite(item.lastAttempt) ? item.lastAttempt : undefined,
      error: typeof item.error === 'string' ? item.error : undefined,
    };
  }

  private updateHighWatermarkState(): void {
    if (this.queue.length >= QUEUE_WARNING_THRESHOLD) {
      if (!this.highWatermarkWarned) {
        console.warn(
          `Sync queue is ${this.queue.length}/${MAX_QUEUE_SIZE} (${Math.round((this.queue.length / MAX_QUEUE_SIZE) * 100)}%).`
        );
        this.highWatermarkWarned = true;
      }
    } else {
      this.highWatermarkWarned = false;
    }
  }

  private persistQueueState(action: string): void {
    if (this.isPersisting) return;
    this.isPersisting = true;
    const scope = getActiveTenantScope();
    const tenantKey = scope?.key;
    const snapshot = this.queue.map((item) => ({ ...item }));

    void (async () => {
      try {
        if (!tenantKey) return;
        const now = Date.now();
        const current = await db.syncOutbox.where('tenant_id').equals(tenantKey).toArray();
        await db.transaction('rw', db.syncOutbox, async () => {
          await db.syncOutbox.bulkDelete(current.map((entry) => entry.id!).filter(Boolean));
          const entries: SyncOutboxItem[] = snapshot.map((item) => ({
            tenant_id: tenantKey,
            item_key: `${item.table}:${item.localId}`,
            table: item.table,
            local_id: item.localId,
            operation: item.operation,
            retry_count: item.retryCount,
            last_attempt: item.lastAttempt,
            error: item.error,
            priority: item.priority,
            created_at: now,
            updated_at: now,
          }));
          if (entries.length) await db.syncOutbox.bulkAdd(entries);
        });
      } catch (error) {
        console.error(`Sync outbox persist failed during ${action}:`, error);
      } finally {
        this.isPersisting = false;
      }
    })();
  }

  private async reloadForActiveTenant(): Promise<void> {
    const scope = getActiveTenantScope();
    this.activeTenantKey = scope?.key ?? null;
    if (!scope) {
      this.queue = [];
      this.highWatermarkWarned = false;
      return;
    }

    try {
      const entries = await db.syncOutbox.where('tenant_id').equals(scope.key).toArray();
      if (this.activeTenantKey !== scope.key) return;
      this.queue = this.sanitizeQueue(entries.map((entry) => ({
        table: entry.table,
        localId: entry.local_id,
        operation: entry.operation,
        data: {},
        retryCount: entry.retry_count,
        lastAttempt: entry.last_attempt,
        error: entry.error,
        priority: entry.priority,
      })), false);
      this.updateHighWatermarkState();
    } catch (error) {
      console.error('Failed to load tenant sync outbox:', error);
      this.queue = [];
    }
  }

  private isValidQueueItem(item: unknown): item is SyncQueueItem {
    return !!item &&
      typeof item === 'object' &&
      typeof (item as Record<string, unknown>).table === 'string' &&
      typeof (item as Record<string, unknown>).localId === 'number' &&
      typeof (item as Record<string, unknown>).operation === 'string' &&
      typeof (item as Record<string, unknown>).priority === 'number' &&
      typeof (item as Record<string, unknown>).retryCount === 'number' &&
      (item as Record<string, unknown>).data !== undefined &&
      typeof (item as Record<string, unknown>).data === 'object';
  }
}
