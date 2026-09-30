import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';

const localRows = vi.hoisted(() => ({
  customers: new Map<number, any>(),
  serviceLogs: new Map<number, any>(),
}));

vi.mock('@/db/chemcheck-db', () => ({
  db: {
    customers: { get: vi.fn(async (id: number) => localRows.customers.get(id)) },
    serviceLogs: { get: vi.fn(async (id: number) => localRows.serviceLogs.get(id)) },
  },
}));

import {
  clearAllPhotos,
  enforceStorageLimits,
  getFailedPhotos,
  getPendingPhotos,
  getPhotoById,
  offlinePhotoDb,
  photoStorageLimits,
  savePhoto,
  updateSyncStatus,
} from './offlinePhotoStorage';
import {
  retrySyncFailedPhotos,
  syncPendingPhotos,
  getServiceLogSyncStatus,
} from './photoSyncService';
import type { CapturedPhoto } from './types';

const DATA_URL = `data:image/jpeg;base64,${Buffer.from('hello-photo').toString('base64')}`;

function capturedPhoto(id: string, category: 'before' | 'after' = 'before'): CapturedPhoto {
  return { id, dataUrl: DATA_URL, timestamp: new Date().toISOString(), category, location: null };
}

function mockConvexClient() {
  const mutation = vi.fn(async (name: string) => {
    if (name === 'servicePhotos:generateUploadUrl') return 'https://upload.example/x';
    if (name === 'servicePhotos:uploadPhoto') return 'remote-photo-1';
    throw new Error(`Unexpected mutation ${name}`);
  });
  return { mutation };
}

describe('photoSyncService', () => {
  beforeEach(async () => {
    await clearAllPhotos();
    localRows.customers.clear();
    localRows.serviceLogs.clear();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ storageId: 'storage-1' }),
    })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves Convex ids from Dexie instead of sending local numeric ids', async () => {
    localRows.customers.set(12, { id: 12, convex_id: 'cust-convex' });
    localRows.serviceLogs.set(34, { id: 34, convex_id: 'log-convex' });
    const photoId = await savePhoto(capturedPhoto('p1'), '12', '34');
    const client = mockConvexClient();

    const results = await syncPendingPhotos(client, { maxRetries: 0 });

    expect(results).toEqual([{ photoId, success: true, convexPhotoId: 'remote-photo-1' }]);
    expect(client.mutation).toHaveBeenCalledWith('servicePhotos:uploadPhoto', expect.objectContaining({
      customer_id: 'cust-convex',
      service_log_id: 'log-convex',
    }));
    expect((await getPhotoById(photoId))?.syncStatus).toBe('synced');
  });

  it('leaves the photo pending with a reason when its customer has not synced yet', async () => {
    localRows.customers.set(12, { id: 12 }); // no convex_id yet
    localRows.serviceLogs.set(34, { id: 34, convex_id: 'log-convex' });
    const photoId = await savePhoto(capturedPhoto('p2'), '12', '34');
    const client = mockConvexClient();

    const results = await syncPendingPhotos(client, { maxRetries: 0 });

    expect(results[0]).toMatchObject({ photoId, success: false, error: expect.stringContaining('not synced') });
    expect(client.mutation).not.toHaveBeenCalled();
    const stored = await getPhotoById(photoId);
    expect(stored?.syncStatus).toBe('pending');
    expect(stored?.syncError).toContain('not synced');

    // Once the customer syncs, the same photo goes through on the next run.
    localRows.customers.set(12, { id: 12, convex_id: 'cust-convex' });
    const retry = await syncPendingPhotos(client, { maxRetries: 0 });
    expect(retry[0]).toMatchObject({ photoId, success: true });
  });

  it('retrySyncFailedPhotos fetches failed photos directly and re-syncs them', async () => {
    localRows.customers.set(12, { id: 12, convex_id: 'cust-convex' });
    localRows.serviceLogs.set(34, { id: 34, convex_id: 'log-convex' });
    const photoId = await savePhoto(capturedPhoto('p3'), '12', '34');
    await updateSyncStatus(photoId, 'failed', 'earlier upload failed');
    expect(await getPendingPhotos()).toHaveLength(0);
    expect(await getFailedPhotos()).toHaveLength(1);
    expect(await getServiceLogSyncStatus('34')).toBe('failed');

    const client = mockConvexClient();
    const results = await retrySyncFailedPhotos(client, { maxRetries: 0 });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ photoId, success: true });
    expect((await getPhotoById(photoId))?.syncStatus).toBe('synced');
    expect(await getServiceLogSyncStatus('34')).toBe('synced');
  });
});

describe('offlinePhotoStorage retention', () => {
  beforeEach(async () => {
    await clearAllPhotos();
  });

  it('only expires photos that are already synced', async () => {
    const old = Date.now() - photoStorageLimits.maxPhotoAgeMs - 1000;
    const base = {
      customerId: '1', serviceLogId: '2', category: 'before' as const, dataUrl: DATA_URL,
      timestamp: new Date(old).toISOString(), latitude: null, longitude: null, accuracy: null,
    };
    await offlinePhotoDb.photos.bulkPut([
      { ...base, id: 'old-pending', syncStatus: 'pending', createdAt: old },
      { ...base, id: 'old-failed', syncStatus: 'failed', createdAt: old },
      { ...base, id: 'old-synced', syncStatus: 'synced', createdAt: old, syncedAt: old },
      { ...base, id: 'new-synced', syncStatus: 'synced', createdAt: Date.now() },
    ]);

    await enforceStorageLimits();

    const remaining = (await offlinePhotoDb.photos.toArray()).map((photo) => photo.id).sort();
    expect(remaining).toEqual(['new-synced', 'old-failed', 'old-pending']);
  });
});
