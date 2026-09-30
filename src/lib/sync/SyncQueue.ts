/**
 * SyncQueue manages the queue of records pending synchronization
 * and keeps the queue persisted safely in localStorage.
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
  /**
   * 'pending' items are eligible for sync. 'dead' items exhausted their retry
   * budget and are kept only for diagnostics/UI until the record is edited
   * again (which replaces them) or the queue is cleared.
   */
  status?: 'pending' | 'dead';
  deadAt?: number;
}

const STORAGE_KEY = 'chemcheck_sync_queue';
const MAX_RETRIES = 3;
/**
 * Soft capacity. Unsynced create/update/delete work is never dropped to stay
 * under it; only dead-letter items are evicted and otherwise the cap is
 * exceeded with a warning.
 */
const MAX_QUEUE_SIZE = 500;
const QUEUE_WARNING_THRESHOLD = Math.floor(MAX_QUEUE_SIZE * 0.8);
const BATCH_SIZE = 20; // Process this many items per sync cycle
const PERSIST_ERROR_THROTTLE_MS = 15_000;

export class SyncQueue {
  private queue: SyncQueueItem[] = [];
  private highWatermarkWarned = false;
  private capacityWarned = false;
  private lastPersistErrorAt = 0;
  private isPersisting = false;
  private revisionSequence = 0;

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
  enqueue(item: Omit<SyncQueueItem, 'retryCount' | 'priority' | 'revision'>): void {
    const queueItem: SyncQueueItem = this.normalizeQueueItem({
      ...item,
      retryCount: 0,
      priority: this.getPriority(item.table, item.operation),
      revision: this.createRevision(),
    });

    let nextQueue = [...this.queue];

    if (queueItem.operation === 'delete') {
      // A delete supersedes any earlier create/update for the same row: the
      // row is gone locally, so pushing its old payload would be wrong. The
      // delete itself is kept (it acks immediately when there is no convex_id).
      nextQueue = nextQueue.filter(
        entry => !(entry.table === queueItem.table && entry.localId === queueItem.localId && entry.operation !== 'delete')
      );
    }

    // Dexie reuses ++id keys after a delete, so a later create/update for the
    // same table+localId must not collide with (or replace) a pending delete.
    const existingIndex = nextQueue.findIndex(
      entry => this.dedupeKey(entry) === this.dedupeKey(queueItem)
    );

    if (existingIndex >= 0) {
      nextQueue[existingIndex] = queueItem;
    } else {
      nextQueue.push(queueItem);
    }

    this.queue = this.sanitizeQueue(nextQueue);
    this.enforceCapacity();
    this.updateHighWatermarkState();
    this.persistQueueState('enqueue');

    console.log(`Enqueued ${item.table}[${item.localId}] for ${item.operation}`);
  }

  /**
   * Get next item to sync (without removing from queue)
   */
  peekNext(): SyncQueueItem | null {
    const pending = this.queue.find(item => !this.isDead(item));
    return pending || null;
  }

  /**
   * Get all pending (non dead-lettered) items
   */
  getPending(): SyncQueueItem[] {
    return this.queue.filter(item => !this.isDead(item));
  }

  /**
   * Get pending count (excludes dead-letter items)
   */
  getPendingCount(): number {
    return this.getPending().length;
  }

  /**
   * Items that exhausted their retry budget. They are kept for diagnostics
   * and UI, but are never retried automatically.
   */
  getDeadLetterItems(): SyncQueueItem[] {
    return this.queue.filter(item => this.isDead(item));
  }

  getDeadLetterCount(): number {
    return this.getDeadLetterItems().length;
  }

  /**
   * Move a dead-letter item back to the retryable pool (e.g. from a UI action).
   */
  requeueDeadLetter(table: SyncQueueItem['table'], localId: number): boolean {
    let changed = false;
    for (const item of this.queue) {
      if (item.table === table && item.localId === localId && this.isDead(item)) {
        item.status = 'pending';
        item.deadAt = undefined;
        item.retryCount = 0;
        item.lastAttempt = undefined;
        item.error = undefined;
        changed = true;
      }
    }
    if (changed) {
      this.queue = this.sanitizeQueue(this.queue);
      this.persistQueueState('requeueDeadLetter');
    }
    return changed;
  }

  getCapacityStatus(): { current: number; max: number; warningThreshold: number; usagePercent: number; dead: number } {
    const current = this.getPendingCount();
    return {
      current,
      max: MAX_QUEUE_SIZE,
      warningThreshold: QUEUE_WARNING_THRESHOLD,
      usagePercent: Math.round((current / MAX_QUEUE_SIZE) * 100),
      dead: this.getDeadLetterCount(),
    };
  }

  /**
   * Get items ready for retry (past their backoff period)
   */
  getRetryableItems(): SyncQueueItem[] {
    const now = Date.now();

    const retryable = this.queue.filter((item) => {
      if (this.isDead(item)) return false; // Dead-lettered: never auto-retried
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
      // Dead-letter after max retries: keep it in storage for diagnostics but
      // stop retrying so one bad record cannot wedge the whole queue.
      queuedItem.status = 'dead';
      queuedItem.deadAt = queuedItem.lastAttempt;
      console.warn(`Dead-lettered ${item.table}[${item.localId}] after ${MAX_RETRIES} failed attempts: ${error}`);
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
    const hadItems = this.queue.length > 0;
    this.queue = [];
    this.highWatermarkWarned = false;
    this.capacityWarned = false;
    // Always clear persisted state so a stale queue from a previous account
    // cannot be reloaded on the next launch.
    this.persistQueueState('clear');
    if (hadItems) console.log('Sync queue cleared');
    return hadItems;
  }

  /**
   * Find existing item in queue by table and localId. Write (create/update)
   * items are preferred over a pending delete for the same key; pass
   * `operation` to look for a specific kind.
   */
  findItem(table: SyncQueueItem['table'], localId: number, operation?: SyncQueueItem['operation']): SyncQueueItem | undefined {
    const matches = this.queue.filter(item => item.table === table && item.localId === localId);
    if (operation) return matches.find(item => item.operation === operation);
    return matches.find(item => item.operation !== 'delete') || matches[0];
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

  private isDead(item: SyncQueueItem): boolean {
    return item.status === 'dead';
  }

  private dedupeKey(item: SyncQueueItem): string {
    return `${item.table}:${item.localId}:${item.operation === 'delete' ? 'delete' : 'write'}`;
  }

  /**
   * Soft cap enforcement: evict dead-letter items first (oldest first); never
   * drop unsynced work. If still over the cap, warn and carry on.
   */
  private enforceCapacity(): void {
    if (this.queue.length <= MAX_QUEUE_SIZE) {
      this.capacityWarned = false;
      return;
    }

    const dead = this.queue
      .filter(item => this.isDead(item))
      .sort((a, b) => (a.deadAt || 0) - (b.deadAt || 0));
    let evicted = 0;
    for (const item of dead) {
      if (this.queue.length <= MAX_QUEUE_SIZE) break;
      const index = this.queue.indexOf(item);
      if (index >= 0) {
        this.queue.splice(index, 1);
        evicted += 1;
      }
    }
    if (evicted > 0) {
      console.warn(`Sync queue overflow: evicted ${evicted} dead-letter items to stay near the limit of ${MAX_QUEUE_SIZE}`);
    }

    if (this.queue.length > MAX_QUEUE_SIZE && !this.capacityWarned) {
      this.capacityWarned = true;
      console.warn(
        `Sync queue holds ${this.queue.length} unsynced items, above the soft limit of ${MAX_QUEUE_SIZE}. ` +
        'No pending work was dropped; the queue will drain once sync succeeds.'
      );
    }
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
      const key = this.dedupeKey(item);
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

    if (sorted.length > MAX_QUEUE_SIZE && log && !this.capacityWarned) {
      // Never truncate: every entry here is unsynced local work (or a
      // dead-letter kept for diagnostics, evicted separately by enforceCapacity).
      console.warn(`Sync queue contains ${sorted.length} items, above the soft limit of ${MAX_QUEUE_SIZE}. Nothing was dropped.`);
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
      revision: typeof item.revision === 'string' && item.revision
        ? item.revision
        : this.createRevision(),
      status: item.status === 'dead' ? 'dead' : 'pending',
      deadAt: item.status === 'dead' && Number.isFinite(item.deadAt) ? item.deadAt : undefined,
    };
  }

  private updateHighWatermarkState(): void {
    const pendingCount = this.getPendingCount();
    if (pendingCount >= QUEUE_WARNING_THRESHOLD) {
      if (!this.highWatermarkWarned) {
        console.warn(
          `Sync queue is ${pendingCount}/${MAX_QUEUE_SIZE} (${Math.round((pendingCount / MAX_QUEUE_SIZE) * 100)}%).`
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
