import { ConvexReactClient } from 'convex/react';
import { Id } from '../../../convex/_generated/dataModel';
import { db } from '@/db/chemcheck-db';
import { api } from '../../../convex/_generated/api';
import { SyncQueue, SyncQueueItem } from './SyncQueue';
import { ConflictResolver } from './ConflictResolver';
import { monitoring } from '@/lib/monitoring';

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline';

export interface SyncResult {
  success: boolean;
  error?: string;
  syncedCount: number;
  failedCount: number;
  pulledCount?: number;
  conflictCount?: number;
}

interface PullState {
  since: number;
  cursor?: string | null;
}

interface RemotePullPage {
  customers?: any[];
  serviceLogs?: any[];
  chemicalUsage?: any[];
  notes?: any[];
  saltCellLogs?: any[];
  pools?: any[];
  equipment?: any[];
  cursor?: string | null;
  hasMore?: boolean;
  watermark?: number;
}

export interface RecordSyncStatus {
  status: 'synced' | 'pending' | 'error';
  error?: string;
  lastSyncAt?: number;
}

/**
 * Core service for managing bidirectional sync between Dexie and Convex
 * Handles automatic background sync, manual sync triggers, and conflict resolution
 */
export class SyncService {
  private convexClient: ConvexReactClient | null = null;
  private autoSyncInterval: NodeJS.Timeout | null = null;
  private currentStatus: SyncStatus = 'idle';
  private statusCallbacks: ((status: SyncStatus) => void)[] = [];
  private isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
  private isInitialized = false;
  private isConnectivityListening = false;
  private onlineHandler: (() => void) | null = null;
  private offlineHandler: (() => void) | null = null;
  private syncQueue: SyncQueue;
  private conflictResolver: ConflictResolver;
  private isSyncCycleRunning = false;
  private lastSyncStartedAt = 0;
  private readonly MAX_RETRIES = 3;
  private readonly MAX_CONFLICT_RETRIES = 2;
  private readonly AUTO_SYNC_INTERVAL_MS = 30_000;
  private readonly PULL_PAGE_SIZE = 100;
  private readonly PULL_STATE_KEY = 'chemcheck_sync_pull_state_v1';
  private pullScope = 'anonymous';
  private lastPullCount = 0;
  private lastConflictCount = 0;

  constructor() {
    this.syncQueue = new SyncQueue();
    this.conflictResolver = new ConflictResolver();

    // Listen for online/offline events (SSR safe)
    this.registerConnectivityListeners();
  }

  /**
   * Initialize the sync service with Convex client (idempotent)
   */
  initialize(convexClient: ConvexReactClient, userScope?: string): void {
    const nextScope = String(userScope || 'anonymous').trim().toLowerCase() || 'anonymous';
    if (this.isInitialized && this.convexClient === convexClient && this.pullScope === nextScope) {
      console.log('SyncService already initialized with same client');
      return;
    }

    // Clean up previous initialization if different client
    if (this.isInitialized) {
      this.cleanup();
    }

    this.convexClient = convexClient;
    this.pullScope = nextScope;
    this.isInitialized = true;
    this.setStatus('idle');
    this.isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

    // Register sync service with database for automatic sync triggers
    // Use try-catch to handle test environments where db might be mocked
    try {
      if (db && typeof db.setSyncService === 'function') {
        db.setSyncService(this);
      }
    } catch (error) {
      console.warn('Could not register sync service with database:', error);
    }

    console.log('SyncService initialized with Convex client');
  }

  /**
   * Get current online status
   */
  isOnlineStatus(): boolean {
    return this.isOnline;
  }

  /**
   * Start automatic background sync (prevents duplicate intervals)
   */
  startAutoSync(): void {
    if (!this.isInitialized) {
      console.warn('Cannot start auto-sync: SyncService not initialized');
      return;
    }

    if (!this.convexClient) {
      console.warn('Cannot start auto-sync: Convex client missing');
      return;
    }

    // Don't start auto-sync if offline
    if (!this.isOnline) {
      console.log('Cannot start auto-sync: device is offline');
      return;
    }

    if (this.currentStatus === 'error') {
      this.setStatus('idle');
    }

    // Prevent duplicate intervals
    if (this.autoSyncInterval) {
      console.log('Auto-sync already running');
      return;
    }

    // Sync every 30 seconds when online
    this.autoSyncInterval = setInterval(() => {
      if (this.isOnline && this.convexClient) {
        this.syncPendingRecords('auto').catch(error => {
          console.error('Auto-sync failed:', error);
          this.setStatus('error');
        });
      }
    }, this.AUTO_SYNC_INTERVAL_MS);

    console.log('Auto-sync started');
  }

  /**
   * Stop automatic sync and clean up resources
   */
  stopAutoSync(): void {
    if (this.autoSyncInterval) {
      clearInterval(this.autoSyncInterval);
      this.autoSyncInterval = null;
    }
    console.log('Auto-sync stopped');
  }

  /**
   * Clean up all resources (for re-initialization)
   */
  private cleanup(): void {
    this.stopAutoSync();
    this.convexClient = null;
    this.isInitialized = false;
    console.log('SyncService cleaned up');
  }

  /**
   * Destroy the service and clean up all resources
   */
  destroy(): void {
    this.cleanup();
    this.unregisterConnectivityListeners();

    // Remove event listeners
    // Clear all callbacks
    this.statusCallbacks = [];
    console.log('SyncService destroyed');
  }

  /**
   * Manually trigger sync for all pending records
   */
  async syncNow(): Promise<SyncResult> {
    if (!this.convexClient) {
      throw new Error('SyncService not initialized with Convex client');
    }

    if (!this.isOnline) {
      throw new Error('Cannot sync while offline');
    }

    return this.syncPendingRecords('manual');
  }

  /**
   * Pull all remote changes newer than the persisted watermark. Pulls are
   * cursor based and resumable: if the app is killed halfway through a large
   * account, the opaque cursor is retained and resumed on the next cycle.
   */
  async pullRemoteChanges(): Promise<{ pulledCount: number; conflictCount: number; hasMore: boolean }> {
    const client: any = this.convexClient as any;
    const pullRef = (api as any)?.sync?.pull;
    if (!client || typeof client.query !== 'function' || !pullRef) {
      return { pulledCount: 0, conflictCount: 0, hasMore: false };
    }

    const persisted = this.readPullState();
    let cursor = persisted.cursor || undefined;
    const since = persisted.since || 0;
    let pulledCount = 0;
    let conflictCount = 0;
    let watermark = persisted.since || 0;

    try {
      do {
        if (!this.isOnline) throw new Error('Cannot pull while offline');
        const page: RemotePullPage = await client.query(pullRef, {
          cursor,
          since: cursor ? undefined : since,
          limit: this.PULL_PAGE_SIZE,
        });
        const counts = await this.applyRemotePullPage(page);
        pulledCount += counts.pulledCount;
        conflictCount += counts.conflictCount;
        watermark = Math.max(watermark, Number(page.watermark) || 0);
        cursor = page.hasMore && page.cursor ? page.cursor : undefined;

        if (cursor) {
          this.writePullState({ since: since || watermark, cursor });
        }
      } while (cursor);

      // Advance the watermark only after every table cursor has been applied.
      if (watermark > 0) this.writePullState({ since: watermark, cursor: null });
      monitoring.recordMetric('sync_pull_complete', pulledCount, { conflictCount, watermark });
      this.lastPullCount = pulledCount;
      this.lastConflictCount = conflictCount;
      return { pulledCount, conflictCount, hasMore: false };
    } catch (error) {
      monitoring.recordMetric('sync_pull_failed', 1, {
        error: error instanceof Error ? error.message : 'Unknown error',
        pulledCount,
        conflictCount,
      });
      // Keep the cursor so a later cycle can continue from the last committed
      // page instead of replaying the entire account.
      if (cursor) this.writePullState({ since: since || watermark, cursor });
      throw error;
    }
  }

  private readPullState(): PullState {
    if (typeof localStorage === 'undefined') return { since: 0, cursor: null };
    try {
      const scopedKey = `${this.PULL_STATE_KEY}:${this.pullScope}`;
      const raw = localStorage.getItem(scopedKey) || (
        this.pullScope === 'anonymous' ? localStorage.getItem(this.PULL_STATE_KEY) : null
      );
      if (!raw) return { since: 0, cursor: null };
      const state = JSON.parse(raw);
      return {
        since: Number.isFinite(Number(state?.since)) ? Number(state.since) : 0,
        cursor: typeof state?.cursor === 'string' ? state.cursor : null,
      };
    } catch {
      return { since: 0, cursor: null };
    }
  }

  private writePullState(state: PullState): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(`${this.PULL_STATE_KEY}:${this.pullScope}`, JSON.stringify(state));
      // Keep the pre-scope key readable for local/demo callers that do not
      // provide an authenticated user scope.
      if (this.pullScope === 'anonymous') localStorage.setItem(this.PULL_STATE_KEY, JSON.stringify(state));
    } catch {
      // Storage can be unavailable in private browsing; pull remains correct
      // for the current process and will simply restart next launch.
    }
  }

  private getTable(table: string): any {
    return (db as any)[table];
  }

  private async findLocalByConvexId(table: string, convexId: string): Promise<any | undefined> {
    const localTable = this.getTable(table);
    if (!localTable) return undefined;
    try {
      if (typeof localTable.where === 'function') {
        const indexed = await localTable.where('convex_id').equals(convexId).first();
        if (indexed) return indexed;
      }
    } catch {
      // Older databases may not have the index yet; fall back to a scan.
    }
    if (typeof localTable.toCollection === 'function') {
      const records = await localTable.toCollection().toArray();
      return records.find((record: any) => record.convex_id === convexId);
    }
    return undefined;
  }

  private async findLocalCustomerByConvexId(convexId: string): Promise<any | undefined> {
    return this.findLocalByConvexId('customers', convexId);
  }

  private async findLocalPoolByConvexId(convexId: string): Promise<any | undefined> {
    return this.findLocalByConvexId('pools', convexId);
  }

  private async applyRemotePullPage(page: RemotePullPage): Promise<{ pulledCount: number; conflictCount: number }> {
    let pulledCount = 0;
    let conflictCount = 0;
    const merge = async (table: string, remote: any): Promise<void> => {
      const convexId = String(remote?._id || remote?.convex_id || '');
      if (!convexId) return;
      const localTable = this.getTable(table);
      if (!localTable) return;
      const remoteUpdatedAt = Number(remote.updated_at || remote.created_at || 0);
      const local = await this.findLocalByConvexId(table, convexId);

      // Translate remote foreign keys to local numeric keys while preserving
      // the Convex IDs for subsequent pushes.
      const mapped: any = { ...remote };
      delete mapped._id;
      delete mapped._creationTime;
      mapped.convex_id = convexId;
      mapped.remote_updated_at = remoteUpdatedAt;
      mapped.local_updated_at = remoteUpdatedAt || Date.now();
      mapped.sync_status = 'synced';
      mapped.sync_error = undefined;

      if (mapped.customer_id && typeof mapped.customer_id === 'string') {
        const customer = await this.findLocalCustomerByConvexId(mapped.customer_id);
        mapped.convex_customer_id = mapped.customer_id;
        if (customer?.id !== undefined) mapped.customer_id = customer.id;
      }
      if (mapped.pool_id && typeof mapped.pool_id === 'string') {
        const pool = await this.findLocalPoolByConvexId(mapped.pool_id);
        mapped.convex_pool_id = mapped.pool_id;
        if (pool?.id !== undefined) mapped.pool_id = pool.id;
      }

      if (!local) {
        // Child records cannot be safely materialized until their local parent
        // exists. The server pull is parent-first, so this indicates a corrupt
        // or partially migrated dataset; fail the page rather than advancing
        // the cursor and silently losing the record.
        if ((mapped.customer_id && typeof mapped.customer_id === 'string') ||
          (mapped.pool_id && typeof mapped.pool_id === 'string')) {
          throw new Error(`Remote ${table} ${convexId} references a parent that has not been pulled`);
        }
        await this.withoutSyncHooks(async () => {
          await localTable.add(mapped);
        });
        pulledCount += 1;
        return;
      }

      const localChanged = local.sync_status === 'pending' ||
        Number(local.local_updated_at || 0) > Number(local.remote_updated_at || 0);
      const localTimestamp = Number(local.local_updated_at || 0);
      if (localChanged && localTimestamp > remoteUpdatedAt) {
        // Local wins; leave the pending record in the queue. We still count a
        // conflict so the UI/telemetry can surface that it needs attention.
        conflictCount += 1;
        monitoring.recordMetric('sync_pull_conflict_local_wins', 1, { table, localId: local.id });
        return;
      }

      if (localChanged) {
        conflictCount += 1;
        try {
          this.conflictResolver.createBackup(local);
        } catch {
          // A backup is best effort; never block accepting the authoritative
          // remote version because local data remains in the audit trail.
        }
      }

      const merged = {
        ...local,
        ...mapped,
        id: local.id,
        convex_id: convexId,
        sync_status: 'synced' as const,
        sync_error: undefined,
        local_updated_at: remoteUpdatedAt || local.local_updated_at,
        remote_updated_at: remoteUpdatedAt || local.remote_updated_at,
      };
      await this.withoutSyncHooks(async () => {
        await localTable.update(local.id, merged);
      });
      pulledCount += 1;
      monitoring.recordMetric('sync_pull_record_applied', 1, { table });
    };

    // Parent-first order ensures foreign-key translation works for records in
    // the same cursor page.
    for (const record of page.customers || []) await merge('customers', record);
    for (const record of page.pools || []) await merge('pools', record);
    for (const record of page.equipment || []) await merge('equipment', record);
    for (const record of page.serviceLogs || []) await merge('serviceLogs', record);
    for (const record of page.chemicalUsage || []) await merge('chemicalUsage', record);
    for (const record of page.notes || []) await merge('notes', record);
    for (const record of page.saltCellLogs || []) await merge('saltCellLogs', record);
    return { pulledCount, conflictCount };
  }

  private async withoutSyncHooks<T>(operation: () => Promise<T>): Promise<T> {
    const scopedDb: any = db as any;
    if (typeof scopedDb.withoutSyncHooks === 'function') return scopedDb.withoutSyncHooks(operation);
    return operation();
  }

  private recordQueueDepth(phase: 'cycle_start' | 'before_batch' | 'after_batch', trigger: 'manual' | 'auto', extra?: Record<string, unknown>): void {
    const queueStatus = this.getQueueStatus();
    monitoring.recordMetric('sync_queue_depth', queueStatus.pending, {
      phase,
      trigger,
      capacity: queueStatus.capacity.max,
      warningThreshold: queueStatus.capacity.warningThreshold,
      usagePercent: queueStatus.capacity.usagePercent,
      ...extra,
    });
  }

  /**
   * Sync a specific record by table and local ID
   */
  async syncRecord(table: string, localId: number): Promise<SyncResult> {
    if (!this.convexClient) {
      throw new Error('SyncService not initialized with Convex client');
    }

    if (!this.isOnline) {
      throw new Error('Cannot sync while offline');
    }

    try {
      let record: any;

      switch (table) {
        case 'customers':
          record = await db.customers.get(localId);
          break;
        case 'pools':
          record = db.pools?.get ? await db.pools.get(localId) : undefined;
          break;
        case 'equipment':
          record = db.equipment?.get ? await db.equipment.get(localId) : undefined;
          break;
        case 'serviceLogs':
          record = await db.serviceLogs.get(localId);
          break;
        case 'chemicalUsage':
          record = await db.chemicalUsage.get(localId);
          break;
        case 'notes':
          record = await db.notes.get(localId);
          break;
        case 'saltCellLogs':
          record = await db.saltCellLogs.get(localId);
          break;
        default:
          throw new Error(`Unknown table: ${table}`);
      }

      if (!record) {
        throw new Error(`Record not found: ${table}[${localId}]`);
      }

      const success = await this.syncSingleRecord(table, record);

      return {
        success,
        syncedCount: success ? 1 : 0,
        failedCount: success ? 0 : 1,
      };
    } catch (error) {
      console.error(`Failed to sync ${table}[${localId}]:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        syncedCount: 0,
        failedCount: 1,
      };
    }
  }

  /**
   * Get current sync status
   */
  getSyncStatus(): SyncStatus {
    return this.currentStatus;
  }

  /**
   * Subscribe to sync status changes
   */
  onSyncStatusChange(callback: (status: SyncStatus) => void): () => void {
    if (this.statusCallbacks.includes(callback)) {
      const existingIndex = this.statusCallbacks.indexOf(callback);
      this.statusCallbacks.splice(existingIndex, 1);
    }

    this.statusCallbacks.push(callback);

    // Return unsubscribe function
    return () => {
      const index = this.statusCallbacks.indexOf(callback);
      if (index > -1) {
        this.statusCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Check if a specific record is synced
   */
  async isRecordSynced(table: string, localId: number): Promise<boolean> {
    try {
      let record: any;

      switch (table) {
        case 'customers':
          record = await db.customers.get(localId);
          break;
        case 'pools':
          record = db.pools?.get ? await db.pools.get(localId) : undefined;
          break;
        case 'equipment':
          record = db.equipment?.get ? await db.equipment.get(localId) : undefined;
          break;
        case 'serviceLogs':
          record = await db.serviceLogs.get(localId);
          break;
        case 'chemicalUsage':
          record = await db.chemicalUsage.get(localId);
          break;
        case 'notes':
          record = await db.notes.get(localId);
          break;
        case 'saltCellLogs':
          record = await db.saltCellLogs.get(localId);
          break;
        default:
          return false;
      }

      return record?.sync_status === 'synced' && !!record?.convex_id;
    } catch (error) {
      console.error(`Error checking sync status for ${table}[${localId}]:`, error);
      return false;
    }
  }

  /**
   * Get sync status for a specific record
   */
  async getRecordSyncStatus(table: string, localId: number): Promise<RecordSyncStatus> {
    try {
      let record: any;

      switch (table) {
        case 'customers':
          record = await db.customers.get(localId);
          break;
        case 'pools':
          record = db.pools?.get ? await db.pools.get(localId) : undefined;
          break;
        case 'equipment':
          record = db.equipment?.get ? await db.equipment.get(localId) : undefined;
          break;
        case 'serviceLogs':
          record = await db.serviceLogs.get(localId);
          break;
        case 'chemicalUsage':
          record = await db.chemicalUsage.get(localId);
          break;
        case 'notes':
          record = await db.notes.get(localId);
          break;
        case 'saltCellLogs':
          record = await db.saltCellLogs.get(localId);
          break;
        default:
          return { status: 'error', error: `Unknown table: ${table}` };
      }

      if (!record) {
        return { status: 'error', error: 'Record not found' };
      }

      return {
        status: record.sync_status || 'pending',
        error: record.sync_error,
        lastSyncAt: record.remote_updated_at,
      };
    } catch (error) {
      return {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get count of pending records across all tables
   */
  async getPendingCount(): Promise<number> {
    try {
      const [customers, pools, equipment, serviceLogs, chemicalUsage, notes, saltCellLogs] = await Promise.all([
        this.getPendingRecords(db.customers),
        this.getPendingRecords(db.pools),
        this.getPendingRecords(db.equipment),
        this.getPendingRecords(db.serviceLogs),
        this.getPendingRecords(db.chemicalUsage),
        this.getPendingRecords(db.notes),
        this.getPendingRecords(db.saltCellLogs),
      ]);

      return customers.length + pools.length + equipment.length + serviceLogs.length + chemicalUsage.length + notes.length + saltCellLogs.length;
    } catch (error) {
      console.error('Error getting pending count:', error);
      return 0;
    }
  }

  /**
   * Add record to sync queue with validation and deduplication
   */
  enqueueRecord(table: string, localId: number, operation: 'create' | 'update' | 'delete', data: Record<string, any>): void {
    // Validate table parameter
    const validTables = ['customers', 'pools', 'equipment', 'serviceLogs', 'chemicalUsage', 'notes', 'saltCellLogs'];
    if (!validTables.includes(table)) {
      throw new Error(`Invalid table: ${table}`);
    }

    // Check for existing queue item to prevent duplicates
    const existingItem = this.syncQueue.findItem(table as SyncQueueItem['table'], localId);
    if (existingItem) {
      // Update existing item with latest data and operation
      this.syncQueue.enqueue({
        table: table as SyncQueueItem['table'],
        localId,
        operation,
        data,
      });
      return;
    }

    this.syncQueue.enqueue({
      table: table as SyncQueueItem['table'],
      localId,
      operation,
      data,
    });
  }

  /**
   * Get sync queue status
   */
  getQueueStatus(): { pending: number; items: SyncQueueItem[]; capacity: { current: number; max: number; warningThreshold: number; usagePercent: number } } {
    return {
      pending: this.syncQueue.getPendingCount(),
      items: this.syncQueue.getPending(),
      capacity: this.syncQueue.getCapacityStatus(),
    };
  }

  private isPendingRecord(record: any): boolean {
    if (!record) return false;
    if (record.sync_status === 'pending') return true;
    if (record.sync_status === 'synced') return false;
    if (record.sync_status === 'error') return false;
    // Legacy rows may predate sync metadata.
    return !record.convex_id;
  }

  private normalizeLocalUpdatedAt(value: unknown): number {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : Date.now();
  }


  private async getPendingRecords(table: any): Promise<any[]> {
    if (!table || typeof table.where !== 'function') {
      return [];
    }

    const pending = await table.where('sync_status').equals('pending').toArray();

    // Legacy records may have no sync_status set yet.
    // Avoid querying equals(undefined), which Dexie rejects with "Invalid key provided".
    let legacyPending: any[] = [];
    try {
      if (typeof table.toCollection === 'function') {
        const allRecords = await table.toCollection().toArray();
        legacyPending = allRecords.filter(
          (record: any) =>
            typeof record?.sync_status === 'undefined' && this.isPendingRecord(record)
        );
      }
    } catch {
      legacyPending = [];
    }

    return [...pending, ...legacyPending];
  }

  // ============================================
  // Private Methods
  // ============================================

  private async syncPendingRecords(trigger: 'manual' | 'auto' = 'auto'): Promise<SyncResult> {
    if (!this.convexClient) {
      return {
        success: false,
        error: 'Cannot sync while sync service is uninitialized',
        syncedCount: 0,
        failedCount: 0,
      };
    }

    if (!this.isOnline) {
      this.setStatus('offline');
      return {
        success: false,
        error: 'Cannot sync while offline',
        syncedCount: 0,
        failedCount: 0,
      };
    }

    if (this.isSyncCycleRunning) {
      return {
        success: false,
        error: 'Sync already in progress',
        syncedCount: 0,
        failedCount: 0,
      };
    }

    this.isSyncCycleRunning = true;
    this.lastSyncStartedAt = performance.now();
    this.setStatus('syncing');
    this.recordQueueDepth('cycle_start', trigger, { status: this.currentStatus });
    monitoring.recordMetric('sync_cycle_started', this.lastSyncStartedAt, { trigger });

    let syncedCount = 0;
    let failedCount = 0;

    try {
      this.recordQueueDepth('before_batch', trigger);

      // Get retryable items from queue (respects exponential backoff)
      const retryableItems = this.syncQueue.getRetryableItems();
      const batchSize = this.syncQueue.getBatchSize();

      if (retryableItems.length === 0) {
        // No items ready for retry, check database for new pending records
        // Note: SyncQueue.enqueue() automatically deduplicates by table+localId
        const [pendingCustomers, pendingPools, pendingEquipment, pendingServiceLogs, pendingChemicalUsage, pendingNotes, pendingSaltCellLogs] = await Promise.all([
          this.getPendingRecords(db.customers),
          this.getPendingRecords(db.pools),
          this.getPendingRecords(db.equipment),
          this.getPendingRecords(db.serviceLogs),
          this.getPendingRecords(db.chemicalUsage),
          this.getPendingRecords(db.notes),
          this.getPendingRecords(db.saltCellLogs),
        ]);

        // Add new pending records to queue (deduplication handled by queue)
        // Priority order: customers first (due to foreign key dependencies)
        for (const customer of pendingCustomers) {
          this.syncQueue.enqueue({
            table: 'customers',
            localId: customer.id!,
            operation: customer.convex_id ? 'update' : 'create',
            data: customer,
          });
        }

        for (const pool of pendingPools) {
          this.syncQueue.enqueue({
            table: 'pools',
            localId: pool.id!,
            operation: pool.convex_id ? 'update' : 'create',
            data: pool,
          });
        }

        for (const equipment of pendingEquipment) {
          this.syncQueue.enqueue({
            table: 'equipment',
            localId: equipment.id!,
            operation: equipment.convex_id ? 'update' : 'create',
            data: equipment,
          });
        }

        for (const serviceLog of pendingServiceLogs) {
          this.syncQueue.enqueue({
            table: 'serviceLogs',
            localId: serviceLog.id!,
            operation: serviceLog.convex_id ? 'update' : 'create',
            data: serviceLog,
          });
        }

        for (const chemicalUsage of pendingChemicalUsage) {
          this.syncQueue.enqueue({
            table: 'chemicalUsage',
            localId: chemicalUsage.id!,
            operation: chemicalUsage.convex_id ? 'update' : 'create',
            data: chemicalUsage,
          });
        }

        for (const note of pendingNotes) {
          this.syncQueue.enqueue({
            table: 'notes',
            localId: note.id!,
            operation: note.convex_id ? 'update' : 'create',
            data: note,
          });
        }

        for (const saltCellLog of pendingSaltCellLogs) {
          this.syncQueue.enqueue({
            table: 'saltCellLogs',
            localId: saltCellLog.id!,
            operation: saltCellLog.convex_id ? 'update' : 'create',
            data: saltCellLog,
          });
        }

        // Get updated retryable items
        const updatedRetryableItems = this.syncQueue.getRetryableItems();

        // Process items with priority order (customers first)
        const batchItems = updatedRetryableItems.slice(0, batchSize);
        for (const item of batchItems) {
          const success = await this.syncQueueItem(item);
          if (success) {
            syncedCount++;
            this.syncQueue.markSynced(item.table, item.localId);
          } else {
            failedCount++;
          }
        }
      } else {
        // Process retryable items
        const batchItems = retryableItems.slice(0, batchSize);
        for (const item of batchItems) {
          const success = await this.syncQueueItem(item);
          if (success) {
            syncedCount++;
            this.syncQueue.markSynced(item.table, item.localId);
          } else {
            failedCount++;
          }
        }
      }

      // Push local writes first, then pull the authoritative remote snapshot.
      // This ordering means a newly-created customer is available before its
      // dependent logs are merged and keeps the watermark monotonic.
      let pullResult = { pulledCount: 0, conflictCount: 0, hasMore: false };
      if (failedCount === 0) {
        try {
          pullResult = await this.pullRemoteChanges();
        } catch (pullError) {
          failedCount += 1;
          console.error('Remote pull failed after push batch:', pullError);
        }
      }

      const result: SyncResult = {
        success: failedCount === 0,
        syncedCount,
        failedCount,
        pulledCount: pullResult.pulledCount,
        conflictCount: pullResult.conflictCount,
      };

      this.recordQueueDepth('after_batch', trigger, {
        success: result.success,
        syncedCount,
        failedCount,
      });

      monitoring.recordMetric('sync_cycle_complete', performance.now() - this.lastSyncStartedAt, {
        trigger,
        synced: syncedCount,
        failed: failedCount,
      });

      if (!result.success) {
        monitoring.recordMetric('sync_cycle_partial', 1, {
          trigger,
          synced: syncedCount,
          failed: failedCount,
        });
        this.setStatus('error');
      } else {
        this.setStatus('idle');
      }

      return result;
    } catch (error) {
      monitoring.recordMetric('sync_cycle_failed', performance.now() - this.lastSyncStartedAt, {
        trigger,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      this.setStatus('error');
      console.error('Error during sync:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        syncedCount,
        failedCount: failedCount + 1,
      };
    } finally {
      this.isSyncCycleRunning = false;
    }
  }

  private async syncQueueItem(item: SyncQueueItem): Promise<boolean> {
    try {
      // Get fresh record from database
      let record: any;

      switch (item.table) {
        case 'customers':
          record = await db.customers.get(item.localId);
          break;
        case 'pools':
          record = db.pools?.get ? await db.pools.get(item.localId) : undefined;
          break;
        case 'equipment':
          record = db.equipment?.get ? await db.equipment.get(item.localId) : undefined;
          break;
        case 'serviceLogs':
          record = await db.serviceLogs.get(item.localId);
          break;
        case 'chemicalUsage':
          record = await db.chemicalUsage.get(item.localId);
          break;
        case 'notes':
          record = await db.notes.get(item.localId);
          break;
        case 'saltCellLogs':
          record = await db.saltCellLogs.get(item.localId);
          break;
        default:
          throw new Error(`Unknown table: ${item.table}`);
      }

      if (!record) {
        // Record was deleted, remove from queue
        this.syncQueue.markSynced(item.table, item.localId);
        return true;
      }

      // Use existing sync logic
      return await this.syncSingleRecord(item.table, record);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`Failed to sync queue item ${item.table}[${item.localId}]:`, errorMessage);
      monitoring.recordMetric('sync_queue_item_error', 1, {
        table: item.table,
        localId: item.localId,
        phase: 'syncQueueItem',
        error: errorMessage,
      });

      // Mark as failed in queue (handles retry logic with exponential backoff)
      this.syncQueue.markFailed(item.table, item.localId, errorMessage);

      return false;
    }
  }

  private async resolveConvexPoolId(record: any): Promise<string | undefined> {
    if (!record?.pool_id) return record?.convex_pool_id;
    const pool = db.pools?.get ? await db.pools.get(record.pool_id) : undefined;
    if (!pool) throw new Error(`Pool ${record.pool_id} not found`);
    if (!pool.convex_id || pool.sync_status === 'pending') {
      if (!(await this.syncSingleRecord('pools', pool))) throw new Error(`Failed to sync pool ${record.pool_id}`);
    }
    const refreshed = await db.pools.get(record.pool_id);
    return refreshed?.convex_id || record.convex_pool_id;
  }

  private async syncSingleRecord(table: string, record: any, conflictRetryCount = 0): Promise<boolean> {
    if (!this.convexClient) return false;

    let retryCount = 0;
    const maxRetries = this.MAX_RETRIES;
    const maxConflictRetries = this.MAX_CONFLICT_RETRIES;
    // Keep this key stable across network retries, but rotate it when a
    // conflict is explicitly retried after resolving a newer remote version.
    const idempotencyKey = `sync:${table}:${record.id}:${this.normalizeLocalUpdatedAt(record.local_updated_at)}:${conflictRetryCount}`;

    while (retryCount < maxRetries) {
      try {
        const localUpdatedAt = this.normalizeLocalUpdatedAt(record.local_updated_at);
        const convexPoolId = ['serviceLogs', 'chemicalUsage', 'notes', 'saltCellLogs'].includes(table)
          ? await this.resolveConvexPoolId(record)
          : undefined;
        let result: any;

        switch (table) {
          case 'customers':
            result = await this.convexClient.mutation(api.sync.syncCustomer, {
              local_id: record.id,
              data: {
                full_name: record.full_name,
                address: record.address,
                phone: record.phone,
                email: record.email,
                gate_code: record.gate_code,
                service_day: record.service_day,
                pool_gallons: record.pool_gallons,
                pool_type: record.pool_type,
                surface_type: record.surface_type,
                sort_order: record.sort_order,
                created_by: record.created_by,
                report_settings: record.report_settings,
              },
              local_updated_at: localUpdatedAt,
              convex_id: record.convex_id as Id<"customers"> | undefined,
              idempotency_key: idempotencyKey,
            });
            break;

          case 'pools': {
            const poolCustomer = await db.customers.get(record.customer_id);
            if (!poolCustomer) throw new Error(`Pool ${record.id} references missing customer ${record.customer_id}`);
            if (!poolCustomer.convex_id || poolCustomer.sync_status === 'pending') {
              if (!(await this.syncSingleRecord('customers', poolCustomer))) throw new Error('Failed to sync pool customer');
            }
            const finalPoolCustomer = await db.customers.get(record.customer_id);
            if (!finalPoolCustomer?.convex_id) throw new Error('Pool customer missing convex_id');
            result = await this.convexClient.mutation((api as any).sync.syncPool, {
              local_id: record.id,
              convex_customer_id: finalPoolCustomer.convex_id as Id<"customers">,
              data: {
                name: record.name,
                address: record.address,
                service_day: record.service_day,
                pool_gallons: record.pool_gallons,
                pool_type: record.pool_type,
                surface_type: record.surface_type,
                sort_order: record.sort_order,
                notes: record.notes,
                active: record.active,
              },
              local_updated_at: localUpdatedAt,
              convex_id: record.convex_id as Id<"pools"> | undefined,
              idempotency_key: idempotencyKey,
            });
            break;
          }

          case 'equipment': {
            const equipmentPool = db.pools?.get ? await db.pools.get(record.pool_id) : undefined;
            if (!equipmentPool) throw new Error(`Equipment ${record.id} references missing pool ${record.pool_id}`);
            if (!equipmentPool.convex_id || equipmentPool.sync_status === 'pending') {
              if (!(await this.syncSingleRecord('pools', equipmentPool))) throw new Error('Failed to sync equipment pool');
            }
            const finalEquipmentPool = await db.pools.get(record.pool_id);
            if (!finalEquipmentPool?.convex_id) throw new Error('Equipment pool missing convex_id');
            result = await this.convexClient.mutation((api as any).sync.syncEquipment, {
              local_id: record.id,
              convex_pool_id: finalEquipmentPool.convex_id as Id<"pools">,
              data: {
                equipment_type: record.equipment_type,
                name: record.name,
                brand: record.brand,
                model: record.model,
                serial_number: record.serial_number,
                install_date: record.install_date,
                status: record.status,
                last_service_date: record.last_service_date,
                next_service_due: record.next_service_due,
                notes: record.notes,
              },
              local_updated_at: localUpdatedAt,
              convex_id: record.convex_id as Id<"equipment"> | undefined,
              idempotency_key: idempotencyKey,
            });
            break;
          }

          case 'serviceLogs':
            // Need to get convex_customer_id first - auto-sync customer if needed
            const customer = await db.customers.get(record.customer_id);
            if (!customer) {
              // Customer was deleted - mark this service log as orphaned and skip sync
              console.warn(`Service log ${record.id} references deleted customer ${record.customer_id} - marking as orphaned`);
              await db.serviceLogs.update(record.id, {
                sync_status: 'error',
                sync_error: `Orphaned record: Customer ${record.customer_id} no longer exists`,
              });
              return false; // Skip this record but don't crash
            }
            if (!customer.convex_id || customer.sync_status === 'pending') {
              // Auto-sync the customer first if not synced or has pending updates
              console.log(`Auto-syncing/updating customer ${record.customer_id} before service log`);
              const customerSyncSuccess = await this.syncSingleRecord('customers', customer);
              if (!customerSyncSuccess) {
                throw new Error(`Failed to sync/update customer before service log`);
              }

              // Refresh customer data after sync
              const syncedCustomer = await db.customers.get(record.customer_id);
              if (!syncedCustomer?.convex_id) {
                throw new Error('Customer sync completed but convex_id still missing');
              }
            }

            // Get the customer again (might have been updated by auto-sync)
            const finalCustomer = await db.customers.get(record.customer_id);
            if (!finalCustomer?.convex_id) {
              throw new Error(`Customer ${record.customer_id} not found or missing convex_id`);
            }

            result = await this.convexClient.mutation(api.sync.syncServiceLog, {
              local_id: record.id,
              convex_customer_id: finalCustomer.convex_id as Id<"customers">,
              data: {
                service_date: record.service_date,
                status: record.status,
                service_type: record.service_type,
                notes: record.notes,
                ph: record.ph,
                chlorine: record.chlorine,
                alkalinity: record.alkalinity,
                stabilizer: record.stabilizer,
                salt: record.salt,
                ph_value: record.ph_value,
                chlorine_value: record.chlorine_value,
                alkalinity_value: record.alkalinity_value,
                stabilizer_value: record.stabilizer_value,
                start_time: record.start_time,
                end_time: record.end_time,
                duration_ms: record.duration_ms,
                pool_id: convexPoolId as Id<"pools"> | undefined,
              },
              local_updated_at: localUpdatedAt,
              convex_id: record.convex_id as Id<"serviceLogs"> | undefined,
              idempotency_key: idempotencyKey,
            });
            break;

          case 'chemicalUsage':
            const chemCustomer = await db.customers.get(record.customer_id);
            if (!chemCustomer) {
              console.warn(`Chemical usage ${record.id} references deleted customer ${record.customer_id}`);
              await db.chemicalUsage.update(record.id, {
                sync_status: 'error',
                sync_error: `Orphaned record: Customer ${record.customer_id} no longer exists`,
              });
              return false;
            }

            if (!chemCustomer.convex_id || chemCustomer.sync_status === 'pending') {
              // Auto-sync the customer first
              console.log(`Auto-syncing/updating customer ${record.customer_id} before chemical usage`);
              const customerSyncSuccess = await this.syncSingleRecord('customers', chemCustomer);
              if (!customerSyncSuccess) {
                throw new Error(`Failed to sync/update customer before chemical usage`);
              }
            }

            // Get the customer again (might have been updated by auto-sync)
            const finalChemCustomer = await db.customers.get(record.customer_id);
            if (!finalChemCustomer?.convex_id) {
              throw new Error(`Customer ${record.customer_id} not found or missing convex_id`);
            }

            result = await this.convexClient.mutation(api.sync.syncChemicalUsage, {
              local_id: record.id,
              convex_customer_id: finalChemCustomer.convex_id as Id<"customers">,
              data: {
                chemical_type: record.chemical_type,
                quantity: record.quantity,
                notes: record.notes,
                created_date: record.created_date,
                pool_id: convexPoolId as Id<"pools"> | undefined,
              },
              local_updated_at: localUpdatedAt,
              convex_id: record.convex_id as Id<"chemicalUsage"> | undefined,
              idempotency_key: idempotencyKey,
            });
            break;

          case 'notes':
            let noteCustomer = null;
            if (record.customer_id) {
              noteCustomer = await db.customers.get(record.customer_id);
              if (!noteCustomer) {
                console.warn(`Note ${record.id} references deleted customer ${record.customer_id}`);
              } else if (!noteCustomer.convex_id || noteCustomer.sync_status === 'pending') {
                // Auto-sync the customer first
                console.log(`Auto-syncing/updating customer ${record.customer_id} before note`);
                const customerSyncSuccess = await this.syncSingleRecord('customers', noteCustomer);
                if (!customerSyncSuccess) {
                  throw new Error(`Failed to sync/update customer before note`);
                }
                // Refresh noteCustomer after sync
                noteCustomer = await db.customers.get(record.customer_id);
              }
            }

            result = await this.convexClient.mutation(api.sync.syncNote, {
              local_id: record.id,
              convex_customer_id: noteCustomer?.convex_id as Id<"customers"> | undefined,
              data: {
                title: record.title,
                content: record.content,
                category: record.category,
                priority: record.priority,
                completed: record.completed,
                created_date: record.created_date,
                pool_id: convexPoolId as Id<"pools"> | undefined,
              },
              local_updated_at: localUpdatedAt,
              convex_id: record.convex_id as Id<"notes"> | undefined,
              idempotency_key: idempotencyKey,
            });
            break;

          case 'saltCellLogs':
            const saltCellCustomer = await db.customers.get(record.customer_id);
            if (!saltCellCustomer) {
              console.warn(`Salt cell log ${record.id} references deleted customer ${record.customer_id}`);
              await db.saltCellLogs.update(record.id, {
                sync_status: 'error',
                sync_error: `Orphaned record: Customer ${record.customer_id} no longer exists`,
              });
              return false;
            }

            if (!saltCellCustomer.convex_id || saltCellCustomer.sync_status === 'pending') {
              // Auto-sync the customer first
              console.log(`Auto-syncing/updating customer ${record.customer_id} before salt cell log`);
              const customerSyncSuccess = await this.syncSingleRecord('customers', saltCellCustomer);
              if (!customerSyncSuccess) {
                throw new Error(`Failed to sync/update customer before salt cell log`);
              }
            }

            // Get the customer again (might have been updated by auto-sync)
            const finalSaltCustomer = await db.customers.get(record.customer_id);
            if (!finalSaltCustomer?.convex_id) {
              throw new Error(`Customer ${record.customer_id} not found or missing convex_id`);
            }

            result = await this.convexClient.mutation(api.sync.syncSaltCellLog, {
              local_id: record.id,
              convex_customer_id: finalSaltCustomer.convex_id as Id<"customers">,
              data: {
                cleaning_date: record.cleaning_date,
                condition: record.condition,
                notes: record.notes,
                next_cleaning_due: record.next_cleaning_due,
                pool_id: convexPoolId as Id<"pools"> | undefined,
              },
              local_updated_at: localUpdatedAt,
              convex_id: record.convex_id as Id<"saltCellLogs"> | undefined,
              idempotency_key: idempotencyKey,
            });
            break;

          default:
            throw new Error(`Unknown table: ${table}`);
        }

        if (result.success) {
          // Update local record with sync success
          const updateData = {
            convex_id: result.convex_id,
            sync_status: 'synced' as const,
            sync_error: undefined,
            remote_updated_at: result.updated_at ?? Date.now(), // Use server timestamp
          };

          try {
            switch (table) {
              case 'customers':
                await db.customers.update(record.id, updateData);
                break;
              case 'pools':
                await db.pools.update(record.id, updateData);
                break;
              case 'equipment':
                await db.equipment.update(record.id, updateData);
                break;
              case 'serviceLogs':
                await db.serviceLogs.update(record.id, {
                  ...updateData,
                  convex_customer_id: result.convex_customer_id,
                });
                break;
              case 'chemicalUsage':
                await db.chemicalUsage.update(record.id, {
                  ...updateData,
                  convex_customer_id: result.convex_customer_id,
                });
                break;
              case 'notes':
                await db.notes.update(record.id, {
                  ...updateData,
                  convex_customer_id: result.convex_customer_id,
                });
                break;
              case 'saltCellLogs':
                await db.saltCellLogs.update(record.id, {
                  ...updateData,
                  convex_customer_id: result.convex_customer_id,
                });
                break;
            }
          } catch (updateError) {
            console.error(`Failed to update local record after successful sync for ${table}[${record.id}]:`, updateError);
            // Still return true since remote sync succeeded
            // The record will be marked as synced in the queue, preventing re-sync
            // But the local record won't have the sync status updated
          }

          return true;
        } else if (result.operation === 'conflict') {
          // Handle conflict using ConflictResolver
          // console.warn(`Conflict detected for ${table}[${record.id}]:`, result.conflict);
          monitoring.recordMetric('sync_conflict_detected', 1, {
            table,
            localId: record.id,
            conflictRetryCount,
            operation: result.operation,
            phase: 'sync_cycle',
          });

          // Build remote record from conflict data
          const remoteRecord = result.conflict?.remote_data ? {
            ...result.conflict.remote_data,
            remote_updated_at: result.conflict.remote_updated_at,
          } : undefined;

          // Get conflict info for logging
          const conflictInfo = this.conflictResolver.getConflictInfo(record, remoteRecord);
          if (conflictInfo) {
            this.conflictResolver.logConflict(table, record.id!, conflictInfo);
          }

          // Resolve conflict using last-write-wins strategy
          const resolution = this.conflictResolver.resolve(record, remoteRecord);

          if (resolution.backupCreated) {
            console.log(`Created conflict backup for ${table}[${record.id}]`);
          }

          // Check if local or remote won
          const localTime = record.local_updated_at || 0;
          const remoteTime = result.conflict?.remote_updated_at || 0;
          const localWins = localTime > remoteTime;

          try {
            if (localWins) {
              // Local wins - update local record and retry sync to push local changes
              // But first check if we've exceeded conflict retry limit
              if (conflictRetryCount >= maxConflictRetries) {
                console.error(`Max conflict retries (${maxConflictRetries}) exceeded for ${table}[${record.id}]. Marking as error.`);
                monitoring.recordMetric('sync_conflict_exhausted', 1, {
                  table,
                  localId: record.id,
                  conflictRetryCount,
                  maxConflictRetries,
                });

                const errorData = {
                  ...resolution.resolved,
                  sync_status: 'error' as const,
                sync_error: `Conflict resolution failed after ${maxConflictRetries} attempts. Local changes preserved but not synced.`,
                };

                switch (table) {
                  case 'customers':
                    await db.customers.update(record.id, errorData);
                    break;
                  case 'pools':
                    await db.pools.update(record.id, errorData);
                    break;
                  case 'equipment':
                    await db.equipment.update(record.id, errorData);
                    break;
                  case 'serviceLogs':
                    await db.serviceLogs.update(record.id, errorData);
                    break;
                  case 'chemicalUsage':
                    await db.chemicalUsage.update(record.id, errorData);
                    break;
                  case 'notes':
                    await db.notes.update(record.id, errorData);
                    break;
                  case 'saltCellLogs':
                    await db.saltCellLogs.update(record.id, errorData);
                    break;
                }

                return false;
              }

              const resolvedData = {
                ...resolution.resolved,
                sync_status: 'pending' as const,
                sync_error: `Conflict resolved: local version wins. ${resolution.backupCreated ? 'Remote data backed up.' : ''} Retrying sync (attempt ${conflictRetryCount + 1}/${maxConflictRetries})...`,
              };

              switch (table) {
                case 'customers':
                  await db.customers.update(record.id, resolvedData);
                  break;
                case 'pools':
                  await db.pools.update(record.id, resolvedData);
                  break;
                case 'equipment':
                  await db.equipment.update(record.id, resolvedData);
                  break;
                case 'serviceLogs':
                  await db.serviceLogs.update(record.id, resolvedData);
                  break;
                case 'chemicalUsage':
                  await db.chemicalUsage.update(record.id, resolvedData);
                  break;
                case 'notes':
                  await db.notes.update(record.id, resolvedData);
                  break;
                case 'saltCellLogs':
                  await db.saltCellLogs.update(record.id, resolvedData);
                  break;
              }

              // Add exponential backoff delay before retry to give remote time to settle
              const backoffMs = Math.pow(2, conflictRetryCount) * 500; // 500ms, 1s, 2s
              monitoring.recordMetric('sync_conflict_retry', 1, {
                table,
                localId: record.id,
                retryAttempt: conflictRetryCount + 1,
                maxConflictRetries,
                backoffMs,
              });
              if (backoffMs > 0) {
                console.log(`Waiting ${backoffMs}ms before conflict retry for ${table}[${record.id}]`);
                await new Promise(resolve => setTimeout(resolve, backoffMs));
              }

              // Retry sync with resolved data and incremented conflict counter
              const updatedRecord = { ...record, ...resolvedData };
              return await this.syncSingleRecord(table, updatedRecord, conflictRetryCount + 1);
            } else {
              // Remote wins - update local record with remote data, mark as synced (no retry needed)
              const resolvedData = {
                ...resolution.resolved,
                sync_status: 'synced' as const,
                sync_error: undefined,
              };

              switch (table) {
                case 'customers':
                  await db.customers.update(record.id, resolvedData);
                  break;
                case 'pools':
                  await db.pools.update(record.id, resolvedData);
                  break;
                case 'equipment':
                  await db.equipment.update(record.id, resolvedData);
                  break;
                case 'serviceLogs':
                  await db.serviceLogs.update(record.id, resolvedData);
                  break;
                case 'chemicalUsage':
                  await db.chemicalUsage.update(record.id, resolvedData);
                  break;
                case 'notes':
                  await db.notes.update(record.id, resolvedData);
                  break;
                case 'saltCellLogs':
                  await db.saltCellLogs.update(record.id, resolvedData);
                  break;
              }

              console.log(`Conflict resolved for ${table}[${record.id}]: remote version accepted${resolution.backupCreated ? ', local changes backed up' : ''}`);
              monitoring.recordMetric('sync_conflict_remote_wins', 1, {
                table,
                localId: record.id,
                remoteTimestamp: remoteTime,
              });
              return true; // No retry needed - we accepted remote version
            }
          } catch (updateError) {
            console.error(`Failed to update local record after conflict resolution for ${table}[${record.id}]:`, updateError);
            return false;
          }
        } else {
          throw new Error(result.error || 'Sync failed');
        }
      } catch (error) {
        retryCount++;
        if (this.isAuthOrPermissionError(error)) {
          this.setStatus('error');
          await this.markRecordAuthError(table, record, error);
          return false;
        }

        // Check if it's a network error that should be retried
        const isNetworkError = error instanceof Error && (
          error.message.includes('network') ||
          error.message.includes('fetch') ||
          error.message.includes('timeout') ||
          error.message.includes('connection')
        );

        if (isNetworkError && retryCount < maxRetries) {
          // Exponential backoff: 1s, 2s, 4s
          const backoffMs = Math.pow(2, retryCount - 1) * 1000;
          console.log(`Retry ${retryCount}/${maxRetries} for ${table}[${record.id}] after ${backoffMs}ms`);

          await new Promise(resolve => setTimeout(resolve, backoffMs));
          continue; // Retry
        }

        // Max retries reached or non-network error
        console.error(`Failed to sync ${table}[${record.id}] after ${retryCount} attempts:`, error);

        // Update local record with error
        const errorData = {
          sync_status: 'error' as const,
          sync_error: error instanceof Error ? error.message : 'Unknown error',
        };

        try {
          switch (table) {
            case 'customers':
              await db.customers.update(record.id, errorData);
              break;
            case 'pools':
              await db.pools.update(record.id, errorData);
              break;
            case 'equipment':
              await db.equipment.update(record.id, errorData);
              break;
            case 'serviceLogs':
              await db.serviceLogs.update(record.id, errorData);
              break;
            case 'chemicalUsage':
              await db.chemicalUsage.update(record.id, errorData);
              break;
            case 'notes':
              await db.notes.update(record.id, errorData);
              break;
            case 'saltCellLogs':
              await db.saltCellLogs.update(record.id, errorData);
              break;
          }
        } catch (updateError) {
          console.error('Failed to update error status:', updateError);
        }

        return false;
      }
    }

    return false;
  }

  private async markRecordAuthError(table: string, record: any, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : 'Authentication failed';
    const errorData = {
      sync_status: 'error' as const,
      sync_error: message,
    };

    try {
      switch (table) {
        case 'customers':
          await db.customers.update(record.id, errorData);
          break;
        case 'pools':
          await db.pools.update(record.id, errorData);
          break;
        case 'equipment':
          await db.equipment.update(record.id, errorData);
          break;
        case 'serviceLogs':
          await db.serviceLogs.update(record.id, errorData);
          break;
        case 'chemicalUsage':
          await db.chemicalUsage.update(record.id, errorData);
          break;
        case 'notes':
          await db.notes.update(record.id, errorData);
          break;
        case 'saltCellLogs':
          await db.saltCellLogs.update(record.id, errorData);
          break;
        default:
          break;
      }
    } catch (updateError) {
      console.error('Failed to persist auth-related sync error:', updateError);
    }
  }

  private setStatus(status: SyncStatus): void {
    if (this.currentStatus !== status) {
      this.currentStatus = status;
      this.statusCallbacks.forEach(callback => callback(status));
    }
  }

  private handleOnline(): void {
    if (this.isOnline) {
      return;
    }

    this.isOnline = true;
    monitoring.recordMetric('network_online', performance.now());
    this.setStatus(this.currentStatus === 'error' ? this.currentStatus : 'idle');
    console.log('Device came online - resuming sync');

    if (this.isInitialized && !this.autoSyncInterval) {
      this.startAutoSync();
    }

    if (this.convexClient && this.isInitialized) {
      this.syncPendingRecords('auto').catch((error) => {
        console.error('Error syncing after coming online:', error);
        this.setStatus('error');
      });
    }
  }

  private handleOffline(): void {
    if (!this.isOnline) {
      return;
    }

    this.isOnline = false;
    monitoring.recordMetric('network_offline', performance.now());
    this.setStatus('offline');
    console.log('Device went offline - pausing sync');

    if (this.autoSyncInterval) {
      clearInterval(this.autoSyncInterval);
      this.autoSyncInterval = null;
      console.log('Auto-sync paused due to offline status');
    }

    if (this.currentStatus !== 'error') {
      this.setStatus('offline');
    }
  }

  private isAuthOrPermissionError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;

    const message = error.message.toLowerCase();
    return (
      message.includes('permission') ||
      message.includes('forbidden') ||
      message.includes('unauthorized') ||
      message.includes('unauthenticated') ||
      message.includes('auth') ||
      message.includes('token') ||
      message.includes('session')
    );
  }

  private registerConnectivityListeners(): void {
    if (this.isConnectivityListening || typeof window === 'undefined') return;

    this.onlineHandler = this.handleOnline.bind(this);
    this.offlineHandler = this.handleOffline.bind(this);

    window.addEventListener('online', this.onlineHandler);
    window.addEventListener('offline', this.offlineHandler);
    this.isConnectivityListening = true;
  }

  private unregisterConnectivityListeners(): void {
    if (!this.isConnectivityListening || typeof window === 'undefined') return;

    if (this.onlineHandler && this.offlineHandler) {
      window.removeEventListener('online', this.onlineHandler);
      window.removeEventListener('offline', this.offlineHandler);
      this.onlineHandler = null;
      this.offlineHandler = null;
    }

    this.isConnectivityListening = false;
  }
}

// Singleton instance
export const syncService = new SyncService();
