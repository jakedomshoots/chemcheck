import { describe, expect, it } from 'vitest';
import { cleanupSyncOperations, isActiveTeamMember, isStaleWrite, pull, syncCustomer, syncDelete } from './sync';

/**
 * Minimal in-memory Convex database: enough of the query/index/filter API for
 * the sync mutations. Index callbacks are evaluated against the row fields.
 */
type Row = Record<string, any> & { _id: string };
type Predicate = (row: Row) => boolean;

function rangeBuilder(conditions: Predicate[]): any {
  const builder: any = {
    eq: (field: string, value: any) => { conditions.push((row) => row[field] === value); return builder; },
    gt: (field: string, value: any) => { conditions.push((row) => row[field] !== undefined && row[field] > value); return builder; },
    gte: (field: string, value: any) => { conditions.push((row) => row[field] !== undefined && row[field] >= value); return builder; },
    lt: (field: string, value: any) => { conditions.push((row) => row[field] !== undefined && row[field] < value); return builder; },
    lte: (field: string, value: any) => { conditions.push((row) => row[field] !== undefined && row[field] <= value); return builder; },
  };
  return builder;
}

function filterBuilder(): any {
  const field = (name: string) => ({ __field: name });
  const resolve = (row: Row, value: any) => (value && typeof value === 'object' && '__field' in value ? row[value.__field] : value);
  return {
    field,
    eq: (a: any, b: any) => (row: Row) => resolve(row, a) === resolve(row, b),
    gt: (a: any, b: any) => (row: Row) => resolve(row, a) > resolve(row, b),
    lte: (a: any, b: any) => (row: Row) => resolve(row, a) <= resolve(row, b),
    and: (...preds: Predicate[]) => (row: Row) => preds.every((pred) => pred(row)),
    or: (...preds: Predicate[]) => (row: Row) => preds.some((pred) => pred(row)),
  };
}

export function createFakeDb(seed: Record<string, Row[]> = {}) {
  const tables = new Map<string, Row[]>();
  let nextId = 1;
  for (const [table, rows] of Object.entries(seed)) tables.set(table, rows.map((row) => ({ ...row })));
  const rowsOf = (table: string) => {
    if (!tables.has(table)) tables.set(table, []);
    return tables.get(table)!;
  };
  const findTable = (id: string) => Array.from(tables.entries()).find(([, rows]) => rows.some((row) => row._id === id));

  const db = {
    tables,
    get: async (id: string) => {
      const entry = findTable(id);
      return entry ? { ...entry[1].find((row) => row._id === id)! } : null;
    },
    normalizeId: (table: string, id: string) => (id.startsWith(`${table}:`) ? id : null),
    insert: async (table: string, doc: Record<string, any>) => {
      const _id = `${table}:${nextId++}`;
      rowsOf(table).push({ ...doc, _id, _creationTime: Date.now() });
      return _id;
    },
    patch: async (id: string, updates: Record<string, any>) => {
      const entry = findTable(id);
      if (!entry) throw new Error(`missing ${id}`);
      const row = entry[1].find((item) => item._id === id)!;
      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined) delete row[key];
        else row[key] = value;
      }
    },
    delete: async (id: string) => {
      const entry = findTable(id);
      if (!entry) throw new Error(`missing ${id}`);
      entry[1].splice(entry[1].findIndex((row) => row._id === id), 1);
    },
    query: (table: string) => {
      const conditions: Predicate[] = [];
      const chain: any = {
        withIndex: (_name: string, fn?: (q: any) => any) => { if (fn) fn(rangeBuilder(conditions)); return chain; },
        filter: (fn: (q: any) => Predicate) => { conditions.push(fn(filterBuilder())); return chain; },
        collect: async () => rowsOf(table).filter((row) => conditions.every((pred) => pred(row))).map((row) => ({ ...row })),
        first: async () => (await chain.collect())[0] ?? null,
        take: async (n: number) => (await chain.collect()).slice(0, n),
        paginate: async ({ cursor, numItems }: { cursor: string | null; numItems: number }) => {
          const all = await chain.collect();
          const start = cursor ? Number(cursor) : 0;
          const page = all.slice(start, start + numItems);
          const end = start + page.length;
          return { page, isDone: end >= all.length, continueCursor: String(end) };
        },
      };
      return chain;
    },
  };
  return db;
}

function ctxFor(db: ReturnType<typeof createFakeDb>, email: string) {
  return {
    db,
    auth: { getUserIdentity: async () => ({ email }) },
    scheduler: { runAfter: async () => undefined },
  };
}

async function pullAll(db: ReturnType<typeof createFakeDb>, email: string, since = 0) {
  const collected: Record<string, any[]> = {};
  let cursor: string | undefined;
  let watermark = 0;
  for (let guard = 0; guard < 100; guard += 1) {
    const page = await (pull as any)._handler(ctxFor(db, email), { cursor, since: cursor ? undefined : since, limit: 50 });
    for (const [key, value] of Object.entries(page)) {
      if (Array.isArray(value)) collected[key] = [...(collected[key] || []), ...value];
    }
    watermark = page.watermark;
    if (!page.hasMore) break;
    cursor = page.cursor;
  }
  return { ...collected, watermark } as any;
}

function seedBusiness(extraMembers: Row[] = []) {
  return createFakeDb({
    businesses: [{ _id: 'businesses:1', owner_email: 'owner@example.com', name: 'Pools' }],
    team_members: [
      { _id: 'team_members:1', business_id: 'businesses:1', user_email: 'tech@example.com', role: 'technician', is_active: true },
      ...extraMembers,
    ],
    customers: [{
      _id: 'customers:1', full_name: 'Jane Doe', address: '123 Main St', service_day: 'Monday',
      pool_type: 'Chlorine', surface_type: 'Plaster', created_by: 'owner@example.com', business_id: 'businesses:1',
      updated_at: 1_000,
    }],
    pools: [{ _id: 'pools:1', customer_id: 'customers:1', business_id: 'businesses:1', name: 'Primary', service_day: 'Monday', pool_type: 'Chlorine', surface_type: 'Plaster', active: true, created_at: 1, updated_at: 1_000 }],
    serviceLogs: [{ _id: 'serviceLogs:1', customer_id: 'customers:1', created_by: 'owner@example.com', service_date: '2026-01-01', status: 'completed', ph: 'good', chlorine: 'good', alkalinity: 'good', stabilizer: 'good', updated_at: 1_000 }],
    saltCellLogs: [{ _id: 'saltCellLogs:1', customer_id: 'customers:1', created_by: 'owner@example.com', cleaning_date: '2026-01-01', condition: 'good', updated_at: 1_000 }],
    notes: [{ _id: 'notes:1', customer_id: 'customers:1', created_by: 'tech@example.com', title: 'Gate', content: 'Dog', category: 'General', priority: 'low', updated_at: 1_000 }],
  });
}

describe('sync delete propagation', () => {
  it('deletes a customer with its children and writes tombstones pulled by other devices', async () => {
    const db = seedBusiness();
    const result = await (syncDelete as any)._handler(ctxFor(db, 'owner@example.com'), {
      table: 'customers', server_id: 'customers:1', idempotency_key: 'delete:customers:1',
    });

    expect(result).toMatchObject({ success: true, operation: 'delete', deleted_count: 5 });
    expect(db.tables.get('customers')).toHaveLength(0);
    expect(db.tables.get('serviceLogs')).toHaveLength(0);
    expect(db.tables.get('saltCellLogs')).toHaveLength(0);
    expect(db.tables.get('notes')).toHaveLength(0);
    expect(db.tables.get('pools')).toHaveLength(0);
    const tombstones = db.tables.get('syncTombstones')!;
    expect(tombstones.map((row) => `${row.table}:${row.server_id}`)).toEqual(expect.arrayContaining([
      'customers:customers:1', 'serviceLogs:serviceLogs:1', 'pools:pools:1', 'notes:notes:1', 'saltCellLogs:saltCellLogs:1',
    ]));
    expect(tombstones.every((row) => row.business_id === 'businesses:1')).toBe(true);

    // A teammate's incremental pull receives the tombstones.
    const pulled = await pullAll(db, 'tech@example.com', 1);
    expect(pulled.tombstones.map((row: any) => row.server_id)).toEqual(expect.arrayContaining(['customers:1', 'serviceLogs:1']));

    // Replaying the same delete is idempotent.
    const replay = await (syncDelete as any)._handler(ctxFor(db, 'owner@example.com'), {
      table: 'customers', server_id: 'customers:1', idempotency_key: 'delete:customers:1',
    });
    expect(replay).toEqual(result);
    const again = await (syncDelete as any)._handler(ctxFor(db, 'owner@example.com'), {
      table: 'customers', server_id: 'customers:1',
    });
    expect(again).toMatchObject({ success: true, already_deleted: true });
  });

  it('applies the customers.remove role gate to technicians', async () => {
    const db = seedBusiness();
    await expect((syncDelete as any)._handler(ctxFor(db, 'tech@example.com'), {
      table: 'customers', server_id: 'customers:1',
    })).rejects.toThrow('Insufficient role permissions');
    expect(db.tables.get('customers')).toHaveLength(1);
  });

  it('lets a technician delete a service log of an accessible customer', async () => {
    const db = seedBusiness();
    await (syncDelete as any)._handler(ctxFor(db, 'tech@example.com'), { table: 'serviceLogs', server_id: 'serviceLogs:1' });
    expect(db.tables.get('serviceLogs')).toHaveLength(0);
    expect(db.tables.get('syncTombstones')![0]).toMatchObject({ table: 'serviceLogs', created_by: 'owner@example.com' });
  });

  it('rejects deletes of another tenant\'s records', async () => {
    const db = seedBusiness();
    await expect((syncDelete as any)._handler(ctxFor(db, 'stranger@example.com'), {
      table: 'serviceLogs', server_id: 'serviceLogs:1',
    })).rejects.toThrow(/Access denied/);
  });
});

describe('sync pull tenancy', () => {
  it('pulls business child rows through per-email index streams, including salt cell logs', async () => {
    const db = seedBusiness();
    const pulled = await pullAll(db, 'tech@example.com');
    expect(pulled.customers).toHaveLength(1);
    expect(pulled.saltCellLogs).toHaveLength(1);
    expect(pulled.serviceLogs).toHaveLength(1);
    expect(pulled.notes).toHaveLength(1);
  });

  it('works for single-user accounts (salt cell logs no longer throw)', async () => {
    const db = createFakeDb({
      customers: [{ _id: 'customers:1', full_name: 'Solo', address: '1 Solo Rd', service_day: 'Monday', pool_type: 'Salt', surface_type: 'Plaster', created_by: 'solo@example.com' }],
      saltCellLogs: [{ _id: 'saltCellLogs:1', customer_id: 'customers:1', created_by: 'solo@example.com', cleaning_date: '2026-01-01', condition: 'good' }],
    });
    const pulled = await pullAll(db, 'solo@example.com');
    expect(pulled.saltCellLogs).toHaveLength(1);
    expect(pulled.tombstones).toEqual([]);
  });

  it('ignores deactivated or pending team members', async () => {
    expect(isActiveTeamMember({ is_active: true })).toBe(true);
    expect(isActiveTeamMember({ is_active: true, status: 'active' })).toBe(true);
    expect(isActiveTeamMember({ is_active: true, status: 'pending' })).toBe(false);
    expect(isActiveTeamMember({ is_active: false, status: 'active' })).toBe(false);

    const db = seedBusiness();
    db.tables.get('team_members')![0].status = 'pending';
    await expect((syncDelete as any)._handler(ctxFor(db, 'tech@example.com'), {
      table: 'serviceLogs', server_id: 'serviceLogs:1',
    })).rejects.toThrow(/Access denied/);
  });
});

describe('sync conflict detection (base version)', () => {
  it('uses the server base version when provided and falls back to the client clock otherwise', () => {
    expect(isStaleWrite({ updated_at: 2_000 }, 2_000, 0)).toBe(false);
    expect(isStaleWrite({ updated_at: 2_001 }, 2_000, 9_999_999)).toBe(true);
    // A fast client clock must not mask a conflict when the base is known.
    expect(isStaleWrite({ updated_at: 5_000 }, 1_000, Number.MAX_SAFE_INTEGER)).toBe(true);
    // Legacy clients: compare against local_updated_at.
    expect(isStaleWrite({ updated_at: 5_000 }, undefined, 6_000)).toBe(false);
    expect(isStaleWrite({ updated_at: 5_000 }, undefined, 4_000)).toBe(true);
  });

  it('returns a conflict for a stale base and stamps updated_at with the server clock otherwise', async () => {
    const db = seedBusiness();
    const data = { full_name: 'Jane Roe', address: '123 Main St', service_day: 'Monday', pool_type: 'Chlorine', surface_type: 'Plaster' };
    const stale = await (syncCustomer as any)._handler(ctxFor(db, 'owner@example.com'), {
      local_id: 1, data, local_updated_at: Number.MAX_SAFE_INTEGER, base_updated_at: 500, convex_id: 'customers:1',
    });
    expect(stale).toMatchObject({ success: false, operation: 'conflict', conflict: { remote_updated_at: 1_000 } });

    const before = Date.now();
    const ok = await (syncCustomer as any)._handler(ctxFor(db, 'owner@example.com'), {
      local_id: 1, data, local_updated_at: 0, base_updated_at: 1_000, convex_id: 'customers:1',
    });
    expect(ok).toMatchObject({ success: true, operation: 'update' });
    expect(ok.updated_at).toBeGreaterThanOrEqual(before);
    expect(db.tables.get('customers')![0]).toMatchObject({ full_name: 'Jane Roe', updated_at: ok.updated_at });
  });

  it('enforces customers.update role rules and validation on sync', async () => {
    const db = seedBusiness();
    const data = { full_name: 'Jane Roe', address: '123 Main St', service_day: 'Monday', pool_type: 'Chlorine', surface_type: 'Plaster' };
    await expect((syncCustomer as any)._handler(ctxFor(db, 'tech@example.com'), {
      local_id: 1, data, local_updated_at: 0, base_updated_at: 1_000, convex_id: 'customers:1',
    })).rejects.toThrow('Insufficient role permissions');
    await expect((syncCustomer as any)._handler(ctxFor(db, 'owner@example.com'), {
      local_id: 2, data: { ...data, service_day: 'Someday' }, local_updated_at: 0,
    })).rejects.toThrow(/Service day/);
  });
});

describe('sync cleanup', () => {
  it('expires receipts and 90-day-old tombstones via index range bounds', async () => {
    const now = Date.now();
    const db = createFakeDb({
      syncOperations: [
        { _id: 'syncOperations:1', key: 'a', expires_at: now - 1 },
        { _id: 'syncOperations:2', key: 'b', expires_at: now + 60_000 },
      ],
      syncTombstones: [
        { _id: 'syncTombstones:1', table: 'notes', server_id: 'notes:9', created_by: 'x', deleted_by: 'x', deleted_at: now - 91 * 24 * 60 * 60 * 1000 },
        { _id: 'syncTombstones:2', table: 'notes', server_id: 'notes:8', created_by: 'x', deleted_by: 'x', deleted_at: now },
      ],
    });
    const result = await (cleanupSyncOperations as any)._handler(ctxFor(db, 'x'), {});
    expect(result).toEqual({ deleted: 1, tombstonesDeleted: 1 });
    expect(db.tables.get('syncOperations')!.map((row) => row.key)).toEqual(['b']);
    expect(db.tables.get('syncTombstones')!.map((row) => row.server_id)).toEqual(['notes:8']);
  });
});
