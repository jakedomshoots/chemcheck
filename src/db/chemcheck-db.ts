import Dexie, { Table } from 'dexie';
import { getActiveTenantScope, requireActiveTenantScope } from '@/lib/tenantScope';

export interface SyncableRecord {
    tenant_id: string;
    convex_id?: string;
    sync_status: 'synced' | 'pending' | 'error';
    sync_error?: string;
    local_updated_at: number;
    remote_updated_at?: number;
    conflict_backup?: string;
    deleted_at?: number;
    sync_operation?: 'create' | 'update' | 'delete';
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

export interface ServiceLog extends SyncableRecord {
    id?: number;
    customer_id: number;
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
    photo_count?: number;
    has_before_photos?: boolean;
    has_after_photos?: boolean;
    createdAt?: string;
    updatedAt?: string;
}

export interface ChemicalUsage extends SyncableRecord {
    id?: number;
    customer_id: number;
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
    convex_customer_id?: string;
    cleaning_date: string;
    condition: string;
    notes?: string;
    next_cleaning_due?: string;
    createdAt?: string;
    updatedAt?: string;
}

export interface SyncOutboxItem {
    id?: number;
    tenant_id: string;
    item_key: string;
    table: 'customers' | 'serviceLogs' | 'chemicalUsage' | 'notes' | 'saltCellLogs';
    local_id: number;
    operation: 'create' | 'update' | 'delete';
    retry_count: number;
    last_attempt?: number;
    error?: string;
    priority: number;
    created_at: number;
    updated_at: number;
}

export interface SyncConflictRecord {
    id?: number;
    tenant_id: string;
    table: SyncOutboxItem['table'];
    local_id: number;
    convex_id: string;
    local_data: string;
    remote_data: string;
    remote_updated_at: number;
    status: 'open' | 'resolved_local' | 'resolved_remote';
    created_at: number;
    resolved_at?: number;
}

export interface RemoteSyncState {
    id?: number;
    tenant_id: string;
    table: SyncOutboxItem['table'];
    last_pulled_at: number;
    updated_at: number;
}

export class ChemCheckDB extends Dexie {
    customers!: Table<Customer>;
    serviceLogs!: Table<ServiceLog>;
    chemicalUsage!: Table<ChemicalUsage>;
    notes!: Table<Note>;
    saltCellLogs!: Table<SaltCellLog>;
    syncOutbox!: Table<SyncOutboxItem>;
    syncConflicts!: Table<SyncConflictRecord>;
    remoteSyncState!: Table<RemoteSyncState>;

    private syncService: any = null;
    private isPurgingTenant = false;
    private isApplyingRemoteChanges = false;

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

        // Legacy rows are intentionally left without a tenant_id and are not
        // visible to signed-in users. An explicit migration can claim only
        // verified legacy data; automatic claim would reintroduce data leaks.
        this.version(4).stores({
            customers: '++id, tenant_id, [tenant_id+created_by], [tenant_id+service_day], created_by, service_day, sort_order, sync_status, convex_id, deleted_at',
            serviceLogs: '++id, tenant_id, [tenant_id+customer_id], [tenant_id+service_date], customer_id, service_date, [customer_id+service_date], sync_status, convex_id, convex_customer_id, deleted_at',
            chemicalUsage: '++id, tenant_id, [tenant_id+customer_id], customer_id, created_date, sync_status, convex_id, convex_customer_id, deleted_at',
            notes: '++id, tenant_id, [tenant_id+customer_id], customer_id, completed, created_date, category, sync_status, convex_id, convex_customer_id, deleted_at',
            saltCellLogs: '++id, tenant_id, [tenant_id+customer_id], customer_id, cleaning_date, sync_status, convex_id, convex_customer_id, deleted_at',
            syncOutbox: '++id, tenant_id, item_key, [tenant_id+item_key], [tenant_id+priority], table, local_id, updated_at',
        });

        this.version(5).stores({
            customers: '++id, tenant_id, [tenant_id+created_by], [tenant_id+service_day], created_by, service_day, sort_order, sync_status, convex_id, deleted_at',
            serviceLogs: '++id, tenant_id, [tenant_id+customer_id], [tenant_id+service_date], customer_id, service_date, [customer_id+service_date], sync_status, convex_id, convex_customer_id, deleted_at',
            chemicalUsage: '++id, tenant_id, [tenant_id+customer_id], customer_id, created_date, sync_status, convex_id, convex_customer_id, deleted_at',
            notes: '++id, tenant_id, [tenant_id+customer_id], customer_id, completed, created_date, category, sync_status, convex_id, convex_customer_id, deleted_at',
            saltCellLogs: '++id, tenant_id, [tenant_id+customer_id], customer_id, cleaning_date, sync_status, convex_id, convex_customer_id, deleted_at',
            syncOutbox: '++id, tenant_id, item_key, [tenant_id+item_key], [tenant_id+priority], table, local_id, updated_at',
            syncConflicts: '++id, tenant_id, [tenant_id+status], [tenant_id+table], [tenant_id+table+local_id], created_at',
            remoteSyncState: '++id, tenant_id, table, [tenant_id+table], updated_at',
        });

        this.setupSyncHooks();
    }

    setSyncService(syncService: any): void {
        this.syncService = syncService;
    }

    async applyRemoteChanges<T>(operation: () => Promise<T>): Promise<T> {
        this.isApplyingRemoteChanges = true;
        try {
            return await operation();
        } finally {
            this.isApplyingRemoteChanges = false;
        }
    }

    private setupSyncHooks(): void {
        this.customers.hook('creating', (_primKey, obj, trans) => {
            if (this.isApplyingRemoteChanges) {
                this.attachTenant(obj);
                return;
            }
            this.attachTenant(obj);
            obj.local_updated_at = Date.now();
            obj.sync_status = 'pending';

            trans.on('complete', () => {
                if (this.syncService && obj.id) {
                    this.syncService.enqueueRecord('customers', obj.id, 'create', obj);
                }
            });
        });

        this.customers.hook('updating', (modifications, primKey, obj, trans) => {
            this.assertTenant(obj);
            if (this.isApplyingRemoteChanges) return;
            // Only trigger sync if non-sync fields are modified
            const isTombstone = Boolean(modifications.deleted_at && !obj.deleted_at);
            if (isTombstone || this.hasNonSyncFieldChanges(modifications)) {
                const updatedRecord = { ...obj, ...modifications };
                updatedRecord.local_updated_at = Date.now();
                updatedRecord.sync_status = 'pending';

                Object.assign(modifications, {
                    local_updated_at: updatedRecord.local_updated_at,
                    sync_status: updatedRecord.sync_status
                });

                trans.on('complete', () => {
                    if (this.syncService && primKey) {
                        this.syncService.enqueueRecord('customers', primKey, isTombstone ? 'delete' : 'update', updatedRecord);
                    }
                });
            }
        });

        this.customers.hook('deleting', (primKey, obj, trans) => {
            if (this.isPurgingTenant) return;
            this.assertTenant(obj);
            trans.on('complete', () => {
                if (this.syncService && primKey) {
                    this.syncService.enqueueRecord('customers', primKey, 'delete', obj);
                }
            });
        });

        this.serviceLogs.hook('creating', (_primKey, obj, trans) => {
            if (this.isApplyingRemoteChanges) {
                this.attachTenant(obj);
                return;
            }
            this.attachTenant(obj);
            obj.local_updated_at = Date.now();
            obj.sync_status = 'pending';

            trans.on('complete', () => {
                if (this.syncService && obj.id) {
                    this.syncService.enqueueRecord('serviceLogs', obj.id, 'create', obj);
                }
            });
        });

        this.serviceLogs.hook('updating', (modifications, primKey, obj, trans) => {
            this.assertTenant(obj);
            if (this.isApplyingRemoteChanges) return;
            const isTombstone = Boolean(modifications.deleted_at && !obj.deleted_at);
            if (isTombstone || this.hasNonSyncFieldChanges(modifications)) {
                const updatedRecord = { ...obj, ...modifications };
                updatedRecord.local_updated_at = Date.now();
                updatedRecord.sync_status = 'pending';

                Object.assign(modifications, {
                    local_updated_at: updatedRecord.local_updated_at,
                    sync_status: updatedRecord.sync_status
                });

                trans.on('complete', () => {
                    if (this.syncService && primKey) {
                        this.syncService.enqueueRecord('serviceLogs', primKey, isTombstone ? 'delete' : 'update', updatedRecord);
                    }
                });
            }
        });

        this.serviceLogs.hook('deleting', (primKey, obj, trans) => {
            if (this.isPurgingTenant) return;
            this.assertTenant(obj);
            trans.on('complete', () => {
                if (this.syncService && primKey) {
                    this.syncService.enqueueRecord('serviceLogs', primKey, 'delete', obj);
                }
            });
        });

        this.chemicalUsage.hook('creating', (_primKey, obj, trans) => {
            if (this.isApplyingRemoteChanges) {
                this.attachTenant(obj);
                return;
            }
            this.attachTenant(obj);
            obj.local_updated_at = Date.now();
            obj.sync_status = 'pending';

            trans.on('complete', () => {
                if (this.syncService && obj.id) {
                    this.syncService.enqueueRecord('chemicalUsage', obj.id, 'create', obj);
                }
            });
        });

        this.chemicalUsage.hook('updating', (modifications, primKey, obj, trans) => {
            this.assertTenant(obj);
            if (this.isApplyingRemoteChanges) return;
            const isTombstone = Boolean(modifications.deleted_at && !obj.deleted_at);
            if (isTombstone || this.hasNonSyncFieldChanges(modifications)) {
                const updatedRecord = { ...obj, ...modifications };
                updatedRecord.local_updated_at = Date.now();
                updatedRecord.sync_status = 'pending';

                Object.assign(modifications, {
                    local_updated_at: updatedRecord.local_updated_at,
                    sync_status: updatedRecord.sync_status
                });

                trans.on('complete', () => {
                    if (this.syncService && primKey) {
                        this.syncService.enqueueRecord('chemicalUsage', primKey, isTombstone ? 'delete' : 'update', updatedRecord);
                    }
                });
            }
        });

        this.chemicalUsage.hook('deleting', (primKey, obj, trans) => {
            if (this.isPurgingTenant) return;
            this.assertTenant(obj);
            trans.on('complete', () => {
                if (this.syncService && primKey) {
                    this.syncService.enqueueRecord('chemicalUsage', primKey, 'delete', obj);
                }
            });
        });

        this.notes.hook('creating', (_primKey, obj, trans) => {
            if (this.isApplyingRemoteChanges) {
                this.attachTenant(obj);
                return;
            }
            this.attachTenant(obj);
            obj.local_updated_at = Date.now();
            obj.sync_status = 'pending';

            trans.on('complete', () => {
                if (this.syncService && obj.id) {
                    this.syncService.enqueueRecord('notes', obj.id, 'create', obj);
                }
            });
        });

        this.notes.hook('updating', (modifications, primKey, obj, trans) => {
            this.assertTenant(obj);
            if (this.isApplyingRemoteChanges) return;
            const isTombstone = Boolean(modifications.deleted_at && !obj.deleted_at);
            if (isTombstone || this.hasNonSyncFieldChanges(modifications)) {
                const updatedRecord = { ...obj, ...modifications };
                updatedRecord.local_updated_at = Date.now();
                updatedRecord.sync_status = 'pending';

                Object.assign(modifications, {
                    local_updated_at: updatedRecord.local_updated_at,
                    sync_status: updatedRecord.sync_status
                });

                trans.on('complete', () => {
                    if (this.syncService && primKey) {
                        this.syncService.enqueueRecord('notes', primKey, isTombstone ? 'delete' : 'update', updatedRecord);
                    }
                });
            }
        });

        this.notes.hook('deleting', (primKey, obj, trans) => {
            if (this.isPurgingTenant) return;
            this.assertTenant(obj);
            trans.on('complete', () => {
                if (this.syncService && primKey) {
                    this.syncService.enqueueRecord('notes', primKey, 'delete', obj);
                }
            });
        });

        this.saltCellLogs.hook('creating', (_primKey, obj, trans) => {
            if (this.isApplyingRemoteChanges) {
                this.attachTenant(obj);
                return;
            }
            this.attachTenant(obj);
            obj.local_updated_at = Date.now();
            obj.sync_status = 'pending';

            trans.on('complete', () => {
                if (this.syncService && obj.id) {
                    this.syncService.enqueueRecord('saltCellLogs', obj.id, 'create', obj);
                }
            });
        });

        this.saltCellLogs.hook('updating', (modifications, primKey, obj, trans) => {
            this.assertTenant(obj);
            if (this.isApplyingRemoteChanges) return;
            const isTombstone = Boolean(modifications.deleted_at && !obj.deleted_at);
            if (isTombstone || this.hasNonSyncFieldChanges(modifications)) {
                const updatedRecord = { ...obj, ...modifications };
                updatedRecord.local_updated_at = Date.now();
                updatedRecord.sync_status = 'pending';

                Object.assign(modifications, {
                    local_updated_at: updatedRecord.local_updated_at,
                    sync_status: updatedRecord.sync_status
                });

                trans.on('complete', () => {
                    if (this.syncService && primKey) {
                        this.syncService.enqueueRecord('saltCellLogs', primKey, isTombstone ? 'delete' : 'update', updatedRecord);
                    }
                });
            }
        });

        this.saltCellLogs.hook('deleting', (primKey, obj, trans) => {
            if (this.isPurgingTenant) return;
            this.assertTenant(obj);
            trans.on('complete', () => {
                if (this.syncService && primKey) {
                    this.syncService.enqueueRecord('saltCellLogs', primKey, 'delete', obj);
                }
            });
        });
    }

    private attachTenant(record: { tenant_id?: string }): void {
        const scope = requireActiveTenantScope();
        if (record.tenant_id && record.tenant_id !== scope.key) {
            throw new Error('Cross-tenant local write blocked');
        }
        record.tenant_id = scope.key;
    }

    private assertTenant(record: { tenant_id?: string } | undefined): void {
        const scope = getActiveTenantScope();
        if (!scope || !record?.tenant_id || record.tenant_id !== scope.key) {
            throw new Error('Cross-tenant local access blocked');
        }
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
            'tenant_id',
            'deleted_at',
            'sync_operation',
        ];

        return Object.keys(modifications).some(key => !syncFields.includes(key));
    }

    async purgeTenant(scopeKey: string): Promise<void> {
        this.isPurgingTenant = true;
        try {
            await this.transaction(
                'rw',
                [this.customers, this.serviceLogs, this.chemicalUsage, this.notes, this.saltCellLogs, this.syncOutbox, this.syncConflicts, this.remoteSyncState],
                async () => {
                    await this.customers.where('tenant_id').equals(scopeKey).delete();
                    await this.serviceLogs.where('tenant_id').equals(scopeKey).delete();
                    await this.chemicalUsage.where('tenant_id').equals(scopeKey).delete();
                    await this.notes.where('tenant_id').equals(scopeKey).delete();
                    await this.saltCellLogs.where('tenant_id').equals(scopeKey).delete();
                    await this.syncOutbox.where('tenant_id').equals(scopeKey).delete();
                    await this.syncConflicts.where('tenant_id').equals(scopeKey).delete();
                    await this.remoteSyncState.where('tenant_id').equals(scopeKey).delete();
                },
            );
        } finally {
            this.isPurgingTenant = false;
        }
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
