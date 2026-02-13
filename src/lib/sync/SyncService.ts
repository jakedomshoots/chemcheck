import { ConvexReactClient } from 'convex/react';
import { Id } from '../../../convex/_generated/dataModel';
import { db } from '@/db/chemcheck-db';
import { api } from '../../../convex/_generated/api';
import { SyncQueue, SyncQueueItem } from './SyncQueue';
import { ConflictResolver } from './ConflictResolver';

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline';

export interface SyncResult {
  success: boolean;
  error?: string;
  syncedCount: number;
  failedCount: number;
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
  private onlineHandler: (() => void) | null = null;
  private offlineHandler: (() => void) | null = null;
  private syncQueue: SyncQueue;
  private conflictResolver: ConflictResolver;

  constructor() {
    this.syncQueue = new SyncQueue();
    this.conflictResolver = new ConflictResolver();

    // Listen for online/offline events (SSR safe)
    if (typeof window !== 'undefined') {
      this.onlineHandler = this.handleOnline.bind(this);
      this.offlineHandler = this.handleOffline.bind(this);
      window.addEventListener('online', this.onlineHandler);
      window.addEventListener('offline', this.offlineHandler);
    }
  }

  /**
   * Initialize the sync service with Convex client (idempotent)
   */
  initialize(convexClient: ConvexReactClient): void {
    if (this.isInitialized && this.convexClient === convexClient) {
      console.log('SyncService already initialized with same client');
      return;
    }

    // Clean up previous initialization if different client
    if (this.isInitialized) {
      this.cleanup();
    }

    this.convexClient = convexClient;
    this.isInitialized = true;

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

    // Don't start auto-sync if offline
    if (!this.isOnline) {
      console.log('Cannot start auto-sync: device is offline');
      return;
    }

    // Prevent duplicate intervals
    if (this.autoSyncInterval) {
      console.log('Auto-sync already running');
      return;
    }

    // Sync every 30 seconds when online
    this.autoSyncInterval = setInterval(() => {
      if (this.isOnline && this.convexClient) {
        this.syncPendingRecords().catch(error => {
          console.error('Auto-sync failed:', error);
        });
      }
    }, 30000);

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

    // Remove event listeners
    if (typeof window !== 'undefined' && this.onlineHandler && this.offlineHandler) {
      window.removeEventListener('online', this.onlineHandler);
      window.removeEventListener('offline', this.offlineHandler);
      this.onlineHandler = null;
      this.offlineHandler = null;
    }

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

    this.setStatus('syncing');

    try {
      const result = await this.syncPendingRecords();
      this.setStatus('idle');
      return result;
    } catch (error) {
      this.setStatus('error');
      throw error;
    }
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
      const [customers, serviceLogs, chemicalUsage, notes, saltCellLogs] = await Promise.all([
        db.customers.where('sync_status').equals('pending').count(),
        db.serviceLogs.where('sync_status').equals('pending').count(),
        db.chemicalUsage.where('sync_status').equals('pending').count(),
        db.notes.where('sync_status').equals('pending').count(),
        db.saltCellLogs.where('sync_status').equals('pending').count(),
      ]);

      return customers + serviceLogs + chemicalUsage + notes + saltCellLogs;
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
    const validTables = ['customers', 'serviceLogs', 'chemicalUsage', 'notes', 'saltCellLogs'];
    if (!validTables.includes(table)) {
      throw new Error(`Invalid table: ${table}`);
    }

    // Check for existing queue item to prevent duplicates
    const existingItem = this.syncQueue.findItem(table as SyncQueueItem['table'], localId);
    if (existingItem) {
      // Update existing item with latest data and operation
      existingItem.operation = operation;
      existingItem.data = data;
      existingItem.lastAttempt = undefined; // Reset retry timing
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

  // ============================================
  // Private Methods
  // ============================================

  private async syncPendingRecords(): Promise<SyncResult> {
    let syncedCount = 0;
    let failedCount = 0;

    try {
      // Get retryable items from queue (respects exponential backoff)
      const retryableItems = this.syncQueue.getRetryableItems();

      if (retryableItems.length === 0) {
        // No items ready for retry, check database for new pending records
        // Note: SyncQueue.enqueue() automatically deduplicates by table+localId
        const [pendingCustomers, pendingServiceLogs, pendingChemicalUsage, pendingNotes, pendingSaltCellLogs] = await Promise.all([
          db.customers.where('sync_status').equals('pending').toArray(),
          db.serviceLogs.where('sync_status').equals('pending').toArray(),
          db.chemicalUsage.where('sync_status').equals('pending').toArray(),
          db.notes.where('sync_status').equals('pending').toArray(),
          db.saltCellLogs.where('sync_status').equals('pending').toArray(),
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
        for (const item of updatedRetryableItems) {
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
        for (const item of retryableItems) {
          const success = await this.syncQueueItem(item);
          if (success) {
            syncedCount++;
            this.syncQueue.markSynced(item.table, item.localId);
          } else {
            failedCount++;
          }
        }
      }

      return {
        success: failedCount === 0,
        syncedCount,
        failedCount,
      };
    } catch (error) {
      console.error('Error during sync:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        syncedCount,
        failedCount: failedCount + 1,
      };
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

      // Mark as failed in queue (handles retry logic with exponential backoff)
      this.syncQueue.markFailed(item.table, item.localId, errorMessage);

      return false;
    }
  }

  private async syncSingleRecord(table: string, record: any, conflictRetryCount = 0): Promise<boolean> {
    if (!this.convexClient) return false;

    const MAX_RETRIES = 3;
    const MAX_CONFLICT_RETRIES = 2;
    let retryCount = 0;

    while (retryCount < MAX_RETRIES) {
      try {
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
              local_updated_at: record.local_updated_at,
              convex_id: record.convex_id as Id<"customers"> | undefined,
            });
            break;

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
                notes: record.notes,
                ph: record.ph,
                chlorine: record.chlorine,
                alkalinity: record.alkalinity,
                stabilizer: record.stabilizer,
                salt: record.salt,
                start_time: record.start_time,
                end_time: record.end_time,
                duration_ms: record.duration_ms,
              },
              local_updated_at: record.local_updated_at,
              convex_id: record.convex_id as Id<"serviceLogs"> | undefined,
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
              },
              local_updated_at: record.local_updated_at,
              convex_id: record.convex_id as Id<"chemicalUsage"> | undefined,
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
              },
              local_updated_at: record.local_updated_at,
              convex_id: record.convex_id as Id<"notes"> | undefined,
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
              },
              local_updated_at: record.local_updated_at,
              convex_id: record.convex_id as Id<"saltCellLogs"> | undefined,
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
              if (conflictRetryCount >= MAX_CONFLICT_RETRIES) {
                console.error(`Max conflict retries (${MAX_CONFLICT_RETRIES}) exceeded for ${table}[${record.id}]. Marking as error.`);

                const errorData = {
                  ...resolution.resolved,
                  sync_status: 'error' as const,
                  sync_error: `Conflict resolution failed after ${MAX_CONFLICT_RETRIES} attempts. Local changes preserved but not synced.`,
                };

                switch (table) {
                  case 'customers':
                    await db.customers.update(record.id, errorData);
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
                sync_error: `Conflict resolved: local version wins. ${resolution.backupCreated ? 'Remote data backed up.' : ''} Retrying sync (attempt ${conflictRetryCount + 1}/${MAX_CONFLICT_RETRIES})...`,
              };

              switch (table) {
                case 'customers':
                  await db.customers.update(record.id, resolvedData);
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

        // Check if it's a network error that should be retried
        const isNetworkError = error instanceof Error && (
          error.message.includes('network') ||
          error.message.includes('fetch') ||
          error.message.includes('timeout') ||
          error.message.includes('connection')
        );

        if (isNetworkError && retryCount < MAX_RETRIES) {
          // Exponential backoff: 1s, 2s, 4s
          const backoffMs = Math.pow(2, retryCount - 1) * 1000;
          console.log(`Retry ${retryCount}/${MAX_RETRIES} for ${table}[${record.id}] after ${backoffMs}ms`);

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

  private setStatus(status: SyncStatus): void {
    if (this.currentStatus !== status) {
      this.currentStatus = status;
      this.statusCallbacks.forEach(callback => callback(status));
    }
  }

  private handleOnline(): void {
    this.isOnline = true;
    this.setStatus('idle'); // Clear offline status
    console.log('Device came online - resuming sync');

    // Restart auto-sync if it was running before going offline
    if (this.isInitialized && !this.autoSyncInterval) {
      this.startAutoSync();
    }

    // Trigger immediate sync when coming online if initialized
    if (this.convexClient && this.isInitialized) {
      this.syncPendingRecords().catch(error => {
        console.error('Error syncing after coming online:', error);
        this.setStatus('error');
      });
    }
  }

  private handleOffline(): void {
    this.isOnline = false;
    this.setStatus('offline');
    console.log('Device went offline - pausing sync');

    // Stop auto-sync when offline to prevent failed attempts
    if (this.autoSyncInterval) {
      clearInterval(this.autoSyncInterval);
      this.autoSyncInterval = null;
      console.log('Auto-sync paused due to offline status');
    }
  }
}

// Singleton instance
export const syncService = new SyncService();
