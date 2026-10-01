const DEFAULT_FALLBACK_DURATION_MINUTES = 15;
const MIN_RESOLVED_DURATION_MINUTES = 10;
const MAX_RESOLVED_DURATION_MINUTES = 180;
const MIN_HISTORY_DURATION_MINUTES = 5;
const MAX_HISTORY_DURATION_MINUTES = 180;
const HISTORY_SAMPLE_LIMIT = 8;

type CustomerLike = Record<string, unknown>;
type ServiceLogLike = Record<string, unknown>;

export interface DurationProfile {
  customerMedianById: Map<number, number>;
}

export interface ServiceTimingSummary {
  stopsAssigned: number;
  totalServiceMinutes: number;
  timePerPoolMinutes: number;
}

function toFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampDurationMinutes(value: number): number {
  return Math.min(MAX_RESOLVED_DURATION_MINUTES, Math.max(MIN_RESOLVED_DURATION_MINUTES, value));
}

function getCustomerNumericId(record: CustomerLike): number | null {
  const id = toFiniteNumber(record._id ?? record.id ?? record.customer_id ?? record.customerId);
  return id;
}

function getMedian(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

function getExplicitDurationMinutes(customer: CustomerLike): number | null {
  const durationMs = toFiniteNumber(customer.duration_ms);
  const candidates = [
    customer.estimatedDuration,
    customer.estimated_duration,
    customer.average_duration_minutes,
    customer.avg_duration_minutes,
    customer.typical_duration_minutes,
    customer.duration,
    durationMs !== null ? durationMs / 60000 : null,
  ];

  for (const candidate of candidates) {
    const parsed = toFiniteNumber(candidate);
    if (parsed !== null && parsed > 0) {
      return clampDurationMinutes(parsed);
    }
  }

  return null;
}

export function buildDurationProfile(serviceLogs: ServiceLogLike[] | null | undefined): DurationProfile {
  const durationsByCustomer = new Map<number, number[]>();

  for (const log of serviceLogs || []) {
    if (!log || typeof log !== "object") continue;
    const customerId = getCustomerNumericId(log);
    const durationMs = toFiniteNumber(log.duration_ms ?? log.durationMs);

    if (customerId === null || durationMs === null || durationMs <= 0) {
      continue;
    }

    const durationMinutes = durationMs / 60000;
    if (
      !Number.isFinite(durationMinutes) ||
      durationMinutes < MIN_HISTORY_DURATION_MINUTES ||
      durationMinutes > MAX_HISTORY_DURATION_MINUTES
    ) {
      continue;
    }

    if (!durationsByCustomer.has(customerId)) {
      durationsByCustomer.set(customerId, []);
    }

    durationsByCustomer.get(customerId)?.push(durationMinutes);
  }

  const customerMedianById = new Map<number, number>();
  for (const [customerId, durations] of durationsByCustomer.entries()) {
    const recentDurations = durations.slice(0, HISTORY_SAMPLE_LIMIT);
    const median = getMedian(recentDurations);
    if (median === null) continue;
    customerMedianById.set(customerId, clampDurationMinutes(median));
  }

  return { customerMedianById };
}

export function resolveServiceDurationMinutes(
  customer: CustomerLike,
  options: { customerMedian?: number | null; fallback?: number } = {}
): number {
  const explicitDuration = getExplicitDurationMinutes(customer);
  if (explicitDuration !== null) return explicitDuration;

  const customerMedian = toFiniteNumber(options.customerMedian);
  if (customerMedian !== null && customerMedian > 0) {
    return clampDurationMinutes(customerMedian);
  }

  const fallback = toFiniteNumber(options.fallback);
  if (fallback !== null && fallback > 0) {
    return clampDurationMinutes(fallback);
  }

  return DEFAULT_FALLBACK_DURATION_MINUTES;
}

export function calculateServiceTimingSummary(
  customers: CustomerLike[] | null | undefined,
  options: { customerMedianById?: Map<number, number>; fallback?: number } = {}
): ServiceTimingSummary {
  const assignedCustomers = customers || [];
  const customerMedianById = options.customerMedianById ?? new Map<number, number>();

  if (assignedCustomers.length === 0) {
    return {
      stopsAssigned: 0,
      totalServiceMinutes: 0,
      timePerPoolMinutes: 0,
    };
  }

  const totalServiceMinutes = assignedCustomers.reduce((total, customer) => {
    const customerRecord = customer as CustomerLike;
    const customerId = getCustomerNumericId(customerRecord);
    const customerMedian = customerId === null ? null : customerMedianById.get(customerId) ?? null;
    const resolvedDuration = resolveServiceDurationMinutes(customerRecord, {
      customerMedian,
      fallback: options.fallback ?? DEFAULT_FALLBACK_DURATION_MINUTES,
    });
    return total + resolvedDuration;
  }, 0);

  return {
    stopsAssigned: assignedCustomers.length,
    totalServiceMinutes: Math.round(totalServiceMinutes),
    timePerPoolMinutes: Math.round(totalServiceMinutes / assignedCustomers.length),
  };
}

export function parseClockToMinutes(timeValue: string | null | undefined): number | null {
  if (!timeValue || !String(timeValue).includes(":")) return null;
  const [hoursRaw, minutesRaw] = String(timeValue).split(":");
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return Math.min(23, Math.max(0, hours)) * 60 + Math.min(59, Math.max(0, minutes));
}

export function parseWorkingHoursCapacity(
  workingHoursStart: string | null | undefined,
  workingHoursEnd: string | null | undefined,
  timePerPoolMinutes: number | null | undefined
): number | null {
  const startMinutes = parseClockToMinutes(workingHoursStart);
  const endMinutes = parseClockToMinutes(workingHoursEnd);
  const minutesPerPool = toFiniteNumber(timePerPoolMinutes);

  if (startMinutes === null || endMinutes === null) return null;
  if (endMinutes <= startMinutes) return null;
  if (minutesPerPool === null || minutesPerPool <= 0) return null;

  return Math.floor((endMinutes - startMinutes) / minutesPerPool);
}

// ============================================
// Observed drive time (fed by src/lib/native/location.ts)
// ============================================

/** Observations needed before an observed average overrides the estimate. */
export const MIN_DRIVE_OBSERVATIONS = 3;
/** Used when no override and no routing estimate exists for a leg. */
export const DEFAULT_DRIVE_MINUTES = 12;
const MAX_OBSERVED_DRIVE_MINUTES = 4 * 60;

export interface DriveObservation {
  averageMinutes: number;
  observations: number;
  /** null when no observation carried a position fix */
  averageDistanceKm: number | null;
}

export type DriveTimeProfile = Map<string, DriveObservation>;

export interface DriveSegmentLike {
  fromCustomerId: string | number;
  toCustomerId: string | number;
  durationMinutes: number;
  distanceKm?: number | null;
}

export function driveKey(fromCustomerId: string | number, toCustomerId: string | number): string {
  return `${String(fromCustomerId)}->${String(toCustomerId)}`;
}

/**
 * Average observed drive minutes per (from, to) pair. Direction matters:
 * A->B and B->A are separate keys, because one-way streets and left turns
 * make them different drives.
 */
export function buildDriveTimeProfile(segments: DriveSegmentLike[] | null | undefined): DriveTimeProfile {
  const totals = new Map<string, { minutes: number; count: number; km: number; kmCount: number }>();

  for (const segment of segments || []) {
    if (!segment || segment.fromCustomerId === undefined || segment.toCustomerId === undefined) continue;
    const minutes = toFiniteNumber(segment.durationMinutes);
    if (minutes === null || minutes <= 0 || minutes > MAX_OBSERVED_DRIVE_MINUTES) continue;

    const key = driveKey(segment.fromCustomerId, segment.toCustomerId);
    const entry = totals.get(key) ?? { minutes: 0, count: 0, km: 0, kmCount: 0 };
    entry.minutes += minutes;
    entry.count += 1;
    const km = segment.distanceKm === null || segment.distanceKm === undefined ? null : toFiniteNumber(segment.distanceKm);
    if (km !== null && km >= 0) {
      entry.km += km;
      entry.kmCount += 1;
    }
    totals.set(key, entry);
  }

  const profile: DriveTimeProfile = new Map();
  for (const [key, entry] of totals.entries()) {
    profile.set(key, {
      averageMinutes: Math.round((entry.minutes / entry.count) * 10) / 10,
      observations: entry.count,
      averageDistanceKm: entry.kmCount > 0 ? Math.round((entry.km / entry.kmCount) * 100) / 100 : null,
    });
  }
  return profile;
}

/**
 * Drive minutes for one leg: the observed average when there are enough
 * observations, otherwise the caller's estimate (routing engine or default).
 */
export function resolveDriveMinutes(
  fromCustomerId: string | number | null | undefined,
  toCustomerId: string | number | null | undefined,
  options: {
    estimate?: number | null;
    profile?: DriveTimeProfile | null;
    minObservations?: number;
    fallback?: number;
  } = {}
): { minutes: number; source: 'observed' | 'estimate' | 'fallback'; observations: number } {
  const minObservations = options.minObservations ?? MIN_DRIVE_OBSERVATIONS;
  const fallback = toFiniteNumber(options.fallback) ?? DEFAULT_DRIVE_MINUTES;

  if (fromCustomerId !== null && fromCustomerId !== undefined && toCustomerId !== null && toCustomerId !== undefined) {
    const observed = options.profile?.get(driveKey(fromCustomerId, toCustomerId));
    if (observed && observed.observations >= minObservations && observed.averageMinutes > 0) {
      return { minutes: Math.round(observed.averageMinutes), source: 'observed', observations: observed.observations };
    }
  }

  const estimate = options.estimate === null || options.estimate === undefined ? null : toFiniteNumber(options.estimate);
  if (estimate !== null && estimate >= 0) {
    return { minutes: Math.round(estimate), source: 'estimate', observations: 0 };
  }

  return { minutes: Math.round(Math.max(0, fallback)), source: 'fallback', observations: 0 };
}

export interface RouteFinishEstimate {
  /** null when nothing is pending */
  finishAt: Date | null;
  remainingServiceMinutes: number;
  remainingDriveMinutes: number;
  remainingMinutes: number;
  pendingStops: number;
}

/**
 * Estimated finish time for the rest of the day: service time for each
 * pending stop (customer history aware) plus a drive leg into each stop.
 * The first leg starts from `fromCustomerId` (the last completed stop) when
 * given, so an observed drive average can apply to it too.
 */
export function estimateRouteFinishTime(
  pendingCustomers: CustomerLike[] | null | undefined,
  options: {
    now?: Date;
    customerMedianById?: Map<number, number>;
    serviceFallback?: number;
    driveProfile?: DriveTimeProfile | null;
    driveFallback?: number;
    fromCustomerId?: string | number | null;
  } = {}
): RouteFinishEstimate {
  const now = options.now ?? new Date();
  const pending = (pendingCustomers || []).filter((customer) => customer && typeof customer === 'object');
  const customerMedianById = options.customerMedianById ?? new Map<number, number>();
  const driveFallback = toFiniteNumber(options.driveFallback) ?? DEFAULT_DRIVE_MINUTES;

  if (pending.length === 0) {
    return { finishAt: null, remainingServiceMinutes: 0, remainingDriveMinutes: 0, remainingMinutes: 0, pendingStops: 0 };
  }

  let serviceMinutes = 0;
  let driveMinutes = 0;
  let previousId: string | number | null | undefined = options.fromCustomerId;

  for (const customer of pending) {
    const numericId = getCustomerNumericId(customer);
    const customerMedian = numericId === null ? null : customerMedianById.get(numericId) ?? null;
    serviceMinutes += resolveServiceDurationMinutes(customer, {
      customerMedian,
      fallback: options.serviceFallback ?? DEFAULT_FALLBACK_DURATION_MINUTES,
    });

    const currentId = (customer._id ?? customer.id ?? null) as string | number | null;
    driveMinutes += resolveDriveMinutes(previousId, currentId, {
      profile: options.driveProfile,
      fallback: driveFallback,
    }).minutes;
    previousId = currentId;
  }

  const remainingMinutes = Math.round(serviceMinutes + driveMinutes);
  return {
    finishAt: new Date(now.getTime() + remainingMinutes * 60000),
    remainingServiceMinutes: Math.round(serviceMinutes),
    remainingDriveMinutes: Math.round(driveMinutes),
    remainingMinutes,
    pendingStops: pending.length,
  };
}
