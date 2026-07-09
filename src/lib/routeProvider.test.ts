import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRouteProvider, deterministicGeocode } from './routeProvider';

describe('route provider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('provides deterministic coordinates for offline use', async () => {
    const provider = createRouteProvider({ provider: 'fallback', timeoutMs: 100, cacheTtlMs: 1000 });
    const first = await provider.geocode('100 Main St, Los Angeles, CA 90001');
    const second = await provider.geocode('100 Main St, Los Angeles, CA 90001');
    expect(first.source).toBe('fallback');
    expect(first.latitude).toBe(second.latitude);
    expect(first.longitude).toBe(second.longitude);
  });

  it('parses remote geocoding and routing responses', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ lat: '34.1', lon: '-118.2', type: 'house' }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ routes: [{ distance: 1609.344, duration: 120 }], code: 'Ok' }), { status: 200 })));
    const provider = createRouteProvider({
      provider: 'osrm',
      geocoderUrl: 'https://geocoder.test/search',
      routerUrl: 'https://router.test/route/v1/driving',
      timeoutMs: 1000,
      cacheTtlMs: 1000,
    });
    const from = await provider.geocode('100 Main St');
    const to = { ...deterministicGeocode('200 Main St'), source: 'provided' as const };
    const travel = await provider.estimateTravel(from, to);
    expect(from.source).toBe('remote');
    expect(from.latitude).toBe(34.1);
    expect(travel.source).toBe('remote');
    expect(travel.distance).toBe(1);
    expect(travel.duration).toBe(2);
  });

  it('falls back when the remote provider fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const provider = createRouteProvider({ provider: 'osrm', timeoutMs: 100, cacheTtlMs: 1000 });
    const location = await provider.geocode('500 Sunset Blvd');
    expect(location.source).toBe('fallback');
  });

  it('supports one-request routing matrices', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      distances: [[0, 3218.688], [3218.688, 0]],
      durations: [[0, 240], [240, 0]],
    }), { status: 200 })));
    const provider = createRouteProvider({ provider: 'osrm', timeoutMs: 1000, cacheTtlMs: 1000 });
    const locations = [deterministicGeocode('100 Main St'), deterministicGeocode('200 Main St')];
    const matrix = await provider.estimateTravelMatrix?.(locations);
    expect(matrix?.[0]?.[1]?.distance).toBe(2);
    expect(matrix?.[0]?.[1]?.duration).toBe(4);
  });
});
