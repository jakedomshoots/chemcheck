import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRouteProvider, isMapProviderConfigured, type ProviderLocation } from './routeProvider';

const loc = (latitude: number, longitude: number, address: string): ProviderLocation => ({
  latitude, longitude, address, source: 'provided',
});

describe('route provider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('never invents coordinates or drive times without a map provider', async () => {
    const config = { provider: 'fallback' as const, timeoutMs: 100, cacheTtlMs: 1000 };
    const provider = createRouteProvider(config);
    expect(isMapProviderConfigured(config)).toBe(false);
    await expect(provider.geocode('100 Main St, Los Angeles, CA 90001')).rejects.toThrow(/map provider/i);
    // Real coordinates -> straight-line distance only, no drive time.
    const travel = await provider.estimateTravel(loc(34.0, -118.0, 'a'), loc(34.1, -118.0, 'b'));
    expect(travel.source).toBe('straight-line');
    expect(travel.duration).toBeNull();
    expect(travel.distance).toBeCloseTo(6.9, 1);
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
    const to = loc(34.2, -118.2, '200 Main St');
    const travel = await provider.estimateTravel(from, to);
    expect(from.source).toBe('remote');
    expect(from.latitude).toBe(34.1);
    expect(travel.source).toBe('remote');
    expect(travel.distance).toBe(1);
    expect(travel.duration).toBe(2);
  });

  it('does not invent a location when the remote geocoder fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const provider = createRouteProvider({ provider: 'osrm', timeoutMs: 100, cacheTtlMs: 1000 });
    await expect(provider.geocode('500 Sunset Blvd')).rejects.toThrow();
  });

  it('degrades routing failures to a labelled straight-line distance with no drive time', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const provider = createRouteProvider({ provider: 'osrm', timeoutMs: 100, cacheTtlMs: 1000 });
    const travel = await provider.estimateTravel(loc(34.0, -118.0, 'a'), loc(34.1, -118.0, 'b'));
    expect(travel.source).toBe('straight-line');
    expect(travel.duration).toBeNull();
    const matrix = await provider.estimateTravelMatrix?.([loc(34.0, -118.0, 'a'), loc(34.1, -118.0, 'b')]);
    expect(matrix?.[0]?.[1]?.duration).toBeNull();
  });

  it('supports one-request routing matrices', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      distances: [[0, 3218.688], [3218.688, 0]],
      durations: [[0, 240], [240, 0]],
    }), { status: 200 })));
    const provider = createRouteProvider({ provider: 'osrm', timeoutMs: 1000, cacheTtlMs: 1000 });
    const locations = [loc(34.0, -118.0, '100 Main St'), loc(34.03, -118.0, '200 Main St')];
    const matrix = await provider.estimateTravelMatrix?.(locations);
    expect(matrix?.[0]?.[1]?.distance).toBe(2);
    expect(matrix?.[0]?.[1]?.duration).toBe(4);
  });
});
