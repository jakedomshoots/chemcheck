import { db } from '@/db/chemcheck-db';
import type { Customer, ServiceLog, ChemicalUsage, Note } from '@/db/chemcheck-db';
import { appRuntime } from './platformPolicy';

const CURRENT_SCHEMA_VERSION = 1;
const MIN_SUPPORTED_SCHEMA_VERSION = 1;
const MAX_ALLOWED_APP_MINOR_SKIP = 3;

function normalizeVersion(version = ''): [number, number, number] {
  const [major = 0, minor = 0, patch = 0] = version
    .split('.')
    .map((value) => Number.parseInt(value, 10))
    .map((value) => (Number.isNaN(value) ? 0 : value));

  return [major, minor, patch];
}

function isVersionMajorlyAheadOfCurrent(candidate = '0.0.0', target = appRuntime.appVersion): boolean {
  const [cMajor, cMinor] = normalizeVersion(candidate);
  const [tMajor, tMinor] = normalizeVersion(target);

  if (cMajor > tMajor) return true;
  if (cMajor < tMajor) return false;
  return cMinor - tMinor > MAX_ALLOWED_APP_MINOR_SKIP;
}

function validateBackupDataShape(backupData: unknown): backupData is BackupData {
  if (typeof backupData !== 'object' || backupData === null) {
    return false;
  }

  const data = backupData as Record<string, unknown>;

  return typeof data.version === 'string' &&
    !!data.data &&
    typeof data.data === 'object' &&
    Array.isArray((data.data as Record<string, unknown>).customers) &&
    Array.isArray((data.data as Record<string, unknown>).serviceLogs) &&
    Array.isArray((data.data as Record<string, unknown>).chemicalUsage) &&
    Array.isArray((data.data as Record<string, unknown>).notes);
}

function getBackupSchemaVersion(backupData: Partial<BackupData>): number {
  if (typeof backupData?.schemaVersion === 'number' && Number.isFinite(backupData.schemaVersion)) {
    return Math.trunc(backupData.schemaVersion);
  }

  return 1;
}

function buildCompatibilityStatus(raw: Partial<BackupData>): { canRestore: boolean; errors: string[]; warnings: string[]; schemaVersion: number } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const schemaVersion = getBackupSchemaVersion(raw);

  if (schemaVersion < MIN_SUPPORTED_SCHEMA_VERSION) {
    errors.push(
      `Unsupported backup schema version: ${schemaVersion}. Minimum supported schema is ${MIN_SUPPORTED_SCHEMA_VERSION}.`
    );
  }

  if (schemaVersion > CURRENT_SCHEMA_VERSION) {
    errors.push(
      `Backup schema version ${schemaVersion} is newer than this app supports (${CURRENT_SCHEMA_VERSION}).`
    );
  }

  const backupAppVersion = raw.appVersion;
  if (typeof backupAppVersion === 'string' && isVersionMajorlyAheadOfCurrent(backupAppVersion)) {
    warnings.push(
      `This backup was created with app version ${backupAppVersion}, which is significantly ahead of the current app version (${appRuntime.appVersion}). Restore is allowed with compatibility mode.`
    );
  }

  return {
    canRestore: errors.length === 0,
    errors,
    warnings,
    schemaVersion
  };
}

// ============================================
// Backup & Export System
// ============================================

export interface BackupData {
  version: string;
  schemaVersion?: number;
  timestamp: string;
  appVersion: string;
  data: {
    customers: Customer[];
    serviceLogs: ServiceLog[];
    chemicalUsage: ChemicalUsage[];
    notes: Note[];
  };
  metadata: {
    totalRecords: number;
    exportedBy: string;
    deviceInfo: string;
    schemaVersion?: number;
    minimumSupportedSchemaVersion?: number;
    warnings?: string[];
    compatibility?: {
      appVersion?: string;
      migratedFrom?: number;
      restoredWithWarnings?: string[];
    };
  };
}

export interface BackupOptions {
  includeCustomers?: boolean;
  includeServiceLogs?: boolean;
  includeChemicalUsage?: boolean;
  includeNotes?: boolean;
  dateRange?: {
    start: string; // YYYY-MM-DD
    end: string;   // YYYY-MM-DD
  };
}

/**
 * Create a complete backup of all data
 */
export async function createBackup(options: BackupOptions = {}): Promise<BackupData> {
  const {
    includeCustomers = true,
    includeServiceLogs = true,
    includeChemicalUsage = true,
    includeNotes = true,
    dateRange
  } = options;

  try {
    const backup: BackupData = {
      version: '1.0',
      schemaVersion: CURRENT_SCHEMA_VERSION,
      timestamp: new Date().toISOString(),
      appVersion: appRuntime.appVersion || '1.0.0',
      data: {
        customers: [],
        serviceLogs: [],
        chemicalUsage: [],
        notes: []
      },
      metadata: {
        totalRecords: 0,
        exportedBy: 'local',
        deviceInfo: navigator.userAgent,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        minimumSupportedSchemaVersion: MIN_SUPPORTED_SCHEMA_VERSION,
        compatibility: {
          appVersion: appRuntime.appVersion || '1.0.0',
          migratedFrom: CURRENT_SCHEMA_VERSION
        }
      }
    };

    // Export customers
    if (includeCustomers) {
      backup.data.customers = await db.customers.toArray();
    }

    // Export service logs with date filtering
    if (includeServiceLogs) {
      let serviceLogs = await db.serviceLogs.toArray();
      if (dateRange) {
        serviceLogs = serviceLogs.filter(log => 
          log.service_date >= dateRange.start && log.service_date <= dateRange.end
        );
      }
      backup.data.serviceLogs = serviceLogs;
    }

    // Export chemical usage with date filtering
    if (includeChemicalUsage) {
      let chemicalUsage = await db.chemicalUsage.toArray();
      if (dateRange) {
        chemicalUsage = chemicalUsage.filter(usage => 
          usage.created_date && usage.created_date >= dateRange.start && usage.created_date <= dateRange.end
        );
      }
      backup.data.chemicalUsage = chemicalUsage;
    }

    // Export notes with date filtering
    if (includeNotes) {
      let notes = await db.notes.toArray();
      if (dateRange) {
        notes = notes.filter(note => 
          note.created_date && note.created_date >= dateRange.start && note.created_date <= dateRange.end
        );
      }
      backup.data.notes = notes;
    }

    // Calculate total records
    backup.metadata.totalRecords = 
      backup.data.customers.length +
      backup.data.serviceLogs.length +
      backup.data.chemicalUsage.length +
      backup.data.notes.length;

    return backup;
  } catch (error) {
    console.error('Backup creation failed:', error);
    throw new Error(`Failed to create backup: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Download backup as JSON file
 */
export async function downloadBackup(options?: BackupOptions): Promise<void> {
  try {
    const backup = await createBackup(options);
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const filename = `chemcheck-backup-${new Date().toISOString().split('T')[0]}.json`;
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Backup download failed:', error);
    throw error;
  }
}

/**
 * Restore data from backup
 */
export async function restoreFromBackup(backupData: BackupData, options: {
  clearExisting?: boolean;
  mergeStrategy?: 'replace' | 'skip' | 'merge';
} = {}): Promise<{
  success: boolean;
  imported: {
    customers: number;
    serviceLogs: number;
    chemicalUsage: number;
    notes: number;
  };
  errors: string[];
  warnings: string[];
}> {
  const { clearExisting = false, mergeStrategy = 'replace' } = options;
  const result = {
    success: false,
    imported: { customers: 0, serviceLogs: 0, chemicalUsage: 0, notes: 0 },
    errors: [] as string[],
    warnings: [] as string[],
  };

  try {
    // Validate backup format
    if (!validateBackupDataShape(backupData)) {
      throw new Error('Invalid backup format');
    }

    const compatibility = buildCompatibilityStatus(backupData);
    compatibility.errors.forEach((error) => result.errors.push(error));
    compatibility.warnings.forEach((warning) => result.warnings.push(warning));

    if (!compatibility.canRestore) {
      result.success = false;
      return result;
    }

    backupData = {
      ...backupData,
      schemaVersion: compatibility.schemaVersion,
      metadata: {
        ...(backupData.metadata || {}),
        schemaVersion: compatibility.schemaVersion,
        minimumSupportedSchemaVersion: MIN_SUPPORTED_SCHEMA_VERSION,
        compatibility: {
          ...((backupData.metadata && backupData.metadata.compatibility) || {}),
          appVersion: backupData.appVersion,
          migratedFrom: CURRENT_SCHEMA_VERSION,
          restoredWithWarnings: [...compatibility.warnings]
        }
      }
    };

    await db.transaction('rw', [db.customers, db.serviceLogs, db.chemicalUsage, db.notes], async () => {
      // Clear existing data if requested
      if (clearExisting) {
        await db.customers.clear();
        await db.serviceLogs.clear();
        await db.chemicalUsage.clear();
        await db.notes.clear();
      }

      // Create ID mapping for customers (old ID -> new ID)
      const customerIdMap = new Map<number, number>();
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();

      // Import customers first (due to foreign key dependencies)
      if (backupData.data.customers?.length > 0) {
        for (const customer of backupData.data.customers) {
          try {
            const { id, ...customerData } = customer;
            const newId = await db.customers.add({
              ...customerData,
              updatedAt: nowIso,
              // Set sync fields for restored records
              sync_status: 'pending',
              local_updated_at: nowMs,
            });
            if (id) customerIdMap.set(id, newId as number);
            result.imported.customers++;
          } catch (error) {
            result.errors.push(`Customer import failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }
      }

      // Import service logs
      if (backupData.data.serviceLogs?.length > 0) {
        for (const log of backupData.data.serviceLogs) {
          try {
            const { id, customer_id, ...logData } = log;
            const newCustomerId = customerIdMap.get(customer_id) || customer_id;
            
            // Verify customer exists
            const customerExists = await db.customers.get(newCustomerId);
            if (!customerExists) {
              result.errors.push(`Service log skipped: customer ${customer_id} not found`);
              continue;
            }

            await db.serviceLogs.add({
              ...logData,
              customer_id: newCustomerId,
              updatedAt: nowIso,
              // Set sync fields for restored records
              sync_status: 'pending',
              local_updated_at: nowMs,
            });
            result.imported.serviceLogs++;
          } catch (error) {
            result.errors.push(`Service log import failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }
      }

      // Import chemical usage
      if (backupData.data.chemicalUsage?.length > 0) {
        for (const usage of backupData.data.chemicalUsage) {
          try {
            const { id, customer_id, ...usageData } = usage;
            const newCustomerId = customerIdMap.get(customer_id) || customer_id;
            
            // Verify customer exists
            const customerExists = await db.customers.get(newCustomerId);
            if (!customerExists) {
              result.errors.push(`Chemical usage skipped: customer ${customer_id} not found`);
              continue;
            }

            await db.chemicalUsage.add({
              ...usageData,
              customer_id: newCustomerId,
              updatedAt: nowIso,
              // Set sync fields for restored records
              sync_status: 'pending',
              local_updated_at: nowMs,
            });
            result.imported.chemicalUsage++;
          } catch (error) {
            result.errors.push(`Chemical usage import failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }
      }

      // Import notes
      if (backupData.data.notes?.length > 0) {
        for (const note of backupData.data.notes) {
          try {
            const { id, customer_id, ...noteData } = note;
            let newCustomerId = customer_id;
            
            if (customer_id) {
              newCustomerId = customerIdMap.get(customer_id) || customer_id;
              // Verify customer exists
              const customerExists = await db.customers.get(newCustomerId);
              if (!customerExists) {
                result.errors.push(`Note skipped: customer ${customer_id} not found`);
                continue;
              }
            }

            await db.notes.add({
              ...noteData,
              customer_id: newCustomerId,
              updatedAt: nowIso,
              // Set sync fields for restored records
              sync_status: 'pending',
              local_updated_at: nowMs,
            });
            result.imported.notes++;
          } catch (error) {
            result.errors.push(`Note import failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }
      }
    });

    result.success = true;
    return result;
  } catch (error) {
    result.errors.push(`Restore failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return result;
  }
}

/**
 * Auto-backup system - runs periodically
 */
export class AutoBackup {
  private intervalId: number | null = null;
  private lastBackup: string | null = null;

  constructor(private intervalHours: number = 24) {
    this.lastBackup = localStorage.getItem('lastAutoBackup');
  }

  start(): void {
    if (this.intervalId) return; // Already running

    // Check if backup is needed immediately
    this.checkAndBackup();

    // Set up periodic backups
    this.intervalId = window.setInterval(() => {
      this.checkAndBackup();
    }, this.intervalHours * 60 * 60 * 1000);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async checkAndBackup(): Promise<void> {
    const now = new Date().toISOString();
    const shouldBackup = !this.lastBackup || 
      (new Date(now).getTime() - new Date(this.lastBackup).getTime()) > (this.intervalHours * 60 * 60 * 1000);

    if (shouldBackup) {
      try {
        const backup = await createBackup();
        // Store in localStorage as emergency backup
        localStorage.setItem('emergencyBackup', JSON.stringify(backup));
        localStorage.setItem('lastAutoBackup', now);
        this.lastBackup = now;
        console.log('Auto-backup completed successfully');
      } catch (error) {
        console.error('Auto-backup failed:', error);
      }
    }
  }

  getLastBackupTime(): string | null {
    return this.lastBackup;
  }
}

// Global auto-backup instance
export const autoBackup = new AutoBackup(24); // 24-hour intervals
