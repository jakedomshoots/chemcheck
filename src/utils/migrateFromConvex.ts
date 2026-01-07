import { db, getTodayDate, getTimestamp, DEFAULT_USER } from '@/db/chemcheck-db';
import type { Customer, ServiceLog, ChemicalUsage, Note } from '@/db/chemcheck-db';

/**
 * Migration Utility: Convex → Dexie
 * 
 * This script helps migrate data exported from Convex to the local Dexie database.
 * 
 * HOW TO USE:
 * 1. Export your data from Convex Dashboard as JSON
 * 2. Copy the JSON data for each table
 * 3. Call the appropriate migration function with the data
 * 
 * Or use the browser console:
 * 1. Open DevTools → Console
 * 2. Import the migration functions
 * 3. Paste your Convex data and call migrateAll()
 */

// Types matching Convex export format
interface ConvexCustomer {
    _id: string;
    full_name: string;
    address: string;
    phone?: string;
    email?: string;
    gate_code?: string;
    service_day: string;
    pool_gallons?: number;
    pool_type: string;
    surface_type: string;
    sort_order?: number;
    created_by: string;
}

interface ConvexServiceLog {
    _id: string;
    customer_id: string;
    service_date: string;
    status: string;
    notes?: string;
    ph: string;
    chlorine: string;
    alkalinity: string;
    stabilizer: string;
    salt?: number;
}

interface ConvexChemicalUsage {
    _id: string;
    customer_id: string;
    chemical_type: string;
    quantity: string;
    notes?: string;
    created_date?: string;
}

interface ConvexNote {
    _id: string;
    title: string;
    content: string;
    category: string;
    customer_id?: string;
    priority: string;
    completed?: boolean;
    created_date?: string;
}

// ID mapping from Convex string IDs to Dexie numeric IDs
const customerIdMap = new Map<string, number>();

export async function migrateCustomers(convexCustomers: ConvexCustomer[]): Promise<number> {
    let count = 0;
    const now = getTimestamp();
    const nowMs = Date.now();

    for (const c of convexCustomers) {
        const customer: Omit<Customer, 'id'> = {
            full_name: c.full_name,
            address: c.address,
            phone: c.phone,
            email: c.email,
            gate_code: c.gate_code,
            service_day: c.service_day,
            pool_gallons: c.pool_gallons,
            pool_type: c.pool_type,
            surface_type: c.surface_type,
            sort_order: c.sort_order,
            created_by: DEFAULT_USER, // Normalize to local user
            createdAt: now,
            updatedAt: now,
            // Set sync fields for migrated records
            sync_status: 'pending',
            local_updated_at: nowMs,
        };

        const newId = await db.customers.add(customer);
        customerIdMap.set(c._id, newId as number);
        count++;
    }

    console.log(`Migrated ${count} customers`);
    return count;
}

export async function migrateServiceLogs(convexLogs: ConvexServiceLog[]): Promise<number> {
    let count = 0;
    const now = getTimestamp();
    const nowMs = Date.now();

    for (const l of convexLogs) {
        const customerId = customerIdMap.get(l.customer_id);
        if (!customerId) {
            console.warn(`Skipping service log - customer ${l.customer_id} not found`);
            continue;
        }

        const log: Omit<ServiceLog, 'id'> = {
            customer_id: customerId,
            service_date: l.service_date,
            status: l.status,
            notes: l.notes,
            ph: l.ph,
            chlorine: l.chlorine,
            alkalinity: l.alkalinity,
            stabilizer: l.stabilizer,
            salt: l.salt,
            createdAt: now,
            updatedAt: now,
            // Set sync fields for migrated records
            sync_status: 'pending',
            local_updated_at: nowMs,
        };

        await db.serviceLogs.add(log);
        count++;
    }

    console.log(`Migrated ${count} service logs`);
    return count;
}

export async function migrateChemicalUsage(convexUsage: ConvexChemicalUsage[]): Promise<number> {
    let count = 0;
    const now = getTimestamp();
    const nowMs = Date.now();

    for (const u of convexUsage) {
        const customerId = customerIdMap.get(u.customer_id);
        if (!customerId) {
            console.warn(`Skipping chemical usage - customer ${u.customer_id} not found`);
            continue;
        }

        const usage: Omit<ChemicalUsage, 'id'> = {
            customer_id: customerId,
            chemical_type: u.chemical_type,
            quantity: u.quantity,
            notes: u.notes,
            created_date: u.created_date || getTodayDate(),
            createdAt: now,
            updatedAt: now,
            // Set sync fields for migrated records
            sync_status: 'pending',
            local_updated_at: nowMs,
        };

        await db.chemicalUsage.add(usage);
        count++;
    }

    console.log(`Migrated ${count} chemical usage records`);
    return count;
}

export async function migrateNotes(convexNotes: ConvexNote[]): Promise<number> {
    let count = 0;
    const now = getTimestamp();
    const nowMs = Date.now();

    for (const n of convexNotes) {
        const note: Omit<Note, 'id'> = {
            title: n.title,
            content: n.content,
            category: n.category,
            customer_id: n.customer_id ? customerIdMap.get(n.customer_id) : undefined,
            priority: n.priority,
            completed: n.completed || false,
            created_date: n.created_date || getTodayDate(),
            createdAt: now,
            updatedAt: now,
            // Set sync fields for migrated records
            sync_status: 'pending',
            local_updated_at: nowMs,
        };

        await db.notes.add(note);
        count++;
    }

    console.log(`Migrated ${count} notes`);
    return count;
}

export interface ConvexExportData {
    customers: ConvexCustomer[];
    serviceLogs: ConvexServiceLog[];
    chemicalUsage: ConvexChemicalUsage[];
    notes: ConvexNote[];
}

export async function migrateAll(data: ConvexExportData): Promise<{
    customers: number;
    serviceLogs: number;
    chemicalUsage: number;
    notes: number;
}> {
    console.log('Starting Convex → Dexie migration...');

    // Clear existing data first
    await db.transaction('rw', [db.customers, db.serviceLogs, db.chemicalUsage, db.notes], async () => {
        await db.customers.clear();
        await db.serviceLogs.clear();
        await db.chemicalUsage.clear();
        await db.notes.clear();
    });

    // Migrate in order (customers first due to foreign keys)
    const customers = await migrateCustomers(data.customers);
    const serviceLogs = await migrateServiceLogs(data.serviceLogs);
    const chemicalUsage = await migrateChemicalUsage(data.chemicalUsage);
    const notes = await migrateNotes(data.notes);

    console.log('Migration complete!');
    return { customers, serviceLogs, chemicalUsage, notes };
}

// Make migrateAll available globally for console usage
if (typeof window !== 'undefined') {
    (window as any).migrateConvexData = migrateAll;
}
