import Dexie, { Table } from 'dexie';

export interface SyncableRecord {
    convex_id?: string;
    sync_status: 'synced' | 'pending' | 'error';
    sync_error?: string;
    local_updated_at: number;
    remote_updated_at?: number;
    conflict_backup?: string;
}

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
    alkalinity_value?: number;
    stabilizer_value?: number;
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

    private setupSyncHooks(): void {
        this.customers.hook('creating', (_primKey, obj, trans) => {
            if (this.syncHooksSuppressed > 0) return;
            obj.local_updated_at = Date.now();
            obj.sync_status = 'pending';

            trans.on('complete', () => {
                if (this.syncService && obj.id) {
                    this.syncService.enqueueRecord('customers', obj.id, 'create', obj);
                }
            });
        });

        this.customers.hook('updating', (modifications, primKey, obj, trans) => {
            if (this.syncHooksSuppressed > 0) return;
            // Only trigger sync if non-sync fields are modified
            if (this.hasNonSyncFieldChanges(modifications)) {
                const updatedRecord = { ...obj, ...modifications };
                updatedRecord.local_updated_at = Date.now();
                updatedRecord.sync_status = 'pending';

                Object.assign(modifications, {
                    local_updated_at: updatedRecord.local_updated_at,
                    sync_status: updatedRecord.sync_status
                });

                trans.on('complete', () => {
                    if (this.syncService && primKey) {
                        this.syncService.enqueueRecord('customers', primKey, 'update', updatedRecord);
                    }
                });
            }
        });

        this.customers.hook('deleting', (primKey, obj, trans) => {
            if (this.syncHooksSuppressed > 0) return;
            trans.on('complete', () => {
                if (this.syncService && primKey) {
                    this.syncService.enqueueRecord('customers', primKey, 'delete', obj);
                }
            });
        });

        this.pools.hook('creating', (_primKey, obj, trans) => {
            if (this.syncHooksSuppressed > 0) return;
            obj.local_updated_at = Date.now();
            obj.sync_status = 'pending';
            trans.on('complete', () => {
                if (this.syncService && obj.id) this.syncService.enqueueRecord('pools', obj.id, 'create', obj);
            });
        });

        this.pools.hook('updating', (modifications, primKey, obj, trans) => {
            if (this.syncHooksSuppressed > 0) return;
            if (this.hasNonSyncFieldChanges(modifications)) {
                const updatedRecord = { ...obj, ...modifications };
                updatedRecord.local_updated_at = Date.now();
                updatedRecord.sync_status = 'pending';
                Object.assign(modifications, { local_updated_at: updatedRecord.local_updated_at, sync_status: 'pending' });
                trans.on('complete', () => {
                    if (this.syncService && primKey) this.syncService.enqueueRecord('pools', primKey, 'update', updatedRecord);
                });
            }
        });

        this.pools.hook('deleting', (primKey, obj, trans) => {
            if (this.syncHooksSuppressed > 0) return;
            trans.on('complete', () => {
                if (this.syncService && primKey) this.syncService.enqueueRecord('pools', primKey, 'delete', obj);
            });
        });

        this.equipment.hook('creating', (_primKey, obj, trans) => {
            if (this.syncHooksSuppressed > 0) return;
            obj.local_updated_at = Date.now();
            obj.sync_status = 'pending';
            trans.on('complete', () => {
                if (this.syncService && obj.id) this.syncService.enqueueRecord('equipment', obj.id, 'create', obj);
            });
        });

        this.equipment.hook('updating', (modifications, primKey, obj, trans) => {
            if (this.syncHooksSuppressed > 0) return;
            if (this.hasNonSyncFieldChanges(modifications)) {
                const updatedRecord = { ...obj, ...modifications };
                updatedRecord.local_updated_at = Date.now();
                updatedRecord.sync_status = 'pending';
                Object.assign(modifications, { local_updated_at: updatedRecord.local_updated_at, sync_status: 'pending' });
                trans.on('complete', () => {
                    if (this.syncService && primKey) this.syncService.enqueueRecord('equipment', primKey, 'update', updatedRecord);
                });
            }
        });

        this.equipment.hook('deleting', (primKey, obj, trans) => {
            if (this.syncHooksSuppressed > 0) return;
            trans.on('complete', () => {
                if (this.syncService && primKey) this.syncService.enqueueRecord('equipment', primKey, 'delete', obj);
            });
        });

        this.serviceLogs.hook('creating', (_primKey, obj, trans) => {
            if (this.syncHooksSuppressed > 0) return;
            obj.local_updated_at = Date.now();
            obj.sync_status = 'pending';

            trans.on('complete', () => {
                if (this.syncService && obj.id) {
                    this.syncService.enqueueRecord('serviceLogs', obj.id, 'create', obj);
                }
            });
        });

        this.serviceLogs.hook('updating', (modifications, primKey, obj, trans) => {
            if (this.syncHooksSuppressed > 0) return;
            if (this.hasNonSyncFieldChanges(modifications)) {
                const updatedRecord = { ...obj, ...modifications };
                updatedRecord.local_updated_at = Date.now();
                updatedRecord.sync_status = 'pending';

                Object.assign(modifications, {
                    local_updated_at: updatedRecord.local_updated_at,
                    sync_status: updatedRecord.sync_status
                });

                trans.on('complete', () => {
                    if (this.syncService && primKey) {
                        this.syncService.enqueueRecord('serviceLogs', primKey, 'update', updatedRecord);
                    }
                });
            }
        });

        this.serviceLogs.hook('deleting', (primKey, obj, trans) => {
            if (this.syncHooksSuppressed > 0) return;
            trans.on('complete', () => {
                if (this.syncService && primKey) {
                    this.syncService.enqueueRecord('serviceLogs', primKey, 'delete', obj);
                }
            });
        });

        this.chemicalUsage.hook('creating', (_primKey, obj, trans) => {
            if (this.syncHooksSuppressed > 0) return;
            obj.local_updated_at = Date.now();
            obj.sync_status = 'pending';

            trans.on('complete', () => {
                if (this.syncService && obj.id) {
                    this.syncService.enqueueRecord('chemicalUsage', obj.id, 'create', obj);
                }
            });
        });

        this.chemicalUsage.hook('updating', (modifications, primKey, obj, trans) => {
            if (this.syncHooksSuppressed > 0) return;
            if (this.hasNonSyncFieldChanges(modifications)) {
                const updatedRecord = { ...obj, ...modifications };
                updatedRecord.local_updated_at = Date.now();
                updatedRecord.sync_status = 'pending';

                Object.assign(modifications, {
                    local_updated_at: updatedRecord.local_updated_at,
                    sync_status: updatedRecord.sync_status
                });

                trans.on('complete', () => {
                    if (this.syncService && primKey) {
                        this.syncService.enqueueRecord('chemicalUsage', primKey, 'update', updatedRecord);
                    }
                });
            }
        });

        this.chemicalUsage.hook('deleting', (primKey, obj, trans) => {
            if (this.syncHooksSuppressed > 0) return;
            trans.on('complete', () => {
                if (this.syncService && primKey) {
                    this.syncService.enqueueRecord('chemicalUsage', primKey, 'delete', obj);
                }
            });
        });

        this.notes.hook('creating', (_primKey, obj, trans) => {
            if (this.syncHooksSuppressed > 0) return;
            obj.local_updated_at = Date.now();
            obj.sync_status = 'pending';

            trans.on('complete', () => {
                if (this.syncService && obj.id) {
                    this.syncService.enqueueRecord('notes', obj.id, 'create', obj);
                }
            });
        });

        this.notes.hook('updating', (modifications, primKey, obj, trans) => {
            if (this.syncHooksSuppressed > 0) return;
            if (this.hasNonSyncFieldChanges(modifications)) {
                const updatedRecord = { ...obj, ...modifications };
                updatedRecord.local_updated_at = Date.now();
                updatedRecord.sync_status = 'pending';

                Object.assign(modifications, {
                    local_updated_at: updatedRecord.local_updated_at,
                    sync_status: updatedRecord.sync_status
                });

                trans.on('complete', () => {
                    if (this.syncService && primKey) {
                        this.syncService.enqueueRecord('notes', primKey, 'update', updatedRecord);
                    }
                });
            }
        });

        this.notes.hook('deleting', (primKey, obj, trans) => {
            if (this.syncHooksSuppressed > 0) return;
            trans.on('complete', () => {
                if (this.syncService && primKey) {
                    this.syncService.enqueueRecord('notes', primKey, 'delete', obj);
                }
            });
        });

        this.saltCellLogs.hook('creating', (_primKey, obj, trans) => {
            if (this.syncHooksSuppressed > 0) return;
            obj.local_updated_at = Date.now();
            obj.sync_status = 'pending';

            trans.on('complete', () => {
                if (this.syncService && obj.id) {
                    this.syncService.enqueueRecord('saltCellLogs', obj.id, 'create', obj);
                }
            });
        });

        this.saltCellLogs.hook('updating', (modifications, primKey, obj, trans) => {
            if (this.syncHooksSuppressed > 0) return;
            if (this.hasNonSyncFieldChanges(modifications)) {
                const updatedRecord = { ...obj, ...modifications };
                updatedRecord.local_updated_at = Date.now();
                updatedRecord.sync_status = 'pending';

                Object.assign(modifications, {
                    local_updated_at: updatedRecord.local_updated_at,
                    sync_status: updatedRecord.sync_status
                });

                trans.on('complete', () => {
                    if (this.syncService && primKey) {
                        this.syncService.enqueueRecord('saltCellLogs', primKey, 'update', updatedRecord);
                    }
                });
            }
        });

        this.saltCellLogs.hook('deleting', (primKey, obj, trans) => {
            if (this.syncHooksSuppressed > 0) return;
            trans.on('complete', () => {
                if (this.syncService && primKey) {
                    this.syncService.enqueueRecord('saltCellLogs', primKey, 'delete', obj);
                }
            });
        });
    }

    /**
     * Check if modifications contain non-sync fields to avoid infinite loops
     */
    private hasNonSyncFieldChanges(modifications: any): boolean {
        const syncFields = [
            'sync_status',
            'sync_error',
            'convex_id',
            'local_updated_at',
            'remote_updated_at',
            'conflict_backup',
            'convex_customer_id',
            'convex_pool_id'
        ];

        return Object.keys(modifications).some(key => !syncFields.includes(key));
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
