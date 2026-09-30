import { describe, it, expect, vi } from 'vitest';
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { ChemCheckDB } from './chemcheck-db';
import type { Customer, ServiceLog, ChemicalUsage, Note, SyncableRecord } from './chemcheck-db';

describe('ChemCheckDB Schema and Sync Fields', () => {
  it('should define all required tables', () => {
    const db = new ChemCheckDB();
    
    // Test that all tables are defined in the schema
    expect(db.customers).toBeDefined();
    expect(db.pools).toBeDefined();
    expect(db.equipment).toBeDefined();
    expect(db.serviceLogs).toBeDefined();
    expect(db.chemicalUsage).toBeDefined();
    expect(db.notes).toBeDefined();
  });

  it('should have SyncableRecord interface with all required fields', () => {
    // Test that SyncableRecord interface has all required sync fields
    const syncableRecord: SyncableRecord = {
      sync_status: 'pending',
      local_updated_at: Date.now(),
    };

    // Optional fields should be allowed
    const fullSyncableRecord: SyncableRecord = {
      convex_id: 'test-id',
      sync_status: 'synced',
      sync_error: 'test error',
      local_updated_at: Date.now(),
      remote_updated_at: Date.now(),
      conflict_backup: '{"test": "data"}',
    };

    expect(syncableRecord.sync_status).toBe('pending');
    expect(syncableRecord.local_updated_at).toBeTypeOf('number');
    expect(fullSyncableRecord.convex_id).toBe('test-id');
    expect(fullSyncableRecord.sync_error).toBe('test error');
    expect(fullSyncableRecord.remote_updated_at).toBeTypeOf('number');
    expect(fullSyncableRecord.conflict_backup).toBe('{"test": "data"}');
  });

  it('should have Customer interface extending SyncableRecord', () => {
    const customer: Customer = {
      full_name: 'Test Customer',
      address: '123 Test St',
      service_day: 'Monday',
      pool_type: 'Chlorine',
      surface_type: 'Plaster',
      created_by: 'test-user',
      // SyncableRecord fields
      sync_status: 'pending',
      local_updated_at: Date.now(),
      convex_id: 'test-convex-id',
    };

    expect(customer.full_name).toBe('Test Customer');
    expect(customer.sync_status).toBe('pending');
    expect(customer.convex_id).toBe('test-convex-id');
  });

  it('should have ServiceLog interface extending SyncableRecord', () => {
    const serviceLog: ServiceLog = {
      customer_id: 1,
      service_date: '2024-01-15',
      status: 'completed',
      ph: 'good',
      chlorine: 'good',
      alkalinity: 'good',
      stabilizer: 'good',
      // SyncableRecord fields
      sync_status: 'pending',
      local_updated_at: Date.now(),
      convex_customer_id: 'test-customer-id',
    };

    expect(serviceLog.customer_id).toBe(1);
    expect(serviceLog.sync_status).toBe('pending');
    expect(serviceLog.convex_customer_id).toBe('test-customer-id');
  });

  it('should have ChemicalUsage interface extending SyncableRecord', () => {
    const chemicalUsage: ChemicalUsage = {
      customer_id: 1,
      chemical_type: 'Chlorine',
      quantity: '2 lbs',
      created_date: '2024-01-15',
      // SyncableRecord fields
      sync_status: 'pending',
      local_updated_at: Date.now(),
      convex_customer_id: 'test-customer-id',
    };

    expect(chemicalUsage.customer_id).toBe(1);
    expect(chemicalUsage.sync_status).toBe('pending');
    expect(chemicalUsage.convex_customer_id).toBe('test-customer-id');
  });

  it('should have Note interface extending SyncableRecord', () => {
    const note: Note = {
      title: 'Test Note',
      content: 'This is a test note',
      category: 'General',
      priority: 'medium',
      created_date: '2024-01-15',
      // SyncableRecord fields
      sync_status: 'pending',
      local_updated_at: Date.now(),
      convex_customer_id: 'test-customer-id',
    };

    expect(note.title).toBe('Test Note');
    expect(note.sync_status).toBe('pending');
    expect(note.convex_customer_id).toBe('test-customer-id');
  });

  it('should support all sync_status values', () => {
    const pendingRecord: SyncableRecord = {
      sync_status: 'pending',
      local_updated_at: Date.now(),
    };

    const syncedRecord: SyncableRecord = {
      sync_status: 'synced',
      local_updated_at: Date.now(),
    };

    const errorRecord: SyncableRecord = {
      sync_status: 'error',
      local_updated_at: Date.now(),
      sync_error: 'Network timeout',
    };

    expect(pendingRecord.sync_status).toBe('pending');
    expect(syncedRecord.sync_status).toBe('synced');
    expect(errorRecord.sync_status).toBe('error');
    expect(errorRecord.sync_error).toBe('Network timeout');
  });

  it('should have latest database version with sync field indexes', () => {
    const db = new ChemCheckDB();
    
    // Schema includes v4 normalized pools/equipment tables.
    expect(db.verno).toBe(4);
  });

  it('registers blocked/versionchange handlers and reports open failures instead of hanging', async () => {
    const db = new ChemCheckDB();
    const on: any = db.on as any;
    expect(on.blocked.subscribers.length).toBeGreaterThanOrEqual(1);
    expect(on.versionchange.subscribers.length).toBeGreaterThanOrEqual(1);

    const openSpy = vi.spyOn(db, 'open').mockRejectedValueOnce(Object.assign(new Error('nope'), { name: 'VersionError' }));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(db.ensureOpen()).resolves.toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('VersionError'), expect.any(Error));
    openSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe('ChemCheckDB v4 upgrade', () => {
  it('backfills one primary pool per legacy customer in a single bulk write', async () => {
    await Dexie.delete('chemcheck');
    const legacy = new Dexie('chemcheck');
    legacy.version(3).stores({
      customers: '++id, created_by, service_day, sort_order, sync_status, convex_id, [created_by+service_day]',
      serviceLogs: '++id, customer_id, service_date, [customer_id+service_date], sync_status, convex_id, convex_customer_id',
      chemicalUsage: '++id, customer_id, created_date, sync_status, convex_id, convex_customer_id',
      notes: '++id, customer_id, completed, created_date, category, sync_status, convex_id, convex_customer_id',
      saltCellLogs: '++id, customer_id, cleaning_date, sync_status, convex_id, convex_customer_id',
    });
    await legacy.open();
    await legacy.table('customers').bulkAdd([
      { full_name: 'A', address: '1 Main', service_day: 'Monday', pool_type: 'Chlorine', surface_type: 'Plaster', created_by: 'me', sync_status: 'synced', local_updated_at: 1 },
      { full_name: 'B', address: '2 Main', service_day: 'Tuesday', pool_type: 'Salt', surface_type: 'Pebble', created_by: 'me', sync_status: 'synced', local_updated_at: 1 },
    ]);
    legacy.close();

    const db = new ChemCheckDB();
    try {
      await expect(db.ensureOpen()).resolves.toBe(true);
      expect(db.verno).toBe(4);
      const pools = await db.pools.toArray();
      expect(pools).toHaveLength(2);
      expect(pools.map((pool) => pool.customer_id).sort()).toEqual([1, 2]);
      expect(pools[0]).toMatchObject({ name: 'Primary Pool', active: true, sync_status: 'pending' });
    } finally {
      db.close();
      await Dexie.delete('chemcheck');
    }
  });
});
