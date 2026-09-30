import { db } from '@/db/chemcheck-db';
import type {
  Customer,
  ServiceLog,
  ChemicalUsage,
  Note,
  Pool,
  Equipment,
  SaltCellLog,
  SyncableRecord,
} from '@/db/chemcheck-db';
import type { Table } from 'dexie';
import { appRuntime } from './platformPolicy';
import { getStoredCurrentUserEmail, hashIdentity, normalizeIdentityEmail } from './sessionIdentity';

/** Owner recorded on backups made while no account is signed in. */
export const LOCAL_BACKUP_OWNER = 'local';

/** Identity of the account that owns the data on this device right now. */
export function getCurrentBackupOwner(): string {
  return getStoredCurrentUserEmail() || LOCAL_BACKUP_OWNER;
}

/**
 * Emergency backup and auto-backup timestamp keys are scoped to the signed-in
 * account so a different account on the same device cannot read them.
 */
export function getEmergencyBackupKey(owner = getCurrentBackupOwner()): string {
  return `emergencyBackup.${hashIdentity(owner)}`;
}

export function getLastAutoBackupKey(owner = getCurrentBackupOwner()): string {
  return `lastAutoBackup.${hashIdentity(owner)}`;
}

/**
 * Fields that never belong in an at-rest local copy. Gate codes in particular
 * are physical-access secrets and are stripped from the emergency backup.
 */
export function stripSensitiveCustomerFields<T extends { gate_code?: string }>(customer: T): Omit<T, 'gate_code'> {
  const { gate_code, ...rest } = customer;
  void gate_code;
  return rest;
}

export function isForeignBackup(backupData: Partial<BackupData>, currentOwner = getCurrentBackupOwner()): boolean {
  const exportedBy = normalizeIdentityEmail(backupData?.metadata?.exportedBy);
  if (!exportedBy || exportedBy === LOCAL_BACKUP_OWNER) return false;
  return exportedBy !== normalizeIdentityEmail(currentOwner);
}

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
    pools?: Pool[];
    equipment?: Equipment[];
    saltCellLogs?: SaltCellLog[];
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
    start: string;
    end: string;
  };
}

async function readOptionalTable<T>(table: Table<T> | undefined): Promise<T[]> {
  if (!table || typeof table.toArray !== 'function') return [];
  return table.toArray();
}

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
        notes: [],
        pools: [],
        equipment: [],
        saltCellLogs: [],
      },
      metadata: {
        totalRecords: 0,
        exportedBy: getCurrentBackupOwner(),
        deviceInfo: navigator.userAgent,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        minimumSupportedSchemaVersion: MIN_SUPPORTED_SCHEMA_VERSION,
        compatibility: {
          appVersion: appRuntime.appVersion || '1.0.0',
          migratedFrom: CURRENT_SCHEMA_VERSION
        }
      }
    };

    if (includeCustomers) {
      backup.data.customers = await db.customers.toArray();
      backup.data.pools = await readOptionalTable<Pool>(db.pools);
      backup.data.equipment = await readOptionalTable<Equipment>(db.equipment);
    }

    if (includeServiceLogs) {
      let serviceLogs = await db.serviceLogs.toArray();
      if (dateRange) {
        serviceLogs = serviceLogs.filter(log => 
          log.service_date >= dateRange.start && log.service_date <= dateRange.end
        );
      }
      backup.data.serviceLogs = serviceLogs;
    }

    if (includeChemicalUsage) {
      let chemicalUsage = await db.chemicalUsage.toArray();
      if (dateRange) {
        chemicalUsage = chemicalUsage.filter(usage => 
          usage.created_date && usage.created_date >= dateRange.start && usage.created_date <= dateRange.end
        );
      }
      backup.data.chemicalUsage = chemicalUsage;
    }

    if (includeNotes) {
      let notes = await db.notes.toArray();
      if (dateRange) {
        notes = notes.filter(note => 
          note.created_date && note.created_date >= dateRange.start && note.created_date <= dateRange.end
        );
      }
      backup.data.notes = notes;
    }

    if (includeServiceLogs) {
      let saltCellLogs = await readOptionalTable<SaltCellLog>(db.saltCellLogs);
      if (dateRange) {
        saltCellLogs = saltCellLogs.filter(log =>
          log.cleaning_date >= dateRange.start && log.cleaning_date <= dateRange.end
        );
      }
      backup.data.saltCellLogs = saltCellLogs;
    }

    backup.metadata.totalRecords = 
      backup.data.customers.length +
      backup.data.serviceLogs.length +
      backup.data.chemicalUsage.length +
      backup.data.notes.length +
      (backup.data.pools?.length || 0) +
      (backup.data.equipment?.length || 0) +
      (backup.data.saltCellLogs?.length || 0);

    return backup;
  } catch (error) {
    console.error('Backup creation failed:', error);
    throw new Error(`Failed to create backup: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

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

export interface RestoreOptions {
  clearExisting?: boolean;
  mergeStrategy?: 'replace' | 'skip' | 'merge';
  /**
   * Allow restoring a backup exported by a different account. The restored
   * records are re-owned by the signed-in user and lose their cloud ids so they
   * are pushed as new records instead of colliding with another tenant's data.
   */
  allowForeign?: boolean;
}

export interface RestoreResult {
  success: boolean;
  imported: {
    customers: number;
    serviceLogs: number;
    chemicalUsage: number;
    notes: number;
    pools: number;
    equipment: number;
    saltCellLogs: number;
  };
  updated: number;
  errors: string[];
  warnings: string[];
}

type RestorableRecord = SyncableRecord & { id?: number };

/**
 * Insert a record, or update the local row that already carries the same
 * convex_id so a same-tenant restore never creates duplicates that share a
 * cloud id.
 */
async function upsertByConvexId<T extends RestorableRecord>(
  table: Table<T>,
  record: Omit<T, 'id'>
): Promise<{ id: number; updated: boolean }> {
  const convexId = (record as Partial<SyncableRecord>).convex_id;
  if (convexId && typeof table.where === 'function') {
    const existing = await table.where('convex_id').equals(convexId).first();
    if (existing && typeof existing.id === 'number') {
      await table.update(existing.id, record as unknown as Parameters<Table<T>['update']>[1]);
      return { id: existing.id, updated: true };
    }
  }
  const id = await table.add(record as T);
  return { id: Number(id), updated: false };
}

function stripCloudIdentity<T extends Partial<SyncableRecord>>(record: T): T {
  const copy = { ...record };
  delete copy.convex_id;
  delete (copy as { convex_customer_id?: string }).convex_customer_id;
  delete (copy as { convex_pool_id?: string }).convex_pool_id;
  delete copy.remote_updated_at;
  return copy;
}

export async function restoreFromBackup(backupData: BackupData, options: RestoreOptions = {}): Promise<RestoreResult> {
  const { clearExisting = false, mergeStrategy = 'replace', allowForeign = false } = options;
  void mergeStrategy;
  const result: RestoreResult = {
    success: false,
    imported: { customers: 0, serviceLogs: 0, chemicalUsage: 0, notes: 0, pools: 0, equipment: 0, saltCellLogs: 0 },
    updated: 0,
    errors: [],
    warnings: [],
  };

  try {
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

    const currentOwner = getCurrentBackupOwner();
    const foreign = isForeignBackup(backupData, currentOwner);
    if (foreign && !allowForeign) {
      result.errors.push(
        `This backup was exported by ${backupData.metadata.exportedBy}, which is not the signed-in account. Restore was refused; pass allowForeign to import it as your own data.`
      );
      return result;
    }
    if (foreign) {
      result.warnings.push(
        `Backup exported by ${backupData.metadata.exportedBy} was re-owned by ${currentOwner}; cloud ids were dropped so records sync as new.`
      );
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

    const poolsTable = db.pools as Table<Pool> | undefined;
    const equipmentTable = db.equipment as Table<Equipment> | undefined;
    const saltCellTable = db.saltCellLogs as Table<SaltCellLog> | undefined;
    const tables = [db.customers, db.serviceLogs, db.chemicalUsage, db.notes, poolsTable, equipmentTable, saltCellTable]
      .filter((table) => !!table) as Table[];

    const prepare = <T extends Partial<SyncableRecord>>(record: T): T => (foreign ? stripCloudIdentity(record) : record);

    await db.transaction('rw', tables, async () => {
      if (clearExisting) {
        await db.customers.clear();
        await db.serviceLogs.clear();
        await db.chemicalUsage.clear();
        await db.notes.clear();
        await poolsTable?.clear?.();
        await equipmentTable?.clear?.();
        await saltCellTable?.clear?.();
      }

      const customerIdMap = new Map<number, number>();
      const poolIdMap = new Map<number, number>();
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();

      const resolveCustomerId = async (customerId: number): Promise<number | null> => {
        const mapped = customerIdMap.get(customerId) || customerId;
        const exists = await db.customers.get(mapped);
        return exists ? mapped : null;
      };

      const resolvePoolId = (poolId: number | undefined): number | undefined => {
        if (poolId === undefined || poolId === null) return undefined;
        return poolIdMap.get(poolId) ?? poolId;
      };

      if (backupData.data.customers?.length > 0) {
        for (const customer of backupData.data.customers) {
          try {
            const { id, ...customerData } = customer;
            const { id: newId, updated } = await upsertByConvexId<Customer>(db.customers, {
              ...prepare(customerData),
              created_by: foreign ? currentOwner : customerData.created_by,
              updatedAt: nowIso,
              sync_status: 'pending',
              local_updated_at: nowMs,
            });
            if (id) customerIdMap.set(id, newId);
            if (updated) result.updated++;
            result.imported.customers++;
          } catch (error) {
            result.errors.push(`Customer import failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }
      }

      if (poolsTable && backupData.data.pools && backupData.data.pools.length > 0) {
        for (const pool of backupData.data.pools) {
          try {
            const { id, customer_id, ...poolData } = pool;
            const newCustomerId = await resolveCustomerId(customer_id);
            if (newCustomerId === null) {
              result.errors.push(`Pool skipped: customer ${customer_id} not found`);
              continue;
            }
            const { id: newId, updated } = await upsertByConvexId<Pool>(poolsTable, {
              ...prepare(poolData),
              customer_id: newCustomerId,
              updatedAt: nowIso,
              sync_status: 'pending',
              local_updated_at: nowMs,
            });
            if (id) poolIdMap.set(id, newId);
            if (updated) result.updated++;
            result.imported.pools++;
          } catch (error) {
            result.errors.push(`Pool import failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }
      }

      if (equipmentTable && backupData.data.equipment && backupData.data.equipment.length > 0) {
        for (const item of backupData.data.equipment) {
          try {
            const { id, customer_id, pool_id, ...equipmentData } = item;
            void id;
            const newCustomerId = await resolveCustomerId(customer_id);
            if (newCustomerId === null) {
              result.errors.push(`Equipment skipped: customer ${customer_id} not found`);
              continue;
            }
            const { updated } = await upsertByConvexId<Equipment>(equipmentTable, {
              ...prepare(equipmentData),
              customer_id: newCustomerId,
              pool_id: resolvePoolId(pool_id) ?? pool_id,
              updatedAt: nowIso,
              sync_status: 'pending',
              local_updated_at: nowMs,
            });
            if (updated) result.updated++;
            result.imported.equipment++;
          } catch (error) {
            result.errors.push(`Equipment import failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }
      }

      // Import service logs
      if (backupData.data.serviceLogs?.length > 0) {
        for (const log of backupData.data.serviceLogs) {
          try {
            const { id, customer_id, pool_id, ...logData } = log;
            void id;
            const newCustomerId = await resolveCustomerId(customer_id);
            if (newCustomerId === null) {
              result.errors.push(`Service log skipped: customer ${customer_id} not found`);
              continue;
            }

            const { updated } = await upsertByConvexId<ServiceLog>(db.serviceLogs, {
              ...prepare(logData),
              customer_id: newCustomerId,
              pool_id: resolvePoolId(pool_id),
              updatedAt: nowIso,
              sync_status: 'pending',
              local_updated_at: nowMs,
            });
            if (updated) result.updated++;
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
            const { id, customer_id, pool_id, ...usageData } = usage;
            void id;
            const newCustomerId = await resolveCustomerId(customer_id);
            if (newCustomerId === null) {
              result.errors.push(`Chemical usage skipped: customer ${customer_id} not found`);
              continue;
            }

            const { updated } = await upsertByConvexId<ChemicalUsage>(db.chemicalUsage, {
              ...prepare(usageData),
              customer_id: newCustomerId,
              pool_id: resolvePoolId(pool_id),
              updatedAt: nowIso,
              sync_status: 'pending',
              local_updated_at: nowMs,
            });
            if (updated) result.updated++;
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
            const { id, customer_id, pool_id, ...noteData } = note;
            void id;
            let newCustomerId = customer_id;

            if (customer_id) {
              const resolved = await resolveCustomerId(customer_id);
              if (resolved === null) {
                result.errors.push(`Note skipped: customer ${customer_id} not found`);
                continue;
              }
              newCustomerId = resolved;
            }

            const { updated } = await upsertByConvexId<Note>(db.notes, {
              ...prepare(noteData),
              customer_id: newCustomerId,
              pool_id: resolvePoolId(pool_id),
              updatedAt: nowIso,
              sync_status: 'pending',
              local_updated_at: nowMs,
            });
            if (updated) result.updated++;
            result.imported.notes++;
          } catch (error) {
            result.errors.push(`Note import failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }
      }

      if (saltCellTable && backupData.data.saltCellLogs && backupData.data.saltCellLogs.length > 0) {
        for (const log of backupData.data.saltCellLogs) {
          try {
            const { id, customer_id, pool_id, ...logData } = log;
            void id;
            const newCustomerId = await resolveCustomerId(customer_id);
            if (newCustomerId === null) {
              result.errors.push(`Salt cell log skipped: customer ${customer_id} not found`);
              continue;
            }
            const { updated } = await upsertByConvexId<SaltCellLog>(saltCellTable, {
              ...prepare(logData),
              customer_id: newCustomerId,
              pool_id: resolvePoolId(pool_id),
              updatedAt: nowIso,
              sync_status: 'pending',
              local_updated_at: nowMs,
            });
            if (updated) result.updated++;
            result.imported.saltCellLogs++;
          } catch (error) {
            result.errors.push(`Salt cell log import failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
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

export class AutoBackup {
  private intervalId: number | null = null;
  private lastBackup: string | null = null;

  constructor(private intervalHours: number = 24) {
    this.lastBackup = localStorage.getItem(getLastAutoBackupKey());
  }

  start(): void {
    if (this.intervalId) return;

    this.checkAndBackup();

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
        // Never keep gate codes in the at-rest emergency copy.
        backup.data.customers = backup.data.customers.map(
          (customer) => stripSensitiveCustomerFields(customer) as Customer
        );
        localStorage.setItem(getEmergencyBackupKey(), JSON.stringify(backup));
        localStorage.setItem(getLastAutoBackupKey(), now);
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

export const autoBackup = new AutoBackup(24);
