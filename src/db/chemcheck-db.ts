import Dexie, { Table } from 'dexie';

// ============================================
// TypeScript Interfaces
// ============================================

export interface SyncableRecord {
    convex_id?: string;             // Convex ID after sync
    sync_status: 'synced' | 'pending' | 'error';
    sync_error?: string;            // Error message if sync failed
    local_updated_at: number;       // Local modification timestamp
    remote_updated_at?: number;     // Remote modification timestamp
    conflict_backup?: string;       // JSON backup of pre-conflict version
}

export interface Customer extends SyncableRecord {
    id?: number;                 // Auto-increment primary key
    full_name: string;
    address: string;
    phone?: string;
    email?: string;
    gate_code?: string;
    service_day: string;         // Monday, Tuesday, etc.
    pool_gallons?: number;
    pool_type: string;           // "Salt" | "Chlorine"
    surface_type: string;        // "Plaster" | "Vinyl" | "Fiberglass" | "Tile"
    sort_order?: number;
    created_by: string;          // For future multi-device sync
    createdAt?: string;          // ISO timestamp
    updatedAt?: string;          // ISO timestamp
    // Report customization settings
    report_settings?: {
        show_chemical_readings: boolean;
        show_photos: boolean;
        show_service_notes: boolean;
        show_technician_name: boolean;
        show_service_duration: boolean;
        show_overall_status: boolean;
    };
}

export interface ServiceLog extends SyncableRecord {
    id?: number;                 // Auto-increment primary key
    customer_id: number;         // Foreign key to Customer.id
    convex_customer_id?: string; // Reference to synced customer
    service_date: string;        // YYYY-MM-DD format
    status: string;              // "completed" | "pending" | etc.
    notes?: string;
    ph: string;                  // "good" | "low" | "high"
    chlorine: string;            // "good" | "low" | "high"
    alkalinity: string;          // "good" | "low" | "high"
    stabilizer: string;          // "good" | "low" | "high"
    salt?: number;               // Salt level (salt pools only)
    // Proof-of-service time tracking fields
    start_time?: string;         // ISO 8601 UTC
    end_time?: string;           // ISO 8601 UTC
    duration_ms?: number;        // Calculated duration in milliseconds
    createdAt?: string;          // ISO timestamp
    updatedAt?: string;          // ISO timestamp
}

export interface ChemicalUsage extends SyncableRecord {
    id?: number;                 // Auto-increment primary key
    customer_id: number;         // Foreign key to Customer.id
    convex_customer_id?: string; // Reference to synced customer
    chemical_type: string;
    quantity: string;
    notes?: string;
    created_date?: string;       // YYYY-MM-DD format
    createdAt?: string;          // ISO timestamp
    updatedAt?: string;          // ISO timestamp
}

export interface Note extends SyncableRecord {
    id?: number;                 // Auto-increment primary key
    title: string;
    content: string;
    category: string;            // "General" | "Customer" | "Equipment" | "Reminder" | "Chemical" | "Billing"
    customer_id?: number;        // Optional foreign key to Customer.id
    convex_customer_id?: string; // Reference to synced customer
    priority: string;            // "low" | "medium" | "high"
    completed?: boolean;
    created_date?: string;       // YYYY-MM-DD format
    createdAt?: string;          // ISO timestamp
    updatedAt?: string;          // ISO timestamp
}

export interface SaltCellLog extends SyncableRecord {
    id?: number;                 // Auto-increment primary key
    customer_id: number;         // Foreign key to Customer.id
    convex_customer_id?: string; // Reference to synced customer
    cleaning_date: string;       // YYYY-MM-DD format
    condition: string;           // "good" | "moderate" | "heavy" - scale buildup condition
    notes?: string;              // Optional notes about the cleaning
    next_cleaning_due?: string;  // YYYY-MM-DD format - estimated next cleaning
    createdAt?: string;          // ISO timestamp
    updatedAt?: string;          // ISO timestamp
}

// ============================================
// Dexie Database Class
// ============================================

export class ChemCheckDB extends Dexie {
    customers!: Table<Customer>;
    serviceLogs!: Table<ServiceLog>;
    chemicalUsage!: Table<ChemicalUsage>;
    notes!: Table<Note>;
    saltCellLogs!: Table<SaltCellLog>;

    // Sync service reference for automatic sync triggers
    private syncService: any = null;

    constructor() {
        super('chemcheck');

        // Version 1: Original schema
        this.version(1).stores({
            customers: '++id, created_by, service_day, sort_order',
            serviceLogs: '++id, customer_id, service_date, [customer_id+service_date]',
            chemicalUsage: '++id, customer_id, created_date',
            notes: '++id, customer_id, completed, created_date, category',
        });

        // Version 2: Add sync fields for Convex integration
        this.version(2).stores({
            customers: '++id, created_by, service_day, sort_order, sync_status, convex_id',
            serviceLogs: '++id, customer_id, service_date, [customer_id+service_date], sync_status, convex_id, convex_customer_id',
            chemicalUsage: '++id, customer_id, created_date, sync_status, convex_id, convex_customer_id',
            notes: '++id, customer_id, completed, created_date, category, sync_status, convex_id, convex_customer_id',
        }).upgrade(async (trans) => {
            console.log('Migrating database to version 2 - adding sync fields...');
            const now = Date.now();

            // Migrate customers
            await trans.table('customers').toCollection().modify((customer: any) => {
                customer.sync_status = 'pending';
                customer.local_updated_at = now;
            });

            // Migrate service logs
            await trans.table('serviceLogs').toCollection().modify((serviceLog: any) => {
                serviceLog.sync_status = 'pending';
                serviceLog.local_updated_at = now;
            });

            // Migrate chemical usage
            await trans.table('chemicalUsage').toCollection().modify((chemicalUsage: any) => {
                chemicalUsage.sync_status = 'pending';
                chemicalUsage.local_updated_at = now;
            });

            // Migrate notes
            await trans.table('notes').toCollection().modify((note: any) => {
                note.sync_status = 'pending';
                note.local_updated_at = now;
            });

            console.log('Database migration to version 2 completed');
        });

        // Version 3: Add salt cell logs table and composite index for common query pattern
        this.version(3).stores({
            customers: '++id, created_by, service_day, sort_order, sync_status, convex_id, [created_by+service_day]',
            serviceLogs: '++id, customer_id, service_date, [customer_id+service_date], sync_status, convex_id, convex_customer_id',
            chemicalUsage: '++id, customer_id, created_date, sync_status, convex_id, convex_customer_id',
            notes: '++id, customer_id, completed, created_date, category, sync_status, convex_id, convex_customer_id',
            saltCellLogs: '++id, customer_id, cleaning_date, sync_status, convex_id, convex_customer_id',
        });

        // Set up table hooks for automatic sync triggers
        this.setupSyncHooks();
    }

    /**
     * Set sync service reference for automatic sync triggers
     */
    setSyncService(syncService: any): void {
        this.syncService = syncService;
    }

    /**
     * Set up Dexie table hooks to automatically trigger sync on data changes
     */
    private setupSyncHooks(): void {
        // Hook into customers table
        this.customers.hook('creating', (primKey, obj, trans) => {
            // Set sync fields immediately
            obj.local_updated_at = Date.now();
            obj.sync_status = 'pending';

            // Use transaction completion to get the auto-generated ID
            trans.on('complete', () => {
                if (this.syncService && obj.id) {
                    this.syncService.enqueueRecord('customers', obj.id, 'create', obj);
                }
            });
        });

        this.customers.hook('updating', (modifications, primKey, obj, trans) => {
            // Only trigger sync if non-sync fields are modified
            if (this.hasNonSyncFieldChanges(modifications)) {
                const updatedRecord = { ...obj, ...modifications };
                updatedRecord.local_updated_at = Date.now();
                updatedRecord.sync_status = 'pending';

                // Apply modifications to the record
                Object.assign(modifications, {
                    local_updated_at: updatedRecord.local_updated_at,
                    sync_status: updatedRecord.sync_status
                });

                if (this.syncService && primKey) {
                    setTimeout(() => {
                        this.syncService.enqueueRecord('customers', primKey, 'update', updatedRecord);
                    }, 0);
                }
            }
        });

        this.customers.hook('deleting', (primKey, obj, trans) => {
            if (this.syncService && primKey) {
                setTimeout(() => {
                    this.syncService.enqueueRecord('customers', primKey, 'delete', obj);
                }, 0);
            }
        });

        // Hook into serviceLogs table
        this.serviceLogs.hook('creating', (primKey, obj, trans) => {
            // Set sync fields immediately
            obj.local_updated_at = Date.now();
            obj.sync_status = 'pending';

            // Use transaction completion to get the auto-generated ID
            trans.on('complete', () => {
                if (this.syncService && obj.id) {
                    this.syncService.enqueueRecord('serviceLogs', obj.id, 'create', obj);
                }
            });
        });

        this.serviceLogs.hook('updating', (modifications, primKey, obj, trans) => {
            if (this.hasNonSyncFieldChanges(modifications)) {
                const updatedRecord = { ...obj, ...modifications };
                updatedRecord.local_updated_at = Date.now();
                updatedRecord.sync_status = 'pending';

                Object.assign(modifications, {
                    local_updated_at: updatedRecord.local_updated_at,
                    sync_status: updatedRecord.sync_status
                });

                if (this.syncService && primKey) {
                    setTimeout(() => {
                        this.syncService.enqueueRecord('serviceLogs', primKey, 'update', updatedRecord);
                    }, 0);
                }
            }
        });

        this.serviceLogs.hook('deleting', (primKey, obj, trans) => {
            if (this.syncService && primKey) {
                setTimeout(() => {
                    this.syncService.enqueueRecord('serviceLogs', primKey, 'delete', obj);
                }, 0);
            }
        });

        // Hook into chemicalUsage table
        this.chemicalUsage.hook('creating', (primKey, obj, trans) => {
            // Set sync fields immediately
            obj.local_updated_at = Date.now();
            obj.sync_status = 'pending';

            // Use transaction completion to get the auto-generated ID
            trans.on('complete', () => {
                if (this.syncService && obj.id) {
                    this.syncService.enqueueRecord('chemicalUsage', obj.id, 'create', obj);
                }
            });
        });

        this.chemicalUsage.hook('updating', (modifications, primKey, obj, trans) => {
            if (this.hasNonSyncFieldChanges(modifications)) {
                const updatedRecord = { ...obj, ...modifications };
                updatedRecord.local_updated_at = Date.now();
                updatedRecord.sync_status = 'pending';

                Object.assign(modifications, {
                    local_updated_at: updatedRecord.local_updated_at,
                    sync_status: updatedRecord.sync_status
                });

                if (this.syncService && primKey) {
                    setTimeout(() => {
                        this.syncService.enqueueRecord('chemicalUsage', primKey, 'update', updatedRecord);
                    }, 0);
                }
            }
        });

        this.chemicalUsage.hook('deleting', (primKey, obj, trans) => {
            if (this.syncService && primKey) {
                setTimeout(() => {
                    this.syncService.enqueueRecord('chemicalUsage', primKey, 'delete', obj);
                }, 0);
            }
        });

        // Hook into notes table
        this.notes.hook('creating', (primKey, obj, trans) => {
            // Set sync fields immediately
            obj.local_updated_at = Date.now();
            obj.sync_status = 'pending';

            // Use transaction completion to get the auto-generated ID
            trans.on('complete', () => {
                if (this.syncService && obj.id) {
                    this.syncService.enqueueRecord('notes', obj.id, 'create', obj);
                }
            });
        });

        this.notes.hook('updating', (modifications, primKey, obj, trans) => {
            if (this.hasNonSyncFieldChanges(modifications)) {
                const updatedRecord = { ...obj, ...modifications };
                updatedRecord.local_updated_at = Date.now();
                updatedRecord.sync_status = 'pending';

                Object.assign(modifications, {
                    local_updated_at: updatedRecord.local_updated_at,
                    sync_status: updatedRecord.sync_status
                });

                if (this.syncService && primKey) {
                    setTimeout(() => {
                        this.syncService.enqueueRecord('notes', primKey, 'update', updatedRecord);
                    }, 0);
                }
            }
        });

        this.notes.hook('deleting', (primKey, obj, trans) => {
            if (this.syncService && primKey) {
                setTimeout(() => {
                    this.syncService.enqueueRecord('notes', primKey, 'delete', obj);
                }, 0);
            }
        });

        // Hook into saltCellLogs table
        this.saltCellLogs.hook('creating', (primKey, obj, trans) => {
            // Set sync fields immediately
            obj.local_updated_at = Date.now();
            obj.sync_status = 'pending';

            // Use transaction completion to get the auto-generated ID
            trans.on('complete', () => {
                if (this.syncService && obj.id) {
                    this.syncService.enqueueRecord('saltCellLogs', obj.id, 'create', obj);
                }
            });
        });

        this.saltCellLogs.hook('updating', (modifications, primKey, obj, trans) => {
            if (this.hasNonSyncFieldChanges(modifications)) {
                const updatedRecord = { ...obj, ...modifications };
                updatedRecord.local_updated_at = Date.now();
                updatedRecord.sync_status = 'pending';

                Object.assign(modifications, {
                    local_updated_at: updatedRecord.local_updated_at,
                    sync_status: updatedRecord.sync_status
                });

                if (this.syncService && primKey) {
                    setTimeout(() => {
                        this.syncService.enqueueRecord('saltCellLogs', primKey, 'update', updatedRecord);
                    }, 0);
                }
            }
        });

        this.saltCellLogs.hook('deleting', (primKey, obj, trans) => {
            if (this.syncService && primKey) {
                setTimeout(() => {
                    this.syncService.enqueueRecord('saltCellLogs', primKey, 'delete', obj);
                }, 0);
            }
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
            'convex_customer_id'
        ];

        return Object.keys(modifications).some(key => !syncFields.includes(key));
    }
}

// ============================================
// Singleton Database Instance
// ============================================

export const db = new ChemCheckDB();

// ============================================
// Helper: Get current date in YYYY-MM-DD format
// ============================================

export function getTodayDate(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// ============================================
// Helper: Get ISO timestamp
// ============================================

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

    return DEFAULT_USER;
}
