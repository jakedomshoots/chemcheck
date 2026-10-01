/**
 * Location bridge + drive-time capture.
 *
 * One thin wrapper over two providers:
 *   - @capacitor/geolocation inside the iOS/Android shell
 *   - navigator.geolocation on the web / PWA
 *
 * Everything here degrades silently: no permission, no provider, no storage
 * all collapse to "no observation", never to a thrown error. Drive-time data
 * is a nice-to-have on top of the route; it must never block the route.
 *
 * How drive segments come together
 * --------------------------------
 * Proof-of-service time tracking (`timeTrackingStorage.ts`) writes a
 * `timeTracker_<customerId>` record when a stop is started and clears it when
 * the service log is saved. We never edit that module; we observe it:
 *
 *   stop started   -> record an ARRIVE fix, start a low-power watch
 *   stop completed -> record a DEPART fix, stop the watch
 *
 * Consecutive visits for the day are then folded into drive segments
 * (depart A -> arrive B) with a haversine distance and a wall-clock duration.
 * Segments persist per account under a `chemcheck_` key, and the average
 * observed minutes per (from, to) pair feeds `routeTimingEstimator` once at
 * least three observations exist.
 */

import { getAllTimeStates } from '@/lib/proof-of-service/timeTrackingStorage';
import { getStoredCurrentUserEmail, hashIdentity } from '@/lib/sessionIdentity';
import { buildDriveTimeProfile, type DriveTimeProfile } from '@/lib/routeTimingEstimator';
import { isNativePlatform, isPluginAvailable } from './platform';

// ============================================
// Types
// ============================================

export interface LocationFix {
  latitude: number;
  longitude: number;
  /** metres */
  accuracy: number;
  /** epoch ms */
  timestamp: number;
}

export type LocationPermission = 'granted' | 'denied' | 'prompt' | 'unavailable';

export interface LocationOptions {
  enableHighAccuracy?: boolean;
  timeout?: number;
  maximumAge?: number;
}

export interface StopVisit {
  customerId: string;
  /** ISO 8601 */
  arrivedAt: string;
  /** ISO 8601, missing while the stop is still in progress */
  departedAt?: string | null;
  arrivePosition?: LocationFix | null;
  departPosition?: LocationFix | null;
}

export interface DriveSegment {
  fromCustomerId: string;
  toCustomerId: string;
  /** ISO 8601 — when the tech left the previous stop */
  departAt: string;
  /** ISO 8601 — when the tech started the next stop */
  arriveAt: string;
  /** null when either end has no position fix */
  distanceKm: number | null;
  durationMinutes: number;
}

interface DriveStore {
  version: 1;
  visits: StopVisit[];
  segments: DriveSegment[];
}

type WatchHandle = { kind: 'native'; id: string } | { kind: 'web'; id: number };

// ============================================
// Constants
// ============================================

/**
 * Low-power defaults: coarse accuracy is plenty for a drive between pools,
 * and a generous maximumAge lets the OS hand back a cached fix instead of
 * spinning up GPS.
 */
export const LOW_POWER_OPTIONS: Required<LocationOptions> = {
  enableHighAccuracy: false,
  timeout: 15000,
  maximumAge: 60000,
};

export const DRIVE_STORAGE_KEY_PREFIX = 'chemcheck_drive_segments_';
export const DRIVE_SEGMENT_RETENTION_DAYS = 90;
export const VISIT_RETENTION_DAYS = 2;
/** Drives longer than this are a lunch break or a day boundary, not a drive. */
export const MAX_DRIVE_MINUTES = 4 * 60;
/** A "drive" of under a minute is two logs saved back to back, not a drive. */
export const MIN_DRIVE_MINUTES = 1;
const BRIDGE_POLL_MS = 10000;
const EARTH_RADIUS_KM = 6371.0088;

// ============================================
// Provider wrapper
// ============================================

type NativeGeolocation = typeof import('@capacitor/geolocation').Geolocation;

let nativeGeolocationPromise: Promise<NativeGeolocation | null> | null = null;

function isNativeGeolocationAvailable(): boolean {
  try {
    return isNativePlatform() && isPluginAvailable('Geolocation');
  } catch {
    return false;
  }
}

function getNativeGeolocation(): Promise<NativeGeolocation | null> {
  if (!nativeGeolocationPromise) {
    nativeGeolocationPromise = import('@capacitor/geolocation')
      .then((mod) => mod.Geolocation)
      .catch(() => null);
  }
  return nativeGeolocationPromise;
}

function getWebGeolocation(): Geolocation | null {
  try {
    if (typeof navigator === 'undefined') return null;
    return navigator.geolocation ?? null;
  } catch {
    return null;
  }
}

function toFix(position: { coords: { latitude: number; longitude: number; accuracy: number }; timestamp: number }): LocationFix {
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : 0,
    timestamp: Number.isFinite(position.timestamp) ? position.timestamp : Date.now(),
  };
}

function mapPermissionState(state: string | undefined): LocationPermission {
  switch (state) {
    case 'granted':
      return 'granted';
    case 'denied':
      return 'denied';
    case 'prompt':
    case 'prompt-with-rationale':
      return 'prompt';
    default:
      return 'unavailable';
  }
}

/** Whether any location provider exists on this platform. */
export function isLocationAvailable(): boolean {
  return isNativeGeolocationAvailable() || getWebGeolocation() !== null;
}

/**
 * Read the current permission state without prompting. On the web this uses
 * the Permissions API when present and otherwise reports `prompt`.
 */
export async function checkLocationPermission(): Promise<LocationPermission> {
  if (isNativeGeolocationAvailable()) {
    const native = await getNativeGeolocation();
    if (!native) return 'unavailable';
    try {
      const status = await native.checkPermissions();
      return mapPermissionState(status.location);
    } catch {
      return 'unavailable';
    }
  }

  if (!getWebGeolocation()) return 'unavailable';
  try {
    const permissions = typeof navigator !== 'undefined' ? navigator.permissions : undefined;
    if (!permissions?.query) return 'prompt';
    const status = await permissions.query({ name: 'geolocation' as PermissionName });
    return mapPermissionState(status.state);
  } catch {
    return 'prompt';
  }
}

/**
 * Ask for location permission. Native shells show the system sheet; on the
 * web the browser prompts lazily on the first position request, so this
 * performs one low-power read to trigger it.
 */
export async function requestLocationPermission(): Promise<LocationPermission> {
  if (isNativeGeolocationAvailable()) {
    const native = await getNativeGeolocation();
    if (!native) return 'unavailable';
    try {
      const status = await native.requestPermissions({ permissions: ['location'] });
      return mapPermissionState(status.location);
    } catch {
      return 'unavailable';
    }
  }

  if (!getWebGeolocation()) return 'unavailable';
  const fix = await getCurrentFix(LOW_POWER_OPTIONS);
  if (fix) return 'granted';
  return checkLocationPermission();
}

/**
 * One position read. Resolves to `null` on any failure (denied permission,
 * timeout, no provider) instead of rejecting.
 */
export async function getCurrentFix(options: LocationOptions = LOW_POWER_OPTIONS): Promise<LocationFix | null> {
  const merged = { ...LOW_POWER_OPTIONS, ...options };

  if (isNativeGeolocationAvailable()) {
    const native = await getNativeGeolocation();
    if (!native) return null;
    try {
      const position = await native.getCurrentPosition(merged);
      return toFix(position);
    } catch {
      return null;
    }
  }

  const web = getWebGeolocation();
  if (!web) return null;

  return new Promise<LocationFix | null>((resolve) => {
    let settled = false;
    const finish = (fix: LocationFix | null) => {
      if (settled) return;
      settled = true;
      resolve(fix);
    };
    try {
      web.getCurrentPosition(
        (position) => finish(toFix(position)),
        () => finish(null),
        merged
      );
      // Some browsers never call either callback when the tab is hidden.
      setTimeout(() => finish(null), merged.timeout + 1000);
    } catch {
      finish(null);
    }
  });
}

/**
 * Start a position watch. The returned function stops it. Never throws.
 */
export function watchLocation(
  onFix: (fix: LocationFix) => void,
  options: LocationOptions = LOW_POWER_OPTIONS
): () => void {
  const merged = { ...LOW_POWER_OPTIONS, ...options };
  let handle: WatchHandle | null = null;
  let cancelled = false;

  if (isNativeGeolocationAvailable()) {
    void getNativeGeolocation().then(async (native) => {
      if (!native || cancelled) return;
      try {
        const id = await native.watchPosition(merged, (position) => {
          if (!cancelled && position) onFix(toFix(position));
        });
        if (cancelled) {
          void native.clearWatch({ id }).catch(() => undefined);
          return;
        }
        handle = { kind: 'native', id };
      } catch {
        /* permission denied or services off: no watch, no noise */
      }
    });
  } else {
    const web = getWebGeolocation();
    if (web) {
      try {
        const id = web.watchPosition(
          (position) => {
            if (!cancelled) onFix(toFix(position));
          },
          () => undefined,
          merged
        );
        handle = { kind: 'web', id };
      } catch {
        /* no provider */
      }
    }
  }

  return () => {
    cancelled = true;
    if (!handle) return;
    const current = handle;
    handle = null;
    try {
      if (current.kind === 'web') {
        getWebGeolocation()?.clearWatch(current.id);
      } else {
        void getNativeGeolocation().then((native) => native?.clearWatch({ id: current.id }).catch(() => undefined));
      }
    } catch {
      /* already cleared */
    }
  };
}

// ============================================
// Pure helpers
// ============================================

export function haversineKm(
  a: Pick<LocationFix, 'latitude' | 'longitude'>,
  b: Pick<LocationFix, 'latitude' | 'longitude'>
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function parseIso(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** Local calendar day key (YYYY-MM-DD) for an ISO timestamp. */
export function localDayKey(iso: string, now: Date = new Date()): string {
  const ms = parseIso(iso);
  const date = ms === null ? now : new Date(ms);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Fold a day's stop visits into drive segments between consecutive stops.
 *
 * Pure: sorts by arrival, pairs each completed visit with the next visit,
 * and keeps only segments with a plausible drive duration. Distance is the
 * great-circle distance between the depart fix and the arrive fix, or null
 * when either fix is missing.
 */
export function computeDriveSegments(
  visits: StopVisit[],
  options: { minMinutes?: number; maxMinutes?: number } = {}
): DriveSegment[] {
  const minMinutes = options.minMinutes ?? MIN_DRIVE_MINUTES;
  const maxMinutes = options.maxMinutes ?? MAX_DRIVE_MINUTES;

  const ordered = (visits || [])
    .filter((visit) => visit && visit.customerId && parseIso(visit.arrivedAt) !== null)
    .map((visit) => ({ visit, arrivedMs: parseIso(visit.arrivedAt) as number }))
    .sort((a, b) => a.arrivedMs - b.arrivedMs);

  const segments: DriveSegment[] = [];

  for (let index = 0; index < ordered.length - 1; index += 1) {
    const from = ordered[index].visit;
    const to = ordered[index + 1].visit;
    if (from.customerId === to.customerId) continue;

    const departMs = parseIso(from.departedAt);
    const arriveMs = ordered[index + 1].arrivedMs;
    if (departMs === null) continue;

    const durationMinutes = (arriveMs - departMs) / 60000;
    if (!Number.isFinite(durationMinutes) || durationMinutes < minMinutes || durationMinutes > maxMinutes) {
      continue;
    }

    const distanceKm =
      from.departPosition && to.arrivePosition
        ? Math.round(haversineKm(from.departPosition, to.arrivePosition) * 1000) / 1000
        : null;

    segments.push({
      fromCustomerId: String(from.customerId),
      toCustomerId: String(to.customerId),
      departAt: new Date(departMs).toISOString(),
      arriveAt: new Date(arriveMs).toISOString(),
      distanceKm,
      durationMinutes: Math.round(durationMinutes * 10) / 10,
    });
  }

  return segments;
}

// ============================================
// Persistence (per-account, chemcheck_ prefixed)
// ============================================

function safeLocalStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

export function getDriveStorageKey(email: string = getStoredCurrentUserEmail()): string {
  return `${DRIVE_STORAGE_KEY_PREFIX}${hashIdentity(email)}`;
}

function emptyStore(): DriveStore {
  return { version: 1, visits: [], segments: [] };
}

function readStore(): DriveStore {
  const storage = safeLocalStorage();
  if (!storage) return emptyStore();
  try {
    const raw = storage.getItem(getDriveStorageKey());
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as Partial<DriveStore>;
    return {
      version: 1,
      visits: Array.isArray(parsed.visits) ? parsed.visits : [],
      segments: Array.isArray(parsed.segments) ? parsed.segments : [],
    };
  } catch {
    return emptyStore();
  }
}

function pruneStore(store: DriveStore, now: number = Date.now()): DriveStore {
  const visitCutoff = now - VISIT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const segmentCutoff = now - DRIVE_SEGMENT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return {
    version: 1,
    visits: store.visits.filter((visit) => (parseIso(visit.arrivedAt) ?? 0) >= visitCutoff),
    segments: store.segments.filter((segment) => (parseIso(segment.arriveAt) ?? 0) >= segmentCutoff),
  };
}

function writeStore(store: DriveStore): void {
  const storage = safeLocalStorage();
  if (!storage) return;
  try {
    storage.setItem(getDriveStorageKey(), JSON.stringify(pruneStore(store)));
  } catch {
    /* quota or private mode: drop the observation, keep the app running */
  }
}

/** All persisted drive segments for the signed-in account (newest last). */
export function getStoredDriveSegments(): DriveSegment[] {
  return readStore().segments;
}

/** Persisted stop visits for the signed-in account. */
export function getStoredStopVisits(): StopVisit[] {
  return readStore().visits;
}

/** Drop every drive observation for the signed-in account. */
export function clearDriveData(): void {
  const storage = safeLocalStorage();
  if (!storage) return;
  try {
    storage.removeItem(getDriveStorageKey());
  } catch {
    /* nothing to clear */
  }
}

function segmentKey(segment: DriveSegment): string {
  return `${segment.fromCustomerId}|${segment.toCustomerId}|${segment.departAt}`;
}

function mergeSegments(existing: DriveSegment[], incoming: DriveSegment[]): DriveSegment[] {
  const byKey = new Map(existing.map((segment) => [segmentKey(segment), segment]));
  for (const segment of incoming) {
    byKey.set(segmentKey(segment), segment);
  }
  return [...byKey.values()].sort((a, b) => (parseIso(a.departAt) ?? 0) - (parseIso(b.departAt) ?? 0));
}

/**
 * Recompute segments from the retained visits (grouped per local day so a
 * late-night stop never pairs with the next morning) and persist them.
 * Returns the full segment list after the merge.
 */
export function refreshDriveSegments(now: Date = new Date()): DriveSegment[] {
  const store = readStore();
  const visitsByDay = new Map<string, StopVisit[]>();
  for (const visit of store.visits) {
    const key = localDayKey(visit.arrivedAt, now);
    const bucket = visitsByDay.get(key) ?? [];
    bucket.push(visit);
    visitsByDay.set(key, bucket);
  }

  let merged = store.segments;
  for (const dayVisits of visitsByDay.values()) {
    merged = mergeSegments(merged, computeDriveSegments(dayVisits));
  }
  writeStore({ ...store, segments: merged });
  return merged;
}

/**
 * Average observed drive minutes per (from, to) pair, ready for
 * `routeTimingEstimator.resolveDriveMinutes`.
 */
export function getObservedDriveProfile(): DriveTimeProfile {
  return buildDriveTimeProfile(getStoredDriveSegments());
}

// ============================================
// Stop visit recording
// ============================================

let lastFix: LocationFix | null = null;
let stopWatch: (() => void) | null = null;

/** Most recent fix seen by the watch or a one-off read, if any. */
export function getLastKnownFix(): LocationFix | null {
  return lastFix;
}

function rememberFix(fix: LocationFix): void {
  if (!lastFix || fix.timestamp >= lastFix.timestamp) {
    lastFix = fix;
  }
}

function startStopWatch(): void {
  if (stopWatch) return;
  stopWatch = watchLocation(rememberFix, LOW_POWER_OPTIONS);
}

function endStopWatch(): void {
  if (!stopWatch) return;
  const stop = stopWatch;
  stopWatch = null;
  stop();
}

/** True while a low-power watch is running (a stop is in progress). */
export function isDriveWatchActive(): boolean {
  return stopWatch !== null;
}

async function captureFix(): Promise<LocationFix | null> {
  const fresh = await getCurrentFix(LOW_POWER_OPTIONS);
  if (fresh) {
    rememberFix(fresh);
    return fresh;
  }
  // Fall back to a recent watch fix (under two minutes old) if the read failed.
  if (lastFix && Date.now() - lastFix.timestamp < 2 * 60 * 1000) return lastFix;
  return null;
}

function findOpenVisit(store: DriveStore, customerId: string): StopVisit | undefined {
  return store.visits.find((visit) => visit.customerId === customerId && !visit.departedAt);
}

/**
 * Record that a stop was started. Captures an arrival fix and starts the
 * low-power watch. Idempotent per open visit.
 */
export async function recordStopStarted(customerId: string, at: string = new Date().toISOString()): Promise<StopVisit | null> {
  const id = String(customerId || '').trim();
  if (!id) return null;

  const store = readStore();
  const open = findOpenVisit(store, id);
  if (open) {
    startStopWatch();
    return open;
  }

  const visit: StopVisit = { customerId: id, arrivedAt: at, departedAt: null, arrivePosition: null, departPosition: null };
  store.visits.push(visit);
  writeStore(store);
  startStopWatch();

  const fix = await captureFix();
  if (fix) {
    const latest = readStore();
    const target = findOpenVisit(latest, id);
    if (target) {
      target.arrivePosition = fix;
      writeStore(latest);
      return target;
    }
  }
  return visit;
}

/**
 * Record that a stop was completed. Captures a departure fix, closes the
 * visit, stops the watch when nothing else is in progress, and refreshes
 * today's segments.
 */
export async function recordStopCompleted(customerId: string, at: string = new Date().toISOString()): Promise<DriveSegment[]> {
  const id = String(customerId || '').trim();
  if (!id) return getStoredDriveSegments();

  const store = readStore();
  const open = findOpenVisit(store, id);
  if (!open) return getStoredDriveSegments();

  open.departedAt = at;
  writeStore(store);

  const fix = await captureFix();
  const latest = readStore();
  const closed = latest.visits.find((visit) => visit.customerId === id && visit.departedAt === at);
  if (closed && fix) {
    closed.departPosition = fix;
    writeStore(latest);
  }

  const stillOpen = readStore().visits.some((visit) => !visit.departedAt);
  if (!stillOpen) endStopWatch();

  return refreshDriveSegments();
}

// ============================================
// Time-tracking bridge
// ============================================

let bridgeStop: (() => void) | null = null;
let bridgeSync: Promise<void> | null = null;

/**
 * Reconcile stop visits with proof-of-service time tracking state.
 *
 * - A `timeTracker_` record with no end time means a stop is in progress:
 *   open a visit (and the watch) if we have not already.
 * - A visit we opened whose record is gone (or has an end time) means the
 *   stop was completed: close the visit at the recorded end time, or now.
 */
export async function syncDriveCaptureFromTimeTracking(now: Date = new Date()): Promise<void> {
  if (bridgeSync) return bridgeSync;
  bridgeSync = (async () => {
    let states: ReturnType<typeof getAllTimeStates> = [];
    try {
      states = getAllTimeStates();
    } catch {
      states = [];
    }

    const trackedById = new Map(states.map((state) => [String(state.customerId), state]));
    const openVisits = readStore().visits.filter((visit) => !visit.departedAt);

    for (const visit of openVisits) {
      const tracked = trackedById.get(visit.customerId);
      if (!tracked || tracked.endTime) {
        await recordStopCompleted(visit.customerId, tracked?.endTime || now.toISOString());
      }
    }

    for (const state of states) {
      if (state.endTime) continue;
      const startedMs = parseIso(state.startTime);
      // Ignore stale records from an earlier day; they are not today's route.
      if (startedMs === null || now.getTime() - startedMs > 24 * 60 * 60 * 1000) continue;
      await recordStopStarted(String(state.customerId), state.startTime);
    }
  })().finally(() => {
    bridgeSync = null;
  });
  return bridgeSync;
}

/**
 * Start the time-tracking bridge once for the app session. It polls the
 * time-tracking records, listens for tab visibility/focus and cross-tab
 * storage events, and stops the watch when nothing is in progress.
 *
 * Returns a function that stops the bridge (used by tests and by callers
 * that want to opt out). Calling it twice is harmless.
 */
export function startDriveTimeCapture(): () => void {
  if (bridgeStop) return bridgeStop;
  if (typeof window === 'undefined') return () => undefined;

  const run = () => {
    void syncDriveCaptureFromTimeTracking().catch(() => undefined);
  };

  const onVisibility = () => {
    if (document.visibilityState === 'visible') run();
  };
  const onStorage = (event: StorageEvent) => {
    if (!event.key || event.key.startsWith('timeTracker_')) run();
  };

  const interval = window.setInterval(run, BRIDGE_POLL_MS);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('focus', run);
  window.addEventListener('storage', onStorage);
  run();

  bridgeStop = () => {
    window.clearInterval(interval);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('focus', run);
    window.removeEventListener('storage', onStorage);
    endStopWatch();
    bridgeStop = null;
  };
  return bridgeStop;
}

/** Whether the bridge is currently running. */
export function isDriveTimeCaptureActive(): boolean {
  return bridgeStop !== null;
}

/**
 * Test-only reset of module state (watch, bridge, cached fix). Storage is
 * left alone so persistence can be asserted separately.
 */
export function __resetLocationStateForTests(): void {
  if (bridgeStop) bridgeStop();
  endStopWatch();
  lastFix = null;
  bridgeSync = null;
  nativeGeolocationPromise = null;
}
