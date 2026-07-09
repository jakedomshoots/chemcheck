import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useMemo } from 'react';
import { db, getTimestamp } from '@/db/chemcheck-db';
import type { Equipment, Pool } from '@/db/chemcheck-db';

const withAlias = <T extends { id?: number }>(record: T | undefined) => (
  record ? { ...record, _id: record.id } : record
);

export function usePoolsByCustomer(customerId?: number) {
  const pools = useLiveQuery(
    () => customerId ? db.pools.where('customer_id').equals(customerId).toArray() : [],
    [customerId],
    [],
  );
  return useMemo(() => pools.map((pool) => withAlias(pool)), [pools]);
}

export function usePool(poolId?: number) {
  const pool = useLiveQuery(() => poolId ? db.pools.get(poolId) : undefined, [poolId]);
  return useMemo(() => withAlias(pool), [pool]);
}

export function usePoolCreate() {
  return useCallback(async (data: Omit<Pool, 'id' | 'sync_status' | 'local_updated_at'>) => {
    if (!data.name?.trim()) throw new Error('Pool name is required');
    if (!data.service_day?.trim()) throw new Error('Service day is required');
    return db.pools.add({
      ...data,
      name: data.name.trim(),
      sync_status: 'pending',
      local_updated_at: Date.now(),
      createdAt: data.createdAt || getTimestamp(),
      updatedAt: getTimestamp(),
    });
  }, []);
}

export function usePoolUpdate() {
  return useCallback(async (id: number, updates: Partial<Pool>) => {
    if (!id) throw new Error('Pool id required');
    if (updates.name !== undefined && !updates.name.trim()) throw new Error('Pool name is required');
    await db.pools.update(id, {
      ...updates,
      updatedAt: getTimestamp(),
      sync_status: 'pending',
      local_updated_at: Date.now(),
    });
    return id;
  }, []);
}

export function useEquipmentByPool(poolId?: number) {
  const equipment = useLiveQuery(
    () => poolId ? db.equipment.where('pool_id').equals(poolId).toArray() : [],
    [poolId],
    [],
  );
  return useMemo(() => equipment.map((item) => withAlias(item)), [equipment]);
}

export function useEquipmentCreate() {
  return useCallback(async (data: Omit<Equipment, 'id' | 'sync_status' | 'local_updated_at'>) => {
    if (!data.pool_id) throw new Error('Pool id is required');
    if (!data.name?.trim()) throw new Error('Equipment name is required');
    return db.equipment.add({
      ...data,
      name: data.name.trim(),
      equipment_type: data.equipment_type.trim(),
      status: data.status || 'active',
      sync_status: 'pending',
      local_updated_at: Date.now(),
      createdAt: data.createdAt || getTimestamp(),
      updatedAt: getTimestamp(),
    });
  }, []);
}

export function useEquipmentUpdate() {
  return useCallback(async (id: number, updates: Partial<Equipment>) => {
    if (!id) throw new Error('Equipment id required');
    if (updates.name !== undefined && !updates.name.trim()) throw new Error('Equipment name is required');
    await db.equipment.update(id, {
      ...updates,
      updatedAt: getTimestamp(),
      sync_status: 'pending',
      local_updated_at: Date.now(),
    });
    return id;
  }, []);
}
