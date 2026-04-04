/**
 * SyncQueue manages the queue of records pending synchronization
 * and keeps the queue persisted safely in localStorage.
 */

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

const STORAGE_KEY = 'chemcheck_sync_queue';
const MAX_RETRIES = 3;
const MAX_QUEUE_SIZE = 500; // Prevent unbounded growth
const QUEUE_WARNING_THRESHOLD = Math.floor(MAX_QUEUE_SIZE * 0.8);
const BATCH_SIZE = 20; // Process this many items per sync cycle
const PERSIST_ERROR_THROTTLE_MS = 15_000;

export class SyncQueue {
  private queue: SyncQueueItem[] = [];
  private highWatermarkWarned = false;
  private lastPersistErrorAt = 0;
  private isPersisting = false;

  constructor() {
    this.loadFromStorage();
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

    // Enforce queue size limit - remove lowest priority items if exceeded
    if (this.queue.length > MAX_QUEUE_SIZE) {
      const overflow = this.queue.length - MAX_QUEUE_SIZE;
      this.queue.splice(-overflow, overflow);
      console.warn(
        `Sync queue overflow: removed ${overflow} low-priority items to maintain limit of ${MAX_QUEUE_SIZE}`
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

    if (item.retryCount >= MAX_RETRIES) {
      // Remove from queue after max retries
      this.queue.splice(itemIndex, 1);
      console.log(`Removed ${table}[${localId}] from queue after ${MAX_RETRIES} failed attempts`);
    }
    else {
      // Keep in queue for retry with exponential backoff
      console.log(`Marked ${table}[${localId}] as failed (attempt ${item.retryCount}/${MAX_RETRIES})`);
    }

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

  private loadFromStorage(): void {
    if (!this.isStorageAvailable()) return;

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) {
        return;
      }

      const parsed = JSON.parse(stored);
      this.queue = this.sanitizeQueue(parsed, false);
      this.updateHighWatermarkState();
      console.log(`Loaded ${this.queue.length} items from sync queue storage`);
    } catch (error) {
      console.error('Failed to load sync queue from storage:', error);
      this.queue = [];
    }
  }

  private isStorageAvailable(): boolean {
    try {
      return typeof window !== 'undefined' && !!window.localStorage;
    } catch {
      return false;
    }
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

    if (sorted.length > MAX_QUEUE_SIZE) {
      sorted.splice(MAX_QUEUE_SIZE);
      if (log) {
        console.warn(`Sync queue contains more than ${MAX_QUEUE_SIZE} items. Truncated oldest entries.`);
      }
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

  private saveToStorage(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.queue));
  }

  private shouldThrottlePersistError(now: number): boolean {
    if (this.lastPersistErrorAt && (now - this.lastPersistErrorAt) < PERSIST_ERROR_THROTTLE_MS) {
      return true;
    }

    this.lastPersistErrorAt = now;
    return false;
  }

  private persistQueueState(action: string): void {
    if (!this.isStorageAvailable()) return;

    if (this.isPersisting) return;
    this.isPersisting = true;

    try {
      this.saveToStorage();
    } catch (error) {
      const now = Date.now();
      if (!this.shouldThrottlePersistError(now)) {
        console.error(`Sync queue persist failed during ${action}:`, error);
      }
      // Keep queue in memory and continue operation
    } finally {
      this.isPersisting = false;
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
