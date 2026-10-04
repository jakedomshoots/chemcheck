/**
 * Deterministic local dataset for development and Playwright.
 *
 * Two entry points:
 *   - buildSeedDataset(options): pure, returns plain rows with explicit ids.
 *   - seedDexie(db, dataset) / seedDevData(options): write those rows into the
 *     on-device Dexie database with sync hooks suppressed, so everything
 *     starts out as "synced" (convex_id set) and nothing is queued for push.
 *
 * In a Playwright test it is loaded straight from the Vite dev server:
 *
 *   await page.evaluate(async () => {
 *     const mod = await import('/scripts/seed-dev-data.ts');
 *     return mod.seedDevData({ reset: true });
 *   });
 */
import { addDays, format, startOfWeek, subWeeks } from 'date-fns';
import { db as defaultDb, DEFAULT_USER } from '@/db/chemcheck-db';
import type {
  ChemCheckDB,
  ChemicalUsage,
  Customer,
  Equipment,
  Note,
  Pool,
  SaltCellLog,
  ServiceLog,
} from '@/db/chemcheck-db';

export interface SeedOptions {
  /** Owner email stamped on customers and notes. Defaults to the stored user or 'local'. */
  owner?: string;
  /** "Today" for date math; defaults to the real clock. */
  today?: Date;
  /** Weeks of history to generate (default 8). */
  weeks?: number;
  /** Customers to generate (default 12). */
  customerCount?: number;
  /** PRNG seed so the same options always produce the same rows. */
  seed?: number;
}

export interface SeedDataset {
  owner: string;
  today: string;
  customers: Customer[];
  pools: Pool[];
  equipment: Equipment[];
  serviceLogs: ServiceLog[];
  chemicalUsage: ChemicalUsage[];
  notes: Note[];
  saltCellLogs: SaltCellLog[];
}

export interface SeedSummary {
  owner: string;
  today: string;
  todayServiceDay: string;
  counts: Record<keyof Omit<SeedDataset, 'owner' | 'today'>, number>;
  todayStops: Array<{ id: number; full_name: string }>;
  customers: Array<{ id: number; full_name: string; service_day: string; logCount: number }>;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const NAMES = [
  'Alice Thornton', 'Marcus Delgado', 'Priya Natarajan', 'Hank Oliveira',
  'June Kowalski', 'Desmond Reyes', 'Fatima El-Amin', 'Tobias Lindqvist',
  'Rosa Campanella', 'Elliot Nakamura', 'Greta Svoboda', 'Omar Haddad',
  'Lena Fischer', 'Victor Mbeki', 'Sana Qureshi', 'Walter Brandt',
];

const STREETS = [
  'Saguaro Ridge Dr', 'Catalina Vista Ln', 'Mesquite Hollow Rd', 'Ocotillo Bend',
  'Rincon Peak Way', 'Palo Verde Ct', 'Sabino Canyon Rd', 'Tanque Verde Loop',
  'Oracle Rd', 'Speedway Blvd', 'Grant Rd', 'Broadway Blvd',
];

const SURFACES = ['Plaster', 'Pebble', 'Tile', 'Fiberglass'];
const CHEMICALS: Array<[string, string[]]> = [
  ['Liquid Chlorine', ['1 gal', '2 gal', '0.5 gal']],
  ['Muriatic Acid', ['1 qt', '2 qt', '1 pt']],
  ['Sodium Bicarbonate', ['2 lb', '4 lb']],
  ['Cyanuric Acid', ['1 lb', '2 lb']],
  ['Calcium Chloride', ['3 lb', '5 lb']],
];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function isoDate(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function level(value: number, low: number, high: number): string {
  if (value < low) return 'low';
  if (value > high) return 'high';
  return 'good';
}

function readStoredOwner(): string {
  try {
    const raw = (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('chemcheck_current_user'))
      || (typeof localStorage !== 'undefined' && localStorage.getItem('chemcheck_current_user'));
    if (raw) {
      const parsed = JSON.parse(raw);
      const email = typeof parsed?.email === 'string' ? parsed.email.trim().toLowerCase() : '';
      if (email) return email;
    }
  } catch {
    // Fall through to the legacy local owner.
  }
  return DEFAULT_USER;
}

/**
 * Build the dataset. Customer i is scheduled on weekday (today + i) % 7, so
 * with 12 customers two of them (0 and 7) always fall on today's route and the
 * rest spread over the week. History covers the previous `weeks` full weeks
 * and never the current week, so today's stops show up as pending.
 */
export function buildSeedDataset(options: SeedOptions = {}): SeedDataset {
  const owner = options.owner || DEFAULT_USER;
  const today = options.today ? new Date(options.today) : new Date();
  const weeks = Math.max(1, options.weeks ?? 8);
  const customerCount = Math.max(1, Math.min(options.customerCount ?? 12, NAMES.length));
  const random = mulberry32(options.seed ?? 20260101);
  const nowMs = today.getTime();
  const nowIso = today.toISOString();
  const todayIndex = today.getDay();

  const customers: Customer[] = [];
  const pools: Pool[] = [];
  const equipment: Equipment[] = [];
  const serviceLogs: ServiceLog[] = [];
  const chemicalUsage: ChemicalUsage[] = [];
  const notes: Note[] = [];
  const saltCellLogs: SaltCellLog[] = [];

  const synced = (key: string) => ({
    convex_id: `seed_${key}`,
    sync_status: 'synced' as const,
    local_updated_at: nowMs - 86_400_000,
    remote_updated_at: nowMs - 86_400_000,
    createdAt: nowIso,
    updatedAt: nowIso,
  });

  let poolId = 0;
  let equipmentId = 0;
  let logId = 0;
  let usageId = 0;
  let noteId = 0;
  let saltId = 0;
  const perDayOrder = new Map<string, number>();

  for (let i = 0; i < customerCount; i += 1) {
    const customerId = i + 1;
    const serviceDay = DAYS[(todayIndex + i) % 7];
    const sortOrder = perDayOrder.get(serviceDay) ?? 0;
    perDayOrder.set(serviceDay, sortOrder + 1);
    const poolType = i % 3 === 0 ? 'Salt' : 'Chlorine';
    const surface = SURFACES[i % SURFACES.length];
    const gallons = 12_000 + Math.floor(random() * 19) * 1_000;
    const name = NAMES[i];
    const slug = name.toLowerCase().replace(/[^a-z]+/g, '.');

    customers.push({
      id: customerId,
      full_name: name,
      address: `${1200 + i * 37} ${STREETS[i % STREETS.length]}, Tucson, AZ 857${String(10 + i).padStart(2, '0')}`,
      phone: `520555${String(1000 + i * 11).padStart(4, '0')}`,
      email: `${slug}@example.com`,
      gate_code: i % 4 === 1 ? String(1000 + Math.floor(random() * 9000)) : undefined,
      service_day: serviceDay,
      pool_gallons: gallons,
      pool_type: poolType,
      surface_type: surface,
      sort_order: sortOrder,
      created_by: owner,
      convex_customer_id: undefined,
      ...synced(`customer_${customerId}`),
    } as Customer);

    const primaryPoolId = ++poolId;
    pools.push({
      id: primaryPoolId,
      customer_id: customerId,
      convex_customer_id: `seed_customer_${customerId}`,
      name: 'Primary Pool',
      address: customers[i].address,
      service_day: serviceDay,
      pool_gallons: gallons,
      pool_type: poolType,
      surface_type: surface,
      sort_order: 0,
      active: true,
      ...synced(`pool_${primaryPoolId}`),
    });
    if (i % 4 === 0) {
      const spaId = ++poolId;
      pools.push({
        id: spaId,
        customer_id: customerId,
        convex_customer_id: `seed_customer_${customerId}`,
        name: 'Spa',
        address: customers[i].address,
        service_day: serviceDay,
        pool_gallons: 600,
        pool_type: poolType,
        surface_type: 'Tile',
        sort_order: 1,
        active: true,
        ...synced(`pool_${spaId}`),
      });
    }

    const addEquipment = (type: string, label: string, brand: string, model: string) => {
      const id = ++equipmentId;
      equipment.push({
        id,
        customer_id: customerId,
        pool_id: primaryPoolId,
        convex_customer_id: `seed_customer_${customerId}`,
        convex_pool_id: `seed_pool_${primaryPoolId}`,
        equipment_type: type,
        name: label,
        brand,
        model,
        serial_number: `SN-${customerId}${id}${Math.floor(random() * 9000) + 1000}`,
        install_date: isoDate(subWeeks(today, 40 + Math.floor(random() * 100))),
        status: 'active',
        last_service_date: isoDate(subWeeks(today, 1 + Math.floor(random() * 6))),
        ...synced(`equipment_${id}`),
      });
    };
    addEquipment('pump', 'Variable speed pump', 'Pentair', 'IntelliFlo3');
    addEquipment('filter', 'Cartridge filter', 'Hayward', 'SwimClear C4030');
    if (poolType === 'Salt') addEquipment('salt cell', 'Salt chlorinator', 'Hayward', 'AquaRite T-15');

    // Service history: one visit per week on this customer's service day,
    // for the previous `weeks` full weeks (never the current week).
    const dayOffset = (DAYS.indexOf(serviceDay) + 6) % 7; // offset from Monday
    for (let w = 1; w <= weeks; w += 1) {
      const weekStart = startOfWeek(subWeeks(today, w), { weekStartsOn: 1 });
      const visit = addDays(weekStart, dayOffset);
      if (visit.getTime() >= startOfWeek(today, { weekStartsOn: 1 }).getTime()) continue;

      const ph = round(7.1 + random() * 0.8, 1);
      const chlorine = round(0.5 + random() * 4.5, 1);
      const alkalinity = Math.round(60 + random() * 80);
      const stabilizer = Math.round(20 + random() * 70);
      const hardness = Math.round(180 + random() * 220);
      const temperature = Math.round(68 + random() * 22);
      const startHour = 7 + (sortOrder % 6);
      const start = new Date(visit);
      start.setHours(startHour, Math.floor(random() * 50), 0, 0);
      const durationMs = (18 + Math.floor(random() * 25)) * 60_000;
      const end = new Date(start.getTime() + durationMs);
      const date = isoDate(visit);
      const id = ++logId;
      serviceLogs.push({
        id,
        customer_id: customerId,
        pool_id: primaryPoolId,
        convex_customer_id: `seed_customer_${customerId}`,
        convex_pool_id: `seed_pool_${primaryPoolId}`,
        service_date: date,
        status: 'completed',
        service_type: w % 4 === 0 ? 'Chemical Balance' : 'Regular Cleaning',
        notes: w % 3 === 0 ? 'Skimmed, brushed walls, emptied pump basket.' : undefined,
        ph: level(ph, 7.2, 7.8),
        chlorine: level(chlorine, 1, 3),
        alkalinity: level(alkalinity, 80, 120),
        stabilizer: level(stabilizer, 30, 50),
        ph_value: ph,
        chlorine_value: chlorine,
        alkalinity_value: alkalinity,
        stabilizer_value: stabilizer,
        hardness_value: hardness,
        hardness_source: 'calcium',
        water_temperature: temperature,
        water_temperature_source: 'measured',
        salt: poolType === 'Salt' ? Math.round(2600 + random() * 1000) : undefined,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        duration_ms: durationMs,
        ...synced(`log_${id}`),
      } as ServiceLog);

      if (random() < 0.6) {
        const [chemical, quantities] = CHEMICALS[Math.floor(random() * CHEMICALS.length)];
        const usage = ++usageId;
        chemicalUsage.push({
          id: usage,
          customer_id: customerId,
          pool_id: primaryPoolId,
          convex_customer_id: `seed_customer_${customerId}`,
          chemical_type: chemical,
          quantity: quantities[Math.floor(random() * quantities.length)],
          notes: undefined,
          created_date: date,
          ...synced(`usage_${usage}`),
        } as ChemicalUsage);
      }
    }

    if (i % 3 === 0) {
      const id = ++noteId;
      notes.push({
        id,
        title: `${name.split(' ')[0]}: gate and access`,
        content: i % 4 === 1 ? 'Use the side gate; code is on the customer record.' : 'Dog in the yard on weekdays, text before arriving.',
        category: 'Customer',
        customer_id: customerId,
        convex_customer_id: `seed_customer_${customerId}`,
        priority: i % 2 === 0 ? 'medium' : 'low',
        completed: false,
        created_date: isoDate(subWeeks(today, 2)),
        created_by: owner,
        ...synced(`note_${id}`),
      });
    }

    if (poolType === 'Salt') {
      for (const weeksAgo of [6, 2]) {
        const id = ++saltId;
        saltCellLogs.push({
          id,
          customer_id: customerId,
          pool_id: primaryPoolId,
          convex_customer_id: `seed_customer_${customerId}`,
          cleaning_date: isoDate(subWeeks(today, weeksAgo)),
          condition: weeksAgo === 6 ? 'light scale' : 'clean',
          notes: weeksAgo === 6 ? 'Acid washed, inspected plates.' : undefined,
          next_cleaning_due: isoDate(addDays(subWeeks(today, weeksAgo), 90)),
          ...synced(`salt_${id}`),
        });
      }
    }
  }

  const generalNotes: Array<[string, string, string, string]> = [
    ['Restock truck', 'Pick up 4 gal liquid chlorine and 2 qt acid before Thursday.', 'Reminder', 'high'],
    ['Test kit reagents', 'Phenol red bottle nearly empty; replace this week.', 'Chemical', 'medium'],
    ['Invoice run', 'Send monthly invoices on the 1st.', 'Billing', 'low'],
  ];
  for (const [title, content, category, priority] of generalNotes) {
    const id = ++noteId;
    notes.push({
      id,
      title,
      content,
      category,
      priority,
      completed: false,
      created_date: isoDate(subWeeks(today, 1)),
      created_by: owner,
      ...synced(`note_${id}`),
    });
  }

  return { owner, today: isoDate(today), customers, pools, equipment, serviceLogs, chemicalUsage, notes, saltCellLogs };
}

export function summarizeDataset(dataset: SeedDataset): SeedSummary {
  const todayServiceDay = DAYS[new Date(`${dataset.today}T12:00:00`).getDay()];
  const logCounts = new Map<number, number>();
  for (const log of dataset.serviceLogs) {
    logCounts.set(log.customer_id, (logCounts.get(log.customer_id) ?? 0) + 1);
  }
  return {
    owner: dataset.owner,
    today: dataset.today,
    todayServiceDay,
    counts: {
      customers: dataset.customers.length,
      pools: dataset.pools.length,
      equipment: dataset.equipment.length,
      serviceLogs: dataset.serviceLogs.length,
      chemicalUsage: dataset.chemicalUsage.length,
      notes: dataset.notes.length,
      saltCellLogs: dataset.saltCellLogs.length,
    },
    todayStops: dataset.customers
      .filter((customer) => customer.service_day === todayServiceDay)
      .map((customer) => ({ id: customer.id!, full_name: customer.full_name })),
    customers: dataset.customers.map((customer) => ({
      id: customer.id!,
      full_name: customer.full_name,
      service_day: customer.service_day,
      logCount: logCounts.get(customer.id!) ?? 0,
    })),
  };
}

export interface SeedWriteOptions {
  /** Clear every table (and the persisted sync queue) first. Default true. */
  reset?: boolean;
}

/**
 * Write a dataset into Dexie. Sync hooks are suppressed for the whole
 * transaction so the rows land exactly as given (already synced) and nothing
 * is enqueued for push.
 */
export async function seedDexie(db: ChemCheckDB, dataset: SeedDataset, options: SeedWriteOptions = {}): Promise<SeedSummary> {
  const reset = options.reset !== false;
  await db.ensureOpen();
  const tables = [db.customers, db.pools, db.equipment, db.serviceLogs, db.chemicalUsage, db.notes, db.saltCellLogs];

  await db.withoutSyncHooks(async () => {
    await db.transaction('rw', tables, async () => {
      if (reset) {
        for (const table of tables) await table.clear();
      }
      await db.customers.bulkAdd(dataset.customers);
      await db.pools.bulkAdd(dataset.pools);
      await db.equipment.bulkAdd(dataset.equipment);
      await db.serviceLogs.bulkAdd(dataset.serviceLogs);
      await db.chemicalUsage.bulkAdd(dataset.chemicalUsage);
      await db.notes.bulkAdd(dataset.notes);
      await db.saltCellLogs.bulkAdd(dataset.saltCellLogs);
    });
  });

  if (reset) {
    try {
      localStorage.removeItem('chemcheck_sync_queue');
    } catch {
      // Storage unavailable (tests without a window); nothing to clear.
    }
  }

  ensureDemoBusinessWorksEveryDay();

  return summarizeDataset(dataset);
}

/**
 * The demo dataset puts stops on every weekday including weekends, so the
 * local business profile must treat all seven days as working days or the
 * Home route hides weekend stops.
 */
function ensureDemoBusinessWorksEveryDay(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem('chemcheck_current_business');
    const business = raw ? JSON.parse(raw) : {};
    const settings = { ...(business.settings || {}), working_days: [...DAYS] };
    localStorage.setItem(
      'chemcheck_current_business',
      JSON.stringify({ name: 'ChemCheck Demo Pools', ...business, settings }),
    );
  } catch {
    // Storage unavailable; Home falls back to Monday-Friday.
  }
}

/**
 * Seed the app's own database. Returns a JSON-serialisable summary so a
 * Playwright test can drive assertions from it.
 */
export async function seedDevData(options: SeedOptions & SeedWriteOptions = {}): Promise<SeedSummary> {
  const owner = options.owner || readStoredOwner();
  const dataset = buildSeedDataset({ ...options, owner });
  return seedDexie(defaultDb, dataset, options);
}

/** True when the seed dataset (or a superset of it) is already on the device. */
export async function isSeeded(db: ChemCheckDB = defaultDb): Promise<boolean> {
  await db.ensureOpen();
  return (await db.customers.where('convex_id').equals('seed_customer_1').count()) > 0;
}
