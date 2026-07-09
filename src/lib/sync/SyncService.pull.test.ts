import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from '@/db/chemcheck-db';
import { clearActiveTenantScope, setActiveTenantScope } from '@/lib/tenantScope';
import { SyncService } from './SyncService';

const tenant = { userEmail: 'sync-pull@chemcheck.test', businessId: 'sync_pull_business' };

function remoteCustomer(overrides: Record<string, unknown> = {}) {
  return {
    _id: 'cloud-customer-1',
    full_name: 'Cloud Customer',
    address: '100 Cloud Lane',
    service_day: 'Monday',
    pool_type: 'Chlorine',
    surface_type: 'Plaster',
    created_by: tenant.userEmail,
    business_id: tenant.businessId,
    created_at: 400,
    updated_at: 400,
    ...overrides,
  };
}

describe('SyncService remote pull and conflicts', () => {
  beforeEach(async () => {
    setActiveTenantScope(tenant);
    await db.open();
    await db.purgeTenant('sync_pull_business:sync-pull@chemcheck.test');
  });

  afterEach(async () => {
    await db.purgeTenant('sync_pull_business:sync-pull@chemcheck.test');
    clearActiveTenantScope();
  });

  it('pulls a cloud customer into the active tenant without enqueueing it for upload', async () => {
    const query = vi.fn(async (_api, args) => ({
      records: args.table === 'customers' ? [remoteCustomer()] : [],
      tombstones: [],
      has_more: false,
    }));
    const service = new SyncService();
    service.initialize({ query } as any);

    const pulled = await (service as any).pullRemoteChanges();
    const customer = await db.customers.where('convex_id').equals('cloud-customer-1').first();

    expect(pulled).toBe(1);
    expect(customer).toMatchObject({
      full_name: 'Cloud Customer',
      sync_status: 'synced',
      tenant_id: 'sync_pull_business:sync-pull@chemcheck.test',
      remote_updated_at: 400,
    });
    expect(query).toHaveBeenCalledTimes(5);
    service.destroy();
  });

  it('keeps both versions until the technician explicitly chooses device or cloud', async () => {
    let localId = 0;
    await db.applyRemoteChanges(async () => {
      localId = await db.customers.add({
        tenant_id: 'sync_pull_business:sync-pull@chemcheck.test',
        convex_id: 'cloud-customer-1',
        sync_status: 'pending',
        local_updated_at: 300,
        remote_updated_at: 100,
        full_name: 'Device Customer',
        address: '100 Cloud Lane',
        service_day: 'Monday',
        pool_type: 'Chlorine',
        surface_type: 'Plaster',
        created_by: tenant.userEmail,
      });
    });
    const service = new SyncService();
    const applied = await (service as any).applyRemoteRecord('customers', remoteCustomer({ updated_at: 400 }), false);
    const conflict = (await service.getOpenConflicts())[0];

    expect(applied).toBe(false);
    expect(conflict).toMatchObject({ table: 'customers', local_id: localId, status: 'open' });
    expect((await db.customers.get(localId))?.full_name).toBe('Device Customer');

    await service.resolveConflict(conflict.id!, 'remote');

    expect((await db.customers.get(localId))).toMatchObject({ full_name: 'Cloud Customer', sync_status: 'synced' });
    expect((await db.syncConflicts.get(conflict.id!))?.status).toBe('resolved_remote');
    service.destroy();
  });
});
