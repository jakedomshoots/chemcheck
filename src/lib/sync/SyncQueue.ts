/**
 * SyncQueue manages the queue of records pending synchronization
 * Provides persistence to localStorage for crash recovery
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

export class SyncQueue {
  private queue: SyncQueueItem[] = [];
  private highWatermarkWarned = false;

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
    const queueItem: SyncQueueItem = {
      ...item,
      retryCount: 0,
      priority: this.getPriority(item.table, item.operation),
    };

    // Remove existing item for same record if exists
    this.queue = this.queue.filter(
      existing => !(existing.table === item.table && existing.localId === item.localId)
    );

    // Add new item
    this.queue.push(queueItem);

    // Sort by priority (lower number = higher priority)
    this.queue.sort((a, b) => a.priority - b.priority);

    // Enforce queue size limit - remove oldest low-priority items if exceeded
    if (this.queue.length > MAX_QUEUE_SIZE) {
      const overflow = this.queue.length - MAX_QUEUE_SIZE;
      // Remove from end (lowest priority items)
      this.queue.splice(-overflow, overflow);
      console.warn(`Sync queue overflow: removed ${overflow} low-priority items to maintain limit of ${MAX_QUEUE_SIZE}`);
    }

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

    try {
      this.saveToStorage();
    } catch (error) {
      console.error(`Failed to persist enqueue operation for ${item.table}[${item.localId}]:`, error);
      // Continue execution - the item is still in memory queue
    }
  }

  /**
   * Get next item to sync (without removing from queue)
   * Use getRetryableItems() + markSynced()/markFailed() for the primary workflow
   */
  peekNext(): SyncQueueItem | null {
    if (this.queue.length === 0) {
      return null;
    }

    // Return highest priority item without removing
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
   * Mark item as synced (remove from queue)
   */
  markSynced(table: string, localId: number): void {
    this.queue = this.queue.filter(
      item => !(item.table === table && item.localId === localId)
    );

    try {
      this.saveToStorage();
    } catch (error) {
      console.error(`Failed to persist sync completion for ${table}[${localId}]:`, error);
      // Continue execution - the item is still removed from memory queue
    }
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
    item.retryCount++;
    item.lastAttempt = Date.now();
    item.error = error;

    if (item.retryCount >= MAX_RETRIES) {
      // Remove from queue after max retries
      this.queue.splice(itemIndex, 1);
    } else {
      // Keep in queue for retry with exponential backoff
    }

    this.saveToStorage();
  }

  /**
   * Get items ready for retry (past their backoff period)
   */
  getRetryableItems(): SyncQueueItem[] {
    const now = Date.now();

    return this.queue.filter(item => {
      if (item.retryCount === 0) return true; // Never attempted
      if (!item.lastAttempt) return true; // No last attempt recorded

      // Exponential backoff: 1s, 2s, 4s
      const backoffMs = Math.pow(2, item.retryCount - 1) * 1000;
      return (now - item.lastAttempt) >= backoffMs;
    });
  }

  /**
   * Clear all items from queue
   */
  clear(): void {
    this.queue = [];
    this.saveToStorage();
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
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Validate structure
        if (Array.isArray(parsed) && parsed.every(item =>
          item.table && typeof item.localId === 'number' && item.operation &&
          typeof item.priority === 'number' && typeof item.retryCount === 'number' &&
          item.data && typeof item.data === 'object'
        )) {
          this.queue = parsed;
        } else {
          console.warn('Invalid sync queue data in storage, resetting');
          this.queue = [];
        }
      }
    } catch (error) {
      console.error('Failed to load sync queue from storage:', error);
      this.queue = [];
    }
  }

  private saveToStorage(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.queue));
    } catch (error) {
      console.error('Failed to save sync queue to storage:', error);

      // Handle quota exceeded error specifically
      if (error instanceof Error && error.name === 'QuotaExceededError') {
        console.warn('LocalStorage quota exceeded. Consider clearing old data or reducing queue size.');
        // Could implement queue size limits or cleanup here
      }

      // Notify callers of save failure by throwing
      throw new Error('Failed to persist sync queue: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  }
}
