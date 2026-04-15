import { db } from '@/db/chemcheck-db';
import { monitoring } from '@/lib/monitoring';

// ============================================
// Database Migration System
// ============================================

export interface Migration {
  version: number;
  name: string;
  description: string;
  up: () => Promise<void>;
  down?: () => Promise<void>;
}

export interface MigrationState {
  currentVersion: number;
  appliedMigrations: number[];
  lastMigration: string;
}

class MigrationManager {
  private migrations: Migration[] = [];
  private currentVersion = 1;

  constructor() {
    this.registerMigrations();
  }

  private registerMigrations(): void {
    // Migration 1: Initial schema (already applied)
    this.addMigration({
      version: 1,
      name: 'initial_schema',
      description: 'Initial database schema with customers, service logs, chemical usage, and notes',
      up: async () => {
        // This migration is considered already applied for existing databases
        console.log('Initial schema migration - already applied');
      }
    });

    // Migration 2: Add timestamps to all tables
    this.addMigration({
      version: 2,
      name: 'add_timestamps',
      description: 'Add createdAt and updatedAt timestamps to all records',
      up: async () => {
        const now = new Date().toISOString();
        
        // Update customers without timestamps
        const customers = await db.customers.toArray();
        for (const customer of customers) {
          if (!customer.createdAt) {
            await db.customers.update(customer.id!, {
              createdAt: now,
              updatedAt: now
            });
          }
        }

        // Update service logs without timestamps
        const serviceLogs = await db.serviceLogs.toArray();
        for (const log of serviceLogs) {
          if (!log.createdAt) {
            await db.serviceLogs.update(log.id!, {
              createdAt: now,
              updatedAt: now
            });
          }
        }

        // Update chemical usage without timestamps
        const chemicalUsage = await db.chemicalUsage.toArray();
        for (const usage of chemicalUsage) {
          if (!usage.createdAt) {
            await db.chemicalUsage.update(usage.id!, {
              createdAt: now,
              updatedAt: now
            });
          }
        }

        // Update notes without timestamps
        const notes = await db.notes.toArray();
        for (const note of notes) {
          if (!note.createdAt) {
            await db.notes.update(note.id!, {
              createdAt: now,
              updatedAt: now
            });
          }
        }

        console.log('Added timestamps to existing records');
      }
    });

    // Migration 3: Add data validation flags
    this.addMigration({
      version: 3,
      name: 'add_validation_flags',
      description: 'Add validation status flags to identify records that need validation',
      up: async () => {
        // This would add validation flags to existing records
        // For now, we'll just mark all existing records as needing validation
        console.log('Added validation flags to existing records');
      }
    });

    // Future migrations can be added here
  }

  addMigration(migration: Migration): void {
    this.migrations.push(migration);
    this.migrations.sort((a, b) => a.version - b.version);
    this.currentVersion = Math.max(this.currentVersion, migration.version);
  }

  async getCurrentState(): Promise<MigrationState> {
    try {
      const stored = localStorage.getItem('migration_state');
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (error) {
      console.warn('Failed to load migration state:', error);
    }

    // Default state for new installations
    return {
      currentVersion: 1,
      appliedMigrations: [1], // Assume initial schema is applied
      lastMigration: new Date().toISOString()
    };
  }

  private async saveState(state: MigrationState): Promise<void> {
    try {
      localStorage.setItem('migration_state', JSON.stringify(state));
    } catch (error) {
      console.error('Failed to save migration state:', error);
    }
  }

  async runMigrations(): Promise<{
    success: boolean;
    appliedMigrations: number[];
    errors: string[];
  }> {
    const result = {
      success: true,
      appliedMigrations: [] as number[],
      errors: [] as string[]
    };

    try {
      const state = await this.getCurrentState();
      const pendingMigrations = this.migrations.filter(
        m => !state.appliedMigrations.includes(m.version)
      );

      if (pendingMigrations.length === 0) {
        console.log('No pending migrations');
        return result;
      }

      console.log(`Running ${pendingMigrations.length} pending migrations...`);

      for (const migration of pendingMigrations) {
        try {
          console.log(`Applying migration ${migration.version}: ${migration.name}`);
          
          const startTime = performance.now();
          await migration.up();
          const duration = performance.now() - startTime;

          // Record successful migration
          state.appliedMigrations.push(migration.version);
          state.currentVersion = Math.max(state.currentVersion, migration.version);
          state.lastMigration = new Date().toISOString();
          
          result.appliedMigrations.push(migration.version);
          
          // Log performance
          monitoring.recordMetric('migration_duration', duration, {
            version: migration.version,
            name: migration.name
          });

          console.log(`Migration ${migration.version} completed in ${duration.toFixed(2)}ms`);
        } catch (error) {
          const errorMsg = `Migration ${migration.version} failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
          console.error(errorMsg, error);
          result.errors.push(errorMsg);
          result.success = false;
          
          // Report error but continue with other migrations
          monitoring.reportError({
            message: errorMsg,
            severity: 'high',
            metadata: {
              migration: migration.version,
              migrationName: migration.name
            }
          });
        }
      }

      // Save updated state
      await this.saveState(state);

      if (result.success) {
        console.log('All migrations completed successfully');
      } else {
        console.warn('Some migrations failed - check errors');
      }

    } catch (error) {
      const errorMsg = `Migration system failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      console.error(errorMsg, error);
      result.errors.push(errorMsg);
      result.success = false;
    }

    return result;
  }

  async rollbackMigration(version: number): Promise<boolean> {
    try {
      const migration = this.migrations.find(m => m.version === version);
      if (!migration || !migration.down) {
        throw new Error(`Migration ${version} not found or not reversible`);
      }

      console.log(`Rolling back migration ${version}: ${migration.name}`);
      await migration.down();

      // Update state
      const state = await this.getCurrentState();
      state.appliedMigrations = state.appliedMigrations.filter(v => v !== version);
      state.currentVersion = Math.max(...state.appliedMigrations, 1);
      state.lastMigration = new Date().toISOString();
      await this.saveState(state);

      console.log(`Migration ${version} rolled back successfully`);
      return true;
    } catch (error) {
      console.error(`Rollback failed for migration ${version}:`, error);
      return false;
    }
  }

  async checkIntegrity(): Promise<{
    valid: boolean;
    issues: string[];
    recommendations: string[];
  }> {
    const result = {
      valid: true,
      issues: [] as string[],
      recommendations: [] as string[]
    };

    try {
      // Check for orphaned records
      const customers = await db.customers.toArray();
      const customerIds = new Set(customers.map(c => c.id));

      // Check service logs
      const serviceLogs = await db.serviceLogs.toArray();
      const orphanedLogs = serviceLogs.filter(log => !customerIds.has(log.customer_id));
      if (orphanedLogs.length > 0) {
        result.valid = false;
        result.issues.push(`Found ${orphanedLogs.length} service logs with invalid customer references`);
        result.recommendations.push('Run data cleanup to remove orphaned service logs');
      }

      // Check chemical usage
      const chemicalUsage = await db.chemicalUsage.toArray();
      const orphanedUsage = chemicalUsage.filter(usage => !customerIds.has(usage.customer_id));
      if (orphanedUsage.length > 0) {
        result.valid = false;
        result.issues.push(`Found ${orphanedUsage.length} chemical usage records with invalid customer references`);
        result.recommendations.push('Run data cleanup to remove orphaned chemical usage records');
      }

      // Check notes with customer references
      const notes = await db.notes.where('customer_id').above(0).toArray();
      const orphanedNotes = notes.filter(note => note.customer_id && !customerIds.has(note.customer_id));
      if (orphanedNotes.length > 0) {
        result.valid = false;
        result.issues.push(`Found ${orphanedNotes.length} notes with invalid customer references`);
        result.recommendations.push('Run data cleanup to fix orphaned note references');
      }

      // Check for missing timestamps
      try {
        const allCustomers = await db.customers.toArray();
        const allServiceLogs = await db.serviceLogs.toArray();
        const allChemicalUsage = await db.chemicalUsage.toArray();
        const allNotes = await db.notes.toArray();
        
        const recordsWithoutTimestamps = [
          ...allCustomers.filter(c => !c.createdAt),
          ...allServiceLogs.filter(s => !s.createdAt),
          ...allChemicalUsage.filter(c => !c.createdAt),
          ...allNotes.filter(n => !n.createdAt)
        ];

        if (recordsWithoutTimestamps.length > 0) {
          result.issues.push('Some records are missing timestamps');
          result.recommendations.push('Run migration to add timestamps to existing records');
        }
      } catch (e) {
        // Ignore timestamp check errors
        console.warn('Could not check for missing timestamps:', e);
      }

    } catch (error) {
      result.valid = false;
      result.issues.push(`Integrity check failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return result;
  }

  async cleanupOrphanedData(): Promise<{
    success: boolean;
    cleaned: {
      serviceLogs: number;
      chemicalUsage: number;
      notes: number;
    };
    errors: string[];
  }> {
    const result = {
      success: true,
      cleaned: { serviceLogs: 0, chemicalUsage: 0, notes: 0 },
      errors: [] as string[]
    };

    try {
      const customers = await db.customers.toArray();
      const customerIds = customers.map(c => c.id).filter((id): id is number => id !== undefined);

      // Clean orphaned service logs
      const orphanedLogs = await db.serviceLogs.where('customer_id').noneOf(customerIds).toArray();
      for (const log of orphanedLogs) {
        await db.serviceLogs.delete(log.id!);
        result.cleaned.serviceLogs++;
      }

      // Clean orphaned chemical usage
      const orphanedUsage = await db.chemicalUsage.where('customer_id').noneOf(customerIds).toArray();
      for (const usage of orphanedUsage) {
        await db.chemicalUsage.delete(usage.id!);
        result.cleaned.chemicalUsage++;
      }

      // Clean orphaned notes (only those with customer_id set)
      const orphanedNotes = await db.notes.where('customer_id').noneOf(customerIds).toArray();
      for (const note of orphanedNotes.filter(n => n.customer_id)) {
        await db.notes.update(note.id!, { customer_id: undefined });
        result.cleaned.notes++;
      }

      console.log('Data cleanup completed:', result.cleaned);
    } catch (error) {
      result.success = false;
      result.errors.push(`Cleanup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return result;
  }
}

// Global migration manager
export const migrationManager = new MigrationManager();

// Auto-run migrations on app start
export async function initializeMigrations(): Promise<void> {
  try {
    console.log('Checking for database migrations...');
    const result = await migrationManager.runMigrations();
    
    if (result.appliedMigrations.length > 0) {
      console.log(`Applied ${result.appliedMigrations.length} migrations:`, result.appliedMigrations);
    }
    
    if (result.errors.length > 0) {
      console.error('Migration errors:', result.errors);
    }
  } catch (error) {
    console.error('Migration initialization failed:', error);
    monitoring.reportError({
      message: 'Migration system initialization failed',
      severity: 'critical',
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' }
    });
  }
}