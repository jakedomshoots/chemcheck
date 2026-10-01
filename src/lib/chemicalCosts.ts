/**
 * Chemical cost model shared by the Convex backend and the dashboard.
 *
 * - A catalog of common pool chemicals with alias matching so human labels
 *   ("pH Down", "Chlorine Tablets") resolve to a priced product.
 * - Cost computation for one usage row from a price row + parsed quantity.
 * - Pure roll-ups (per customer/pool, technician, route day, month, chemical).
 * - Small formatting / date-range helpers for the UI.
 */

import {
  canonicalUnitForFamily,
  convertAmount,
  parseQuantity,
  type AnyUnit,
  type CanonicalUnit,
  type ParsedQuantity,
  type QuantityFamily,
} from "./quantityParser";

// ============================================
// Catalog
// ============================================

export interface CatalogEntry {
  key: string;
  label: string;
  family: Exclude<QuantityFamily, "unknown">;
  unit: CanonicalUnit;
  /** Placeholder USD price per unit; the owner edits it. */
  default_price: number;
  package_size?: number;
  package_price?: number;
  aliases: string[];
}

export const CHEMICAL_CATALOG: CatalogEntry[] = [
  {
    key: "liquid_chlorine", label: "Liquid Chlorine", family: "liquid", unit: "gal", default_price: 4.5,
    aliases: ["liquid chlorine", "chlorine liquid", "liquid chlor", "sodium hypochlorite", "bleach", "liquid shock"],
  },
  {
    key: "muriatic_acid", label: "Muriatic Acid", family: "liquid", unit: "gal", default_price: 9,
    aliases: ["muriatic", "muriatic acid", "acid", "ph down", "ph minus", "ph reducer", "hydrochloric acid", "liquid acid"],
  },
  {
    key: "cal_hypo", label: "Cal-Hypo Shock", family: "solid", unit: "lb", default_price: 5,
    aliases: ["cal hypo", "cal-hypo", "calcium hypochlorite", "shock", "granular chlorine", "granular shock"],
  },
  {
    key: "trichlor_tabs", label: "Trichlor Tablets", family: "tabs", unit: "tabs", default_price: 3,
    aliases: ["chlorine tablets", "chlorine tabs", "chlorine_tabs", "tabs", "tablets", "trichlor", "trichlor tabs", "pucks", "3 inch tabs", "3\" tabs"],
  },
  {
    key: "sodium_bicarb", label: "Sodium Bicarbonate", family: "solid", unit: "lb", default_price: 1.5,
    aliases: ["alkalinity up", "alk up", "baking soda", "bicarb", "sodium bicarb", "sodium bicarbonate", "alkalinity increaser"],
  },
  {
    key: "soda_ash", label: "Soda Ash", family: "solid", unit: "lb", default_price: 2.5,
    aliases: ["ph up", "ph plus", "ph increaser", "soda ash", "sodium carbonate"],
  },
  {
    key: "calcium_chloride", label: "Calcium Chloride", family: "solid", unit: "lb", default_price: 2,
    aliases: ["calcium chloride", "cal chloride", "hardness up", "calcium up", "calcium increaser", "hardness increaser"],
  },
  {
    key: "cyanuric_acid", label: "Cyanuric Acid (CYA)", family: "solid", unit: "lb", default_price: 4,
    aliases: ["stabilizer", "cya", "conditioner", "cyanuric", "cyanuric acid", "stabiliser"],
  },
  {
    key: "salt", label: "Pool Salt", family: "bags", unit: "bags", default_price: 12, package_size: 40,
    aliases: ["salt", "pool salt", "sodium chloride", "salt bag", "salt bags"],
  },
];

/** "pH Down (Muriatic)" -> "ph_down_muriatic". Stable key for lookups and the price index. */
export function normalizeChemicalKey(value: string | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const ALIAS_INDEX: Map<string, CatalogEntry> = (() => {
  const index = new Map<string, CatalogEntry>();
  for (const entry of CHEMICAL_CATALOG) {
    index.set(entry.key, entry);
    index.set(normalizeChemicalKey(entry.label), entry);
    for (const alias of entry.aliases) index.set(normalizeChemicalKey(alias), entry);
  }
  return index;
})();

/** Resolve a chemical label to a catalog product (exact key, alias, then keyword heuristics). */
export function resolveCatalogEntry(chemicalType: string | null | undefined): CatalogEntry | null {
  const key = normalizeChemicalKey(chemicalType);
  if (!key) return null;
  const direct = ALIAS_INDEX.get(key);
  if (direct) return direct;
  const text = key.replace(/_/g, " ");
  const find = (k: string) => CHEMICAL_CATALOG.find((e) => e.key === k)!;
  if (/\b(tab|tabs|tablet|puck)/.test(text)) return find("trichlor_tabs");
  if (/\bsalt\b/.test(text)) return find("salt");
  if (/cyanuric|stabili[sz]er|conditioner|\bcya\b/.test(text)) return find("cyanuric_acid");
  if (/bicarb|baking soda|alkalinity/.test(text)) return find("sodium_bicarb");
  if (/soda ash|ph up|ph plus|ph increas/.test(text)) return find("soda_ash");
  if (/calcium chloride|hardness|calcium up/.test(text)) return find("calcium_chloride");
  if (/cal ?hypo|hypochlorite|shock/.test(text)) return find("cal_hypo");
  if (/muriatic|acid|ph down|ph minus/.test(text)) return find("muriatic_acid");
  if (/liquid|bleach|chlorine/.test(text)) return find("liquid_chlorine");
  return null;
}

/** Family hint for the parser. Falls back to keyword heuristics for unknown products. */
export function chemicalFamilyFor(chemicalType: string | null | undefined): QuantityFamily {
  const entry = resolveCatalogEntry(chemicalType);
  if (entry) return entry.family;
  const text = normalizeChemicalKey(chemicalType).replace(/_/g, " ");
  if (/liquid|acid|algaecide|clarifier|enzyme|phosphate|metal|sequest/.test(text)) return "liquid";
  if (/tab|puck/.test(text)) return "tabs";
  if (/bag|salt/.test(text)) return "bags";
  if (/granular|powder|dry|chloride|bicarb|ash|shock/.test(text)) return "solid";
  return "unknown";
}

// ============================================
// Cost computation
// ============================================

export interface PriceLike {
  chemical_type: string;
  unit: string;
  unit_price: number;
  package_size?: number;
  package_price?: number;
}

export interface UsageCost {
  normalized_amount: number;
  normalized_unit: CanonicalUnit;
  /** USD per canonical unit actually used for the row. */
  unit_cost: number;
  total_cost: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Effective USD per `price.unit`: unit_price, or package_price / package_size when unit_price is unset. */
export function effectiveUnitPrice(price: PriceLike): number {
  if (Number.isFinite(price.unit_price) && price.unit_price > 0) return price.unit_price;
  if (price.package_price && price.package_size && price.package_size > 0) {
    return price.package_price / price.package_size;
  }
  return 0;
}

/**
 * Amount of the parsed quantity expressed in the price's unit, bridging
 * bags <-> weight when the price row knows the package size (lb per bag).
 */
export function amountInPriceUnit(parsed: ParsedQuantity, price: PriceLike): number | null {
  const priceUnit = price.unit as AnyUnit;
  const direct = convertAmount(parsed.amount, parsed.unit, priceUnit, parsed.family);
  if (direct !== null) return direct;

  const packageSize = parsed.package_size ?? price.package_size;
  if (priceUnit === "bags" && parsed.unit === "lb" && packageSize) {
    return Math.round((parsed.amount / packageSize) * 10000) / 10000;
  }
  if (parsed.unit === "bags" && packageSize) {
    const pounds = parsed.amount * packageSize;
    return convertAmount(pounds, "lb", priceUnit);
  }
  return null;
}

/** Cost of one usage row. Null when the quantity cannot be parsed or the units do not bridge. */
export function computeUsageCost(
  price: PriceLike | null | undefined,
  chemicalType: string,
  quantity: string | null | undefined,
): UsageCost | null {
  if (!price) return null;
  const family = chemicalFamilyFor(chemicalType);
  const parsed = parseQuantity(quantity, { family });
  if (!parsed) return null;
  const amountInUnit = amountInPriceUnit(parsed, price);
  if (amountInUnit === null) return null;
  const unitPrice = effectiveUnitPrice(price);
  const total = round2(amountInUnit * unitPrice);
  const unitCost = parsed.amount > 0 ? round2(total / parsed.amount) : 0;
  return {
    normalized_amount: parsed.amount,
    normalized_unit: parsed.unit,
    unit_cost: Number.isFinite(unitCost) ? unitCost : 0,
    total_cost: total,
  };
}

/** Parsed quantity only (no price). Used to store normalized amounts even for unpriced rows. */
export function normalizeUsageQuantity(chemicalType: string, quantity: string | null | undefined): ParsedQuantity | null {
  return parseQuantity(quantity, { family: chemicalFamilyFor(chemicalType) });
}

/** Pick the price row for a chemical label: exact normalized key, then catalog alias match. */
export function findPriceForChemical<T extends PriceLike>(prices: T[], chemicalType: string): T | null {
  const key = normalizeChemicalKey(chemicalType);
  if (!key) return null;
  const exact = prices.find((p) => normalizeChemicalKey(p.chemical_type) === key);
  if (exact) return exact;
  const entry = resolveCatalogEntry(chemicalType);
  if (!entry) return null;
  return prices.find((p) => resolveCatalogEntry(p.chemical_type)?.key === entry.key) ?? null;
}

// ============================================
// Roll-ups
// ============================================

export interface CostRow {
  id: string;
  customer_id: string;
  customer_name: string;
  pool_id?: string;
  pool_name?: string;
  service_day?: string;
  technician: string;
  /** YYYY-MM-DD */
  date: string;
  chemical_type: string;
  quantity: string;
  normalized_amount?: number;
  normalized_unit?: string;
  /** null when no price or the quantity could not be parsed. */
  cost: number | null;
}

export interface Bucket {
  key: string;
  label: string;
  total_cost: number;
  rows: number;
  priced_rows: number;
  visits: number;
  cost_per_visit: number;
}

export interface PoolBucket extends Bucket {
  customer_id: string;
  pool_id?: string;
  service_day?: string;
}

export interface ChemicalBucket {
  chemical_type: string;
  total_cost: number;
  rows: number;
  priced_rows: number;
  amount: number;
  unit: string;
}

export interface CustomerBreakdown extends PoolBucket {
  chemicals: ChemicalBucket[];
  dates: string[];
}

export interface CostRollup {
  totals: {
    total_cost: number;
    rows: number;
    priced_rows: number;
    unpriced_rows: number;
    visits: number;
    cost_per_visit: number;
  };
  top_pools: PoolBucket[];
  by_customer: CustomerBreakdown[];
  by_technician: Bucket[];
  by_route_day: Bucket[];
  by_month: Bucket[];
  by_chemical: ChemicalBucket[];
  unpriced_chemicals: string[];
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function visitKey(row: CostRow): string {
  return `${row.pool_id ?? row.customer_id}|${row.date}`;
}

function finalizeBucket<T extends Bucket>(bucket: T, visits: Set<string>): T {
  bucket.visits = visits.size;
  bucket.total_cost = round2(bucket.total_cost);
  bucket.cost_per_visit = bucket.visits > 0 ? round2(bucket.total_cost / bucket.visits) : 0;
  return bucket;
}

/** Group rows into buckets by a key; returns buckets sorted by total cost descending. */
function groupRows<T extends Bucket>(
  rows: CostRow[],
  keyOf: (row: CostRow) => string,
  make: (row: CostRow, key: string) => T,
): T[] {
  const buckets = new Map<string, { bucket: T; visits: Set<string> }>();
  for (const row of rows) {
    const key = keyOf(row);
    let entry = buckets.get(key);
    if (!entry) {
      entry = { bucket: make(row, key), visits: new Set() };
      buckets.set(key, entry);
    }
    entry.bucket.rows += 1;
    entry.visits.add(visitKey(row));
    if (row.cost !== null) {
      entry.bucket.priced_rows += 1;
      entry.bucket.total_cost += row.cost;
    }
  }
  return [...buckets.values()]
    .map(({ bucket, visits }) => finalizeBucket(bucket, visits))
    .sort((a, b) => b.total_cost - a.total_cost || a.label.localeCompare(b.label));
}

function emptyBucket(key: string, label: string): Bucket {
  return { key, label, total_cost: 0, rows: 0, priced_rows: 0, visits: 0, cost_per_visit: 0 };
}

function chemicalBuckets(rows: CostRow[]): ChemicalBucket[] {
  const map = new Map<string, ChemicalBucket>();
  for (const row of rows) {
    const key = normalizeChemicalKey(row.chemical_type) || "unknown";
    let bucket = map.get(key);
    if (!bucket) {
      bucket = { chemical_type: row.chemical_type, total_cost: 0, rows: 0, priced_rows: 0, amount: 0, unit: row.normalized_unit ?? "" };
      map.set(key, bucket);
    }
    bucket.rows += 1;
    if (row.cost !== null) {
      bucket.priced_rows += 1;
      bucket.total_cost += row.cost;
    }
    if (row.normalized_amount !== undefined && row.normalized_unit && (bucket.unit === "" || bucket.unit === row.normalized_unit)) {
      bucket.unit = row.normalized_unit;
      bucket.amount += row.normalized_amount;
    }
  }
  return [...map.values()]
    .map((b) => ({ ...b, total_cost: round2(b.total_cost), amount: Math.round(b.amount * 100) / 100 }))
    .sort((a, b) => b.total_cost - a.total_cost || a.chemical_type.localeCompare(b.chemical_type));
}

export function rollupCosts(rows: CostRow[], options: { topN?: number } = {}): CostRollup {
  const topN = Math.max(1, Math.min(options.topN ?? 10, 100));
  const allVisits = new Set<string>();
  let total = 0;
  let priced = 0;
  for (const row of rows) {
    allVisits.add(visitKey(row));
    if (row.cost !== null) {
      priced += 1;
      total += row.cost;
    }
  }

  const poolLabel = (row: CostRow) => (row.pool_name ? `${row.customer_name} · ${row.pool_name}` : row.customer_name);
  const pools = groupRows<PoolBucket>(
    rows,
    (row) => `${row.customer_id}|${row.pool_id ?? ""}`,
    (row, key) => ({
      ...emptyBucket(key, poolLabel(row)),
      customer_id: row.customer_id,
      pool_id: row.pool_id,
      service_day: row.service_day,
    }),
  );

  const byCustomer: CustomerBreakdown[] = pools.map((bucket) => {
    const bucketRows = rows.filter((r) => `${r.customer_id}|${r.pool_id ?? ""}` === bucket.key);
    return {
      ...bucket,
      chemicals: chemicalBuckets(bucketRows),
      dates: [...new Set(bucketRows.map((r) => r.date))].sort().reverse(),
    };
  });

  const byTechnician = groupRows<Bucket>(rows, (row) => row.technician || "unknown", (row, key) => emptyBucket(key, row.technician || "Unassigned"));
  const byRouteDay = groupRows<Bucket>(rows, (row) => row.service_day || "Unscheduled", (row, key) => emptyBucket(key, row.service_day || "Unscheduled"))
    .sort((a, b) => {
      const ai = WEEKDAYS.indexOf(a.key);
      const bi = WEEKDAYS.indexOf(b.key);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
  const byMonth = groupRows<Bucket>(rows, (row) => row.date.slice(0, 7), (row, key) => emptyBucket(key, key))
    .sort((a, b) => a.key.localeCompare(b.key));

  const unpriced = [...new Set(rows.filter((r) => r.cost === null).map((r) => r.chemical_type))].sort();

  return {
    totals: {
      total_cost: round2(total),
      rows: rows.length,
      priced_rows: priced,
      unpriced_rows: rows.length - priced,
      visits: allVisits.size,
      cost_per_visit: allVisits.size > 0 ? round2(total / allVisits.size) : 0,
    },
    top_pools: pools.slice(0, topN),
    by_customer: byCustomer,
    by_technician: byTechnician,
    by_route_day: byRouteDay,
    by_month: byMonth,
    by_chemical: chemicalBuckets(rows),
    unpriced_chemicals: unpriced,
  };
}

// ============================================
// UI helpers
// ============================================

export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

export type RangePreset = "this_month" | "last_30" | "last_90" | "ytd" | "custom";

export const RANGE_PRESETS: Array<{ id: RangePreset; label: string }> = [
  { id: "this_month", label: "This month" },
  { id: "last_30", label: "Last 30 days" },
  { id: "last_90", label: "Last 90 days" },
  { id: "ytd", label: "Year to date" },
  { id: "custom", label: "Custom" },
];

export function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

export function resolveRange(preset: RangePreset, now: Date = new Date()): { start: string; end: string } {
  const end = toIsoDate(now);
  const daysAgo = (days: number) => toIsoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - days));
  switch (preset) {
    case "last_30": return { start: daysAgo(29), end };
    case "last_90": return { start: daysAgo(89), end };
    case "ytd": return { start: `${now.getFullYear()}-01-01`, end };
    case "this_month":
    default:
      return { start: toIsoDate(new Date(now.getFullYear(), now.getMonth(), 1)), end };
  }
}

/** Default unit for a chemical label (catalog family), for the price editor. */
export function defaultUnitForChemical(chemicalType: string): CanonicalUnit {
  const family = chemicalFamilyFor(chemicalType);
  return family === "unknown" ? "each" : canonicalUnitForFamily(family);
}
