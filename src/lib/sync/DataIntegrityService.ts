import { ConvexReactClient } from 'convex/react';
import { db } from '@/db/chemcheck-db';

export interface IntegrityCheckResult {
  table: string;
  localCount: number;
  remoteCount?: number;
  syncedCount: number;
  pendingCount: number;
  errorCount: number;
  discrepancies: string[];
  sampleMismatches?: RecordMismatch[];
}

export interface RecordMismatch {
  localId: number;
  convexId?: string;
  field: string;
  localValue: any;
  remoteValue: any;
}

export interface DataIntegrityReport {
  success: boolean;
  timestamp: number;
  totalLocalRecords: number;
  totalSyncedRecords: number;
  totalPendingRecords: number;
  totalErrorRecords: number;
  tableResults: IntegrityCheckResult[];
  overallDiscrepancies: string[];
}

/**
 * Service for verifying data integrity between Dexie and Convex
 * Compares record counts, sync status, and data consistency
 */
export class DataIntegrityService {
  private convexClient: ConvexReactClient | null = null;
  private isInitialized = false;

  /**
   * Initialize the service with Convex client (idempotent)
   */
  initialize(convexClient: ConvexReactClient): void {
    // Skip if already initialized with the same client
    if (this.isInitialized && this.convexClient === convexClient) {
      return;
    }
    
    this.convexClient = convexClient;
    this.isInitialized = true;
    console.log('DataIntegrityService initialized');
  }

  /**
   * Check if the service is initialized
   */
  isServiceInitialized(): boolean {
    return this.isInitialized;
  }

  /**
   * Perform comprehensive data integrity check
   */
  async performIntegrityCheck(): Promise<DataIntegrityReport> {
    if (!this.isInitialized || !this.convexClient) {
      throw new Error('DataIntegrityService not initialized');
    }

    const timestamp = Date.now();
    const tableResults: IntegrityCheckResult[] = [];
    const overallDiscrepancies: string[] = [];

    try {
      // Check each table
      const customerResult = await this.checkTableIntegrity('customers');
      const serviceLogResult = await this.checkTableIntegrity('serviceLogs');
      const chemicalUsageResult = await this.checkTableIntegrity('chemicalUsage');
      const notesResult = await this.checkTableIntegrity('notes');

      tableResults.push(customerResult, serviceLogResult, chemicalUsageResult, notesResult);

      // Calculate totals
      const totalLocalRecords = tableResults.reduce((sum, result) => sum + result.localCount, 0);
      const totalSyncedRecords = tableResults.reduce((sum, result) => sum + result.syncedCount, 0);
      const totalPendingRecords = tableResults.reduce((sum, result) => sum + result.pendingCount, 0);
      const totalErrorRecords = tableResults.reduce((sum, result) => sum + result.errorCount, 0);

      // Collect all discrepancies
      tableResults.forEach(result => {
        if (result.discrepancies.length > 0) {
          overallDiscrepancies.push(...result.discrepancies.map(d => `${result.table}: ${d}`));
        }
      });

      // Check for overall consistency issues
      if (totalPendingRecords > 0) {
        overallDiscrepancies.push(`${totalPendingRecords} records are still pending sync`);
      }

      if (totalErrorRecords > 0) {
        overallDiscrepancies.push(`${totalErrorRecords} records have sync errors`);
      }

      // Check for orphaned records (service logs without synced customers)
      const orphanedServiceLogs = await this.checkOrphanedServiceLogs();
      if (orphanedServiceLogs.length > 0) {
        overallDiscrepancies.push(`${orphanedServiceLogs.length} service logs reference unsynced customers`);
      }

      const success = overallDiscrepancies.length === 0;

      return {
        success,
        timestamp,
        totalLocalRecords,
        totalSyncedRecords,
        totalPendingRecords,
        totalErrorRecords,
        tableResults,
        overallDiscrepancies,
      };

    } catch (error) {
      console.error('Error performing integrity check:', error);
      
      return {
        success: false,
        timestamp,
        totalLocalRecords: 0,
        totalSyncedRecords: 0,
        totalPendingRecords: 0,
        totalErrorRecords: 0,
        tableResults,
        overallDiscrepancies: [`Integrity check failed: ${error instanceof Error ? error.message : 'Unknown error'}`],
      };
    }
  }

  /**
   * Quick integrity check - just counts and sync status
   */
  async quickIntegrityCheck(): Promise<{ success: boolean; summary: string }> {
    try {
      const [
        totalCustomers, syncedCustomers, pendingCustomers, errorCustomers,
        totalServiceLogs, syncedServiceLogs, pendingServiceLogs, errorServiceLogs,
        totalChemicalUsage, syncedChemicalUsage, pendingChemicalUsage, errorChemicalUsage,
        totalNotes, syncedNotes, pendingNotes, errorNotes
      ] = await Promise.all([
        // Customers
        db.customers.count(),
        db.customers.where('sync_status').equals('synced').count(),
        db.customers.where('sync_status').equals('pending').count(),
        db.customers.where('sync_status').equals('error').count(),
        // Service Logs
        db.serviceLogs.count(),
        db.serviceLogs.where('sync_status').equals('synced').count(),
        db.serviceLogs.where('sync_status').equals('pending').count(),
        db.serviceLogs.where('sync_status').equals('error').count(),
        // Chemical Usage
        db.chemicalUsage.count(),
        db.chemicalUsage.where('sync_status').equals('synced').count(),
        db.chemicalUsage.where('sync_status').equals('pending').count(),
        db.chemicalUsage.where('sync_status').equals('error').count(),
        // Notes
        db.notes.count(),
        db.notes.where('sync_status').equals('synced').count(),
        db.notes.where('sync_status').equals('pending').count(),
        db.notes.where('sync_status').equals('error').count(),
      ]);

      const totalRecords = totalCustomers + totalServiceLogs + totalChemicalUsage + totalNotes;
      const totalSynced = syncedCustomers + syncedServiceLogs + syncedChemicalUsage + syncedNotes;
      const totalPending = pendingCustomers + pendingServiceLogs + pendingChemicalUsage + pendingNotes;
      const totalErrors = errorCustomers + errorServiceLogs + errorChemicalUsage + errorNotes;

      const success = totalPending === 0 && totalErrors === 0;
      const syncPercentage = totalRecords > 0 ? Math.round((totalSynced / totalRecords) * 100) : 100;

      let summary = `${totalSynced}/${totalRecords} records synced (${syncPercentage}%)`;
      
      if (totalPending > 0) {
        summary += `, ${totalPending} pending`;
      }
      
      if (totalErrors > 0) {
        summary += `, ${totalErrors} errors`;
      }

      return { success, summary };

    } catch (error) {
      return {
        success: false,
        summary: `Check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Check integrity for a specific table
   */
  private async checkTableIntegrity(tableName: string): Promise<IntegrityCheckResult> {
    const discrepancies: string[] = [];

    try {
      let localCount = 0;
      let syncedCount = 0;
      let pendingCount = 0;
      let errorCount = 0;

      switch (tableName) {
        case 'customers':
          [localCount, syncedCount, pendingCount, errorCount] = await Promise.all([
            db.customers.count(),
            db.customers.where('sync_status').equals('synced').count(),
            db.customers.where('sync_status').equals('pending').count(),
            db.customers.where('sync_status').equals('error').count(),
          ]);
          break;

        case 'serviceLogs':
          [localCount, syncedCount, pendingCount, errorCount] = await Promise.all([
            db.serviceLogs.count(),
            db.serviceLogs.where('sync_status').equals('synced').count(),
            db.serviceLogs.where('sync_status').equals('pending').count(),
            db.serviceLogs.where('sync_status').equals('error').count(),
          ]);
          break;

        case 'chemicalUsage':
          [localCount, syncedCount, pendingCount, errorCount] = await Promise.all([
            db.chemicalUsage.count(),
            db.chemicalUsage.where('sync_status').equals('synced').count(),
            db.chemicalUsage.where('sync_status').equals('pending').count(),
            db.chemicalUsage.where('sync_status').equals('error').count(),
          ]);
          break;

        case 'notes':
          [localCount, syncedCount, pendingCount, errorCount] = await Promise.all([
            db.notes.count(),
            db.notes.where('sync_status').equals('synced').count(),
            db.notes.where('sync_status').equals('pending').count(),
            db.notes.where('sync_status').equals('error').count(),
          ]);
          break;

        default:
          throw new Error(`Unknown table: ${tableName}`);
      }

      // Check for inconsistencies
      const totalStatusRecords = syncedCount + pendingCount + errorCount;
      if (totalStatusRecords !== localCount) {
        discrepancies.push(`Status count mismatch: ${totalStatusRecords} status records vs ${localCount} total records`);
      }

      // Check for records with convex_id but not synced status
      const recordsWithConvexIdButNotSynced = await this.countRecordsWithConvexIdButNotSynced(tableName);
      if (recordsWithConvexIdButNotSynced > 0) {
        discrepancies.push(`${recordsWithConvexIdButNotSynced} records have convex_id but are not marked as synced`);
      }

      // Check for synced records without convex_id
      const syncedRecordsWithoutConvexId = await this.countSyncedRecordsWithoutConvexId(tableName);
      if (syncedRecordsWithoutConvexId > 0) {
        discrepancies.push(`${syncedRecordsWithoutConvexId} records are marked as synced but have no convex_id`);
      }

      return {
        table: tableName,
        localCount,
        syncedCount,
        pendingCount,
        errorCount,
        discrepancies,
      };

    } catch (error) {
      return {
        table: tableName,
        localCount: 0,
        syncedCount: 0,
        pendingCount: 0,
        errorCount: 0,
        discrepancies: [`Error checking ${tableName}: ${error instanceof Error ? error.message : 'Unknown error'}`],
      };
    }
  }

  /**
   * Count records that have convex_id but are not marked as synced
   */
  private async countRecordsWithConvexIdButNotSynced(tableName: string): Promise<number> {
    try {
      switch (tableName) {
        case 'customers':
          return await db.customers
            .where('convex_id').above('')
            .and(record => record.sync_status !== 'synced')
            .count();

        case 'serviceLogs':
          return await db.serviceLogs
            .where('convex_id').above('')
            .and(record => record.sync_status !== 'synced')
            .count();

        case 'chemicalUsage':
          return await db.chemicalUsage
            .where('convex_id').above('')
            .and(record => record.sync_status !== 'synced')
            .count();

        case 'notes':
          return await db.notes
            .where('convex_id').above('')
            .and(record => record.sync_status !== 'synced')
            .count();

        default:
          return 0;
      }
    } catch (error) {
      console.error(`Error counting records with convex_id but not synced for ${tableName}:`, error);
      throw error; // Let checkTableIntegrity handle it
    }
  }

  /**
   * Count records that are marked as synced but have no convex_id
   */
  private async countSyncedRecordsWithoutConvexId(tableName: string): Promise<number> {
    try {
      switch (tableName) {
        case 'customers':
          return await db.customers
            .where('sync_status').equals('synced')
            .and(record => !record.convex_id)
            .count();

        case 'serviceLogs':
          return await db.serviceLogs
            .where('sync_status').equals('synced')
            .and(record => !record.convex_id)
            .count();

        case 'chemicalUsage':
          return await db.chemicalUsage
            .where('sync_status').equals('synced')
            .and(record => !record.convex_id)
            .count();

        case 'notes':
          return await db.notes
            .where('sync_status').equals('synced')
            .and(record => !record.convex_id)
            .count();

        default:
          return 0;
      }
    } catch (error) {
      console.error(`Error counting synced records without convex_id for ${tableName}:`, error);
      throw error; // Let checkTableIntegrity handle it
    }
  }

  /**
   * Check for orphaned service logs (service logs that reference unsynced customers)
   */
  private async checkOrphanedServiceLogs(): Promise<number[]> {
    try {
      const serviceLogs = await db.serviceLogs
        .where('sync_status').equals('synced')
        .toArray();

      // Batch lookup: get unique customer IDs and fetch all at once
      const customerIds = [...new Set(serviceLogs.map(log => log.customer_id))];
      const customers = await db.customers.bulkGet(customerIds);
      const validCustomerIds = new Set(
        customers
          .filter(c => c && c.sync_status === 'synced' && c.convex_id)
          .map(c => c!.id)
      );

      const orphanedIds: number[] = [];
      for (const serviceLog of serviceLogs) {
        if (!validCustomerIds.has(serviceLog.customer_id)) {
          orphanedIds.push(serviceLog.id!);
        }
      }

      return orphanedIds;
    } catch (error) {
      console.error('Error checking orphaned service logs:', error);
      return [];
    }
  }

  /**
   * Fix common integrity issues automatically
   */
  async fixIntegrityIssues(): Promise<{ fixed: number; errors: string[] }> {
    if (!this.isInitialized) {
      throw new Error('DataIntegrityService not initialized');
    }

    let fixedCount = 0;
    const errors: string[] = [];

    try {
      // Fix records with convex_id but not marked as synced
      const tables = ['customers', 'serviceLogs', 'chemicalUsage', 'notes'];
      
      for (const tableName of tables) {
        try {
          let recordsToFix: any[] = [];

          switch (tableName) {
            case 'customers':
              recordsToFix = await db.customers
                .where('convex_id').above('')
                .and(record => record.sync_status !== 'synced')
                .toArray();
              break;

            case 'serviceLogs':
              recordsToFix = await db.serviceLogs
                .where('convex_id').above('')
                .and(record => record.sync_status !== 'synced')
                .toArray();
              break;

            case 'chemicalUsage':
              recordsToFix = await db.chemicalUsage
                .where('convex_id').above('')
                .and(record => record.sync_status !== 'synced')
                .toArray();
              break;

            case 'notes':
              recordsToFix = await db.notes
                .where('convex_id').above('')
                .and(record => record.sync_status !== 'synced')
                .toArray();
              break;
          }

          // Fix each record
          for (const record of recordsToFix) {
            try {
              // Only update sync_status; preserve existing remote_updated_at
              // Setting remote_updated_at to Date.now() would be semantically incorrect
              // as it should reflect when the remote record was actually updated
              const updateData = {
                sync_status: 'synced' as const,
              };

              switch (tableName) {
                case 'customers':
                  await db.customers.update(record.id, updateData);
                  break;
                case 'serviceLogs':
                  await db.serviceLogs.update(record.id, updateData);
                  break;
                case 'chemicalUsage':
                  await db.chemicalUsage.update(record.id, updateData);
                  break;
                case 'notes':
                  await db.notes.update(record.id, updateData);
                  break;
              }

              fixedCount++;
            } catch (error) {
              errors.push(`Failed to fix ${tableName}[${record.id}]: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
          }
        } catch (error) {
          errors.push(`Failed to process ${tableName}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }

      console.log(`Fixed ${fixedCount} integrity issues`);
      return { fixed: fixedCount, errors };

    } catch (error) {
      errors.push(`Integrity fix failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return { fixed: fixedCount, errors };
    }
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.convexClient = null;
    this.isInitialized = false;
    console.log('DataIntegrityService destroyed');
  }
}

// Singleton instance
export const dataIntegrityService = new DataIntegrityService();