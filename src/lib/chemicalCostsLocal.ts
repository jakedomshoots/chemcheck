/**
 * Device-side chemical cost summary.
 *
 * The cloud summary (convex/chemicalCosts.ts) is authoritative, but the app is
 * offline-first: a tech on a dead-zone route still deserves to see what the
 * day cost. This module rebuilds the same rollup from Dexie rows and the last
 * price list the device saw.
 */
import { db } from '@/db/chemcheck-db';
import {
  computeUsageCost,
  findPriceForChemical,
  rollupCosts,
  type CostRollup,
  type CostRow,
  type PriceLike,
} from '@/lib/chemicalCosts';

export const PRICE_CACHE_KEY = 'chemcheck_chemical_prices_cache_v1';

export interface LocalCostSummary extends CostRollup {
  range: { start: string; end: string };
  truncated: boolean;
  has_prices: boolean;
  /** Marks the summary as computed on this device rather than in the cloud. */
  source: 'device';
  price_cached_at: string | null;
}

interface CachedPrices {
  cached_at: string;
  prices: PriceLike[];
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Remember the cloud price list so offline summaries can still be priced. */
export function cacheChemicalPrices(prices: ReadonlyArray<PriceLike>): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    const payload: CachedPrices = {
      cached_at: new Date().toISOString(),
      prices: prices.map((price) => ({
        chemical_type: price.chemical_type,
        unit: price.unit,
        unit_price: price.unit_price,
        package_size: price.package_size,
        package_price: price.package_price,
      })),
    };
    storage.setItem(PRICE_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Quota or privacy mode: the summary will simply be unpriced.
  }
}

export function readCachedChemicalPrices(): CachedPrices | null {
  const storage = safeStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(PRICE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedPrices>;
    if (!parsed || !Array.isArray(parsed.prices)) return null;
    return { cached_at: typeof parsed.cached_at === 'string' ? parsed.cached_at : '', prices: parsed.prices };
  } catch {
    return null;
  }
}

function inRange(date: string | undefined, start: string, end: string): date is string {
  return typeof date === 'string' && date.length >= 10 && date.slice(0, 10) >= start && date.slice(0, 10) <= end;
}

/**
 * Build the cost summary from local rows. Technician attribution follows the
 * service log for that customer and day when one exists, matching the cloud.
 */
export async function buildLocalCostSummary(options: {
  start: string;
  end: string;
  topN?: number;
  currentUser?: string;
}): Promise<LocalCostSummary> {
  const { start, end } = options;
  const cached = readCachedChemicalPrices();
  const prices = cached?.prices ?? [];

  const [usage, customers, pools, logs] = await Promise.all([
    db.chemicalUsage.toArray(),
    db.customers.toArray(),
    db.pools.toArray(),
    db.serviceLogs.toArray(),
  ]);

  const customerById = new Map(customers.map((customer) => [customer.id, customer]));
  const poolById = new Map(pools.map((pool) => [pool.id, pool]));
  const techByVisit = new Map<string, string>();
  for (const log of logs) {
    const tech = (log as { created_by?: string }).created_by;
    if (tech) techByVisit.set(`${log.customer_id}|${log.service_date}`, tech);
  }

  const rows: CostRow[] = [];
  for (const row of usage) {
    if ((row as { deleted_at?: number | null }).deleted_at != null) continue;
    const date = row.created_date ?? row.createdAt?.slice(0, 10);
    if (!inRange(date, start, end)) continue;
    const customer = customerById.get(row.customer_id);
    if (!customer) continue;
    const pool = row.pool_id !== undefined ? poolById.get(row.pool_id) : undefined;
    const computed = computeUsageCost(findPriceForChemical(prices, row.chemical_type), row.chemical_type, row.quantity);
    const technician =
      techByVisit.get(`${row.customer_id}|${date}`)
      ?? (row as { created_by?: string }).created_by
      ?? options.currentUser
      ?? 'local';
    rows.push({
      id: String(row.id ?? `${row.customer_id}-${date}-${row.chemical_type}`),
      customer_id: String(row.customer_id),
      customer_name: customer.full_name,
      pool_id: pool ? String(pool.id) : undefined,
      pool_name: pool?.name,
      service_day: pool?.service_day ?? customer.service_day,
      technician,
      date: date.slice(0, 10),
      chemical_type: row.chemical_type,
      quantity: row.quantity,
      normalized_amount: computed?.normalized_amount,
      normalized_unit: computed?.normalized_unit,
      cost: computed ? computed.total_cost : null,
    });
  }

  return {
    ...rollupCosts(rows, { topN: options.topN }),
    range: { start, end },
    truncated: false,
    has_prices: prices.length > 0,
    source: 'device',
    price_cached_at: cached?.cached_at || null,
  };
}
