import 'fake-indexeddb/auto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/chemcheck-db';
import {
  PRICE_CACHE_KEY,
  buildLocalCostSummary,
  cacheChemicalPrices,
  readCachedChemicalPrices,
} from './chemicalCostsLocal';

async function resetDb() {
  await db.withoutSyncHooks(async () => {
    await Promise.all([db.customers.clear(), db.pools.clear(), db.chemicalUsage.clear(), db.serviceLogs.clear()]);
  });
}

describe('chemicalCostsLocal', () => {
  beforeEach(async () => {
    localStorage.clear();
    await resetDb();
  });

  afterAll(async () => {
    await db.close();
  });

  it('round-trips the price cache', () => {
    cacheChemicalPrices([{ chemical_type: 'Liquid Chlorine', unit: 'gal', unit_price: 4.5 }]);
    const cached = readCachedChemicalPrices();
    expect(cached?.prices).toEqual([{ chemical_type: 'Liquid Chlorine', unit: 'gal', unit_price: 4.5, package_size: undefined, package_price: undefined }]);
    expect(cached?.cached_at).toBeTruthy();
    localStorage.setItem(PRICE_CACHE_KEY, '{not json');
    expect(readCachedChemicalPrices()).toBeNull();
  });

  it('rolls up priced usage from device rows within the range', async () => {
    cacheChemicalPrices([{ chemical_type: 'Liquid Chlorine', unit: 'gal', unit_price: 4 }]);
    await db.withoutSyncHooks(async () => {
      const customerId = await db.customers.add({
        full_name: 'Alice Thornton', address: '1 Pool Ln', service_day: 'Monday', pool_type: 'Salt', surface_type: 'Plaster', created_by: 'local',
      } as never);
      const poolId = await db.pools.add({ customer_id: customerId, name: 'Primary Pool', service_day: 'Monday', pool_type: 'Salt', surface_type: 'Plaster', active: true } as never);
      await db.serviceLogs.add({ customer_id: customerId, service_date: '2026-10-01', status: 'completed', ph: 'good', chlorine: 'good', alkalinity: 'good', stabilizer: 'good', created_by: 'tech@example.com' } as never);
      await db.chemicalUsage.add({ customer_id: customerId, pool_id: poolId, chemical_type: 'Liquid Chlorine', quantity: '2 gal', created_date: '2026-10-01' } as never);
      await db.chemicalUsage.add({ customer_id: customerId, pool_id: poolId, chemical_type: 'Mystery Powder', quantity: '1 lb', created_date: '2026-10-01' } as never);
      await db.chemicalUsage.add({ customer_id: customerId, pool_id: poolId, chemical_type: 'Liquid Chlorine', quantity: '1 gal', created_date: '2026-08-01' } as never);
    });

    const summary = await buildLocalCostSummary({ start: '2026-10-01', end: '2026-10-31', topN: 5 });
    expect(summary.source).toBe('device');
    expect(summary.has_prices).toBe(true);
    expect(summary.totals.rows).toBe(2);
    expect(summary.totals.total_cost).toBe(8);
    expect(summary.totals.unpriced_rows).toBe(1);
    expect(summary.unpriced_chemicals).toEqual(['Mystery Powder']);
    expect(summary.top_pools[0]).toMatchObject({ label: expect.stringContaining('Alice'), total_cost: 8 });
    expect(summary.by_technician[0]).toMatchObject({ label: 'tech@example.com', total_cost: 8 });
  });

  it('reports unpriced data when no price list has been cached', async () => {
    await db.withoutSyncHooks(async () => {
      const customerId = await db.customers.add({ full_name: 'Bob', address: '2 Pool Ln', service_day: 'Tuesday', pool_type: 'Chlorine', surface_type: 'Plaster', created_by: 'local' } as never);
      await db.chemicalUsage.add({ customer_id: customerId, chemical_type: 'Liquid Chlorine', quantity: '2 gal', created_date: '2026-10-02' } as never);
    });
    const summary = await buildLocalCostSummary({ start: '2026-10-01', end: '2026-10-31' });
    expect(summary.has_prices).toBe(false);
    expect(summary.price_cached_at).toBeNull();
    expect(summary.totals.total_cost).toBe(0);
    expect(summary.totals.rows).toBe(1);
  });
});
