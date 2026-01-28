import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useMemo } from 'react';
import { db, getTodayDate, getTimestamp, DEFAULT_USER } from '@/db/chemcheck-db';
import type { Customer, ServiceLog, ChemicalUsage, Note, SyncableRecord } from '@/db/chemcheck-db';
import {
    validateCustomer,
    validateServiceLog,
    validateChemicalUsage,
    validateNote,
    checkRateLimit
} from '@/lib/validation';
import { measureDatabaseOperation, reportError } from '@/lib/monitoring';

/**
 * Dexie-based hooks - drop-in replacement for Convex hooks
 * These hooks provide the same API surface as the previous Convex hooks
 * 
 * IMPORTANT: All returned records include `_id` as an alias for `id` for 
 * backwards compatibility with code written for Convex.
 */

// Helper to add _id alias to records for Convex compatibility
// Uses a WeakMap to cache transformed objects to prevent infinite re-renders
const idAliasCache = new WeakMap();

function addIdAlias<T extends { id?: number }>(record: T): T & { _id: number } {
    if (!record.id) return record as T & { _id: number };

    // Check cache first
    if (idAliasCache.has(record)) {
        return idAliasCache.get(record);
    }

    // Create new object with _id alias
    const aliased = { ...record, _id: record.id };
    idAliasCache.set(record, aliased);
    return aliased;
}

function addIdAliasToArray<T extends { id?: number }>(records: T[]): (T & { _id: number })[] {
    if (!records) return [];
    return records.map(addIdAlias);
}

// ============================================
// Customer Hooks
// ============================================

export function useCustomers() {
    const data = useLiveQuery(
        () => measureDatabaseOperation('customers_list', () =>
            db.customers.where('created_by').equals(DEFAULT_USER).toArray()
        ),
        [],
        []
    );
    return useMemo(() => addIdAliasToArray(data), [data]);
}

export function useCustomersFilter(filters?: { created_by?: string; service_day?: string }) {
    const data = useLiveQuery(
        async () => {
            let query = db.customers.where('created_by').equals(filters?.created_by || DEFAULT_USER);
            const customers = await query.toArray();

            if (filters?.service_day) {
                return customers.filter(c => c.service_day === filters.service_day);
            }
            return customers;
        },
        [filters?.created_by, filters?.service_day],
        []
    );
    return useMemo(() => addIdAliasToArray(data), [data]);
}

export function useCustomer(id: number | undefined) {
    const data = useLiveQuery(
        () => (id ? db.customers.get(id) : undefined),
        [id],
        undefined
    );
    return useMemo(() => data ? addIdAlias(data) : undefined, [data]);
}

export function useCustomerCreate() {
    return useCallback(async (data: Omit<Customer, 'id' | 'created_by' | 'createdAt' | 'updatedAt' | keyof SyncableRecord>) => {
        // Rate limiting check
        const rateCheck = checkRateLimit('customers');
        if (!rateCheck.allowed) {
            throw new Error(rateCheck.reason);
        }

        // Validate input data
        const validation = validateCustomer(data);
        if (!validation.success) {
            throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
        }

        const now = getTimestamp();
        const nowMs = Date.now();
        const id = await db.customers.add({
            ...validation.data,
            created_by: DEFAULT_USER,
            createdAt: now,
            updatedAt: now,
            // Sync fields
            sync_status: 'pending',
            local_updated_at: nowMs,
        });
        return id;
    }, []);
}

export function useCustomerUpdate() {
    return useCallback(async (data: { id?: number; _id?: number } & Partial<Customer>) => {
        // Support both id and _id for backwards compatibility
        const id = data.id ?? data._id;
        if (!id) throw new Error('Customer id required');

        const { id: _idField, _id: _idAlias, ...updates } = data as any;

        // Validate update data (partial validation)
        if (Object.keys(updates).length > 0) {
            const validation = validateCustomer({ ...updates, full_name: updates.full_name || 'temp', address: updates.address || 'temp', service_day: updates.service_day || 'Monday', pool_type: updates.pool_type || 'Chlorine', surface_type: updates.surface_type || 'Plaster' });
            if (!validation.success) {
                throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
            }
        }

        await db.customers.update(id, {
            ...updates,
            updatedAt: getTimestamp(),
            // Update sync fields
            sync_status: 'pending',
            local_updated_at: Date.now(),
        });
        return id;
    }, []);
}

export function useCustomerDelete() {
    return useCallback(async (idOrObj: number | { id?: number; _id?: number }) => {
        const id = typeof idOrObj === 'number' ? idOrObj : (idOrObj.id ?? idOrObj._id);
        if (!id) throw new Error('Customer id required');
        await db.customers.delete(id);
    }, []);
}

// ============================================
// ServiceLog Hooks
// ============================================

export function useServiceLogs(order = '-service_date', limit?: number) {
    const data = useLiveQuery(
        async () => {
            let collection = db.serviceLogs.orderBy('service_date');
            if (order === '-service_date') {
                collection = collection.reverse();
            }
            return limit ? collection.limit(limit).toArray() : collection.toArray();
        },
        [order, limit],
        []
    );
    return useMemo(() => addIdAliasToArray(data), [data]);
}

export function useServiceLogsFilter(filters?: { customer_id?: number; service_date?: string }) {
    const data = useLiveQuery(
        async () => {
            if (filters?.customer_id) {
                return db.serviceLogs.where('customer_id').equals(filters.customer_id).toArray();
            }
            if (filters?.service_date) {
                return db.serviceLogs.where('service_date').equals(filters.service_date).toArray();
            }
            return db.serviceLogs.toArray();
        },
        [filters?.customer_id, filters?.service_date],
        []
    );
    return useMemo(() => addIdAliasToArray(data), [data]);
}

export function useServiceLogsByCustomer(customerId: number | undefined) {
    const data = useLiveQuery(
        () => customerId
            ? db.serviceLogs.where('customer_id').equals(customerId).reverse().toArray()
            : [],
        [customerId],
        []
    );

    return useMemo(() => addIdAliasToArray(data), [data]);
}

export function useServiceLogCreate() {
    return useCallback(async (data: Omit<ServiceLog, 'id' | 'createdAt' | 'updatedAt' | keyof SyncableRecord>) => {
        // Rate limiting check
        const rateCheck = checkRateLimit('serviceLogs');
        if (!rateCheck.allowed) {
            throw new Error(rateCheck.reason);
        }

        // Validate input data
        const validation = validateServiceLog(data);
        if (!validation.success) {
            throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
        }

        const now = getTimestamp();
        const nowMs = Date.now();
        const id = await db.serviceLogs.add({
            ...validation.data,
            createdAt: now,
            updatedAt: now,
            // Sync fields
            sync_status: 'pending',
            local_updated_at: nowMs,
        });
        return id;
    }, []);
}

export function useServiceLogUpdate() {
    return useCallback(async (data: { id?: number; _id?: number } & Partial<ServiceLog>) => {
        const id = data.id ?? data._id;
        if (!id) throw new Error('ServiceLog id required');

        const { id: _idField, _id: _idAlias, ...updates } = data as any;
        await db.serviceLogs.update(id, {
            ...updates,
            updatedAt: getTimestamp(),
            // Update sync fields
            sync_status: 'pending',
            local_updated_at: Date.now(),
        });
        return id;
    }, []);
}

export function useServiceLogDelete() {
    return useCallback(async (idOrObj: number | { id?: number; _id?: number }) => {
        const id = typeof idOrObj === 'number' ? idOrObj : (idOrObj.id ?? idOrObj._id);
        if (!id) throw new Error('ServiceLog id required');
        await db.serviceLogs.delete(id);
    }, []);
}

// ============================================
// ChemicalUsage Hooks
// ============================================

export function useChemicalUsage(order = '-created_date', limit = 100) {
    const data = useLiveQuery(
        async () => {
            let collection = db.chemicalUsage.orderBy('created_date');
            if (order === '-created_date') {
                collection = collection.reverse();
            }
            return collection.limit(limit).toArray();
        },
        [order, limit],
        []
    );
    return useMemo(() => addIdAliasToArray(data), [data]);
}

export function useChemicalUsageFilter(filters?: { customer_id?: number }) {
    const data = useLiveQuery(
        async () => {
            if (filters?.customer_id) {
                return db.chemicalUsage.where('customer_id').equals(filters.customer_id).toArray();
            }
            return db.chemicalUsage.toArray();
        },
        [filters?.customer_id],
        []
    );
    return useMemo(() => addIdAliasToArray(data), [data]);
}

export function useChemicalUsageCreate() {
    return useCallback(async (data: Omit<ChemicalUsage, 'id' | 'created_date' | 'createdAt' | 'updatedAt' | keyof SyncableRecord>) => {
        // Rate limiting check
        const rateCheck = checkRateLimit('chemicalUsage');
        if (!rateCheck.allowed) {
            throw new Error(rateCheck.reason);
        }

        // Validate input data
        const validation = validateChemicalUsage({
            ...data,
            created_date: getTodayDate(),
        });
        if (!validation.success) {
            throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
        }

        const now = getTimestamp();
        const nowMs = Date.now();
        const id = await db.chemicalUsage.add({
            ...validation.data,
            createdAt: now,
            updatedAt: now,
            // Sync fields
            sync_status: 'pending',
            local_updated_at: nowMs,
        });
        return id;
    }, []);
}

export function useChemicalUsageUpdate() {
    return useCallback(async (data: { id?: number; _id?: number } & Partial<ChemicalUsage>) => {
        const id = data.id ?? data._id;
        if (!id) throw new Error('ChemicalUsage id required');

        const { id: _idField, _id: _idAlias, ...updates } = data as any;
        await db.chemicalUsage.update(id, {
            ...updates,
            updatedAt: getTimestamp(),
            // Update sync fields
            sync_status: 'pending',
            local_updated_at: Date.now(),
        });
        return id;
    }, []);
}

export function useChemicalUsageDelete() {
    return useCallback(async (idOrObj: number | { id?: number; _id?: number }) => {
        const id = typeof idOrObj === 'number' ? idOrObj : (idOrObj.id ?? idOrObj._id);
        if (!id) throw new Error('ChemicalUsage id required');
        await db.chemicalUsage.delete(id);
    }, []);
}

// ============================================
// Note Hooks
// ============================================

export function useNotes(order = '-created_date') {
    const data = useLiveQuery(
        async () => {
            let collection = db.notes.orderBy('created_date');
            if (order === '-created_date') {
                collection = collection.reverse();
            }
            return collection.toArray();
        },
        [order],
        []
    );
    return useMemo(() => addIdAliasToArray(data), [data]);
}

export function useNotesFilter(filters?: { customer_id?: number; completed?: boolean; category?: string }) {
    const data = useLiveQuery(
        async () => {
            let notes: Note[] = [];

            if (filters?.customer_id !== undefined) {
                notes = await db.notes.where('customer_id').equals(filters.customer_id).toArray();
            } else if (filters?.completed !== undefined) {
                notes = await db.notes.where('completed').equals(filters.completed).toArray();
            } else {
                notes = await db.notes.toArray();
            }

            if (filters?.category) {
                return notes.filter(n => n.category === filters.category);
            }
            return notes;
        },
        [filters?.customer_id, filters?.completed, filters?.category],
        []
    );
    return useMemo(() => addIdAliasToArray(data), [data]);
}

export function useNoteCreate() {
    return useCallback(async (data: Omit<Note, 'id' | 'completed' | 'created_date' | 'createdAt' | 'updatedAt' | keyof SyncableRecord>) => {
        // Rate limiting check
        const rateCheck = checkRateLimit('notes');
        if (!rateCheck.allowed) {
            throw new Error(rateCheck.reason);
        }

        // Validate input data
        const validation = validateNote({
            ...data,
            completed: false,
            created_date: getTodayDate(),
        });
        if (!validation.success) {
            throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
        }

        const now = getTimestamp();
        const nowMs = Date.now();
        const id = await db.notes.add({
            ...validation.data,
            createdAt: now,
            updatedAt: now,
            // Sync fields
            sync_status: 'pending',
            local_updated_at: nowMs,
        });
        return id;
    }, []);
}

export function useNoteUpdate() {
    return useCallback(async (data: { id?: number; _id?: number } & Partial<Note>) => {
        const id = data.id ?? data._id;
        if (!id) throw new Error('Note id required');

        const { id: _idField, _id: _idAlias, ...updates } = data as any;
        await db.notes.update(id, {
            ...updates,
            updatedAt: getTimestamp(),
            // Update sync fields
            sync_status: 'pending',
            local_updated_at: Date.now(),
        });
        return id;
    }, []);
}

export function useNoteDelete() {
    return useCallback(async (idOrObj: number | { id?: number; _id?: number }) => {
        const id = typeof idOrObj === 'number' ? idOrObj : (idOrObj.id ?? idOrObj._id);
        if (!id) throw new Error('Note id required');
        await db.notes.delete(id);
    }, []);
}

// ============================================
// User/Auth Hook - Simplified for offline mode
// ============================================

export function useCurrentUser() {
    // For offline-first mode, return the current user from userManager
    // or fall back to the default local user
    return useMemo(() => {
        try {
            const userData = localStorage.getItem('chemcheck_current_user');
            if (userData) {
                const user = JSON.parse(userData);
                return {
                    email: DEFAULT_USER, // Always use DEFAULT_USER for data queries
                    name: user.name || 'Local User'
                };
            }
        } catch (e) {
            // Ignore parse errors
        }
        return {
            email: DEFAULT_USER,
            name: 'Local User'
        };
    }, []);
}
