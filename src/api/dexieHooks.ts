import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { db, getTodayDate, getTimestamp } from '@/db/chemcheck-db';
import type { Customer, ServiceLog, ChemicalUsage, Note, SyncableRecord } from '@/db/chemcheck-db';
import { getActiveTenantScope, subscribeTenantScope } from '@/lib/tenantScope';
import {
    validateCustomer,
    validateServiceLog,
    validateChemicalUsage,
    validateNote,
    checkRateLimit
} from '@/lib/validation';
import { measureDatabaseOperation } from '@/lib/monitoring';

interface CacheEntry<T> {
    value: T;
    timestamp: number;
    key: string;
}

class LRUCacheWithTTL<T> {
    private cache = new Map<string, CacheEntry<T>>();
    private readonly maxSize: number;
    private readonly ttlMs: number;

    constructor(maxSize: number = 1000, ttlMs: number = 5 * 60 * 1000) {
        this.maxSize = maxSize;
        this.ttlMs = ttlMs;
    }

    /**
     * Generate a unique cache key from a record
     * Uses id and a hash of the record content for uniqueness
     * SECURITY: Includes content hash to prevent collisions between different records
     */
    private generateKey(record: { id?: number }): string {
        if (!record.id) return '';
        try {
            const content = JSON.stringify(record);
            let hash = 0;
            for (let i = 0; i < content.length; i++) {
                const char = content.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash = hash & hash;
            }
            return `${record.id}:${hash}`;
        } catch {
            return `${record.id}:0`;
        }
    }

    get(record: { id?: number }): T | undefined {
        const key = this.generateKey(record);
        if (!key) return undefined;

        const entry = this.cache.get(key);
        if (!entry) return undefined;

        if (Date.now() - entry.timestamp > this.ttlMs) {
            this.cache.delete(key);
            return undefined;
        }

        this.cache.delete(key);
        this.cache.set(key, { ...entry, timestamp: Date.now() });

        return entry.value;
    }

    set(record: { id?: number }, value: T): void {
        const key = this.generateKey(record);
        if (!key) return;

        if (this.cache.size >= this.maxSize) {
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey) {
                this.cache.delete(oldestKey);
            }
        }

        this.cache.set(key, {
            value,
            timestamp: Date.now(),
            key,
        });
    }

    has(record: { id?: number }): boolean {
        const key = this.generateKey(record);
        if (!key) return false;

        const entry = this.cache.get(key);
        if (!entry) return false;

        if (Date.now() - entry.timestamp > this.ttlMs) {
            this.cache.delete(key);
            return false;
        }

        return true;
    }

    cleanup(): number {
        const now = Date.now();
        let removed = 0;

        const entries = Array.from(this.cache.entries());
        for (const [key, entry] of entries) {
            if (now - entry.timestamp > this.ttlMs) {
                this.cache.delete(key);
                removed++;
            }
        }

        return removed;
    }

    clear(): void {
        this.cache.clear();
    }

    get size(): number {
        return this.cache.size;
    }

    destroy(): void {
        this.cache.clear();
    }
}

const idAliasCache = new LRUCacheWithTTL<any>(1000, 5 * 60 * 1000);

let cacheCleanupIntervalId: ReturnType<typeof setInterval> | null = null;
let visibilityCleanupRegistered = false;
let cacheLifecycleInitialized = false;

export function startCacheCleanup(): void {
    if (cacheCleanupIntervalId) return;
    cacheCleanupIntervalId = setInterval(() => {
        idAliasCache.cleanup();
    }, 60 * 1000);
}

export function stopCacheCleanup(): void {
    if (!cacheCleanupIntervalId) return;
    clearInterval(cacheCleanupIntervalId);
    cacheCleanupIntervalId = null;
}

export function registerVisibilityCleanup(): void {
    if (visibilityCleanupRegistered || typeof document === 'undefined') return;
    visibilityCleanupRegistered = true;

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            idAliasCache.cleanup();
            stopCacheCleanup();
        } else {
            startCacheCleanup();
        }
    });
}

export function initializeCacheLifecycle(): void {
    if (cacheLifecycleInitialized) return;
    cacheLifecycleInitialized = true;
    registerVisibilityCleanup();
    startCacheCleanup();
}

function addIdAlias<T extends { id?: number }>(record: T): T & { _id: number } {
    if (!record || typeof record !== 'object' || record === null) {
        return record as T & { _id: number };
    }

    if (!record.id || typeof record.id !== 'number') {
        return record as T & { _id: number };
    }

    if (idAliasCache.has(record)) {
        return idAliasCache.get(record)!;
    }

    const aliased = { ...record, _id: record.id };
    idAliasCache.set(record, aliased);
    return aliased;
}

function addIdAliasToArray<T extends { id?: number }>(records: T[]): (T & { _id: number })[] {
    if (!records) return [];
    return records.map(addIdAlias);
}

export function useTenantScope() {
    return useSyncExternalStore(
        subscribeTenantScope,
        getActiveTenantScope,
        () => null,
    );
}

function isVisibleToTenant<T extends { tenant_id?: string; deleted_at?: number }>(record: T | undefined, tenantId: string): record is T {
    return Boolean(record && record.tenant_id === tenantId && !record.deleted_at);
}

export function useCustomers() {
    const tenant = useTenantScope();
    const data = useLiveQuery(
        () => !tenant ? [] : measureDatabaseOperation('customers_list', async () =>
            (await db.customers.where('[tenant_id+created_by]').equals([tenant.key, tenant.userEmail]).toArray())
                .filter(customer => !customer.deleted_at)
        ),
        [tenant?.key, tenant?.userEmail],
        []
    );
    return useMemo(() => addIdAliasToArray(data), [data]);
}

export function usePaginatedCustomers(options?: {
    page?: number;
    pageSize?: number;
}) {
    const tenant = useTenantScope();
    const page = options?.page ?? 0;
    const pageSize = options?.pageSize ?? 50;

    const data = useLiveQuery(
        () => !tenant ? [] : measureDatabaseOperation('customers_paginated', () =>
            db.customers
                .where('[tenant_id+created_by]').equals([tenant.key, tenant.userEmail])
                .filter(customer => !customer.deleted_at)
                .offset(page * pageSize)
                .limit(pageSize)
                .toArray()
        ),
        [tenant?.key, tenant?.userEmail, page, pageSize],
        []
    );

    return useMemo(() => addIdAliasToArray(data), [data]);
}

export function useCustomerCount() {
    const tenant = useTenantScope();
    return useLiveQuery(
        () => !tenant ? 0 : measureDatabaseOperation('customers_count', async () =>
            (await db.customers.where('[tenant_id+created_by]').equals([tenant.key, tenant.userEmail]).toArray())
                .filter(customer => !customer.deleted_at).length
        ),
        [tenant?.key, tenant?.userEmail],
        0
    );
}

export function useCustomersFilter(filters?: { created_by?: string; service_day?: string }) {
    const tenant = useTenantScope();
    const data = useLiveQuery(
        async () => {
            if (!tenant) return [];
            const requestedEmail = filters?.created_by?.trim().toLowerCase();
            if (requestedEmail && requestedEmail !== tenant.userEmail) return [];
            let query = db.customers.where('[tenant_id+created_by]').equals([tenant.key, tenant.userEmail]);
            const customers = await query.toArray();

            if (filters?.service_day) {
                return customers.filter(c => c.service_day === filters.service_day);
            }
            return customers.filter(customer => !customer.deleted_at);
        },
        [tenant?.key, tenant?.userEmail, filters?.created_by, filters?.service_day],
        []
    );
    return useMemo(() => addIdAliasToArray(data), [data]);
}

export function useCustomer(id: number | undefined) {
    const tenant = useTenantScope();
    const data = useLiveQuery(
        async () => {
            if (!id || !tenant) return undefined;
            const customer = await db.customers.get(id);
            return isVisibleToTenant(customer, tenant.key) ? customer : undefined;
        },
        [tenant?.key, id],
        undefined
    );
    return useMemo(() => data ? addIdAlias(data) : undefined, [data]);
}

export function useCustomerCreate() {
    const tenant = useTenantScope();
    return useCallback(async (data: Omit<Customer, 'id' | 'created_by' | 'createdAt' | 'updatedAt' | keyof SyncableRecord>) => {
        if (!tenant) throw new Error('No authenticated tenant is active');
        const rateCheck = checkRateLimit('customers');
        if (!rateCheck.allowed) {
            throw new Error(rateCheck.reason);
        }

        const validation = validateCustomer(data);
        if (!validation.success) {
            throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
        }

        const existingCustomers = await db.customers.toArray();
        const sameDayCount = existingCustomers.filter(
            (customer) =>
                customer.tenant_id === tenant.key &&
                customer.created_by === tenant.userEmail &&
                !customer.deleted_at &&
                customer.service_day === validation.data.service_day
        ).length;

        const sortOrder = validation.data.sort_order ?? sameDayCount;

        const now = getTimestamp();
        const nowMs = Date.now();
        const id = await db.customers.add({
            ...validation.data,
            sort_order: sortOrder,
            tenant_id: tenant.key,
            created_by: tenant.userEmail,
            createdAt: now,
            updatedAt: now,
            sync_status: 'pending',
            local_updated_at: nowMs,
        });
        return id;
    }, [tenant]);
}

export function useCustomerUpdate() {
    return useCallback(async (data: { id?: number; _id?: number } & Partial<Customer>) => {
        const id = data.id ?? data._id;
        if (!id) throw new Error('Customer id required');

        const { id: _idField, _id: _idAlias, ...updates } = data as any;

        const updatableFields = ['full_name', 'address', 'phone', 'email', 'gate_code',
            'service_day', 'pool_gallons', 'pool_type', 'surface_type', 'sort_order'];
        const changedFields = Object.keys(updates).filter(key => updatableFields.includes(key));

        if (changedFields.length > 0) {
            for (const field of changedFields) {
                const value = updates[field];

                if ((field === 'full_name' || field === 'address') &&
                    (value === '' || value === null || value === undefined)) {
                    throw new Error(`Validation failed: ${field} cannot be empty`);
                }

                if (field === 'service_day' && value &&
                    !['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].includes(value)) {
                    throw new Error(`Validation failed: invalid service_day`);
                }
                if (field === 'pool_type' && value && !['Salt', 'Chlorine'].includes(value)) {
                    throw new Error(`Validation failed: invalid pool_type`);
                }
                if (field === 'surface_type' && value &&
                    !['Plaster', 'Vinyl', 'Fiberglass', 'Tile'].includes(value)) {
                    throw new Error(`Validation failed: invalid surface_type`);
                }
            }
        }

        await db.customers.update(id, {
            ...updates,
            updatedAt: getTimestamp(),
            sync_status: 'pending',
            local_updated_at: Date.now(),
        });
        return id;
    }, []);
}

export function useCustomerDelete() {
    const tenant = useTenantScope();
    return useCallback(async (idOrObj: number | { id?: number; _id?: number }) => {
        const id = typeof idOrObj === 'number' ? idOrObj : (idOrObj.id ?? idOrObj._id);
        if (!id) throw new Error('Customer id required');
        if (!tenant) throw new Error('No authenticated tenant is active');
        const customer = await db.customers.get(id);
        if (!isVisibleToTenant(customer, tenant.key)) throw new Error('Customer not found or access denied');
        await db.customers.update(id, {
            deleted_at: Date.now(),
            sync_status: 'pending',
            sync_operation: 'delete',
            local_updated_at: Date.now(),
        });
    }, [tenant]);
}

export function useServiceLogs(order = '-service_date', limit?: number) {
    const tenant = useTenantScope();
    const data = useLiveQuery(
        async () => {
            if (!tenant) return [];
            let collection = db.serviceLogs
                .where('tenant_id').equals(tenant.key)
                .filter(log => !log.deleted_at)
                .sortBy('service_date');
            if (order === '-service_date') return limit ? collection.reverse().slice(0, limit) : collection.reverse();
            return limit ? collection.slice(0, limit) : collection;
        },
        [tenant?.key, order, limit],
        []
    );
    return useMemo(() => addIdAliasToArray(data), [data]);
}

export function useServiceLogsFilter(filters?: { customer_id?: number; service_date?: string }) {
    const tenant = useTenantScope();
    const data = useLiveQuery(
        async () => {
            if (!tenant) return [];
            if (filters?.customer_id) {
                return (await db.serviceLogs.where('[tenant_id+customer_id]').equals([tenant.key, filters.customer_id]).toArray())
                    .filter(log => !log.deleted_at);
            }
            if (filters?.service_date) {
                return (await db.serviceLogs.where('[tenant_id+service_date]').equals([tenant.key, filters.service_date]).toArray())
                    .filter(log => !log.deleted_at);
            }
            return (await db.serviceLogs.where('tenant_id').equals(tenant.key).toArray()).filter(log => !log.deleted_at);
        },
        [tenant?.key, filters?.customer_id, filters?.service_date],
        []
    );
    return useMemo(() => addIdAliasToArray(data), [data]);
}

export function useServiceLogsByCustomer(customerId: number | undefined) {
    const tenant = useTenantScope();
    const data = useLiveQuery(
        async () => tenant && customerId
            ? (await db.serviceLogs.where('[tenant_id+customer_id]').equals([tenant.key, customerId]).toArray())
                .filter(log => !log.deleted_at).reverse()
            : [],
        [tenant?.key, customerId],
        []
    );

    return useMemo(() => addIdAliasToArray(data), [data]);
}

export function useServiceLogCreate() {
    const tenant = useTenantScope();
    return useCallback(async (data: Omit<ServiceLog, 'id' | 'createdAt' | 'updatedAt' | keyof SyncableRecord>) => {
        if (!tenant) throw new Error('No authenticated tenant is active');
        const rateCheck = checkRateLimit('serviceLogs');
        if (!rateCheck.allowed) {
            throw new Error(rateCheck.reason);
        }

        const validation = validateServiceLog(data);
        if (!validation.success) {
            throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
        }

        const now = getTimestamp();
        const nowMs = Date.now();
        const id = await db.serviceLogs.add({
            ...validation.data,
            tenant_id: tenant.key,
            createdAt: now,
            updatedAt: now,
            sync_status: 'pending',
            local_updated_at: nowMs,
        });
        return id;
    }, [tenant]);
}

export function useServiceLogUpdate() {
    return useCallback(async (data: { id?: number; _id?: number } & Partial<ServiceLog>) => {
        const id = data.id ?? data._id;
        if (!id) throw new Error('ServiceLog id required');

        const { id: _idField, _id: _idAlias, ...updates } = data as any;
        await db.serviceLogs.update(id, {
            ...updates,
            updatedAt: getTimestamp(),
            sync_status: 'pending',
            local_updated_at: Date.now(),
        });
        return id;
    }, []);
}

export function useServiceLogDelete() {
    const tenant = useTenantScope();
    return useCallback(async (idOrObj: number | { id?: number; _id?: number }) => {
        const id = typeof idOrObj === 'number' ? idOrObj : (idOrObj.id ?? idOrObj._id);
        if (!id) throw new Error('ServiceLog id required');
        if (!tenant) throw new Error('No authenticated tenant is active');
        const record = await db.serviceLogs.get(id);
        if (!isVisibleToTenant(record, tenant.key)) throw new Error('Service log not found or access denied');
        await db.serviceLogs.update(id, {
            deleted_at: Date.now(), sync_status: 'pending', sync_operation: 'delete', local_updated_at: Date.now(),
        });
    }, [tenant]);
}

export function useChemicalUsage(order = '-created_date', limit = 100) {
    const tenant = useTenantScope();
    const data = useLiveQuery(
        async () => {
            if (!tenant) return [];
            const records = (await db.chemicalUsage.where('tenant_id').equals(tenant.key).toArray())
                .filter(record => !record.deleted_at)
                .sort((a, b) => String(a.created_date || '').localeCompare(String(b.created_date || '')));
            return (order === '-created_date' ? records.reverse() : records).slice(0, limit);
        },
        [tenant?.key, order, limit],
        []
    );
    return useMemo(() => addIdAliasToArray(data), [data]);
}

export function useChemicalUsageFilter(filters?: { customer_id?: number }) {
    const tenant = useTenantScope();
    const data = useLiveQuery(
        async () => {
            if (!tenant) return [];
            if (filters?.customer_id) {
                return (await db.chemicalUsage.where('[tenant_id+customer_id]').equals([tenant.key, filters.customer_id]).toArray())
                    .filter(record => !record.deleted_at);
            }
            return (await db.chemicalUsage.where('tenant_id').equals(tenant.key).toArray()).filter(record => !record.deleted_at);
        },
        [tenant?.key, filters?.customer_id],
        []
    );
    return useMemo(() => addIdAliasToArray(data), [data]);
}

export function useChemicalUsageCreate() {
    const tenant = useTenantScope();
    return useCallback(async (data: Omit<ChemicalUsage, 'id' | 'created_date' | 'createdAt' | 'updatedAt' | keyof SyncableRecord>) => {
        if (!tenant) throw new Error('No authenticated tenant is active');
        const rateCheck = checkRateLimit('chemicalUsage');
        if (!rateCheck.allowed) {
            throw new Error(rateCheck.reason);
        }

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
            tenant_id: tenant.key,
            createdAt: now,
            updatedAt: now,
            sync_status: 'pending',
            local_updated_at: nowMs,
        });
        return id;
    }, [tenant]);
}

export function useChemicalUsageUpdate() {
    return useCallback(async (data: { id?: number; _id?: number } & Partial<ChemicalUsage>) => {
        const id = data.id ?? data._id;
        if (!id) throw new Error('ChemicalUsage id required');

        const { id: _idField, _id: _idAlias, ...updates } = data as any;
        await db.chemicalUsage.update(id, {
            ...updates,
            updatedAt: getTimestamp(),
            sync_status: 'pending',
            local_updated_at: Date.now(),
        });
        return id;
    }, []);
}

export function useChemicalUsageDelete() {
    const tenant = useTenantScope();
    return useCallback(async (idOrObj: number | { id?: number; _id?: number }) => {
        const id = typeof idOrObj === 'number' ? idOrObj : (idOrObj.id ?? idOrObj._id);
        if (!id) throw new Error('ChemicalUsage id required');
        if (!tenant) throw new Error('No authenticated tenant is active');
        const record = await db.chemicalUsage.get(id);
        if (!isVisibleToTenant(record, tenant.key)) throw new Error('Chemical usage not found or access denied');
        await db.chemicalUsage.update(id, {
            deleted_at: Date.now(), sync_status: 'pending', sync_operation: 'delete', local_updated_at: Date.now(),
        });
    }, [tenant]);
}

export function useNotes(order = '-created_date') {
    const tenant = useTenantScope();
    const data = useLiveQuery(
        async () => {
            if (!tenant) return [];
            const records = (await db.notes.where('tenant_id').equals(tenant.key).toArray())
                .filter(note => !note.deleted_at)
                .sort((a, b) => String(a.created_date || '').localeCompare(String(b.created_date || '')));
            return order === '-created_date' ? records.reverse() : records;
        },
        [tenant?.key, order],
        []
    );
    return useMemo(() => addIdAliasToArray(data), [data]);
}

export function useNotesFilter(filters?: { customer_id?: number; completed?: boolean; category?: string }) {
    const tenant = useTenantScope();
    const data = useLiveQuery(
        async () => {
            if (!tenant) return [];
            let notes: Note[] = [];

            if (filters?.customer_id !== undefined) {
                notes = await db.notes.where('[tenant_id+customer_id]').equals([tenant.key, filters.customer_id]).toArray();
            } else if (filters?.completed !== undefined) {
                notes = (await db.notes.where('tenant_id').equals(tenant.key).toArray()).filter(n => n.completed === filters.completed);
            } else {
                notes = await db.notes.where('tenant_id').equals(tenant.key).toArray();
            }

            notes = notes.filter(note => !note.deleted_at);

            if (filters?.category) {
                return notes.filter(n => n.category === filters.category);
            }
            return notes;
        },
        [tenant?.key, filters?.customer_id, filters?.completed, filters?.category],
        []
    );
    return useMemo(() => addIdAliasToArray(data), [data]);
}

export function useNoteCreate() {
    const tenant = useTenantScope();
    return useCallback(async (data: Omit<Note, 'id' | 'completed' | 'created_date' | 'createdAt' | 'updatedAt' | keyof SyncableRecord>) => {
        if (!tenant) throw new Error('No authenticated tenant is active');
        const rateCheck = checkRateLimit('notes');
        if (!rateCheck.allowed) {
            throw new Error(rateCheck.reason);
        }

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
            tenant_id: tenant.key,
            createdAt: now,
            updatedAt: now,
            sync_status: 'pending',
            local_updated_at: nowMs,
        });
        return id;
    }, [tenant]);
}

export function useNoteUpdate() {
    return useCallback(async (data: { id?: number; _id?: number } & Partial<Note>) => {
        const id = data.id ?? data._id;
        if (!id) throw new Error('Note id required');

        const { id: _idField, _id: _idAlias, ...updates } = data as any;
        await db.notes.update(id, {
            ...updates,
            updatedAt: getTimestamp(),
            sync_status: 'pending',
            local_updated_at: Date.now(),
        });
        return id;
    }, []);
}

export function useNoteDelete() {
    const tenant = useTenantScope();
    return useCallback(async (idOrObj: number | { id?: number; _id?: number }) => {
        const id = typeof idOrObj === 'number' ? idOrObj : (idOrObj.id ?? idOrObj._id);
        if (!id) throw new Error('Note id required');
        if (!tenant) throw new Error('No authenticated tenant is active');
        const record = await db.notes.get(id);
        if (!isVisibleToTenant(record, tenant.key)) throw new Error('Note not found or access denied');
        await db.notes.update(id, {
            deleted_at: Date.now(), sync_status: 'pending', sync_operation: 'delete', local_updated_at: Date.now(),
        });
    }, [tenant]);
}

/** Clerk-authenticated tenant identity for legacy callers that need display data. */
export function useCurrentUser() {
    const tenant = useTenantScope();
    return useMemo(() => ({
        email: tenant?.userEmail || '',
        name: tenant?.userEmail || 'Unauthenticated user',
    }), [tenant?.userEmail]);
}
