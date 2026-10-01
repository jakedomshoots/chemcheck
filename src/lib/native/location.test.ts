import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const platformMock = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => false),
  isPluginAvailable: vi.fn(() => false),
}));

const nativeGeolocationMock = vi.hoisted(() => ({
  getCurrentPosition: vi.fn(),
  watchPosition: vi.fn(),
  clearWatch: vi.fn(async () => undefined),
  checkPermissions: vi.fn(),
  requestPermissions: vi.fn(),
}));

vi.mock('./platform', () => platformMock);
vi.mock('@capacitor/geolocation', () => ({ Geolocation: nativeGeolocationMock }));

import {
  __resetLocationStateForTests,
  checkLocationPermission,
  clearDriveData,
  computeDriveSegments,
  getCurrentFix,
  getDriveStorageKey,
  getObservedDriveProfile,
  getStoredDriveSegments,
  getStoredStopVisits,
  haversineKm,
  isDriveTimeCaptureActive,
  isDriveWatchActive,
  localDayKey,
  recordStopCompleted,
  recordStopStarted,
  requestLocationPermission,
  startDriveTimeCapture,
  syncDriveCaptureFromTimeTracking,
  watchLocation,
  type StopVisit,
} from './location';
import { saveTimeState, updateEndTime, clearTimeState } from '@/lib/proof-of-service/timeTrackingStorage';
import { hashIdentity } from '@/lib/sessionIdentity';
import { resolveDriveMinutes } from '@/lib/routeTimingEstimator';

type PositionCallback = (position: GeolocationPosition) => void;
type ErrorCallback = (error: GeolocationPositionError) => void;

function makePosition(latitude: number, longitude: number, timestamp = Date.now()): GeolocationPosition {
  return {
    coords: { latitude, longitude, accuracy: 25, altitude: null, altitudeAccuracy: null, heading: null, speed: null, toJSON: () => ({}) },
    timestamp,
    toJSON: () => ({}),
  } as unknown as GeolocationPosition;
}

function installWebGeolocation(queue: Array<GeolocationPosition | Error>) {
  const watchCallbacks: PositionCallback[] = [];
  const geolocation = {
    getCurrentPosition: vi.fn((success: PositionCallback, error?: ErrorCallback, _options?: PositionOptions) => {
      const next = queue.shift();
      if (next instanceof Error) {
        error?.({ code: 1, message: next.message, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError);
      } else if (next) {
        success(next);
      } else {
        error?.({ code: 2, message: 'unavailable', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError);
      }
    }),
    watchPosition: vi.fn((success: PositionCallback) => {
      watchCallbacks.push(success);
      return watchCallbacks.length;
    }),
    clearWatch: vi.fn(),
  };
  Object.defineProperty(navigator, 'geolocation', { value: geolocation, configurable: true, writable: true });
  return { geolocation, watchCallbacks };
}

function removeWebGeolocation() {
  Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true, writable: true });
}

function signIn(email: string) {
  localStorage.setItem('chemcheck_current_user', JSON.stringify({ email }));
}

/** ISO timestamp at a clock time today (visits older than two days are pruned). */
function todayAt(hours: number, minutes: number): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes).toISOString();
}

describe('location: pure helpers', () => {
  it('computes haversine distance between two fixes', () => {
    // Los Angeles City Hall -> Santa Monica Pier is roughly 24 km.
    const km = haversineKm({ latitude: 34.0537, longitude: -118.2428 }, { latitude: 34.0094, longitude: -118.4973 });
    expect(km).toBeGreaterThan(23);
    expect(km).toBeLessThan(25);
    expect(haversineKm({ latitude: 1, longitude: 1 }, { latitude: 1, longitude: 1 })).toBe(0);
  });

  it('derives a local day key from an ISO timestamp', () => {
    const now = new Date(2026, 5, 8, 9, 30);
    expect(localDayKey(now.toISOString(), now)).toBe('2026-06-08');
    expect(localDayKey('not a date', now)).toBe('2026-06-08');
  });

  it('folds consecutive visits into drive segments with distance and duration', () => {
    const visits: StopVisit[] = [
      {
        customerId: '2',
        arrivedAt: '2026-06-08T16:00:00.000Z',
        departedAt: '2026-06-08T16:20:00.000Z',
        arrivePosition: { latitude: 34.05, longitude: -118.25, accuracy: 10, timestamp: 1 },
        departPosition: { latitude: 34.05, longitude: -118.25, accuracy: 10, timestamp: 2 },
      },
      {
        customerId: '1',
        arrivedAt: '2026-06-08T15:00:00.000Z',
        departedAt: '2026-06-08T15:30:00.000Z',
        arrivePosition: { latitude: 34.0, longitude: -118.2, accuracy: 10, timestamp: 1 },
        departPosition: { latitude: 34.0, longitude: -118.2, accuracy: 10, timestamp: 2 },
      },
      {
        customerId: '3',
        arrivedAt: '2026-06-08T16:32:00.000Z',
        departedAt: null,
        arrivePosition: null,
      },
    ];

    const segments = computeDriveSegments(visits);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ fromCustomerId: '1', toCustomerId: '2', durationMinutes: 30 });
    expect(segments[0].distanceKm).toBeGreaterThan(7);
    expect(segments[0].distanceKm).toBeLessThan(8);
    expect(segments[1]).toMatchObject({ fromCustomerId: '2', toCustomerId: '3', durationMinutes: 12, distanceKm: null });
  });

  it('drops implausible drives, repeated stops and visits without a departure', () => {
    const segments = computeDriveSegments([
      { customerId: 'a', arrivedAt: '2026-06-08T15:00:00.000Z', departedAt: '2026-06-08T15:10:00.000Z' },
      { customerId: 'a', arrivedAt: '2026-06-08T15:15:00.000Z', departedAt: '2026-06-08T15:20:00.000Z' },
      { customerId: 'b', arrivedAt: '2026-06-08T15:20:20.000Z', departedAt: null },
      { customerId: 'c', arrivedAt: '2026-06-08T23:00:00.000Z', departedAt: null },
      { customerId: 'd', arrivedAt: 'garbage', departedAt: null },
    ]);
    expect(segments).toEqual([]);
  });
});

describe('location: provider wrapper', () => {
  beforeEach(() => {
    __resetLocationStateForTests();
    platformMock.isNativePlatform.mockReturnValue(false);
    platformMock.isPluginAvailable.mockReturnValue(false);
    vi.clearAllMocks();
  });

  afterEach(() => {
    __resetLocationStateForTests();
    removeWebGeolocation();
  });

  it('returns null and never throws without a provider', async () => {
    removeWebGeolocation();
    await expect(getCurrentFix()).resolves.toBeNull();
    await expect(checkLocationPermission()).resolves.toBe('unavailable');
    await expect(requestLocationPermission()).resolves.toBe('unavailable');
    const stop = watchLocation(() => undefined);
    expect(() => stop()).not.toThrow();
  });

  it('returns null when the browser denies permission', async () => {
    installWebGeolocation([new Error('denied')]);
    await expect(getCurrentFix()).resolves.toBeNull();
  });

  it('reads a web fix with low-power options and watches with cleanup', async () => {
    const { geolocation, watchCallbacks } = installWebGeolocation([makePosition(34, -118, 1000)]);

    const fix = await getCurrentFix();
    expect(fix).toMatchObject({ latitude: 34, longitude: -118, accuracy: 25, timestamp: 1000 });
    expect(geolocation.getCurrentPosition.mock.calls[0][2]).toMatchObject({ enableHighAccuracy: false, maximumAge: 60000 });

    const seen: number[] = [];
    const stop = watchLocation((next) => seen.push(next.latitude));
    watchCallbacks[0](makePosition(35, -118));
    stop();
    watchCallbacks[0](makePosition(36, -118));
    expect(seen).toEqual([35]);
    expect(geolocation.clearWatch).toHaveBeenCalledWith(1);
  });

  it('uses the Capacitor plugin on native platforms', async () => {
    platformMock.isNativePlatform.mockReturnValue(true);
    platformMock.isPluginAvailable.mockReturnValue(true);
    nativeGeolocationMock.checkPermissions.mockResolvedValue({ location: 'prompt', coarseLocation: 'prompt' });
    nativeGeolocationMock.requestPermissions.mockResolvedValue({ location: 'granted', coarseLocation: 'granted' });
    nativeGeolocationMock.getCurrentPosition.mockResolvedValue({ coords: { latitude: 1, longitude: 2, accuracy: 5 }, timestamp: 42 });
    nativeGeolocationMock.watchPosition.mockImplementation(async (_opts: unknown, cb: (p: unknown) => void) => {
      cb({ coords: { latitude: 3, longitude: 4, accuracy: 5 }, timestamp: 43 });
      return 'watch-1';
    });

    await expect(checkLocationPermission()).resolves.toBe('prompt');
    await expect(requestLocationPermission()).resolves.toBe('granted');
    await expect(getCurrentFix()).resolves.toMatchObject({ latitude: 1, longitude: 2, timestamp: 42 });

    const seen: number[] = [];
    const stop = watchLocation((fix) => seen.push(fix.latitude));
    await vi.waitFor(() => expect(seen).toEqual([3]));
    stop();
    await vi.waitFor(() => expect(nativeGeolocationMock.clearWatch).toHaveBeenCalledWith({ id: 'watch-1' }));
  });

  it('degrades to unavailable when the native plugin throws', async () => {
    platformMock.isNativePlatform.mockReturnValue(true);
    platformMock.isPluginAvailable.mockReturnValue(true);
    nativeGeolocationMock.checkPermissions.mockRejectedValue(new Error('services off'));
    nativeGeolocationMock.getCurrentPosition.mockRejectedValue(new Error('services off'));
    await expect(checkLocationPermission()).resolves.toBe('unavailable');
    await expect(getCurrentFix()).resolves.toBeNull();
  });
});

describe('location: drive-time capture', () => {
  beforeEach(() => {
    __resetLocationStateForTests();
    platformMock.isNativePlatform.mockReturnValue(false);
    platformMock.isPluginAvailable.mockReturnValue(false);
    vi.clearAllMocks();
    signIn('tech@example.com');
  });

  afterEach(() => {
    __resetLocationStateForTests();
    removeWebGeolocation();
    vi.useRealTimers();
  });

  it('scopes storage to the signed-in account under a chemcheck_ key', () => {
    expect(getDriveStorageKey()).toBe(`chemcheck_drive_segments_${hashIdentity('tech@example.com')}`);
    expect(getDriveStorageKey('other@example.com')).toBe(`chemcheck_drive_segments_${hashIdentity('other@example.com')}`);
    localStorage.removeItem('chemcheck_current_user');
    expect(getDriveStorageKey()).toBe('chemcheck_drive_segments_anonymous');
  });

  it('records arrive and depart fixes, runs the watch only during a stop, and persists segments', async () => {
    const { geolocation } = installWebGeolocation([
      makePosition(34.0, -118.2),
      makePosition(34.0, -118.2),
      makePosition(34.05, -118.25),
      makePosition(34.05, -118.25),
    ]);

    expect(isDriveWatchActive()).toBe(false);
    await recordStopStarted('1', todayAt(8, 0));
    expect(isDriveWatchActive()).toBe(true);
    expect(geolocation.watchPosition).toHaveBeenCalledTimes(1);

    await recordStopCompleted('1', todayAt(8, 30));
    expect(isDriveWatchActive()).toBe(false);
    expect(geolocation.clearWatch).toHaveBeenCalled();

    await recordStopStarted('2', todayAt(8, 45));
    const segments = await recordStopCompleted('2', todayAt(9, 5));

    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ fromCustomerId: '1', toCustomerId: '2', durationMinutes: 15 });
    expect(segments[0].distanceKm).toBeGreaterThan(7);

    const visits = getStoredStopVisits();
    expect(visits).toHaveLength(2);
    expect(visits[0].arrivePosition).toMatchObject({ latitude: 34.0 });
    expect(visits[1].departPosition).toMatchObject({ latitude: 34.05 });

    const raw = localStorage.getItem(getDriveStorageKey());
    expect(raw).toContain('"segments"');
    expect(getStoredDriveSegments()).toEqual(segments);
  });

  it('still records durations when location permission is denied', async () => {
    installWebGeolocation([new Error('denied'), new Error('denied'), new Error('denied'), new Error('denied')]);

    await recordStopStarted('1', todayAt(8, 0));
    await recordStopCompleted('1', todayAt(8, 30));
    await recordStopStarted('2', todayAt(8, 42));
    const segments = await recordStopCompleted('2', todayAt(9, 0));

    expect(segments).toEqual([
      expect.objectContaining({ fromCustomerId: '1', toCustomerId: '2', durationMinutes: 12, distanceKm: null }),
    ]);
  });

  it('is idempotent for an already-open visit and ignores unknown completions', async () => {
    installWebGeolocation([]);
    const first = await recordStopStarted('9', todayAt(8, 0));
    const again = await recordStopStarted('9', todayAt(8, 5));
    expect(again?.arrivedAt).toBe(first?.arrivedAt);
    expect(getStoredStopVisits()).toHaveLength(1);
    await expect(recordStopCompleted('unknown')).resolves.toEqual([]);
    await expect(recordStopStarted('')).resolves.toBeNull();
  });

  it('feeds averages into the estimator only after three observations', async () => {
    installWebGeolocation([]);
    const today = new Date();
    const at = (dayOffset: number, h: number, m: number) =>
      new Date(today.getFullYear(), today.getMonth(), today.getDate() + dayOffset, h, m).toISOString();

    // Yesterday: one 10-minute drive from 1 to 2.
    await recordStopStarted('1', at(-1, 8, 0));
    await recordStopCompleted('1', at(-1, 8, 30));
    await recordStopStarted('2', at(-1, 8, 40));
    await recordStopCompleted('2', at(-1, 9, 0));

    // Today, morning: 14 minutes. Not enough observations yet.
    await recordStopStarted('1', at(0, 8, 0));
    await recordStopCompleted('1', at(0, 8, 30));
    await recordStopStarted('2', at(0, 8, 44));
    await recordStopCompleted('2', at(0, 9, 0));

    let profile = getObservedDriveProfile();
    expect(profile.get('1->2')).toMatchObject({ observations: 2, averageMinutes: 12 });
    expect(resolveDriveMinutes('1', '2', { estimate: 25, profile })).toMatchObject({ source: 'estimate', minutes: 25 });

    // Today, afternoon: 12 minutes. Third observation unlocks the override.
    await recordStopStarted('1', at(0, 13, 0));
    await recordStopCompleted('1', at(0, 13, 30));
    await recordStopStarted('2', at(0, 13, 42));
    await recordStopCompleted('2', at(0, 14, 0));

    profile = getObservedDriveProfile();
    expect(profile.get('1->2')).toMatchObject({ observations: 3, averageMinutes: 12 });
    expect(resolveDriveMinutes('1', '2', { estimate: 25, profile })).toMatchObject({ source: 'observed', minutes: 12, observations: 3 });
    // Direction matters: the reverse leg has never been driven.
    expect(resolveDriveMinutes('2', '1', { estimate: 25, profile }).source).toBe('estimate');
  });

  it('bridges proof-of-service time tracking into visits and segments', async () => {
    installWebGeolocation([]);
    const now = new Date();
    const iso = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60000).toISOString();

    saveTimeState('11', { startTime: iso(50), endTime: null, duration: null, isTracking: true });
    await syncDriveCaptureFromTimeTracking(now);
    expect(getStoredStopVisits()).toEqual([expect.objectContaining({ customerId: '11', departedAt: null })]);
    expect(isDriveWatchActive()).toBe(true);

    updateEndTime('11', iso(30));
    await syncDriveCaptureFromTimeTracking(now);
    expect(getStoredStopVisits()[0].departedAt).toBe(iso(30));
    expect(isDriveWatchActive()).toBe(false);

    // Service log saved: NewServiceLog clears the record, and a new stop begins.
    clearTimeState('11');
    saveTimeState('12', { startTime: iso(15), endTime: null, duration: null, isTracking: true });
    await syncDriveCaptureFromTimeTracking(now);
    expect(getStoredStopVisits()).toHaveLength(2);

    clearTimeState('12');
    await syncDriveCaptureFromTimeTracking(now);
    const segments = getStoredDriveSegments();
    expect(segments).toEqual([expect.objectContaining({ fromCustomerId: '11', toCustomerId: '12', durationMinutes: 15 })]);
  });

  it('ignores stale time-tracking records from previous days', async () => {
    installWebGeolocation([]);
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    saveTimeState('old', { startTime: twoDaysAgo, endTime: null, duration: null, isTracking: true });
    await syncDriveCaptureFromTimeTracking();
    expect(getStoredStopVisits()).toEqual([]);
  });

  it('starts the bridge once and tears it down cleanly', async () => {
    vi.useFakeTimers();
    installWebGeolocation([]);
    const stop = startDriveTimeCapture();
    expect(isDriveTimeCaptureActive()).toBe(true);
    expect(startDriveTimeCapture()).toBe(stop);

    saveTimeState('21', { startTime: new Date().toISOString(), endTime: null, duration: null, isTracking: true });
    await vi.advanceTimersByTimeAsync(11000);
    expect(getStoredStopVisits()).toEqual([expect.objectContaining({ customerId: '21' })]);

    stop();
    expect(isDriveTimeCaptureActive()).toBe(false);
    expect(isDriveWatchActive()).toBe(false);
  });

  it('clears drive data for the account', async () => {
    installWebGeolocation([]);
    await recordStopStarted('1');
    expect(localStorage.getItem(getDriveStorageKey())).not.toBeNull();
    clearDriveData();
    expect(localStorage.getItem(getDriveStorageKey())).toBeNull();
    expect(getStoredDriveSegments()).toEqual([]);
  });
});
