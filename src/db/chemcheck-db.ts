import Dexie, { Table } from 'dexie';

export interface SyncableRecord {
    convex_id?: string;
    sync_status: 'synced' | 'pending' | 'error';
    sync_error?: string;
    local_updated_at: number;
    remote_updated_at?: number;
    conflict_backup?: string;
    /**
     * Server value of each locally edited field, captured at the first edit
     * after the last sync (null = field was absent).  Cleared once the edit
     * is acknowledged by the server.
     */
    dirty_base?: Record<string, unknown>;
}

export const SYNC_TABLE_NAMES = [
    'customers',
    'pools',
    'equipment',
    'serviceLogs',
    'chemicalUsage',
    'notes',
    'saltCellLogs',
] as const;
export type SyncTableName = typeof SYNC_TABLE_NAMES[number];

/** Bookkeeping fields that never count as a user edit. */
export const SYNC_FIELDS = [
    'sync_status',
    'sync_error',
    'convex_id',
    'local_updated_at',
    'remote_updated_at',
    'conflict_backup',
    'convex_customer_id',
    'convex_pool_id',
    'dirty_base',
];

export interface Customer extends SyncableRecord {
    id?: number;
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
    createdAt?: string;
    updatedAt?: string;
    report_settings?: {
        show_chemical_readings: boolean;
        show_photos: boolean;
        show_service_notes: boolean;
        show_technician_name: boolean;
        show_service_duration: boolean;
        show_overall_status: boolean;
    };
}

export interface Pool extends SyncableRecord {
    id?: number;
    customer_id: number;
    convex_customer_id?: string;
    name: string;
    address?: string;
    service_day: string;
    pool_gallons?: number;
    pool_type: string;
    surface_type: string;
    sort_order?: number;
    notes?: string;
    active: boolean;
    createdAt?: string;
    updatedAt?: string;
}

export interface Equipment extends SyncableRecord {
    id?: number;
    customer_id: number;
    pool_id: number;
    convex_customer_id?: string;
    convex_pool_id?: string;
    equipment_type: string;
    name: string;
    brand?: string;
    model?: string;
    serial_number?: string;
    install_date?: string;
    status: string;
    last_service_date?: string;
    next_service_due?: string;
    notes?: string;
    createdAt?: string;
    updatedAt?: string;
}

export interface ServiceLog extends SyncableRecord {
    id?: number;
    customer_id: number;
    pool_id?: number;
    convex_customer_id?: string;
    service_date: string;
    status: string;
    notes?: string;
    ph: string;
    chlorine: string;
    alkalinity: string;
    stabilizer: string;
    ph_value?: number;
    chlorine_value?: number;
    total_chlorine_value?: number;
    total_bromine_value?: number;
    // Legacy scan metadata is retained for backward-compatible local sync.
    strip_scan_method?: 'aquachek_select_photo';
    strip_scan_confidence?: 'low' | 'medium' | 'high';
    strip_scan_analysis_version?: 'aquachek-select-v2' | 'aquachek-select-v3' | 'aquachek-select-v4';
    strip_scan_pad_confidence?: {
        totalHardness: number;
        totalChlorine: number;
        freeChlorine: number;
        ph: number;
        totalAlkalinity: number;
        cyanuricAcid: number;
    };
    strip_scan_quality?: {
        backgroundLightness: number;
        backgroundNeutrality: number;
        lightingUniformity: number;
        framing: number;
    };
    lsi_calculation_version?: 'aquachek-epa-v1' | 'lsi-v1';
    alkalinity_value?: number;
    stabilizer_value?: number;
    hardness_value?: number;
    hardness_source?: 'aquachek_total' | 'calcium';
    water_temperature?: number;
    water_temperature_source?: 'measured' | 'assumed';
    tds_value?: number;
    tds_source?: 'measured' | 'assumed';
    salt?: number;
    start_time?: string;
    end_time?: string;
    duration_ms?: number;
    service_type?: string;
    createdAt?: string;
    updatedAt?: string;
}

export interface ChemicalUsage extends SyncableRecord {
    id?: number;
    customer_id: number;
    pool_id?: number;
    convex_customer_id?: string;
    chemical_type: string;
    quantity: string;
    notes?: string;
    created_date?: string;
    createdAt?: string;
    updatedAt?: string;
}

export interface Note extends SyncableRecord {
    id?: number;
    title: string;
    content: string;
    category: string;
    customer_id?: number;
    pool_id?: number;
    convex_customer_id?: string;
    priority: string;
    completed?: boolean;
    created_date?: string;
    createdAt?: string;
    updatedAt?: string;
}

export interface SaltCellLog extends SyncableRecord {
    id?: number;
    customer_id: number;
    pool_id?: number;
    convex_customer_id?: string;
    cleaning_date: string;
    condition: string;
    notes?: string;
    next_cleaning_due?: string;
    createdAt?: string;
    updatedAt?: string;
}

export class ChemCheckDB extends Dexie {
    customers!: Table<Customer>;
    pools!: Table<Pool>;
    equipment!: Table<Equipment>;
    serviceLogs!: Table<ServiceLog>;
    chemicalUsage!: Table<ChemicalUsage>;
    notes!: Table<Note>;
    saltCellLogs!: Table<SaltCellLog>;

    private syncService: any = null;
    private syncHooksSuppressed = 0;
    private localOnlyDeleteTables = new Map<string, number>();

    constructor() {
        super('chemcheck');

        this.version(1).stores({
            customers: '++id, created_by, service_day, sort_order',
            serviceLogs: '++id, customer_id, service_date, [customer_id+service_date]',
            chemicalUsage: '++id, customer_id, created_date',
            notes: '++id, customer_id, completed, created_date, category',
        });

        this.version(2).stores({
            customers: '++id, created_by, service_day, sort_order, sync_status, convex_id',
            serviceLogs: '++id, customer_id, service_date, [customer_id+service_date], sync_status, convex_id, convex_customer_id',
            chemicalUsage: '++id, customer_id, created_date, sync_status, convex_id, convex_customer_id',
            notes: '++id, customer_id, completed, created_date, category, sync_status, convex_id, convex_customer_id',
        }).upgrade(async (trans) => {
            console.log('Migrating database to version 2 - adding sync fields...');
            const now = Date.now();

            await trans.table('customers').toCollection().modify((customer: any) => {
                customer.sync_status = 'pending';
                customer.local_updated_at = now;
            });

            await trans.table('serviceLogs').toCollection().modify((serviceLog: any) => {
                serviceLog.sync_status = 'pending';
                serviceLog.local_updated_at = now;
            });

            await trans.table('chemicalUsage').toCollection().modify((chemicalUsage: any) => {
                chemicalUsage.sync_status = 'pending';
                chemicalUsage.local_updated_at = now;
            });

            await trans.table('notes').toCollection().modify((note: any) => {
                note.sync_status = 'pending';
                note.local_updated_at = now;
            });

            console.log('Database migration to version 2 completed');
        });

        this.version(3).stores({
            customers: '++id, created_by, service_day, sort_order, sync_status, convex_id, [created_by+service_day]',
            serviceLogs: '++id, customer_id, service_date, [customer_id+service_date], sync_status, convex_id, convex_customer_id',
            chemicalUsage: '++id, customer_id, created_date, sync_status, convex_id, convex_customer_id',
            notes: '++id, customer_id, completed, created_date, category, sync_status, convex_id, convex_customer_id',
            saltCellLogs: '++id, customer_id, cleaning_date, sync_status, convex_id, convex_customer_id',
        });

        this.version(4).stores({
            customers: '++id, created_by, service_day, sort_order, sync_status, convex_id, [created_by+service_day]',
            pools: '++id, customer_id, service_day, active, sync_status, convex_id, convex_customer_id, [customer_id+active]',
            equipment: '++id, customer_id, pool_id, status, next_service_due, sync_status, convex_id, convex_pool_id, [pool_id+status]',
            serviceLogs: '++id, customer_id, pool_id, service_date, [customer_id+service_date], [pool_id+service_date], sync_status, convex_id, convex_customer_id',
            chemicalUsage: '++id, customer_id, pool_id, created_date, sync_status, convex_id, convex_customer_id',
            notes: '++id, customer_id, pool_id, completed, created_date, category, sync_status, convex_id, convex_customer_id',
            saltCellLogs: '++id, customer_id, pool_id, cleaning_date, sync_status, convex_id, convex_customer_id',
        }).upgrade(async (trans) => {
            const customers = await trans.table('customers').toArray();
            const pools = trans.table('pools');
            const now = Date.now();
            for (const customer of customers as any[]) {
                const existing = await pools.where('customer_id').equals(customer.id).first();
                if (existing) continue;
                await pools.add({
                    customer_id: customer.id,
                    name: 'Primary Pool',
                    address: customer.address,
                    service_day: customer.service_day,
                    pool_gallons: customer.pool_gallons,
                    pool_type: customer.pool_type,
                    surface_type: customer.surface_type,
                    sort_order: customer.sort_order,
                    active: true,
                    createdAt: customer.createdAt,
                    updatedAt: customer.updatedAt,
                    sync_status: 'pending',
                    local_updated_at: now,
                });
            }
        });

        this.setupSyncHooks();
    }

    setSyncService(syncService: any): void {
        this.syncService = syncService;
    }

    /** Apply a remote pull without turning the pulled rows back into outbound work. */
    async withoutSync<T>(operation: () => Promise<T>): Promise<T> {
        const previous = this.syncService;
        this.syncService = null;
        try {
            return await operation();
        } finally {
            this.syncService = previous;
        }
    }

    /**
     * Apply a server snapshot without enqueueing it as a new local write.
     * Remote merges otherwise trigger the normal Dexie hooks, which would
     * immediately push the just-applied server version back to Convex.
     */
    async withoutSyncHooks<T>(operation: () => Promise<T>): Promise<T> {
        this.syncHooksSuppressed += 1;
        try {
            return await operation();
        } finally {
            this.syncHooksSuppressed = Math.max(0, this.syncHooksSuppressed - 1);
        }
    }

    /**
     * Delete a customer and its local child rows.  Only the customer delete
     * is sent to the server: sync.syncDelete cascades to the synced children
     * there and tombstones them for other devices, so the children are removed
     * locally without queueing one delete per row.
     */
    async deleteCustomerWithChildren(customerId: number): Promise<void> {
        const childTables = [this.serviceLogs, this.chemicalUsage, this.notes, this.saltCellLogs, this.equipment, this.pools];
        await this.withoutSyncHooks(async () => {
            await this.transaction('rw', childTables, async () => {
                for (const table of childTables) {
                    await (table as Table<any>).where('customer_id').equals(customerId).delete();
                }
            });
        });
        await this.customers.delete(customerId);
    }

    /**
     * Run a bulk local delete (e.g. `clear()` during a backup restore or a
     * local data wipe) without propagating the deletions to the server.
     */
    private withLocalOnlyDeletes<T>(tableName: string, operation: () => Promise<T>): Promise<T> {
        this.localOnlyDeleteTables.set(tableName, (this.localOnlyDeleteTables.get(tableName) || 0) + 1);
        const release = () => {
            const next = (this.localOnlyDeleteTables.get(tableName) || 1) - 1;
            if (next <= 0) this.localOnlyDeleteTables.delete(tableName);
            else this.localOnlyDeleteTables.set(tableName, next);
        };
        // Chain on the (Dexie) promise itself to stay inside an outer transaction zone.
        return operation().then(
            (value) => { release(); return value; },
            (error) => { release(); throw error; },
        );
    }

    private setupSyncHooks(): void {
        for (const tableName of SYNC_TABLE_NAMES) {
            const table = this.table(tableName);

            table.hook('creating', (_primKey, obj, trans) => {
                if (this.syncHooksSuppressed > 0) return;
                obj.local_updated_at = Date.now();
                obj.sync_status = 'pending';

                trans.on('complete', () => {
                    if (this.syncService && obj.id) {
                        this.syncService.enqueueRecord(tableName, obj.id, 'create', obj);
                    }
                });
            });

            table.hook('updating', (modifications: Record<string, any>, primKey, obj, trans) => {
                if (this.syncHooksSuppressed > 0) return;
                // Only trigger sync if non-sync fields are modified
                if (!this.hasNonSyncFieldChanges(modifications)) return;

                const updatedRecord = { ...obj, ...modifications };
                updatedRecord.local_updated_at = Date.now();
                updatedRecord.sync_status = 'pending';
                const dirtyBase = this.trackDirtyBase(obj, modifications);

                Object.assign(modifications, {
                    local_updated_at: updatedRecord.local_updated_at,
                    sync_status: updatedRecord.sync_status,
                    ...(dirtyBase ? { dirty_base: dirtyBase } : {}),
                });
                if (dirtyBase) updatedRecord.dirty_base = dirtyBase;

                trans.on('complete', () => {
                    if (this.syncService && primKey) {
                        this.syncService.enqueueRecord(tableName, primKey, 'update', updatedRecord);
                    }
                });
            });

            table.hook('deleting', (primKey, obj, trans) => {
                if (this.syncHooksSuppressed > 0) return;
                if (this.localOnlyDeleteTables.has(tableName)) return;
                trans.on('complete', () => {
                    // `obj` carries convex_id, which the delete sync needs
                    // once the local row is gone.
                    if (this.syncService && primKey) {
                        this.syncService.enqueueRecord(tableName, primKey, 'delete', obj);
                    }
                });
            });

            // Table.clear() fires the deleting hook for every row. It is used
            // for local wipes/restores, which must never delete server data.
            const originalClear = table.clear.bind(table);
            table.clear = (() => this.withLocalOnlyDeletes(tableName, originalClear)) as typeof table.clear;
        }
    }

    /**
     * Record the server-side value of each field the first time it is edited
     * since the last successful sync.  The sync engine uses this base to merge
     * concurrent edits field by field instead of trusting device clocks.
     */
    private trackDirtyBase(obj: any, modifications: Record<string, any>): Record<string, any> | undefined {
        if (!obj?.convex_id) return undefined; // never synced: the create carries everything
        const base: Record<string, any> = { ...(obj.dirty_base || {}) };
        for (const key of Object.keys(modifications)) {
            const field = key.split('.')[0];
            if (SYNC_FIELDS.includes(field) || Object.prototype.hasOwnProperty.call(base, field)) continue;
            base[field] = obj[field] === undefined ? null : obj[field];
        }
        return base;
    }

    /**
     * Check if modifications contain non-sync fields to avoid infinite loops
     */
    private hasNonSyncFieldChanges(modifications: any): boolean {
        return Object.keys(modifications).some(key => !SYNC_FIELDS.includes(key.split('.')[0]));
    }
}

export const db = new ChemCheckDB();

export function getTodayDate(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function getTimestamp(): string {
    return new Date().toISOString();
}

/**
 * @deprecated SECURITY WARNING: Using DEFAULT_USER bypasses multi-tenant isolation!
 * 
 * This constant should NEVER be used in production with real user data.
 * It exists only for:
 * 1. Local development/demo purposes
 * 2. Backwards compatibility with legacy local-only data
 * 
 * In production, ALWAYS use the authenticated user's email from:
 * - Clerk: useUser().user?.emailAddresses[0].emailAddress
 * - Or your auth provider's equivalent
 * 
 * Multi-tenant isolation is critical for:
 * - Customer data privacy
 * - GDPR/CCPA compliance  
 * - Preventing data leaks between users
 */
export const DEFAULT_USER = 'local';

/**
 * Get the current user context for database operations.
 * 
 * @param authEmail - Email from authenticated user (e.g., from Clerk)
 * @returns The user identifier to use for database queries
 * 
 * @example
 * // In a component with Clerk authentication:
 * const { user } = useUser();
 * const userEmail = getUserContext(user?.emailAddresses[0]?.emailAddress);
 * 
 * // Use userEmail for database queries:
 * db.customers.where('created_by').equals(userEmail)
 */
export function getUserContext(authEmail?: string | null): string {
    if (authEmail) {
        return authEmail;
    }

    // SECURITY: Log warning in development when falling back to DEFAULT_USER
    if (process.env.NODE_ENV === 'development') {
        console.warn(
            '[SECURITY] getUserContext falling back to DEFAULT_USER. ' +
            'Pass authenticated user email for proper tenant isolation.'
        );
    }

    return 'local';
}
