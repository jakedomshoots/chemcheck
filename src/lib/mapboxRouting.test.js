import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  geocodeAddress,
  getMapboxRoutingReadiness,
  optimizeMapboxRoute,
} from './mapboxRouting';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Mapbox routing', () => {
  it('stays disabled until an origin-restricted public token is configured', () => {
    vi.stubEnv('VITE_MAPBOX_ACCESS_TOKEN', '');
    expect(getMapboxRoutingReadiness()).toMatchObject({ configured: false, provider: null });
  });

  it('geocodes an address without exposing a token in the returned location', async () => {
    vi.stubEnv('VITE_MAPBOX_ACCESS_TOKEN', 'public-test-token');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        features: [{ geometry: { coordinates: [-110.97, 32.22] }, properties: { full_address: '123 Test Lane, Tucson, AZ' } }],
      }),
    });

    const location = await geocodeAddress('123 Test Lane, Tucson, AZ', fetchMock);

    expect(location).toEqual({ longitude: -110.97, latitude: 32.22, formattedAddress: '123 Test Lane, Tucson, AZ' });
    expect(fetchMock.mock.calls[0][0]).toContain('access_token=public-test-token');
    expect(location).not.toHaveProperty('token');
  });

  it('uses Mapbox waypoint order instead of falling back to the saved customer order', async () => {
    vi.stubEnv('VITE_MAPBOX_ACCESS_TOKEN', 'public-test-token');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ features: [{ geometry: { coordinates: [-110.97, 32.22] }, properties: { full_address: 'A' } }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ features: [{ geometry: { coordinates: [-110.98, 32.23] }, properties: { full_address: 'B' } }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          trips: [{ duration: 1260, distance: 8046.72 }],
          waypoints: [{ waypoint_index: 1 }, { waypoint_index: 0 }],
        }),
      });

    const route = await optimizeMapboxRoute([
      { _id: 'customer-a', full_name: 'First saved', address: 'A', sort_order: 1 },
      { _id: 'customer-b', full_name: 'Second saved', address: 'B', sort_order: 2 },
    ], fetchMock);

    expect(route.customers.map((customer) => customer.full_name)).toEqual(['Second saved', 'First saved']);
    expect(route.driveMinutes).toBe(21);
    expect(route.distanceMiles).toBe(5);
  });
});
