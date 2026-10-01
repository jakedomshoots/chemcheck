/**
 * Readings trends per pool.
 *
 * Turns a customer's (or a pool's) service logs and chemical-usage rows into
 * chart-ready series plus a handful of rule-based, conservative diagnostics.
 * Pure functions: no React, no storage.
 */

import { calculateServiceLogLsi, LSI_BALANCED_MAX, LSI_BALANCED_MIN } from '../lsi';
import { getDosingTargets, type TargetRange } from '../dosing';

export type TrendRangeDays = 30 | 90 | 365;
export const TREND_RANGES: TrendRangeDays[] = [30, 90, 365];

export type TrendMetric = 'ph' | 'fc' | 'ta' | 'cya' | 'ch' | 'salt' | 'lsi';
export const TREND_METRICS: TrendMetric[] = ['ph', 'fc', 'ta', 'cya', 'ch', 'salt', 'lsi'];

export interface TrendLog {
  id?: number | string;
  _id?: number | string;
  pool_id?: number | string | null;
  service_date: string;
  ph_value?: number | null;
  chlorine_value?: number | null;
  alkalinity_value?: number | null;
  stabilizer_value?: number | null;
  hardness_value?: number | null;
  hardness_source?: string | null;
  water_temperature?: number | null;
  water_temperature_source?: string | null;
  tds_value?: number | null;
  tds_source?: string | null;
  salt?: number | null;
}

export interface TrendUsage {
  id?: number | string;
  _id?: number | string;
  pool_id?: number | string | null;
  created_date?: string | null;
  chemical_type: string;
  quantity: string;
}

export interface TrendPoint {
  date: string;
  value: number;
  logId: number | string | null;
  inRange: boolean | null;
}

export interface TrendSeries {
  key: TrendMetric;
  label: string;
  shortLabel: string;
  unit: string;
  decimals: number;
  target: { min: number; max: number } | null;
  points: TrendPoint[];
  latest: TrendPoint | null;
  drift: TrendDrift;
  outOfRangeStreak: number;
}

export type TrendDrift = 'rising' | 'falling' | 'stable' | 'unknown';

export interface DoseMarker {
  date: string;
  onVisit: boolean;
  entries: Array<{ chemical_type: string; quantity: string }>;
}

export interface TrendDiagnostic {
  id: string;
  metric: TrendMetric | 'general';
  severity: 'info' | 'watch';
  message: string;
}

export interface ReadingTrends {
  rangeDays: TrendRangeDays;
  start: string;
  end: string;
  visitCount: number;
  series: TrendSeries[];
  doses: DoseMarker[];
  diagnostics: TrendDiagnostic[];
}

export interface BuildReadingTrendsInput {
  serviceLogs: TrendLog[];
  chemicalUsage?: TrendUsage[];
  rangeDays?: TrendRangeDays;
  /** ISO date (YYYY-MM-DD) treated as "today"; defaults to the current date. */
  now?: string | Date;
  poolType?: string | null;
  surfaceType?: string | null;
  /** When set, only logs/usage rows for this pool are included. */
  poolId?: number | string | null;
}

const METRIC_META: Record<TrendMetric, { label: string; shortLabel: string; unit: string; decimals: number; field: keyof TrendLog | null }> = {
  ph: { label: 'pH', shortLabel: 'pH', unit: '', decimals: 1, field: 'ph_value' },
  fc: { label: 'Free chlorine', shortLabel: 'FC', unit: 'ppm', decimals: 1, field: 'chlorine_value' },
  ta: { label: 'Total alkalinity', shortLabel: 'TA', unit: 'ppm', decimals: 0, field: 'alkalinity_value' },
  cya: { label: 'Stabilizer (CYA)', shortLabel: 'CYA', unit: 'ppm', decimals: 0, field: 'stabilizer_value' },
  ch: { label: 'Calcium hardness', shortLabel: 'CH', unit: 'ppm', decimals: 0, field: 'hardness_value' },
  salt: { label: 'Salt', shortLabel: 'Salt', unit: 'ppm', decimals: 0, field: 'salt' },
  lsi: { label: 'LSI', shortLabel: 'LSI', unit: '', decimals: 2, field: null },
};

/* ------------------------------------------------------------------------ */
/* Date helpers                                                              */
/* ------------------------------------------------------------------------ */

export function toIsoDate(value: string | Date): string {
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return String(value).slice(0, 10);
}

function shiftDays(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(year, (month || 1) - 1, (day || 1) + days);
  return toIsoDate(date);
}

export function dayIndex(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number);
  return Math.round(Date.UTC(year, (month || 1) - 1, day || 1) / 86_400_000);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function sameId(a: unknown, b: unknown): boolean {
  return String(a) === String(b);
}

/* ------------------------------------------------------------------------ */
/* Grouping                                                                  */
/* ------------------------------------------------------------------------ */

/**
 * Groups logs by pool id. Logs without a pool land under the `null` key so
 * single-pool customers (the common case) still get one chart.
 */
export function groupLogsByPool<T extends { pool_id?: number | string | null }>(logs: T[]): Array<{ poolId: number | string | null; logs: T[] }> {
  const groups = new Map<string, { poolId: number | string | null; logs: T[] }>();
  for (const log of logs) {
    const poolId = log.pool_id ?? null;
    const key = poolId === null ? '' : String(poolId);
    if (!groups.has(key)) groups.set(key, { poolId, logs: [] });
    groups.get(key)!.logs.push(log);
  }
  return [...groups.values()];
}

/* ------------------------------------------------------------------------ */
/* Series                                                                    */
/* ------------------------------------------------------------------------ */

function metricValue(log: TrendLog, metric: TrendMetric): number | null {
  if (metric === 'lsi') {
    const output = calculateServiceLogLsi({
      ph_value: log.ph_value ?? undefined,
      alkalinity_value: log.alkalinity_value ?? undefined,
      stabilizer_value: log.stabilizer_value ?? undefined,
      hardness_value: log.hardness_value ?? undefined,
      hardness_source: (log.hardness_source as 'calcium' | 'aquachek_total' | undefined) ?? undefined,
      water_temperature: log.water_temperature ?? undefined,
      water_temperature_source: (log.water_temperature_source as 'measured' | 'assumed' | undefined) ?? undefined,
      tds_value: log.tds_value ?? undefined,
      tds_source: (log.tds_source as 'measured' | 'assumed' | undefined) ?? undefined,
    });
    return output.result ? output.result.value : null;
  }
  const field = METRIC_META[metric].field!;
  const raw = log[field];
  return isFiniteNumber(raw) ? raw : null;
}

function targetFor(metric: TrendMetric, targets: ReturnType<typeof getDosingTargets>): { min: number; max: number } | null {
  const pick = (range: TargetRange) => ({ min: range.min, max: range.max });
  switch (metric) {
    case 'ph': return pick(targets.ph);
    case 'fc': return pick(targets.chlorine);
    case 'ta': return pick(targets.alkalinity);
    case 'cya': return pick(targets.stabilizer);
    case 'ch': return pick(targets.hardness);
    case 'salt': return pick(targets.salt);
    case 'lsi': return { min: LSI_BALANCED_MIN, max: LSI_BALANCED_MAX };
    default: return null;
  }
}

/**
 * Least-squares slope in metric units per day. Needs at least three points
 * spread over at least seven days to say anything.
 */
export function slopePerDay(points: Array<{ date: string; value: number }>): number | null {
  if (points.length < 3) return null;
  const xs = points.map((point) => dayIndex(point.date));
  const span = Math.max(...xs) - Math.min(...xs);
  if (span < 7) return null;
  const n = points.length;
  const meanX = xs.reduce((sum, x) => sum + x, 0) / n;
  const meanY = points.reduce((sum, point) => sum + point.value, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    num += (xs[i] - meanX) * (points[i].value - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  if (den === 0) return null;
  return num / den;
}

function classifyDrift(points: TrendPoint[], target: { min: number; max: number } | null): TrendDrift {
  const slope = slopePerDay(points);
  if (slope === null) return 'unknown';
  const xs = points.map((point) => dayIndex(point.date));
  const span = Math.max(...xs) - Math.min(...xs);
  const projected = slope * span;
  // Meaningful drift: projected change over the window exceeds a quarter of
  // the target band (or 10% of the mean when no band is known).
  const width = target ? (target.max - target.min) : Math.abs(points.reduce((sum, p) => sum + p.value, 0) / points.length) || 1;
  const threshold = width * 0.25;
  if (projected > threshold) return 'rising';
  if (projected < -threshold) return 'falling';
  return 'stable';
}

function outOfRangeStreak(points: TrendPoint[]): number {
  let streak = 0;
  for (let i = points.length - 1; i >= 0; i -= 1) {
    if (points[i].inRange === false) streak += 1;
    else break;
  }
  return streak;
}

/* ------------------------------------------------------------------------ */
/* Diagnostics                                                               */
/* ------------------------------------------------------------------------ */

function consecutiveRises(points: TrendPoint[], minDelta: number): number {
  let rises = 0;
  for (let i = points.length - 1; i > 0; i -= 1) {
    if (points[i].value - points[i - 1].value >= minDelta) rises += 1;
    else break;
  }
  return rises;
}

function usageMentions(doses: DoseMarker[], pattern: RegExp): number {
  return doses.reduce((count, dose) => count + dose.entries.filter((entry) => pattern.test(entry.chemical_type)).length, 0);
}

function buildDiagnostics(series: TrendSeries[], doses: DoseMarker[]): TrendDiagnostic[] {
  const byKey = Object.fromEntries(series.map((item) => [item.key, item])) as Partial<Record<TrendMetric, TrendSeries>>;
  const out: TrendDiagnostic[] = [];
  const ph = byKey.ph;
  const fc = byKey.fc;
  const ta = byKey.ta;
  const cya = byKey.cya;
  const ch = byKey.ch;
  const salt = byKey.salt;
  const lsi = byKey.lsi;

  if (ph && ph.points.length >= 3) {
    const rises = consecutiveRises(ph.points, 0.1);
    const taHigh = ta?.latest ? ta.latest.value > 120 : false;
    if (rises >= 2 || ph.drift === 'rising') {
      out.push({
        id: 'ph-rising',
        metric: 'ph',
        severity: 'watch',
        message: taHigh
          ? `pH keeps climbing between visits and alkalinity is ${ta!.latest!.value} ppm. High TA drives pH up — lower TA toward 80–100 ppm and the pH will hold.`
          : 'pH rises every visit. Check aeration (water features, spillovers, bubblers) and keep alkalinity near the low end of 80–120 ppm.',
      });
    } else if (ph.drift === 'falling') {
      out.push({
        id: 'ph-falling',
        metric: 'ph',
        severity: 'watch',
        message: 'pH is trending down. Check for an over-active acid feeder or trichlor tablets, and confirm alkalinity is at least 80 ppm.',
      });
    }
  }

  if (fc && fc.points.length >= 3) {
    const lowStreak = fc.outOfRangeStreak >= 2 && fc.latest && fc.target && fc.latest.value < fc.target.min;
    const cyaLatest = cya?.latest?.value;
    if (lowStreak && isFiniteNumber(cyaLatest) && cyaLatest < 30) {
      out.push({
        id: 'fc-low-cya-low',
        metric: 'fc',
        severity: 'watch',
        message: `Chlorine has been low ${fc.outOfRangeStreak} visits in a row with CYA at ${cyaLatest} ppm. Sunlight is burning it off — bring stabilizer up to 30–50 ppm.`,
      });
    } else if (lowStreak && isFiniteNumber(cyaLatest) && cyaLatest > 80) {
      out.push({
        id: 'fc-low-cya-high',
        metric: 'fc',
        severity: 'watch',
        message: `Chlorine keeps testing low with CYA at ${cyaLatest} ppm. The FC target scales with CYA; plan a partial drain and switch to unstabilized chlorine.`,
      });
    } else if (lowStreak) {
      out.push({
        id: 'fc-low-streak',
        metric: 'fc',
        severity: 'watch',
        message: `Chlorine has been under target ${fc.outOfRangeStreak} visits in a row. Check chlorinator or cell output and look for algae or phosphates.`,
      });
    }
  }

  if (ta && ta.drift === 'falling' && usageMentions(doses, /acid/i) >= 2) {
    out.push({
      id: 'ta-falling-acid',
      metric: 'ta',
      severity: 'info',
      message: 'Alkalinity is drifting down after repeated acid additions. Expect to add bicarbonate soon; smaller, more frequent acid doses hold TA steadier.',
    });
  }

  if (ch && ch.drift === 'rising' && usageMentions(doses, /cal[-\s]?hypo|calcium hypochlorite/i) >= 2) {
    out.push({
      id: 'ch-rising-calhypo',
      metric: 'ch',
      severity: 'info',
      message: 'Calcium hardness is climbing while cal-hypo is being used. Each pound adds calcium — switch to liquid chlorine to keep hardness in range.',
    });
  }

  if (cya && cya.drift === 'rising' && usageMentions(doses, /tablet|trichlor|dichlor/i) >= 2) {
    out.push({
      id: 'cya-rising-tabs',
      metric: 'cya',
      severity: 'info',
      message: 'Stabilizer is rising with tablet use. Trichlor adds CYA with every tab — budget for a partial drain or move to liquid chlorine.',
    });
  }

  if (salt && salt.drift === 'falling' && salt.points.length >= 3) {
    out.push({
      id: 'salt-falling',
      metric: 'salt',
      severity: 'info',
      message: 'Salt is dropping between visits. Rain, backwashing or splash-out dilutes it; a steady fall with no weather may mean a leak.',
    });
  }

  if (lsi && lsi.outOfRangeStreak >= 2 && lsi.latest) {
    const aggressive = lsi.latest.value < LSI_BALANCED_MIN;
    out.push({
      id: aggressive ? 'lsi-aggressive' : 'lsi-scaling',
      metric: 'lsi',
      severity: 'watch',
      message: aggressive
        ? `LSI has been aggressive ${lsi.outOfRangeStreak} visits running. Corrosive water etches plaster — raise calcium and alkalinity toward target.`
        : `LSI has been scale-forming ${lsi.outOfRangeStreak} visits running. Expect scale on tile and in the cell — keep pH at 7.4 and alkalinity near 80 ppm.`,
    });
  }

  return out;
}

/* ------------------------------------------------------------------------ */
/* Entry point                                                               */
/* ------------------------------------------------------------------------ */

export function buildReadingTrends(input: BuildReadingTrendsInput): ReadingTrends {
  const rangeDays: TrendRangeDays = input.rangeDays ?? 90;
  const end = toIsoDate(input.now ?? new Date());
  const start = shiftDays(end, -(rangeDays - 1));
  const targets = getDosingTargets(input.poolType, input.surfaceType);

  const poolFilter = (row: { pool_id?: number | string | null }) => (
    input.poolId === undefined || input.poolId === null ? true : sameId(row.pool_id, input.poolId)
  );

  const logs = (input.serviceLogs || [])
    .filter((log) => typeof log.service_date === 'string' && log.service_date.length >= 10)
    .map((log) => ({ ...log, service_date: toIsoDate(log.service_date) }))
    .filter((log) => log.service_date >= start && log.service_date <= end)
    .filter(poolFilter)
    .sort((a, b) => a.service_date.localeCompare(b.service_date));

  const visitDates = new Set(logs.map((log) => log.service_date));

  const usageByDate = new Map<string, DoseMarker>();
  for (const row of input.chemicalUsage || []) {
    if (!row || typeof row.created_date !== 'string') continue;
    const date = toIsoDate(row.created_date);
    if (date < start || date > end) continue;
    if (!poolFilter(row)) continue;
    if (!usageByDate.has(date)) usageByDate.set(date, { date, onVisit: visitDates.has(date), entries: [] });
    usageByDate.get(date)!.entries.push({ chemical_type: String(row.chemical_type || 'Chemical'), quantity: String(row.quantity || '') });
  }
  const doses = [...usageByDate.values()].sort((a, b) => a.date.localeCompare(b.date));

  const series: TrendSeries[] = TREND_METRICS.map((metric) => {
    const meta = METRIC_META[metric];
    const target = targetFor(metric, targets);
    const points: TrendPoint[] = [];
    for (const log of logs) {
      const value = metricValue(log, metric);
      if (value === null) continue;
      points.push({
        date: log.service_date,
        value,
        logId: log._id ?? log.id ?? null,
        inRange: target ? value >= target.min && value <= target.max : null,
      });
    }
    return {
      key: metric,
      label: meta.label,
      shortLabel: meta.shortLabel,
      unit: meta.unit,
      decimals: meta.decimals,
      target,
      points,
      latest: points.length ? points[points.length - 1] : null,
      drift: classifyDrift(points, target),
      outOfRangeStreak: outOfRangeStreak(points),
    };
  });

  return {
    rangeDays,
    start,
    end,
    visitCount: logs.length,
    series,
    doses,
    diagnostics: buildDiagnostics(series, doses),
  };
}

/** Rows for the accessible table fallback: one row per visit date. */
export function trendsToTableRows(trends: ReadingTrends): Array<{ date: string; values: Partial<Record<TrendMetric, number>>; doses: string[] }> {
  const byDate = new Map<string, { date: string; values: Partial<Record<TrendMetric, number>>; doses: string[] }>();
  const ensure = (date: string) => {
    if (!byDate.has(date)) byDate.set(date, { date, values: {}, doses: [] });
    return byDate.get(date)!;
  };
  for (const item of trends.series) {
    for (const point of item.points) {
      ensure(point.date).values[item.key] = point.value;
    }
  }
  for (const dose of trends.doses) {
    ensure(dose.date).doses.push(...dose.entries.map((entry) => `${entry.chemical_type} ${entry.quantity}`.trim()));
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
