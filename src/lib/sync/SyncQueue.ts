/**
 * SyncQueue manages the queue of records pending synchronization
 * and keeps the queue persisted safely in localStorage.
 *
 * Unsynced work is never dropped: items that exhaust their retries move to a
 * persisted "failed" list that is retried with a long backoff (or on demand
 * via retryFailed()), and the queue is never truncated.  MAX_QUEUE_SIZE is
 * only a capacity warning threshold.
 */

export interface SyncQueueItem {
  table: 'customers' | 'pools' | 'equipment' | 'serviceLogs' | 'chemicalUsage' | 'notes' | 'saltCellLogs';
  localId: number;
  operation: 'create' | 'update' | 'delete';
  data: Record<string, any>;
  retryCount: number;
  lastAttempt?: number;
  error?: string;
  priority: number; // Lower number = higher priority
  /** Unique identity for this exact queued revision of the record. */
  revision: string;
  /** Set when the item exhausted its retries and moved to the failed list. */
  failedAt?: number;
  /** How many times the item has been moved to the failed list. */
  failedCount?: number;
}

const STORAGE_KEY = 'chemcheck_sync_queue';
const FAILED_STORAGE_KEY = 'chemcheck_sync_queue_failed';
const MAX_RETRIES = 3;
const MAX_QUEUE_SIZE = 500; // Capacity warning only; unsynced items are never evicted
const QUEUE_WARNING_THRESHOLD = Math.floor(MAX_QUEUE_SIZE * 0.8);
const BATCH_SIZE = 20; // Process this many items per sync cycle
const PERSIST_ERROR_THROTTLE_MS = 15_000;
// Failed items are retried automatically after 1, 2, 4 ... 60 minutes.
const FAILED_RETRY_BASE_MS = 60_000;
const FAILED_RETRY_MAX_MS = 60 * 60_000;

export class SyncQueue {
  private queue: SyncQueueItem[] = [];
  private failed: SyncQueueItem[] = [];
  private highWatermarkWarned = false;
  private lastPersistErrorAt = 0;
  private isPersisting = false;
  private revisionSequence = 0;

  constructor() {
    this.loadFromStorage();
    this.loadFailedFromStorage();
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
  enqueue(item: Omit<SyncQueueItem, 'retryCount' | 'priority' | 'revision'>): void {
    const queueItem: SyncQueueItem = this.normalizeQueueItem({
      ...item,
      retryCount: 0,
      priority: this.getPriority(item.table, item.operation),
      revision: this.createRevision(),
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
    // A newer revision supersedes any failed attempt for the same record.
    this.removeFailed(queueItem.table, queueItem.localId);

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
    const hadFailed = !!this.findFailed(table, localId);
    this.removeFailed(table, localId);
    const nextQueue = this.queue.filter(
      (item) => !(item.table === table && item.localId === localId)
    );
    if (nextQueue.length === this.queue.length) {
      return hadFailed;
    }

    this.queue = this.sanitizeQueue(nextQueue);
    this.updateHighWatermarkState();
    this.persistQueueState('clearForItem');
    return true;
  }

  /**
   * Mark item as synced (remove from queue)
   */
  markSynced(item: Pick<SyncQueueItem, 'table' | 'localId' | 'revision'>): boolean {
    if (this.queue.length === 0) {
      return false;
    }

    const nextQueue = this.queue.filter(
      queued => !this.isSameRevision(queued, item)
    );

    if (nextQueue.length === this.queue.length) {
      return false;
    }

    this.queue = this.sanitizeQueue(nextQueue);
    this.updateHighWatermarkState();

    try {
      this.persistQueueState('markSynced');
      console.log(`Marked ${item.table}[${item.localId}] revision ${item.revision} as synced`);
    } catch (error) {
      console.error(`Failed to persist sync completion for ${item.table}[${item.localId}]:`, error);
      // Continue execution - the item is still removed from memory queue
    }

    return true;
  }

  /**
   * Mark item as failed and potentially retry
   */
  markFailed(item: Pick<SyncQueueItem, 'table' | 'localId' | 'revision'>, error: string): void {
    const itemIndex = this.queue.findIndex(
      queued => this.isSameRevision(queued, item)
    );

    if (itemIndex === -1) {
      console.warn(`Item ${item.table}[${item.localId}] revision ${item.revision} is no longer current`);
      return;
    }

    const queuedItem = this.queue[itemIndex];
    queuedItem.retryCount += 1;
    queuedItem.lastAttempt = Date.now();
    queuedItem.error = error;

    if (queuedItem.retryCount >= MAX_RETRIES) {
      // Never drop unsynced work: park it in the persisted failed list, where
      // it is retried with a long backoff or on demand (retryFailed()).
      this.queue.splice(itemIndex, 1);
      this.failed = [
        ...this.failed.filter((entry) => !(entry.table === queuedItem.table && entry.localId === queuedItem.localId)),
        { ...queuedItem, failedAt: Date.now(), failedCount: (queuedItem.failedCount || 0) + 1 },
      ];
      this.persistFailedState('markFailed');
      console.warn(`Moved ${item.table}[${item.localId}] to the failed sync list after ${MAX_RETRIES} failed attempts`);
    }
    else {
      // Keep in queue for retry with exponential backoff
      console.log(`Marked ${item.table}[${item.localId}] as failed (attempt ${queuedItem.retryCount}/${MAX_RETRIES})`);
    }

    this.queue = this.sanitizeQueue(this.queue);
    this.updateHighWatermarkState();
    this.persistQueueState('markFailed');
  }

  /**
   * Clear all items from queue
   */
  clear(): boolean {
    if (this.queue.length === 0 && this.failed.length === 0) {
      this.highWatermarkWarned = false;
      return false;
    }

    this.queue = [];
    this.failed = [];
    this.highWatermarkWarned = false;
    this.persistQueueState('clear');
    this.persistFailedState('clear');
    console.log('Sync queue cleared');
    return true;
  }

  /** Items that exhausted their retries and wait for a (manual) retry. */
  getFailedItems(): SyncQueueItem[] {
    return [...this.failed];
  }

  getFailedCount(): number {
    return this.failed.length;
  }

  findFailed(table: SyncQueueItem['table'], localId: number): SyncQueueItem | undefined {
    return this.failed.find(item => item.table === table && item.localId === localId);
  }

  /**
   * Move failed items back into the active queue with a fresh retry budget.
   * With `onlyDue`, only items whose failed-list backoff has elapsed move.
   * Returns the number of revived items.
   */
  retryFailed(options: { onlyDue?: boolean; now?: number } = {}): number {
    const now = options.now ?? Date.now();
    const revive = options.onlyDue
      ? this.failed.filter((item) => now - (item.failedAt || 0) >= this.getFailedBackoffMs(item))
      : [...this.failed];
    if (revive.length === 0) return 0;

    const reviveKeys = new Set(revive.map((item) => `${item.table}:${item.localId}`));
    this.failed = this.failed.filter((item) => !reviveKeys.has(`${item.table}:${item.localId}`));
    const activeKeys = new Set(this.queue.map((item) => `${item.table}:${item.localId}`));
    const revived = revive
      .filter((item) => !activeKeys.has(`${item.table}:${item.localId}`))
      .map((item) => ({ ...item, retryCount: 0, lastAttempt: undefined, revision: this.createRevision() }));
    this.queue = this.sanitizeQueue([...this.queue, ...revived]);
    this.updateHighWatermarkState();
    this.persistQueueState('retryFailed');
    this.persistFailedState('retryFailed');
    return revived.length;
  }

  private getFailedBackoffMs(item: SyncQueueItem): number {
    const exponent = Math.max(0, (item.failedCount || 1) - 1);
    return Math.min(FAILED_RETRY_BASE_MS * Math.pow(2, exponent), FAILED_RETRY_MAX_MS);
  }

  private removeFailed(table: SyncQueueItem['table'], localId: number): void {
    const next = this.failed.filter((item) => !(item.table === table && item.localId === localId));
    if (next.length !== this.failed.length) {
      this.failed = next;
      this.persistFailedState('supersede');
    }
  }

  /**
   * Find existing item in queue by table and localId
   */
  findItem(table: SyncQueueItem['table'], localId: number): SyncQueueItem | undefined {
    return this.queue.find(item => item.table === table && item.localId === localId);
  }

  /** True only while this exact queued revision is still the current one. */
  isCurrent(item: Pick<SyncQueueItem, 'table' | 'localId' | 'revision'>): boolean {
    return this.queue.some(queued => this.isSameRevision(queued, item));
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
      pools: 2,
      equipment: 3,
      serviceLogs: 4,
      chemicalUsage: 4,
      notes: 4,
      saltCellLogs: 4,
    };

    const operationPriority = {
      create: 0,
      update: 1,
      delete: 2,
    };

    return (tablePriority[table as keyof typeof tablePriority] || 3) * 10 +
      (operationPriority[operation as keyof typeof operationPriority] || 3);
  }

  private createRevision(): string {
    this.revisionSequence += 1;
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
    return `${Date.now().toString(36)}-${this.revisionSequence.toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  private isSameRevision(
    left: Pick<SyncQueueItem, 'table' | 'localId' | 'revision'>,
    right: Pick<SyncQueueItem, 'table' | 'localId' | 'revision'>,
  ): boolean {
    return left.table === right.table &&
      left.localId === right.localId &&
      left.revision === right.revision;
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

  private loadFailedFromStorage(): void {
    if (!this.isStorageAvailable()) return;
    try {
      const stored = localStorage.getItem(FAILED_STORAGE_KEY);
      if (!stored) return;
      this.failed = this.sanitizeQueue(JSON.parse(stored), false);
    } catch (error) {
      console.error('Failed to load failed sync items from storage:', error);
      this.failed = [];
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

    // Never truncate: every entry represents unsynced local work.
    return sorted;
  }

  private normalizeQueueItem(item: SyncQueueItem): SyncQueueItem {
    return {
      ...item,
      retryCount: Number.isFinite(item.retryCount) ? Math.max(0, item.retryCount) : 0,
      priority: Number.isFinite(item.priority) ? item.priority : this.getPriority(item.table, item.operation),
      lastAttempt: item.lastAttempt && Number.isFinite(item.lastAttempt) ? item.lastAttempt : undefined,
      error: typeof item.error === 'string' ? item.error : undefined,
      failedAt: item.failedAt && Number.isFinite(item.failedAt) ? item.failedAt : undefined,
      failedCount: item.failedCount && Number.isFinite(item.failedCount) ? item.failedCount : undefined,
      revision: typeof item.revision === 'string' && item.revision
        ? item.revision
        : this.createRevision(),
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

  private persistFailedState(action: string): void {
    if (!this.isStorageAvailable()) return;
    try {
      localStorage.setItem(FAILED_STORAGE_KEY, JSON.stringify(this.failed));
    } catch (error) {
      if (!this.shouldThrottlePersistError(Date.now())) {
        console.error(`Failed sync list persist failed during ${action}:`, error);
      }
    }
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
