import { db } from '@/db/chemcheck-db';
import type { Customer, ServiceLog, ChemicalUsage, Note } from '@/db/chemcheck-db';

/**
 * CSV Export/Import Utilities for ChemCheck
 * Enables local data backup and restore
 */

// ============================================
// Export Functions
// ============================================

function escapeCsvValue(value: unknown): string {
    if (value === null || value === undefined) {
        return '';
    }
    const str = String(value);
    // Escape quotes and wrap in quotes if contains comma, quote, or newline
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

function arrayToCsv<T extends Record<string, unknown>>(data: T[], headers: string[]): string {
    const headerRow = headers.join(',');
    const dataRows = data.map(row =>
        headers.map(header => escapeCsvValue(row[header])).join(',')
    );
    return [headerRow, ...dataRows].join('\n');
}

export async function exportCustomersCsv(): Promise<string> {
    const customers = await db.customers.toArray();
    const headers = [
        'id', 'full_name', 'address', 'phone', 'email', 'gate_code',
        'service_day', 'pool_gallons', 'pool_type', 'surface_type',
        'sort_order', 'created_by', 'createdAt', 'updatedAt'
    ];
    return arrayToCsv(customers, headers);
}

export async function exportServiceLogsCsv(): Promise<string> {
    const logs = await db.serviceLogs.toArray();
    const headers = [
        'id', 'customer_id', 'service_date', 'status', 'notes',
        'ph', 'chlorine', 'alkalinity', 'stabilizer', 'salt',
        'createdAt', 'updatedAt'
    ];
    return arrayToCsv(logs, headers);
}

export async function exportChemicalUsageCsv(): Promise<string> {
    const usage = await db.chemicalUsage.toArray();
    const headers = [
        'id', 'customer_id', 'chemical_type', 'quantity', 'notes',
        'created_date', 'createdAt', 'updatedAt'
    ];
    return arrayToCsv(usage, headers);
}

export async function exportNotesCsv(): Promise<string> {
    const notes = await db.notes.toArray();
    const headers = [
        'id', 'title', 'content', 'category', 'customer_id',
        'priority', 'completed', 'created_date', 'createdAt', 'updatedAt'
    ];
    return arrayToCsv(notes, headers);
}

export async function exportAllDataAsZip(): Promise<Blob> {
    // Get all CSVs
    const [customers, serviceLogs, chemicalUsage, notes] = await Promise.all([
        exportCustomersCsv(),
        exportServiceLogsCsv(),
        exportChemicalUsageCsv(),
        exportNotesCsv(),
    ]);

    // Create a combined JSON backup as well
    const jsonBackup = JSON.stringify({
        exportDate: new Date().toISOString(),
        version: 1,
        customers: await db.customers.toArray(),
        serviceLogs: await db.serviceLogs.toArray(),
        chemicalUsage: await db.chemicalUsage.toArray(),
        notes: await db.notes.toArray(),
    }, null, 2);

    // For simplicity, return a single JSON file (more reliable than ZIP for restore)
    return new Blob([jsonBackup], { type: 'application/json' });
}

export function downloadFile(content: string | Blob, filename: string) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

export async function downloadFullBackup() {
    const today = new Date().toISOString().split('T')[0];
    const blob = await exportAllDataAsZip();
    downloadFile(blob, `chemcheck-backup-${today}.json`);
}

// ============================================
// Import Functions
// ============================================

interface BackupData {
    version: number;
    exportDate: string;
    customers: Customer[];
    serviceLogs: ServiceLog[];
    chemicalUsage: ChemicalUsage[];
    notes: Note[];
}

// Schema validation to prevent malformed data import
function validateBackupData(data: unknown): { valid: boolean; error?: string } {
    if (typeof data !== 'object' || data === null) {
        return { valid: false, error: 'Backup must be a JSON object' };
    }

    const d = data as Record<string, unknown>;

    // Check required fields
    if (typeof d.version !== 'number') {
        return { valid: false, error: 'Missing or invalid version field' };
    }
    if (!Array.isArray(d.customers)) {
        return { valid: false, error: 'Missing or invalid customers array' };
    }
    if (!Array.isArray(d.serviceLogs)) {
        return { valid: false, error: 'Missing or invalid serviceLogs array' };
    }
    if (!Array.isArray(d.chemicalUsage)) {
        return { valid: false, error: 'Missing or invalid chemicalUsage array' };
    }
    if (!Array.isArray(d.notes)) {
        return { valid: false, error: 'Missing or invalid notes array' };
    }

    // Validate customer records have required string fields
    for (let i = 0; i < d.customers.length; i++) {
        const c = d.customers[i] as Record<string, unknown>;
        if (typeof c.full_name !== 'string' || !c.full_name.trim()) {
            return { valid: false, error: `Customer ${i + 1}: missing or invalid full_name` };
        }
        if (typeof c.address !== 'string') {
            return { valid: false, error: `Customer ${i + 1}: missing or invalid address` };
        }
        if (typeof c.service_day !== 'string') {
            return { valid: false, error: `Customer ${i + 1}: missing or invalid service_day` };
        }
        if (typeof c.pool_type !== 'string') {
            return { valid: false, error: `Customer ${i + 1}: missing or invalid pool_type` };
        }
        if (typeof c.surface_type !== 'string') {
            return { valid: false, error: `Customer ${i + 1}: missing or invalid surface_type` };
        }
    }

    // Validate service logs have required fields
    for (let i = 0; i < d.serviceLogs.length; i++) {
        const log = d.serviceLogs[i] as Record<string, unknown>;
        if (typeof log.customer_id !== 'number') {
            return { valid: false, error: `ServiceLog ${i + 1}: missing or invalid customer_id` };
        }
        if (typeof log.service_date !== 'string') {
            return { valid: false, error: `ServiceLog ${i + 1}: missing or invalid service_date` };
        }
    }

    return { valid: true };
}

export async function importFromBackup(file: File): Promise<{ success: boolean; message: string }> {
    try {
        const text = await file.text();

        let data: unknown;
        try {
            data = JSON.parse(text);
        } catch {
            return { success: false, message: 'Invalid JSON format' };
        }

        // Validate schema before import
        const validation = validateBackupData(data);
        if (!validation.valid) {
            return { success: false, message: `Validation error: ${validation.error}` };
        }

        const backupData = data as BackupData;

        // Clear existing data and import
        await db.transaction('rw', [db.customers, db.serviceLogs, db.chemicalUsage, db.notes], async () => {
            // Clear all tables
            await db.customers.clear();
            await db.serviceLogs.clear();
            await db.chemicalUsage.clear();
            await db.notes.clear();

            // Import customers first (they're referenced by other tables)
            const customerIdMap = new Map<number, number>();
            const nowMs = Date.now();
            
            for (const customer of backupData.customers) {
                const oldId = customer.id!;
                delete customer.id; // Let Dexie auto-generate new ID
                // Set sync fields for imported records
                customer.sync_status = 'pending';
                customer.local_updated_at = nowMs;
                const newId = await db.customers.add(customer);
                customerIdMap.set(oldId, newId as number);
            }

            // Import service logs with updated customer_id
            for (const log of backupData.serviceLogs) {
                delete log.id;
                log.customer_id = customerIdMap.get(log.customer_id) || log.customer_id;
                // Set sync fields for imported records
                log.sync_status = 'pending';
                log.local_updated_at = nowMs;
                await db.serviceLogs.add(log);
            }

            // Import chemical usage with updated customer_id
            for (const usage of backupData.chemicalUsage) {
                delete usage.id;
                usage.customer_id = customerIdMap.get(usage.customer_id) || usage.customer_id;
                // Set sync fields for imported records
                usage.sync_status = 'pending';
                usage.local_updated_at = nowMs;
                await db.chemicalUsage.add(usage);
            }

            // Import notes with updated customer_id
            for (const note of backupData.notes) {
                delete note.id;
                if (note.customer_id) {
                    note.customer_id = customerIdMap.get(note.customer_id) || note.customer_id;
                }
                // Set sync fields for imported records
                note.sync_status = 'pending';
                note.local_updated_at = nowMs;
                await db.notes.add(note);
            }
        });

        return {
            success: true,
            message: `Imported ${backupData.customers.length} customers, ${backupData.serviceLogs.length} service logs, ${backupData.chemicalUsage.length} chemical usage records, and ${backupData.notes.length} notes`
        };
    } catch (error) {
        return {
            success: false,
            message: `Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        };
    }
}
