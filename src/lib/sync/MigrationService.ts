import { ConvexReactClient } from 'convex/react';
import { db } from '@/db/chemcheck-db';
import { syncService } from './SyncService';

export interface MigrationStatus {
  isRequired: boolean;
  totalRecords: number;
  migratedRecords: number;
  progress: number; // 0-100
  isComplete: boolean;
  error?: string;
  estimatedTimeRemaining?: number; // in milliseconds
}

export interface MigrationResult {
  success: boolean;
  totalRecords: number;
  migratedRecords: number;
  failedRecords: number;
  error?: string;
  discrepancies?: string[];
}

/**
 * Service for handling initial migration of existing local data to Convex
 * Detects existing data, shows migration prompts, and handles batch migration
 */
export class MigrationService {
  private convexClient: ConvexReactClient | null = null;
  private isInitialized = false;
  private migrationInProgress = false;
  private statusCallbacks: ((status: MigrationStatus) => void)[] = [];
  private currentStatus: MigrationStatus = {
    isRequired: false,
    totalRecords: 0,
    migratedRecords: 0,
    progress: 0,
    isComplete: false,
  };

  /**
   * Initialize the migration service with Convex client
   */
  initialize(convexClient: ConvexReactClient): void {
    this.convexClient = convexClient;
    this.isInitialized = true;
    console.log('MigrationService initialized');
  }

  /**
   * Check if migration is required for first-time sync
   * Returns true if there's existing local data that hasn't been synced
   */
  async checkMigrationRequired(): Promise<boolean> {
    if (!this.isInitialized) {
      throw new Error('MigrationService not initialized');
    }

    try {
      // Check for existing unsynced records
      const [unsyncedCustomers, unsyncedServiceLogs, unsyncedChemicalUsage, unsyncedNotes] = await Promise.all([
        db.customers.where('sync_status').notEqual('synced').count(),
        db.serviceLogs.where('sync_status').notEqual('synced').count(),
        db.chemicalUsage.where('sync_status').notEqual('synced').count(),
        db.notes.where('sync_status').notEqual('synced').count(),
      ]);

      const totalUnsynced = unsyncedCustomers + unsyncedServiceLogs + unsyncedChemicalUsage + unsyncedNotes;
      const isRequired = totalUnsynced > 0;

      this.currentStatus = {
        ...this.currentStatus,
        isRequired,
        totalRecords: totalUnsynced,
      };

      return isRequired;
    } catch (error) {
      console.error('Error checking migration requirement:', error);
      throw error; // Propagate error so caller knows the check failed
    }
  }

  /**
   * Get current migration status
   */
  getMigrationStatus(): MigrationStatus {
    return { ...this.currentStatus };
  }

  /**
   * Subscribe to migration status changes
   */
  onMigrationStatusChange(callback: (status: MigrationStatus) => void): () => void {
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
   * Calculate estimated time remaining with division by zero protection
   */
  private calculateEstimatedTime(startTime: number, processedCount: number, totalRecords: number): number {
    if (processedCount === 0) return 0;
    
    const elapsed = Date.now() - startTime;
    const avgTimePerRecord = elapsed / processedCount;
    const remainingRecords = totalRecords - processedCount;
    
    return Math.max(0, avgTimePerRecord * remainingRecords);
  }

  /**
   * Start the migration process with batch processing and progress tracking
   */
  async startMigration(): Promise<MigrationResult> {
    if (!this.isInitialized || !this.convexClient) {
      throw new Error('MigrationService not initialized with Convex client');
    }

    if (this.migrationInProgress) {
      throw new Error('Migration already in progress');
    }

    this.migrationInProgress = true;
    const startTime = Date.now();

    try {
      // Get all unsynced records
      const [unsyncedCustomers, unsyncedServiceLogs, unsyncedChemicalUsage, unsyncedNotes] = await Promise.all([
        db.customers.where('sync_status').notEqual('synced').toArray(),
        db.serviceLogs.where('sync_status').notEqual('synced').toArray(),
        db.chemicalUsage.where('sync_status').notEqual('synced').toArray(),
        db.notes.where('sync_status').notEqual('synced').toArray(),
      ]);

      const totalRecords = unsyncedCustomers.length + unsyncedServiceLogs.length + 
                          unsyncedChemicalUsage.length + unsyncedNotes.length;

      if (totalRecords === 0) {
        this.updateStatus({
          isRequired: false,
          totalRecords: 0,
          migratedRecords: 0,
          progress: 100,
          isComplete: true,
        });

        return {
          success: true,
          totalRecords: 0,
          migratedRecords: 0,
          failedRecords: 0,
        };
      }

      this.updateStatus({
        isRequired: true,
        totalRecords,
        migratedRecords: 0,
        progress: 0,
        isComplete: false,
      });

      let migratedCount = 0;
      let failedCount = 0;
      const batchSize = 10; // Process 10 records at a time

      // Migrate customers first (due to foreign key dependencies)
      console.log(`Starting migration of ${unsyncedCustomers.length} customers...`);
      for (let i = 0; i < unsyncedCustomers.length; i += batchSize) {
        // Check for cancellation before processing each batch
        if (!this.migrationInProgress) {
          throw new Error('Migration cancelled by user');
        }

        const batch = unsyncedCustomers.slice(i, i + batchSize);
        
        for (const customer of batch) {
          // Check for cancellation before each record
          if (!this.migrationInProgress) {
            throw new Error('Migration cancelled by user');
          }

          try {
            const result = await syncService.syncRecord('customers', customer.id!);
            if (result.success) {
              migratedCount++;
            } else {
              failedCount++;
            }
          } catch (error) {
            console.error(`Failed to migrate customer ${customer.id}:`, error);
            failedCount++;
          }

          // Update progress
          const progress = Math.round((migratedCount + failedCount) / totalRecords * 100);
          const estimatedTimeRemaining = this.calculateEstimatedTime(startTime, migratedCount + failedCount, totalRecords);

          this.updateStatus({
            isRequired: true,
            totalRecords,
            migratedRecords: migratedCount,
            progress,
            isComplete: false,
            estimatedTimeRemaining,
          });
        }

        // Small delay between batches to prevent overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Migrate service logs
      console.log(`Starting migration of ${unsyncedServiceLogs.length} service logs...`);
      for (let i = 0; i < unsyncedServiceLogs.length; i += batchSize) {
        // Check for cancellation before processing each batch
        if (!this.migrationInProgress) {
          throw new Error('Migration cancelled by user');
        }

        const batch = unsyncedServiceLogs.slice(i, i + batchSize);
        
        for (const serviceLog of batch) {
          // Check for cancellation before each record
          if (!this.migrationInProgress) {
            throw new Error('Migration cancelled by user');
          }

          try {
            const result = await syncService.syncRecord('serviceLogs', serviceLog.id!);
            if (result.success) {
              migratedCount++;
            } else {
              failedCount++;
            }
          } catch (error) {
            console.error(`Failed to migrate service log ${serviceLog.id}:`, error);
            failedCount++;
          }

          // Update progress
          const progress = Math.round((migratedCount + failedCount) / totalRecords * 100);
          const estimatedTimeRemaining = this.calculateEstimatedTime(startTime, migratedCount + failedCount, totalRecords);

          this.updateStatus({
            isRequired: true,
            totalRecords,
            migratedRecords: migratedCount,
            progress,
            isComplete: false,
            estimatedTimeRemaining,
          });
        }

        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Migrate chemical usage
      console.log(`Starting migration of ${unsyncedChemicalUsage.length} chemical usage records...`);
      for (let i = 0; i < unsyncedChemicalUsage.length; i += batchSize) {
        // Check for cancellation before processing each batch
        if (!this.migrationInProgress) {
          throw new Error('Migration cancelled by user');
        }

        const batch = unsyncedChemicalUsage.slice(i, i + batchSize);
        
        for (const chemicalUsage of batch) {
          // Check for cancellation before each record
          if (!this.migrationInProgress) {
            throw new Error('Migration cancelled by user');
          }

          try {
            const result = await syncService.syncRecord('chemicalUsage', chemicalUsage.id!);
            if (result.success) {
              migratedCount++;
            } else {
              failedCount++;
            }
          } catch (error) {
            console.error(`Failed to migrate chemical usage ${chemicalUsage.id}:`, error);
            failedCount++;
          }

          // Update progress
          const progress = Math.round((migratedCount + failedCount) / totalRecords * 100);
          const estimatedTimeRemaining = this.calculateEstimatedTime(startTime, migratedCount + failedCount, totalRecords);

          this.updateStatus({
            isRequired: true,
            totalRecords,
            migratedRecords: migratedCount,
            progress,
            isComplete: false,
            estimatedTimeRemaining,
          });
        }

        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Migrate notes
      console.log(`Starting migration of ${unsyncedNotes.length} notes...`);
      for (let i = 0; i < unsyncedNotes.length; i += batchSize) {
        // Check for cancellation before processing each batch
        if (!this.migrationInProgress) {
          throw new Error('Migration cancelled by user');
        }

        const batch = unsyncedNotes.slice(i, i + batchSize);
        
        for (const note of batch) {
          // Check for cancellation before each record
          if (!this.migrationInProgress) {
            throw new Error('Migration cancelled by user');
          }

          try {
            const result = await syncService.syncRecord('notes', note.id!);
            if (result.success) {
              migratedCount++;
            } else {
              failedCount++;
            }
          } catch (error) {
            console.error(`Failed to migrate note ${note.id}:`, error);
            failedCount++;
          }

          // Update progress
          const progress = Math.round((migratedCount + failedCount) / totalRecords * 100);
          const estimatedTimeRemaining = this.calculateEstimatedTime(startTime, migratedCount + failedCount, totalRecords);

          this.updateStatus({
            isRequired: true,
            totalRecords,
            migratedRecords: migratedCount,
            progress,
            isComplete: false,
            estimatedTimeRemaining,
          });
        }

        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Migration complete
      this.updateStatus({
        isRequired: false,
        totalRecords,
        migratedRecords: migratedCount,
        progress: 100,
        isComplete: true,
      });

      const result: MigrationResult = {
        success: failedCount === 0,
        totalRecords,
        migratedRecords: migratedCount,
        failedRecords: failedCount,
      };

      if (failedCount > 0) {
        result.error = `${failedCount} records failed to migrate`;
      }

      console.log('Migration completed:', result);
      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown migration error';
      
      this.updateStatus({
        ...this.currentStatus,
        error: errorMessage,
      });

      return {
        success: false,
        totalRecords: this.currentStatus.totalRecords,
        migratedRecords: this.currentStatus.migratedRecords,
        failedRecords: this.currentStatus.totalRecords - this.currentStatus.migratedRecords,
        error: errorMessage,
      };
    } finally {
      this.migrationInProgress = false;
    }
  }

  /**
   * Resume migration from where it left off (for failure recovery)
   */
  async resumeMigration(): Promise<MigrationResult> {
    // For now, just restart the migration
    // In a more sophisticated implementation, we could track which records
    // were already processed and resume from there
    return this.startMigration();
  }

  /**
   * Verify data integrity after migration by comparing record counts
   */
  async verifyDataIntegrity(): Promise<{ success: boolean; discrepancies: string[] }> {
    if (!this.isInitialized || !this.convexClient) {
      throw new Error('MigrationService not initialized');
    }

    try {
      // Use the enhanced data integrity service for comprehensive verification
      const { dataIntegrityService } = await import('./DataIntegrityService');
      
      // Initialize or re-initialize (DataIntegrityService handles idempotency via isServiceInitialized)
      dataIntegrityService.initialize(this.convexClient);

      // Perform quick integrity check
      const result = await dataIntegrityService.quickIntegrityCheck();
      
      if (result.success) {
        return {
          success: true,
          discrepancies: [],
        };
      } else {
        return {
          success: false,
          discrepancies: [result.summary],
        };
      }

    } catch (error) {
      console.error('Error verifying data integrity:', error);
      
      // Fallback to basic verification if enhanced service fails
      const discrepancies: string[] = [];

      try {
        // Get local record counts (only synced records)
        const [localCustomers, localServiceLogs, localChemicalUsage, localNotes] = await Promise.all([
          db.customers.where('sync_status').equals('synced').count(),
          db.serviceLogs.where('sync_status').equals('synced').count(),
          db.chemicalUsage.where('sync_status').equals('synced').count(),
          db.notes.where('sync_status').equals('synced').count(),
        ]);

        // Get total record counts
        const [totalCustomers, totalServiceLogs, totalChemicalUsage, totalNotes] = await Promise.all([
          db.customers.count(),
          db.serviceLogs.count(),
          db.chemicalUsage.count(),
          db.notes.count(),
        ]);

        // Check for discrepancies
        if (localCustomers !== totalCustomers) {
          discrepancies.push(`Customers: ${totalCustomers - localCustomers} records not synced`);
        }

        if (localServiceLogs !== totalServiceLogs) {
          discrepancies.push(`Service Logs: ${totalServiceLogs - localServiceLogs} records not synced`);
        }

        if (localChemicalUsage !== totalChemicalUsage) {
          discrepancies.push(`Chemical Usage: ${totalChemicalUsage - localChemicalUsage} records not synced`);
        }

        if (localNotes !== totalNotes) {
          discrepancies.push(`Notes: ${totalNotes - localNotes} records not synced`);
        }

        return {
          success: discrepancies.length === 0,
          discrepancies,
        };

      } catch (fallbackError) {
        return {
          success: false,
          discrepancies: [`Verification failed: ${fallbackError instanceof Error ? fallbackError.message : 'Unknown error'}`],
        };
      }
    }
  }

  /**
   * Check if migration is currently in progress
   */
  isMigrationInProgress(): boolean {
    return this.migrationInProgress;
  }

  /**
   * Cancel ongoing migration (if possible)
   */
  cancelMigration(): void {
    if (this.migrationInProgress) {
      this.migrationInProgress = false;
      this.updateStatus({
        ...this.currentStatus,
        error: 'Migration cancelled by user',
      });
      console.log('Migration cancelled');
    }
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.cancelMigration();
    this.statusCallbacks = [];
    this.convexClient = null;
    this.isInitialized = false;
    console.log('MigrationService destroyed');
  }

  // ============================================
  // Private Methods
  // ============================================

  private updateStatus(updates: Partial<MigrationStatus>): void {
    this.currentStatus = { ...this.currentStatus, ...updates };
    this.statusCallbacks.forEach(callback => callback(this.currentStatus));
  }
}

// Singleton instance
export const migrationService = new MigrationService();