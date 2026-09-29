/**
 * Provider abstraction for route geocoding and travel-time estimates.
 *
 * The app deliberately keeps this behind a small interface. A browser build
 * can use a restricted, public map token or a same-origin proxy. Never put a
 * server-only secret in a VITE_* variable.
 *
 * Without a configured map provider ('fallback') this module NEVER invents
 * coordinates or drive times: geocoding is unavailable, and travel between
 * two REAL coordinates (e.g. ones stored on a customer) is reported only as a
 * straight-line distance with no drive time.
 */

export type RouteProviderName = 'osrm' | 'mapbox' | 'proxy' | 'fallback';
export type LocationSource = 'remote' | 'cache' | 'provided';

export interface ProviderLocation {
  latitude: number;
  longitude: number;
  address: string;
  source: LocationSource;
  provider?: string;
  precision?: string;
}

export interface TravelEstimate {
  /** Miles (road distance for 'remote', great-circle distance for 'straight-line'). */
  distance: number;
  /** Driving minutes, or null when only a straight-line distance is known. */
  duration: number | null;
  source: 'remote' | 'straight-line';
  provider?: string;
}

/** Thrown when an address cannot be resolved to real coordinates. */
export class GeocodingUnavailableError extends Error {
  constructor(message = 'No map provider is configured for address lookup') {
    super(message);
    this.name = 'GeocodingUnavailableError';
  }
}

export interface RouteProvider {
  readonly name: RouteProviderName;
  geocode(address: string, signal?: AbortSignal): Promise<ProviderLocation>;
  estimateTravel(from: ProviderLocation, to: ProviderLocation, signal?: AbortSignal): Promise<TravelEstimate>;
  estimateTravelMatrix?(locations: ProviderLocation[], signal?: AbortSignal): Promise<TravelEstimate[][]>;
}

export interface RouteProviderConfig {
  provider: RouteProviderName;
  geocoderUrl?: string;
  routerUrl?: string;
  proxyUrl?: string;
  apiKey?: string;
  timeoutMs: number;
  cacheTtlMs: number;
}

const GEOCODE_CACHE_KEY = 'chemcheck.route.geocode.v1';
const DEFAULT_TIMEOUT_MS = 6500;
const DEFAULT_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 30;

function readEnv(key: string): string | undefined {
  try {
    const viteEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
    if (viteEnv?.[key]) return viteEnv[key];
  } catch {
    // import.meta.env is not available in a few non-Vite test runners.
  }

  try {
    const processEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
    return processEnv?.[key];
  } catch {
    return undefined;
  }
}

function isTestRuntime(): boolean {
  return readEnv('MODE') === 'test' || readEnv('NODE_ENV') === 'test';
}

export function getRouteProviderConfig(): RouteProviderConfig {
  const requested = (readEnv('VITE_ROUTE_PROVIDER') || '').toLowerCase();
  const configuredProxy = readEnv('VITE_ROUTE_PROXY_URL');
  // Never send customer addresses to a public geocoder by default. Production
  // deployments must explicitly opt into OSRM/Mapbox or provide a same-origin
  // proxy that applies the business's privacy and rate-limit policy.
  const provider: RouteProviderName = requested === 'mapbox' || requested === 'osrm' || requested === 'proxy' || requested === 'fallback'
    ? requested
    : isTestRuntime() ? 'fallback' : configuredProxy ? 'proxy' : 'fallback';

  const timeout = Number(readEnv('VITE_ROUTE_TIMEOUT_MS'));
  const ttl = Number(readEnv('VITE_ROUTE_CACHE_TTL_MS'));

  return {
    provider,
    // Nominatim is used for address search with OSRM's public routing API.
    // Production teams should set VITE_ROUTE_GEOCODER_URL to their proxy.
    geocoderUrl: readEnv('VITE_ROUTE_GEOCODER_URL') || 'https://nominatim.openstreetmap.org/search',
    routerUrl: readEnv('VITE_ROUTE_ROUTER_URL') || 'https://router.project-osrm.org/route/v1/driving',
    proxyUrl: configuredProxy,
    // This is only appropriate for a restricted public map token. Keep
    // private provider keys server-side behind VITE_ROUTE_PROXY_URL.
    apiKey: readEnv('VITE_ROUTE_PUBLIC_KEY'),
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? Math.min(timeout, 30000) : DEFAULT_TIMEOUT_MS,
    cacheTtlMs: Number.isFinite(ttl) && ttl > 0 ? Math.min(ttl, 1000 * 60 * 60 * 24 * 365) : DEFAULT_CACHE_TTL_MS,
  };
}

function normalizeAddress(address: string): string {
  return String(address || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Great-circle distance in miles between two real coordinates. */
export function straightLineMiles(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number }
): number {
  const radians = Math.PI / 180;
  const dLat = (to.latitude - from.latitude) * radians;
  const dLng = (to.longitude - from.longitude) * radians;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(from.latitude * radians) * Math.cos(to.latitude * radians) * Math.sin(dLng / 2) ** 2;
  return 3959 * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

/** Straight-line distance only — no invented drive time. */
function straightLineTravel(from: ProviderLocation, to: ProviderLocation): TravelEstimate {
  return {
    distance: straightLineMiles(from, to),
    duration: null,
    source: 'straight-line',
    provider: 'straight-line',
  };
}

function readCachedGeocode(address: string, ttlMs: number): ProviderLocation | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const cache = JSON.parse(localStorage.getItem(GEOCODE_CACHE_KEY) || '{}') as Record<string, { savedAt: number; location: ProviderLocation }>;
    const entry = cache[normalizeAddress(address)];
    if (!entry || Date.now() - entry.savedAt > ttlMs) return null;
    return { ...entry.location, source: 'cache' };
  } catch {
    return null;
  }
}

function writeCachedGeocode(address: string, location: ProviderLocation): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const cache = JSON.parse(localStorage.getItem(GEOCODE_CACHE_KEY) || '{}') as Record<string, { savedAt: number; location: ProviderLocation }>;
    cache[normalizeAddress(address)] = { savedAt: Date.now(), location };
    const keys = Object.keys(cache);
    if (keys.length > 500) delete cache[keys.sort((a, b) => cache[a].savedAt - cache[b].savedAt)[0]];
    localStorage.setItem(GEOCODE_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Storage can be disabled or full; in-memory operation remains valid.
  }
}

function withTimeout(timeoutMs: number, signal?: AbortSignal): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

/**
 * Used when no map provider is configured. It cannot geocode addresses and
 * cannot estimate drive times; it only measures straight-line distance
 * between coordinates the caller already has.
 */
class NoMapProvider implements RouteProvider {
  readonly name = 'fallback' as const;
  async geocode(): Promise<ProviderLocation> {
    throw new GeocodingUnavailableError();
  }
  async estimateTravel(from: ProviderLocation, to: ProviderLocation): Promise<TravelEstimate> {
    return straightLineTravel(from, to);
  }
  async estimateTravelMatrix(locations: ProviderLocation[]): Promise<TravelEstimate[][]> {
    return locations.map((from) => locations.map((to) => straightLineTravel(from, to)));
  }
}

class RemoteProvider implements RouteProvider {
  readonly name: RouteProviderName;
  constructor(private readonly config: RouteProviderConfig) {
    this.name = config.provider;
  }

  async geocode(address: string, signal?: AbortSignal): Promise<ProviderLocation> {
    const cleanAddress = String(address || '').trim();
    if (!cleanAddress) throw new GeocodingUnavailableError('No address to look up');
    const cached = readCachedGeocode(cleanAddress, this.config.cacheTtlMs);
    if (cached) return cached;

    const url = this.buildGeocoderUrl(cleanAddress);
    const request = withTimeout(this.config.timeoutMs, signal);
    try {
      const response = await fetch(url, { signal: request.signal, headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`Geocoder returned HTTP ${response.status}`);
      const payload = await response.json() as unknown;
      const location = this.parseGeocoderPayload(cleanAddress, payload);
      writeCachedGeocode(cleanAddress, location);
      return location;
    } finally {
      request.cleanup();
    }
  }

  async estimateTravel(from: ProviderLocation, to: ProviderLocation, signal?: AbortSignal): Promise<TravelEstimate> {
    const request = withTimeout(this.config.timeoutMs, signal);
    try {
      const url = this.buildRouterUrl(from, to);
      const response = await fetch(url, { signal: request.signal, headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`Router returned HTTP ${response.status}`);
      const payload = await response.json() as {
        routes?: Array<{ distance?: number; duration?: number }>;
        distances?: number[][];
        durations?: number[][];
      };
      const route = payload.routes?.[0];
      const matrixDistance = payload.distances?.[0]?.[1];
      const matrixDuration = payload.durations?.[0]?.[1];
      const distanceMeters = route?.distance ?? matrixDistance;
      const durationSeconds = route?.duration ?? matrixDuration;
      if (!Number.isFinite(distanceMeters) || !Number.isFinite(durationSeconds)) {
        throw new Error('Router response did not include distance and duration');
      }
      return { distance: Number(distanceMeters) / 1609.344, duration: Number(durationSeconds) / 60, source: 'remote', provider: this.name };
    } finally {
      request.cleanup();
    }
  }

  async estimateTravelMatrix(locations: ProviderLocation[], signal?: AbortSignal): Promise<TravelEstimate[][]> {
    const request = withTimeout(this.config.timeoutMs, signal);
    try {
      const url = this.buildMatrixUrl(locations);
      const response = await fetch(url, { signal: request.signal, headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`Router returned HTTP ${response.status}`);
      const payload = await response.json() as { distances?: number[][]; durations?: number[][] };
      if (!Array.isArray(payload.distances) || !Array.isArray(payload.durations)) {
        throw new Error('Router matrix response did not include distances and durations');
      }
      return locations.map((_, fromIndex) => locations.map((__, toIndex) => {
        const distance = payload.distances?.[fromIndex]?.[toIndex];
        const duration = payload.durations?.[fromIndex]?.[toIndex];
        if (!Number.isFinite(distance) || !Number.isFinite(duration)) throw new Error('Router matrix contained an invalid cell');
        return { distance: Number(distance) / 1609.344, duration: Number(duration) / 60, source: 'remote', provider: this.name };
      }));
    } finally {
      request.cleanup();
    }
  }

  private buildGeocoderUrl(address: string): string {
    if (this.config.provider === 'proxy' && this.config.proxyUrl) {
      const url = new URL(this.config.proxyUrl, typeof window !== 'undefined' ? window.location.origin : undefined);
      url.searchParams.set('q', address);
      return url.toString();
    }
    if (this.config.provider === 'mapbox') {
      const url = `${(this.config.geocoderUrl || 'https://api.mapbox.com/geocoding/v5/mapbox.places').replace(/\/$/, '')}/${encodeURIComponent(address)}.json`;
      return this.withApiKey(url);
    }
    const url = new URL(this.config.geocoderUrl || 'https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', address);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '1');
    return url.toString();
  }

  private buildRouterUrl(from: ProviderLocation, to: ProviderLocation): string {
    if (this.config.provider === 'proxy' && this.config.proxyUrl) {
      const url = new URL(this.config.proxyUrl, typeof window !== 'undefined' ? window.location.origin : undefined);
      url.searchParams.set('from', `${from.longitude},${from.latitude}`);
      url.searchParams.set('to', `${to.longitude},${to.latitude}`);
      return url.toString();
    }
    const defaultBase = this.config.provider === 'mapbox'
      ? 'https://api.mapbox.com/directions-matrix/v1/mapbox/driving'
      : 'https://router.project-osrm.org/route/v1/driving';
    const base = (this.config.routerUrl || defaultBase).replace(/\/$/, '');
    const coordinates = `${from.longitude},${from.latitude};${to.longitude},${to.latitude}`;
    const query = this.config.provider === 'mapbox'
      ? 'annotations=distance,duration'
      : 'overview=false&steps=false';
    const url = `${base}/${coordinates}?${query}`;
    return this.withApiKey(url);
  }

  private buildMatrixUrl(locations: ProviderLocation[]): string {
    if (this.config.provider === 'proxy' && this.config.proxyUrl) {
      const url = new URL(this.config.proxyUrl, typeof window !== 'undefined' ? window.location.origin : undefined);
      url.searchParams.set('locations', locations.map((location) => `${location.longitude},${location.latitude}`).join(';'));
      return url.toString();
    }
    const defaultBase = this.config.provider === 'mapbox'
      ? 'https://api.mapbox.com/directions-matrix/v1/mapbox/driving'
      : 'https://router.project-osrm.org/table/v1/driving';
    const configuredBase = this.config.routerUrl || defaultBase;
    const base = (this.config.provider === 'osrm' && configuredBase.endsWith('/route/v1/driving')
      ? configuredBase.replace(/\/route\/v1\/driving$/, '/table/v1/driving')
      : configuredBase).replace(/\/$/, '');
    const coordinates = locations.map((location) => `${location.longitude},${location.latitude}`).join(';');
    const query = this.config.provider === 'mapbox'
      ? 'annotations=distance,duration'
      : 'annotations=distance,duration';
    return this.withApiKey(`${base}/${coordinates}?${query}`);
  }

  private withApiKey(url: string): string {
    if (!this.config.apiKey) return url;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}access_token=${encodeURIComponent(this.config.apiKey)}`;
  }

  private parseGeocoderPayload(address: string, payload: unknown): ProviderLocation {
    const first = Array.isArray(payload) ? payload[0] as Record<string, unknown> : payload as Record<string, unknown>;
    const mapboxCenter = Array.isArray(first?.center) ? first.center as unknown[] : [];
    const geometry = first?.geometry as Record<string, unknown> | undefined;
    const coordinates = Array.isArray(geometry?.coordinates) ? geometry.coordinates as unknown[] : [];
    const latitude = Number(first?.lat ?? first?.latitude ?? coordinates[1] ?? mapboxCenter[1]);
    const longitude = Number(first?.lon ?? first?.lng ?? first?.longitude ?? coordinates[0] ?? mapboxCenter[0]);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new Error('Geocoder response did not include coordinates');
    return { latitude, longitude, address, source: 'remote', provider: this.name, precision: String(first?.type || first?.place_type?.[0] || 'address') };
  }
}

class CachedResilientProvider implements RouteProvider {
  readonly name: RouteProviderName;
  constructor(private readonly remote: RouteProvider, private readonly fallback = new NoMapProvider()) {
    this.name = remote.name;
  }
  /** Geocoding failures propagate: a location is never invented. */
  async geocode(address: string, signal?: AbortSignal): Promise<ProviderLocation> {
    return this.remote.geocode(address, signal);
  }
  /** Routing failures degrade to a clearly-labelled straight-line distance (no drive time). */
  async estimateTravel(from: ProviderLocation, to: ProviderLocation, signal?: AbortSignal): Promise<TravelEstimate> {
    try {
      return await this.remote.estimateTravel(from, to, signal);
    } catch {
      return this.fallback.estimateTravel(from, to);
    }
  }
  async estimateTravelMatrix(locations: ProviderLocation[], signal?: AbortSignal): Promise<TravelEstimate[][]> {
    try {
      if (!this.remote.estimateTravelMatrix) throw new Error('Provider does not support matrix routing');
      return await this.remote.estimateTravelMatrix(locations, signal);
    } catch {
      return this.fallback.estimateTravelMatrix(locations);
    }
  }
}

/** True when a real map provider (not the no-map fallback) is configured. */
export function isMapProviderConfigured(config: RouteProviderConfig = getRouteProviderConfig()): boolean {
  return config.provider !== 'fallback';
}

export function createRouteProvider(config: RouteProviderConfig = getRouteProviderConfig()): RouteProvider {
  if (config.provider === 'fallback') return new NoMapProvider();
  return new CachedResilientProvider(new RemoteProvider(config));
}

export const routeProvider = createRouteProvider();
