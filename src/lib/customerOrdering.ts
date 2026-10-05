/**
 * One definition of "route order" for customers.
 *
 * Every screen that lists a day's stops (Home, Clients, the off-day picker,
 * the route optimizer) must agree on the order, and every write that assigns
 * a position (create, day change, reorder) must keep positions unique within
 * a day. This module is the only place those rules live.
 */

export interface OrderableCustomer {
  _id?: number | string;
  id?: number | string;
  service_day?: string;
  sort_order?: number | null;
  createdAt?: string | null;
  created_at?: number | null;
}

/** Customers without a position sort after every positioned customer. */
export const UNPOSITIONED = Number.MAX_SAFE_INTEGER;

export function positionOf(customer: OrderableCustomer): number {
  return typeof customer.sort_order === 'number' && Number.isFinite(customer.sort_order)
    ? customer.sort_order
    : UNPOSITIONED;
}

function creationTimeOf(customer: OrderableCustomer): number {
  if (typeof customer.created_at === 'number' && Number.isFinite(customer.created_at)) {
    return customer.created_at;
  }
  if (typeof customer.createdAt === 'string') {
    const parsed = Date.parse(customer.createdAt);
    if (Number.isFinite(parsed)) return parsed;
  }
  return UNPOSITIONED;
}

function idOf(customer: OrderableCustomer): number | string {
  const raw = customer._id ?? customer.id ?? '';
  const numeric = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(numeric) && String(raw).trim() !== '' ? numeric : String(raw);
}

/**
 * Compare two customers that share a service day.
 * Position first; ties (duplicates, legacy rows) fall back to creation time,
 * then to a numeric id comparison so "10" never sorts before "2".
 */
export function compareWithinDay(a: OrderableCustomer, b: OrderableCustomer): number {
  const byPosition = positionOf(a) - positionOf(b);
  if (byPosition !== 0) return byPosition;

  const byCreated = creationTimeOf(a) - creationTimeOf(b);
  if (byCreated !== 0) return byCreated;

  const aId = idOf(a);
  const bId = idOf(b);
  if (typeof aId === 'number' && typeof bId === 'number') return aId - bId;
  return String(aId).localeCompare(String(bId));
}

/** Customers of one day in display order. */
export function sortDay<T extends OrderableCustomer>(customers: readonly T[]): T[] {
  return [...customers].sort(compareWithinDay);
}

/**
 * The position a customer added to `day` should take: one past the highest
 * position already used on that day. Counting rows instead would collide with
 * existing positions whenever the day has gaps or duplicates.
 */
export function nextPositionForDay(customers: readonly OrderableCustomer[], day: string): number {
  let highest = -1;
  for (const customer of customers) {
    if (customer.service_day !== day) continue;
    const position = positionOf(customer);
    if (position !== UNPOSITIONED && position > highest) highest = position;
  }
  return highest + 1;
}

export interface PositionChange {
  id: number | string;
  sort_order: number;
}

/**
 * Positions that make a day contiguous (0..n-1) in its current display order.
 * Returns only the rows whose stored position differs, so callers can persist
 * the minimum and the operation is idempotent.
 */
export function planNormalization(dayCustomers: readonly OrderableCustomer[]): PositionChange[] {
  const changes: PositionChange[] = [];
  sortDay(dayCustomers).forEach((customer, index) => {
    if (positionOf(customer) !== index) {
      changes.push({ id: (customer._id ?? customer.id) as number | string, sort_order: index });
    }
  });
  return changes;
}

/**
 * Positions for a day after the user reorders the customers they can see.
 * `visibleOrder` is the new order of the visible customers; customers of the
 * day that are not visible (for example without an active pool) keep their
 * relative order and are placed after the visible ones so no two customers
 * share a position.
 */
export function planReorder(
  dayCustomers: readonly OrderableCustomer[],
  visibleOrder: readonly OrderableCustomer[],
): PositionChange[] {
  const key = (customer: OrderableCustomer) => String(customer._id ?? customer.id);
  const visibleKeys = new Set(visibleOrder.map(key));
  const hidden = sortDay(dayCustomers.filter((customer) => !visibleKeys.has(key(customer))));
  const byKey = new Map(dayCustomers.map((customer) => [key(customer), customer]));

  const changes: PositionChange[] = [];
  let index = 0;
  for (const customer of [...visibleOrder, ...hidden]) {
    const stored = byKey.get(key(customer)) ?? customer;
    if (positionOf(stored) !== index) {
      changes.push({ id: (stored._id ?? stored.id) as number | string, sort_order: index });
    }
    index += 1;
  }
  return changes;
}
