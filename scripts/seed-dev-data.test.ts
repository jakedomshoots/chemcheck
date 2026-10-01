import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChemCheckDB } from '@/db/chemcheck-db';
import { buildSeedDataset, isSeeded, seedDexie, summarizeDataset } from './seed-dev-data';

const TODAY = new Date('2026-10-01T09:00:00'); // a Thursday

describe('buildSeedDataset', () => {
  it('is deterministic for the same options', () => {
    const a = buildSeedDataset({ today: TODAY, owner: 'tech@example.com' });
    const b = buildSeedDataset({ today: TODAY, owner: 'tech@example.com' });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('builds 12 customers across the week with two stops today, pools with equipment and 8 weeks of history', () => {
    const dataset = buildSeedDataset({ today: TODAY, owner: 'tech@example.com' });
    const summary = summarizeDataset(dataset);

    expect(dataset.customers).toHaveLength(12);
    expect(summary.todayServiceDay).toBe('Thursday');
    expect(summary.todayStops.map((stop) => stop.full_name)).toEqual(['Alice Thornton', 'Tobias Lindqvist']);
    expect(new Set(dataset.customers.map((customer) => customer.service_day)).size).toBe(7);
    expect(dataset.customers.every((customer) => customer.created_by === 'tech@example.com')).toBe(true);
    expect(dataset.customers.every((customer) => customer.sync_status === 'synced' && customer.convex_id)).toBe(true);

    // Every customer has a primary pool; every primary pool has a pump and a filter.
    expect(dataset.pools.filter((pool) => pool.name === 'Primary Pool')).toHaveLength(12);
    expect(dataset.pools.length).toBeGreaterThan(12);
    for (const customer of dataset.customers) {
      const primary = dataset.pools.find((pool) => pool.customer_id === customer.id && pool.name === 'Primary Pool')!;
      const types = dataset.equipment.filter((item) => item.pool_id === primary.id).map((item) => item.equipment_type);
      expect(types).toEqual(expect.arrayContaining(['pump', 'filter']));
      if (customer.pool_type === 'Salt') expect(types).toContain('salt cell');
    }

    // 8 visits per customer, all before the current week, all with numeric readings.
    expect(dataset.serviceLogs).toHaveLength(12 * 8);
    const thisWeekMonday = '2026-09-28';
    for (const log of dataset.serviceLogs) {
      expect(log.service_date < thisWeekMonday).toBe(true);
      expect(log.ph_value).toBeGreaterThan(0);
      expect(log.chlorine_value).toBeGreaterThan(0);
      expect(['good', 'low', 'high']).toContain(log.ph);
      expect(log.pool_id).toBeDefined();
      expect(log.duration_ms).toBeGreaterThan(0);
    }
    expect(summary.customers.every((customer) => customer.logCount === 8)).toBe(true);

    expect(dataset.chemicalUsage.length).toBeGreaterThan(20);
    expect(dataset.chemicalUsage.every((usage) => usage.created_date && usage.chemical_type)).toBe(true);

    // General notes carry the owner; customer notes carry the customer.
    const general = dataset.notes.filter((note) => note.customer_id === undefined);
    expect(general).toHaveLength(3);
    expect(dataset.notes.every((note) => note.created_by === 'tech@example.com')).toBe(true);
    expect(dataset.notes.length).toBeGreaterThan(3);

    expect(dataset.saltCellLogs.length).toBe(dataset.customers.filter((customer) => customer.pool_type === 'Salt').length * 2);
  });

  it('respects customerCount and weeks', () => {
    const dataset = buildSeedDataset({ today: TODAY, customerCount: 3, weeks: 2 });
    expect(dataset.customers).toHaveLength(3);
    expect(dataset.serviceLogs).toHaveLength(6);
  });
});

describe('seedDexie', () => {
  let db: ChemCheckDB;

  beforeEach(async () => {
    await Dexie.delete('chemcheck');
    db = new ChemCheckDB();
  });

  afterEach(async () => {
    db.close();
    await Dexie.delete('chemcheck');
  });

  it('writes every table with the given ids and leaves nothing pending', async () => {
    const dataset = buildSeedDataset({ today: TODAY, owner: 'tech@example.com' });
    const summary = await seedDexie(db, dataset);

    expect(await db.customers.count()).toBe(summary.counts.customers);
    expect(await db.pools.count()).toBe(summary.counts.pools);
    expect(await db.equipment.count()).toBe(summary.counts.equipment);
    expect(await db.serviceLogs.count()).toBe(summary.counts.serviceLogs);
    expect(await db.chemicalUsage.count()).toBe(summary.counts.chemicalUsage);
    expect(await db.notes.count()).toBe(summary.counts.notes);
    expect(await db.saltCellLogs.count()).toBe(summary.counts.saltCellLogs);

    expect((await db.customers.get(1))?.full_name).toBe('Alice Thornton');
    expect(await db.serviceLogs.where('sync_status').equals('pending').count()).toBe(0);
    expect(await db.customers.where('sync_status').equals('pending').count()).toBe(0);
    expect(await db.notes.where('created_by').equals('tech@example.com').count()).toBe(summary.counts.notes);
    expect(await isSeeded(db)).toBe(true);
  });

  it('is idempotent when reset is on and additive otherwise', async () => {
    const dataset = buildSeedDataset({ today: TODAY });
    await seedDexie(db, dataset);
    await seedDexie(db, dataset);
    expect(await db.customers.count()).toBe(12);

    await expect(seedDexie(db, dataset, { reset: false })).rejects.toThrow();
    expect(await db.customers.count()).toBe(12);
  });

  it('does not enqueue seeded rows for sync even when a sync service is registered', async () => {
    const enqueued: unknown[] = [];
    db.setSyncService({ enqueueRecord: (...args: unknown[]) => enqueued.push(args) });
    await seedDexie(db, buildSeedDataset({ today: TODAY, customerCount: 2, weeks: 1 }));
    expect(enqueued).toHaveLength(0);
  });
});
