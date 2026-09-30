/**
 * GDPR Compliance Utilities
 * 
 * Provides data export and deletion capabilities for GDPR compliance:
 * - Right to access (data export)
 * - Right to erasure (data deletion)
 * - Right to portability (machine-readable export)
 */

import { db } from '@/db/chemcheck-db';
import { downloadFile } from '@/utils/exportCsv';
import { api } from '../../convex/_generated/api';
import { getSharedConvexClient } from '@/lib/convexClient';

export interface UserDataExport {
  exportDate: string;
  exportType: 'gdpr_data_request';
  userData: {
    customers: unknown[];
    serviceLogs: unknown[];
    chemicalUsage: unknown[];
    notes: unknown[];
  };
  metadata: {
    totalRecords: number;
    exportFormat: 'json';
    gdprCompliant: true;
  };
}

/**
 * Export all user data in GDPR-compliant format
 * Satisfies: Right to Access (Article 15) and Right to Portability (Article 20)
 */
export async function exportUserData(): Promise<UserDataExport> {
  const [customers, serviceLogs, chemicalUsage, notes] = await Promise.all([
    db.customers.toArray(),
    db.serviceLogs.toArray(),
    db.chemicalUsage.toArray(),
    db.notes.toArray(),
  ]);

  const totalRecords = customers.length + serviceLogs.length + chemicalUsage.length + notes.length;

  return {
    exportDate: new Date().toISOString(),
    exportType: 'gdpr_data_request',
    userData: {
      customers,
      serviceLogs,
      chemicalUsage,
      notes,
    },
    metadata: {
      totalRecords,
      exportFormat: 'json',
      gdprCompliant: true,
    },
  };
}

function downloadFromUrl(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * Download user data as JSON file.
 *
 * Calls the server-side GDPR export action so the user receives their full
 * cloud data (customers, service logs, chemical usage, notes, salt cell logs,
 * businesses, team memberships, subscriptions, and communications). If the
 * export is small the JSON is downloaded directly; otherwise a temporary
 * storage URL is used.
 */
export async function downloadUserData(): Promise<void> {
  const client = getSharedConvexClient();
  const result = await client.action(api.account.exportUserData, {});
  const date = new Date().toISOString().split('T')[0];

  if (result.type === 'url') {
    downloadFromUrl(result.url, result.filename || `chemcheck-gdpr-export-${date}.json`);
  } else {
    const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' });
    downloadFile(blob, `chemcheck-gdpr-export-${date}.json`);
  }
}

export interface LocalDataDeletionSummary {
  deleted: {
    customers: number;
    serviceLogs: number;
    chemicalUsage: number;
    notes: number;
  };
  success: boolean;
}

function clearAppOwnedLocalStorage(): void {
  try {
    const allKeys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .filter((key): key is string => key !== null);
    const keysToRemove = allKeys.filter(key =>
      key !== 'analytics_opt_out' &&
      key !== 'chemcheck-theme' &&
      (
        key.startsWith('chemcheck_') ||
        key.startsWith('chemcheck.') ||
        key.startsWith('business_') ||
        key.startsWith('user_') ||
        key.startsWith('emergencyBackup') ||
        key.startsWith('lastAutoBackup') ||
        key === 'migration_state'
      )
    );
    keysToRemove.forEach(key => localStorage.removeItem(key));
  } catch {
    // Storage unavailable; the IndexedDB wipe above is what matters.
  }
}

/**
 * Clear local data on THIS DEVICE only.
 *
 * This removes the offline copy (IndexedDB tables and app-owned browser
 * storage). It does NOT delete anything from the cloud account; use
 * `deleteAccountAndAllData` for the GDPR right-to-erasure flow.
 */
export async function clearLocalDeviceData(): Promise<LocalDataDeletionSummary> {
  // Get counts before deletion
  const [customerCount, serviceLogCount, chemicalUsageCount, noteCount] = await Promise.all([
    db.customers.count(),
    db.serviceLogs.count(),
    db.chemicalUsage.count(),
    db.notes.count(),
  ]);

  const optionalTables = [db.pools, db.equipment, db.saltCellLogs].filter(
    (table) => !!table && typeof table.clear === 'function'
  );

  // Delete all data in a transaction
  await db.transaction('rw', [db.customers, db.serviceLogs, db.chemicalUsage, db.notes, ...optionalTables], async () => {
    await db.serviceLogs.clear();
    await db.chemicalUsage.clear();
    await db.notes.clear();
    for (const table of optionalTables) {
      await table.clear();
    }
    await db.customers.clear();
  });

  clearAppOwnedLocalStorage();

  return {
    deleted: {
      customers: customerCount,
      serviceLogs: serviceLogCount,
      chemicalUsage: chemicalUsageCount,
      notes: noteCount,
    },
    success: true,
  };
}

/**
 * @deprecated Local-only wipe kept for backward compatibility. Prefer
 * `clearLocalDeviceData` (device) or `deleteAccountAndAllData` (cloud + device).
 */
export const deleteAllUserData = clearLocalDeviceData;

export interface AccountDeletionSummary {
  cloud: unknown;
  local: LocalDataDeletionSummary;
}

/**
 * Delete the user's account data everywhere.
 * Satisfies: Right to Erasure (Article 17)
 *
 * Calls the server-side `account.deleteMyAccount` action first (which
 * requires an authenticated identity and removes the tenant's cloud data),
 * then clears the local copy on this device. A cloud failure aborts before
 * anything local is touched so the user is never left with a wiped device
 * and an intact cloud account.
 */
export async function deleteAccountAndAllData(options: {
  deleteCloudAccount?: () => Promise<unknown>;
} = {}): Promise<AccountDeletionSummary> {
  const deleteCloudAccount = options.deleteCloudAccount
    ?? (() => getSharedConvexClient().action(api.account.deleteMyAccount, {}));

  const cloud = await deleteCloudAccount();
  const local = await clearLocalDeviceData();
  return { cloud, local };
}

/**
 * Delete specific customer and all related data
 * For partial data deletion requests
 */
export async function deleteCustomerData(customerId: number): Promise<{
  deleted: {
    customer: boolean;
    serviceLogs: number;
    chemicalUsage: number;
    notes: number;
  };
}> {
  const [serviceLogCount, chemicalUsageCount, noteCount] = await Promise.all([
    db.serviceLogs.where('customer_id').equals(customerId).count(),
    db.chemicalUsage.where('customer_id').equals(customerId).count(),
    db.notes.where('customer_id').equals(customerId).count(),
  ]);

  await db.transaction('rw', [db.customers, db.serviceLogs, db.chemicalUsage, db.notes], async () => {
    await db.serviceLogs.where('customer_id').equals(customerId).delete();
    await db.chemicalUsage.where('customer_id').equals(customerId).delete();
    await db.notes.where('customer_id').equals(customerId).delete();
    await db.customers.delete(customerId);
  });

  return {
    deleted: {
      customer: true,
      serviceLogs: serviceLogCount,
      chemicalUsage: chemicalUsageCount,
      notes: noteCount,
    },
  };
}

/**
 * Get data retention summary
 * Shows what data is stored and for how long
 */
export async function getDataRetentionSummary(): Promise<{
  dataTypes: Array<{
    type: string;
    count: number;
    oldestRecord: string | null;
    newestRecord: string | null;
  }>;
}> {
  const customers = await db.customers.toArray();
  const serviceLogs = await db.serviceLogs.toArray();
  const chemicalUsage = await db.chemicalUsage.toArray();
  const notes = await db.notes.toArray();

  const getDateRange = (records: ReadonlyArray<object>) => {
    if (records.length === 0) return { oldest: null, newest: null };
    const dates = records
      .map((r) => (r as { createdAt?: unknown }).createdAt)
      .filter((value): value is number => typeof value === 'number');
    if (dates.length === 0) return { oldest: null, newest: null };
    return {
      oldest: new Date(Math.min(...dates)).toISOString(),
      newest: new Date(Math.max(...dates)).toISOString(),
    };
  };

  return {
    dataTypes: [
      {
        type: 'Customers',
        count: customers.length,
        ...(() => {
          const range = getDateRange(customers);
          return { oldestRecord: range.oldest, newestRecord: range.newest };
        })(),
      },
      {
        type: 'Service Logs',
        count: serviceLogs.length,
        ...(() => {
          const range = getDateRange(serviceLogs);
          return { oldestRecord: range.oldest, newestRecord: range.newest };
        })(),
      },
      {
        type: 'Chemical Usage',
        count: chemicalUsage.length,
        ...(() => {
          const range = getDateRange(chemicalUsage);
          return { oldestRecord: range.oldest, newestRecord: range.newest };
        })(),
      },
      {
        type: 'Notes',
        count: notes.length,
        ...(() => {
          const range = getDateRange(notes);
          return { oldestRecord: range.oldest, newestRecord: range.newest };
        })(),
      },
    ],
  };
}
