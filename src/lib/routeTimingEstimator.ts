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
  return id !== null ? id : null;
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
  const candidates = [
    customer.estimatedDuration,
    customer.estimated_duration,
    customer.average_duration_minutes,
    customer.avg_duration_minutes,
    customer.typical_duration_minutes,
    customer.duration,
    toFiniteNumber(customer.duration_ms) !== null ? Number(customer.duration_ms) / 60000 : null,
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
