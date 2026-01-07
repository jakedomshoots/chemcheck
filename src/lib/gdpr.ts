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

/**
 * Download user data as JSON file
 */
export async function downloadUserData(): Promise<void> {
  const data = await exportUserData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const date = new Date().toISOString().split('T')[0];
  downloadFile(blob, `chemcheck-gdpr-export-${date}.json`);
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
  // Get counts before deletion
  const [customerCount, serviceLogCount, chemicalUsageCount, noteCount] = await Promise.all([
    db.customers.count(),
    db.serviceLogs.count(),
    db.chemicalUsage.count(),
    db.notes.count(),
  ]);

  // Delete all data in a transaction
  await db.transaction('rw', [db.customers, db.serviceLogs, db.chemicalUsage, db.notes], async () => {
    await db.serviceLogs.clear();
    await db.chemicalUsage.clear();
    await db.notes.clear();
    await db.customers.clear();
  });

  // Clear localStorage data
  const keysToRemove = Object.keys(localStorage).filter(key => 
    key.startsWith('chemcheck_') || 
    key.startsWith('business_') ||
    key.startsWith('user_')
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
