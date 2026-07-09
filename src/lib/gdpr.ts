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
import { requireActiveTenantScope } from '@/lib/tenantScope';
import { clearAllPhotos } from '@/lib/proof-of-service/offlinePhotoStorage';

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
  const scope = requireActiveTenantScope();
  const [customers, serviceLogs, chemicalUsage, notes] = await Promise.all([
    db.customers.where('tenant_id').equals(scope.key).toArray(),
    db.serviceLogs.where('tenant_id').equals(scope.key).toArray(),
    db.chemicalUsage.where('tenant_id').equals(scope.key).toArray(),
    db.notes.where('tenant_id').equals(scope.key).toArray(),
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
  const deviceOnlyData = await exportUserData();

  if (result.type === 'url') {
    downloadFromUrl(result.url, result.filename || `chemcheck-gdpr-export-${date}.json`);
    // Large cloud exports stream separately; preserve unsynced device-only
    // records in a second explicit file rather than silently omitting them.
    downloadFile(
      new Blob([JSON.stringify(deviceOnlyData, null, 2)], { type: 'application/json' }),
      `chemcheck-device-only-export-${date}.json`,
    );
  } else {
    const blob = new Blob([JSON.stringify({ ...result.data, deviceOnlyData }, null, 2)], { type: 'application/json' });
    downloadFile(blob, `chemcheck-gdpr-export-${date}.json`);
  }
}

/**
 * Delete all user data
 * Satisfies: Right to Erasure (Article 17)
 * 
 * @returns Summary of deleted records
 */
export async function deleteAllUserData(): Promise<{
  deleted: {
    customers: number;
    serviceLogs: number;
    chemicalUsage: number;
    notes: number;
  };
  success: boolean;
}> {
  const scope = requireActiveTenantScope();
  // Get counts before deletion. Only the active authenticated tenant is in scope.
  const [customerCount, serviceLogCount, chemicalUsageCount, noteCount] = await Promise.all([
    db.customers.where('tenant_id').equals(scope.key).count(),
    db.serviceLogs.where('tenant_id').equals(scope.key).count(),
    db.chemicalUsage.where('tenant_id').equals(scope.key).count(),
    db.notes.where('tenant_id').equals(scope.key).count(),
  ]);

  // Cloud erasure first. Never claim device-only completion if the server
  // failed to erase the account and its customer data.
  const client = getSharedConvexClient();
  const remote = await client.action(api.account.deleteMyAccount, {});
  if (!remote?.success) throw new Error('Cloud account deletion was not confirmed');

  await db.purgeTenant(scope.key);
  await clearAllPhotos();

  // Clear localStorage data
  const keysToRemove = Object.keys(localStorage).filter(key => 
    key.startsWith('chemcheck_') || 
    key.startsWith('business_') ||
    key.startsWith('user_') ||
    key.startsWith('skipped_services_')
  );
  keysToRemove.forEach(key => localStorage.removeItem(key));

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
  const scope = requireActiveTenantScope();
  const customer = await db.customers.get(customerId);
  if (!customer || customer.tenant_id !== scope.key || customer.deleted_at) {
    throw new Error('Customer not found or access denied');
  }
  const [serviceLogCount, chemicalUsageCount, noteCount] = await Promise.all([
    db.serviceLogs.where('[tenant_id+customer_id]').equals([scope.key, customerId]).count(),
    db.chemicalUsage.where('[tenant_id+customer_id]').equals([scope.key, customerId]).count(),
    db.notes.where('[tenant_id+customer_id]').equals([scope.key, customerId]).count(),
  ]);

  const tombstone = { deleted_at: Date.now(), sync_status: 'pending' as const, sync_operation: 'delete' as const, local_updated_at: Date.now() };
  await db.transaction('rw', [db.customers, db.serviceLogs, db.chemicalUsage, db.notes], async () => {
    const [serviceLogs, chemicalUsage, notes] = await Promise.all([
      db.serviceLogs.where('[tenant_id+customer_id]').equals([scope.key, customerId]).toArray(),
      db.chemicalUsage.where('[tenant_id+customer_id]').equals([scope.key, customerId]).toArray(),
      db.notes.where('[tenant_id+customer_id]').equals([scope.key, customerId]).toArray(),
    ]);
    await Promise.all([
      ...serviceLogs.map((record) => db.serviceLogs.update(record.id!, tombstone)),
      ...chemicalUsage.map((record) => db.chemicalUsage.update(record.id!, tombstone)),
      ...notes.map((record) => db.notes.update(record.id!, tombstone)),
    ]);
    await db.customers.update(customerId, tombstone);
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
  const scope = requireActiveTenantScope();
  const [customers, serviceLogs, chemicalUsage, notes] = await Promise.all([
    db.customers.where('tenant_id').equals(scope.key).toArray(),
    db.serviceLogs.where('tenant_id').equals(scope.key).toArray(),
    db.chemicalUsage.where('tenant_id').equals(scope.key).toArray(),
    db.notes.where('tenant_id').equals(scope.key).toArray(),
  ]);

  const getDateRange = (records: Array<{ createdAt?: number }>) => {
    if (records.length === 0) return { oldest: null, newest: null };
    const dates = records.map(r => r.createdAt).filter(Boolean) as number[];
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
