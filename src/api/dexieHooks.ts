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

function normalizeOwnerEmail(email: unknown): string {
    return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function getStoredCurrentUser(): { email: string; name: string } {
    try {
        const userData = sessionStorage.getItem('chemcheck_current_user')
            || localStorage.getItem('chemcheck_current_user');
        if (userData) {
            const user = JSON.parse(userData);
            return {
                email: normalizeOwnerEmail(user.email) || DEFAULT_USER,
                name: user.name || 'Local User',
            };
        }
    } catch {
        // A malformed or unavailable browser store falls back to legacy local mode.
    }
    return { email: DEFAULT_USER, name: 'Local User' };
}

function isCustomerInLocalAccount(customer: Customer, ownerEmail: string): boolean {
    const customerOwner = normalizeOwnerEmail(customer.created_by);
    const normalizedOwner = normalizeOwnerEmail(ownerEmail) || DEFAULT_USER;
    return customerOwner === normalizedOwner || customerOwner === DEFAULT_USER;
}

export function filterCustomersForLocalAccount(
    customers: Customer[],
    ownerEmail: string
): Customer[] {
    return customers.filter((customer) => isCustomerInLocalAccount(customer, ownerEmail));
}

async function getCustomersForLocalAccount(ownerEmail: string): Promise<Customer[]> {
    const customers = await db.customers.toArray();
    return filterCustomersForLocalAccount(customers, ownerEmail);
}

/**
 * Ids of the customers visible to the current account. Child records
 * (service logs, chemical usage, notes) carry no owner of their own, so they
 * are scoped through their parent customer exactly like useCustomers.
 */
async function getOwnedCustomerIds(ownerEmail: string): Promise<Set<number>> {
    const customers = await getCustomersForLocalAccount(ownerEmail);
    return new Set(customers.map((customer) => customer.id).filter((id): id is number => typeof id === 'number'));
}

async function isCustomerOwnedByAccount(customerId: number, ownerEmail: string): Promise<boolean> {
    const customer = await db.customers.get(customerId);
    return !!customer && isCustomerInLocalAccount(customer, ownerEmail);
}

export function filterRecordsForLocalAccount<T extends { customer_id?: number }>(
    records: T[],
    ownedCustomerIds: Set<number>,
    options: { allowUnassigned?: boolean } = {}
): T[] {
    return records.filter((record) => {
        if (record.customer_id === undefined || record.customer_id === null) {
            return options.allowUnassigned === true;
        }
        return ownedCustomerIds.has(record.customer_id);
    });
}

export function useCustomers() {
    const user = useCurrentUser();
    const data = useLiveQuery(
        () => measureDatabaseOperation('customers_list', () =>
            getCustomersForLocalAccount(user.email)
        ),
        [user.email],
        []
    );
    return useMemo(() => addIdAliasToArray(data), [data]);
}

export function usePaginatedCustomers(options?: {
    page?: number;
    pageSize?: number;
}) {
    const page = options?.page ?? 0;
    const pageSize = options?.pageSize ?? 50;
    const user = useCurrentUser();

    const data = useLiveQuery(
        () => measureDatabaseOperation('customers_paginated', async () => {
            const customers = await getCustomersForLocalAccount(user.email);
            return customers.slice(page * pageSize, (page + 1) * pageSize);
        }),
        [page, pageSize, user.email],
        []
    );

    return useMemo(() => addIdAliasToArray(data), [data]);
}

export function useCustomerCount() {
    const user = useCurrentUser();
    return useLiveQuery(
        () => measureDatabaseOperation('customers_count', async () =>
            (await getCustomersForLocalAccount(user.email)).length
        ),
        [user.email],
        0
    );
}

export function useCustomersFilter(filters?: { created_by?: string; service_day?: string }) {
    const user = useCurrentUser();
    const ownerEmail = normalizeOwnerEmail(filters?.created_by) || user.email;
    const data = useLiveQuery(
        async () => {
            const customers = await getCustomersForLocalAccount(ownerEmail);

            if (filters?.service_day) {
                return customers.filter(c => c.service_day === filters.service_day);
            }
            return customers;
        },
        [ownerEmail, filters?.service_day],
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
    const user = useCurrentUser();
    const ownerEmail = normalizeOwnerEmail(user.email) || DEFAULT_USER;
    return useCallback(async (data: Omit<Customer, 'id' | 'created_by' | 'createdAt' | 'updatedAt' | keyof SyncableRecord>) => {
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
                isCustomerInLocalAccount(customer, ownerEmail) &&
                customer.service_day === validation.data.service_day
        ).length;

        const sortOrder = validation.data.sort_order ?? sameDayCount;

        const now = getTimestamp();
        const nowMs = Date.now();
        const id = await db.customers.add({
            ...validation.data,
            sort_order: sortOrder,
            created_by: ownerEmail,
            createdAt: now,
            updatedAt: now,
            sync_status: 'pending',
            local_updated_at: nowMs,
        });

        // Canonical normalized model: every new customer starts with one
        // primary pool while legacy customer.pool_* fields remain available
        // during the migration window.
        if (db.pools?.add) await db.pools.add({
            customer_id: id,
            name: 'Primary Pool',
            address: validation.data.address,
            service_day: validation.data.service_day,
            pool_gallons: validation.data.pool_gallons,
            pool_type: validation.data.pool_type,
            surface_type: validation.data.surface_type,
            sort_order: 0,
            active: true,
            createdAt: now,
            updatedAt: now,
            sync_status: 'pending',
            local_updated_at: nowMs,
        });
        return id;
    }, [ownerEmail]);
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
    return useCallback(async (idOrObj: number | { id?: number; _id?: number }) => {
        const id = typeof idOrObj === 'number' ? idOrObj : (idOrObj.id ?? idOrObj._id);
        if (!id) throw new Error('Customer id required');
        await db.customers.delete(id);
    }, []);
}

export function useServiceLogs(order = '-service_date', limit?: number) {
    const user = useCurrentUser();
    const data = useLiveQuery(
        async () => {
            let collection = db.serviceLogs.orderBy('service_date');
            if (order === '-service_date') {
                collection = collection.reverse();
            }
            const ownedCustomerIds = await getOwnedCustomerIds(user.email);
            const logs = filterRecordsForLocalAccount(await collection.toArray(), ownedCustomerIds);
            return limit ? logs.slice(0, limit) : logs;
        },
        [order, limit, user.email],
        []
    );
    return useMemo(() => addIdAliasToArray(data), [data]);
}

export function useServiceLogsFilter(filters?: { customer_id?: number; service_date?: string }) {
    const user = useCurrentUser();
    const data = useLiveQuery(
        async () => {
            if (filters?.customer_id) {
                if (!(await isCustomerOwnedByAccount(filters.customer_id, user.email))) return [];
                return db.serviceLogs.where('customer_id').equals(filters.customer_id).toArray();
            }
            const ownedCustomerIds = await getOwnedCustomerIds(user.email);
            if (filters?.service_date) {
                const logs = await db.serviceLogs.where('service_date').equals(filters.service_date).toArray();
                return filterRecordsForLocalAccount(logs, ownedCustomerIds);
            }
            return filterRecordsForLocalAccount(await db.serviceLogs.toArray(), ownedCustomerIds);
        },
        [filters?.customer_id, filters?.service_date, user.email],
        []
    );
    return useMemo(() => addIdAliasToArray(data), [data]);
}

export function useServiceLogsByCustomer(customerId: number | undefined) {
    const user = useCurrentUser();
    const data = useLiveQuery(
        async () => {
            if (!customerId) return [];
            if (!(await isCustomerOwnedByAccount(customerId, user.email))) return [];
            return db.serviceLogs.where('customer_id').equals(customerId).reverse().toArray();
        },
        [customerId, user.email],
        []
    );

    return useMemo(() => addIdAliasToArray(data), [data]);
}

export function queryServiceLogsByCustomerDateRange(
    customerId: number,
    startDate: string,
    endDate: string,
    limit: number = 1
) {
    const safeLimit = Math.min(25, Math.max(1, Math.trunc(limit || 1)));
    return measureDatabaseOperation('service_logs_customer_date_range', () =>
        db.serviceLogs
            .where('[customer_id+service_date]')
            .between([customerId, startDate], [customerId, endDate], true, true)
            .reverse()
            .limit(safeLimit)
            .toArray()
    );
}

/**
 * Read a small, date-bounded slice of one customer's service history.
 * Uses the compound index so service forms never scan an entire customer
 * history just to show a recent comparison.
 */
export function useServiceLogsByCustomerDateRange(
    customerId: number | undefined,
    startDate: string | undefined,
    endDate: string | undefined,
    limit: number = 1
) {
    const safeLimit = Math.min(25, Math.max(1, Math.trunc(limit || 1)));
    const data = useLiveQuery(
        () => {
            if (!customerId || !startDate || !endDate) return [];
            return queryServiceLogsByCustomerDateRange(customerId, startDate, endDate, safeLimit);
        },
        [customerId, startDate, endDate, safeLimit],
        []
    );

    return useMemo(() => addIdAliasToArray(data), [data]);
}

export function useServiceLogCreate() {
    return useCallback(async (data: Omit<ServiceLog, 'id' | 'createdAt' | 'updatedAt' | keyof SyncableRecord>) => {
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
            createdAt: now,
            updatedAt: now,
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

export function useChemicalUsage(order = '-created_date', limit = 100) {
    const user = useCurrentUser();
    const data = useLiveQuery(
        async () => {
            let collection = db.chemicalUsage.orderBy('created_date');
            if (order === '-created_date') {
                collection = collection.reverse();
            }
            const ownedCustomerIds = await getOwnedCustomerIds(user.email);
            return filterRecordsForLocalAccount(await collection.toArray(), ownedCustomerIds).slice(0, limit);
        },
        [order, limit, user.email],
        []
    );
    return useMemo(() => addIdAliasToArray(data), [data]);
}

export function useChemicalUsageFilter(filters?: { customer_id?: number }) {
    const user = useCurrentUser();
    const data = useLiveQuery(
        async () => {
            if (filters?.customer_id) {
                if (!(await isCustomerOwnedByAccount(filters.customer_id, user.email))) return [];
                return db.chemicalUsage.where('customer_id').equals(filters.customer_id).toArray();
            }
            const ownedCustomerIds = await getOwnedCustomerIds(user.email);
            return filterRecordsForLocalAccount(await db.chemicalUsage.toArray(), ownedCustomerIds);
        },
        [filters?.customer_id, user.email],
        []
    );
    return useMemo(() => addIdAliasToArray(data), [data]);
}

export function useChemicalUsageCreate() {
    return useCallback(async (data: Omit<ChemicalUsage, 'id' | 'created_date' | 'createdAt' | 'updatedAt' | keyof SyncableRecord>) => {
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
            createdAt: now,
            updatedAt: now,
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

/**
 * Account visibility for a note. Customer-linked notes follow their customer
 * (same rule as every other child record). General notes carry their own
 * owner in `created_by`; a note stamped with another account's email is never
 * shown, while legacy rows (no owner, or the pre-auth 'local' owner) stay
 * visible exactly like legacy local customers do.
 */
export function isNoteVisibleToAccount(
    note: Pick<Note, 'customer_id' | 'created_by'>,
    ownerEmail: string,
    ownedCustomerIds: Set<number>
): boolean {
    if (note.customer_id !== undefined && note.customer_id !== null) {
        return ownedCustomerIds.has(note.customer_id);
    }
    const normalizedOwner = normalizeOwnerEmail(ownerEmail) || DEFAULT_USER;
    const noteOwner = normalizeOwnerEmail(note.created_by);
    if (!noteOwner || noteOwner === DEFAULT_USER) return true;
    return noteOwner === normalizedOwner;
}

export function filterNotesForLocalAccount(
    notes: Note[],
    ownerEmail: string,
    ownedCustomerIds: Set<number>
): Note[] {
    return notes.filter((note) => isNoteVisibleToAccount(note, ownerEmail, ownedCustomerIds));
}

export function useNotes(order = '-created_date') {
    const user = useCurrentUser();
    const data = useLiveQuery(
        async () => {
            let collection = db.notes.orderBy('created_date');
            if (order === '-created_date') {
                collection = collection.reverse();
            }
            const ownedCustomerIds = await getOwnedCustomerIds(user.email);
            return filterNotesForLocalAccount(await collection.toArray(), user.email, ownedCustomerIds);
        },
        [order, user.email],
        []
    );
    return useMemo(() => addIdAliasToArray(data), [data]);
}

export function useNotesFilter(filters?: { customer_id?: number; completed?: boolean; category?: string }) {
    const user = useCurrentUser();
    const data = useLiveQuery(
        async () => {
            let notes: Note[] = [];

            if (filters?.customer_id !== undefined) {
                if (!(await isCustomerOwnedByAccount(filters.customer_id, user.email))) return [];
                notes = await db.notes.where('customer_id').equals(filters.customer_id).toArray();
            } else {
                const ownedCustomerIds = await getOwnedCustomerIds(user.email);
                notes = filterNotesForLocalAccount(await db.notes.toArray(), user.email, ownedCustomerIds);
                if (filters?.completed !== undefined) {
                    notes = notes.filter(n => n.completed === filters.completed);
                }
            }

            if (filters?.category) {
                return notes.filter(n => n.category === filters.category);
            }
            return notes;
        },
        [filters?.customer_id, filters?.completed, filters?.category, user.email],
        []
    );
    return useMemo(() => addIdAliasToArray(data), [data]);
}

export function useNoteCreate() {
    const user = useCurrentUser();
    const ownerEmail = normalizeOwnerEmail(user.email) || DEFAULT_USER;
    return useCallback(async (data: Omit<Note, 'id' | 'completed' | 'created_date' | 'created_by' | 'createdAt' | 'updatedAt' | keyof SyncableRecord>) => {
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

        // A customer-linked note must belong to one of this account's customers;
        // otherwise it would be written under another tenant and rejected by
        // the server on sync.
        if (validation.data.customer_id !== undefined &&
            !(await isCustomerOwnedByAccount(validation.data.customer_id, ownerEmail))) {
            throw new Error('Customer not found for this account');
        }

        const now = getTimestamp();
        const nowMs = Date.now();
        const id = await db.notes.add({
            ...validation.data,
            // Owner is stamped at creation so general notes never leak to a
            // different account that later signs in on this device.
            created_by: ownerEmail,
            createdAt: now,
            updatedAt: now,
            sync_status: 'pending',
            local_updated_at: nowMs,
        });
        return id;
    }, [ownerEmail]);
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
    return useCallback(async (idOrObj: number | { id?: number; _id?: number }) => {
        const id = typeof idOrObj === 'number' ? idOrObj : (idOrObj.id ?? idOrObj._id);
        if (!id) throw new Error('Note id required');
        await db.notes.delete(id);
    }, []);
}

/**
 * SECURITY NOTE: This hook provides offline-first user context.
 * In production with proper authentication:
 * - Use Clerk/Auth0 for actual user identity
 * - DEFAULT_USER should NEVER be used for production data access
 * - User email from auth provider should be used for multi-tenant isolation
 * 
 * The DEFAULT_USER constant is DEPRECATED and only kept for backwards
 * compatibility with existing local-only data.
 */
export function useCurrentUser() {
    return useMemo(() => getStoredCurrentUser(), []);
}
