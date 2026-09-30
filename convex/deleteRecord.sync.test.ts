import { describe, expect, it } from "vitest";
import { deleteRecord, pull, syncCustomer, syncServiceLog, batchSyncCustomers } from "./sync";
import { remove as removeCustomer } from "./customers";

/**
 * Minimal in-memory stand-in for the Convex database API used by sync.ts.
 * It supports the subset the handlers rely on: indexed lookups, filters,
 * ordering, first/collect/take/paginate, get/insert/patch/delete and
 * normalizeId. Every withIndex() call is recorded so tests can assert that a
 * table is only ever read through an index.
 */
type Row = Record<string, any>;

function fieldRef(name: string) {
  return { __field: name };
}

function resolve(doc: Row, operand: any): any {
  return operand && typeof operand === "object" && "__field" in operand ? doc[operand.__field] : operand;
}

function filterBuilder() {
  return {
    field: fieldRef,
    eq: (a: any, b: any) => (doc: Row) => resolve(doc, a) === resolve(doc, b),
    neq: (a: any, b: any) => (doc: Row) => resolve(doc, a) !== resolve(doc, b),
    gt: (a: any, b: any) => (doc: Row) => resolve(doc, a) > resolve(doc, b),
    gte: (a: any, b: any) => (doc: Row) => resolve(doc, a) >= resolve(doc, b),
    lt: (a: any, b: any) => (doc: Row) => resolve(doc, a) < resolve(doc, b),
    lte: (a: any, b: any) => (doc: Row) => resolve(doc, a) <= resolve(doc, b),
    and: (...preds: Array<(doc: Row) => boolean>) => (doc: Row) => preds.every((p) => p(doc)),
    or: (...preds: Array<(doc: Row) => boolean>) => (doc: Row) => preds.some((p) => p(doc)),
  };
}

class FakeDb {
  tables = new Map<string, Row[]>();
  indexReads: Array<{ table: string; index: string | null }> = [];
  private counter = 0;

  seed(table: string, doc: Row): string {
    const id = doc._id ?? `${table}:${++this.counter}`;
    const row = { ...doc, _id: id, _creationTime: this.counter };
    this.rows(table).push(row);
    return id;
  }

  private rows(table: string): Row[] {
    if (!this.tables.has(table)) this.tables.set(table, []);
    return this.tables.get(table)!;
  }

  private find(id: string): { table: string; row: Row } | null {
    for (const [table, rows] of this.tables) {
      const row = rows.find((candidate) => candidate._id === id);
      if (row) return { table, row };
    }
    return null;
  }

  normalizeId(table: string, id: string): string | null {
    return String(id).startsWith(`${table}:`) ? id : null;
  }

  async get(id: string): Promise<Row | null> {
    const hit = this.find(id);
    return hit ? { ...hit.row } : null;
  }

  async insert(table: string, doc: Row): Promise<string> {
    return this.seed(table, doc);
  }

  async patch(id: string, updates: Row): Promise<void> {
    const hit = this.find(id);
    if (!hit) throw new Error(`patch: ${id} not found`);
    Object.assign(hit.row, updates);
  }

  async delete(id: string): Promise<void> {
    const hit = this.find(id);
    if (!hit) throw new Error(`delete: ${id} not found`);
    const rows = this.rows(hit.table);
    rows.splice(rows.indexOf(hit.row), 1);
  }

  query(table: string) {
    const db = this;
    const constraints: Array<[string, any]> = [];
    const predicates: Array<(doc: Row) => boolean> = [];
    let indexName: string | null = null;
    let direction: "asc" | "desc" = "asc";

    const evaluate = (): Row[] => {
      db.indexReads.push({ table, index: indexName });
      let result = db.rows(table).filter((row) =>
        constraints.every(([field, value]) => row[field] === value) && predicates.every((p) => p(row))
      );
      if (direction === "desc") result = [...result].reverse();
      return result.map((row) => ({ ...row }));
    };

    const chain: any = {
      withIndex(name: string, build?: (q: any) => any) {
        indexName = name;
        const q: any = { eq: (field: string, value: any) => { constraints.push([field, value]); return q; } };
        if (build) build(q);
        return chain;
      },
      filter(build: (q: any) => (doc: Row) => boolean) {
        predicates.push(build(filterBuilder()));
        return chain;
      },
      order(dir: "asc" | "desc") {
        direction = dir;
        return chain;
      },
      first: async () => evaluate()[0] ?? null,
      collect: async () => evaluate(),
      take: async (n: number) => evaluate().slice(0, n),
      paginate: async ({ cursor, numItems }: { cursor: string | null; numItems: number }) => {
        const all = evaluate();
        const start = cursor ? Number(cursor) : 0;
        const page = all.slice(start, start + numItems);
        const next = start + page.length;
        return { page, isDone: next >= all.length, continueCursor: String(next) };
      },
    };
    return chain;
  }
}

function makeCtx(db: FakeDb, email: string | null) {
  const deletedStorage: string[] = [];
  return {
    ctx: {
      auth: { getUserIdentity: async () => (email ? { email } : null) },
      db,
      storage: {
        delete: async (id: string) => { deletedStorage.push(id); },
        getUrl: async () => "https://example.test/file",
      },
    },
    deletedStorage,
  };
}

const OWNER = "owner@example.com";
const STRANGER = "stranger@example.com";

function seedSoloTenant(db: FakeDb) {
  const now = 1_000;
  const customer = db.seed("customers", {
    full_name: "Alice", address: "1 Pool Ln", service_day: "Monday", pool_type: "Salt",
    surface_type: "Plaster", created_by: OWNER, created_at: now, updated_at: now,
  });
  const pool = db.seed("pools", {
    customer_id: customer, name: "Primary Pool", service_day: "Monday", pool_type: "Salt",
    surface_type: "Plaster", active: true, created_by: OWNER, created_at: now, updated_at: now,
  });
  const equipment = db.seed("equipment", {
    customer_id: customer, pool_id: pool, equipment_type: "pump", name: "Pump", status: "active",
    created_by: OWNER, created_at: now, updated_at: now,
  });
  const log = db.seed("serviceLogs", {
    customer_id: customer, created_by: OWNER, service_date: "2026-01-01", status: "completed",
    ph: "good", chlorine: "good", alkalinity: "good", stabilizer: "good", created_at: now, updated_at: now,
  });
  const photo = db.seed("servicePhotos", {
    service_log_id: log, customer_id: customer, category: "before", storage_id: "storage:photo-1",
    timestamp: "2026-01-01T00:00:00Z", created_at: now,
  });
  const report = db.seed("serviceReports", {
    service_log_id: log, customer_id: customer, report_token: "token", created_at: now,
  });
  const chemical = db.seed("chemicalUsage", {
    customer_id: customer, created_by: OWNER, chemical_type: "Chlorine", quantity: "1 lb", created_at: now, updated_at: now,
  });
  const note = db.seed("notes", {
    customer_id: customer, created_by: OWNER, title: "Gate", content: "1234", category: "general",
    priority: "low", created_at: now, updated_at: now,
  });
  const salt = db.seed("saltCellLogs", {
    customer_id: customer, created_by: OWNER, cleaning_date: "2026-01-01", condition: "good", created_at: now, updated_at: now,
  });
  return { customer, pool, equipment, log, photo, report, chemical, note, salt };
}

describe("deleteRecord authorization", () => {
  it("rejects unauthenticated callers", async () => {
    const db = new FakeDb();
    const ids = seedSoloTenant(db);
    const { ctx } = makeCtx(db, null);
    await expect((deleteRecord as any)._handler(ctx, { table: "customers", id: ids.customer }))
      .rejects.toThrow("Not authenticated");
  });

  it("refuses to delete another tenant's records and leaves them untouched", async () => {
    const db = new FakeDb();
    const ids = seedSoloTenant(db);
    const { ctx } = makeCtx(db, STRANGER);

    for (const [table, id] of [
      ["customers", ids.customer],
      ["serviceLogs", ids.log],
      ["chemicalUsage", ids.chemical],
      ["notes", ids.note],
      ["saltCellLogs", ids.salt],
      ["pools", ids.pool],
      ["equipment", ids.equipment],
    ] as const) {
      await expect((deleteRecord as any)._handler(ctx, { table, id })).rejects.toThrow(/Access denied/);
      expect((await db.get(id))!.deleted_at).toBeUndefined();
    }
  });

  it("lets the owner tombstone a child row without hard-deleting it", async () => {
    const db = new FakeDb();
    const ids = seedSoloTenant(db);
    const { ctx } = makeCtx(db, OWNER);

    const result = await (deleteRecord as any)._handler(ctx, { table: "notes", id: ids.note });
    expect(result).toEqual({ success: true, deleted_at: expect.any(Number) });

    const note = await db.get(ids.note);
    expect(note).not.toBeNull();
    expect(note!.deleted_at).toBe(result.deleted_at);
    expect(note!.updated_at).toBe(result.deleted_at);
  });

  it("treats a general note as owned by its creator (case-insensitive)", async () => {
    const db = new FakeDb();
    const note = db.seed("notes", { title: "t", content: "c", category: "general", priority: "low", created_by: "Owner@Example.com" });
    const { ctx } = makeCtx(db, OWNER);
    const result = await (deleteRecord as any)._handler(ctx, { table: "notes", id: note });
    expect(result.success).toBe(true);
    expect((await db.get(note))!.deleted_at).toBe(result.deleted_at);
  });

  it("is idempotent for unknown, malformed and already-deleted ids", async () => {
    const db = new FakeDb();
    const ids = seedSoloTenant(db);
    const { ctx } = makeCtx(db, OWNER);

    await expect((deleteRecord as any)._handler(ctx, { table: "notes", id: "not-a-real-id" }))
      .resolves.toMatchObject({ success: true });
    await expect((deleteRecord as any)._handler(ctx, { table: "notes", id: "notes:999" }))
      .resolves.toMatchObject({ success: true });

    const first = await (deleteRecord as any)._handler(ctx, { table: "chemicalUsage", id: ids.chemical });
    const second = await (deleteRecord as any)._handler(ctx, { table: "chemicalUsage", id: ids.chemical });
    expect(second).toEqual({ success: true, deleted_at: first.deleted_at });
  });
});

describe("deleteRecord customer cascade", () => {
  it("soft-deletes every child row and hard-deletes photos, storage files and reports", async () => {
    const db = new FakeDb();
    const ids = seedSoloTenant(db);
    const { ctx, deletedStorage } = makeCtx(db, OWNER);

    const result = await (deleteRecord as any)._handler(ctx, { table: "customers", id: ids.customer });
    expect(result).toEqual({ success: true, deleted_at: expect.any(Number) });

    for (const id of [ids.customer, ids.pool, ids.equipment, ids.log, ids.chemical, ids.note, ids.salt]) {
      const row = await db.get(id);
      expect(row, id).not.toBeNull();
      expect(row!.deleted_at, id).toBe(result.deleted_at);
      expect(row!.updated_at, id).toBe(result.deleted_at);
    }
    expect(await db.get(ids.photo)).toBeNull();
    expect(await db.get(ids.report)).toBeNull();
    expect(deletedStorage).toEqual(["storage:photo-1"]);

    // Every child lookup went through an index; nothing scanned a whole table.
    const childReads = db.indexReads.filter((read) =>
      ["pools", "equipment", "serviceLogs", "chemicalUsage", "notes", "saltCellLogs", "servicePhotos", "serviceReports"].includes(read.table)
    );
    expect(childReads.length).toBeGreaterThan(0);
    expect(childReads.every((read) => read.index !== null)).toBe(true);
  });

  it("customers.remove uses the same cascade", async () => {
    const db = new FakeDb();
    const ids = seedSoloTenant(db);
    const { ctx, deletedStorage } = makeCtx(db, OWNER);

    await (removeCustomer as any)._handler(ctx, { id: ids.customer });

    for (const id of [ids.customer, ids.pool, ids.log, ids.salt]) {
      expect((await db.get(id))!.deleted_at).toEqual(expect.any(Number));
    }
    expect(await db.get(ids.photo)).toBeNull();
    expect(deletedStorage).toEqual(["storage:photo-1"]);
  });

  it("refuses to resurrect a tombstoned row through a sync update", async () => {
    const db = new FakeDb();
    const ids = seedSoloTenant(db);
    const { ctx } = makeCtx(db, OWNER);
    const deleted = await (deleteRecord as any)._handler(ctx, { table: "customers", id: ids.customer });

    const customerResult = await (syncCustomer as any)._handler(ctx, {
      local_id: 1,
      convex_id: ids.customer,
      local_updated_at: Date.now() + 60_000,
      data: { full_name: "Alice Edited", address: "1", service_day: "Monday", pool_type: "Salt", surface_type: "Plaster" },
    });
    expect(customerResult).toMatchObject({
      success: false,
      operation: "deleted",
      convex_id: ids.customer,
      deleted_at: deleted.deleted_at,
      remote_data: { _id: ids.customer, deleted_at: deleted.deleted_at },
    });
    expect((await db.get(ids.customer))!.full_name).toBe("Alice");

    const logResult = await (syncServiceLog as any)._handler(ctx, {
      local_id: 2,
      convex_customer_id: ids.customer,
      convex_id: ids.log,
      local_updated_at: Date.now() + 60_000,
      data: { service_date: "2026-01-02", status: "completed", ph: "low", chlorine: "good", alkalinity: "good", stabilizer: "good" },
    });
    expect(logResult).toMatchObject({ success: false, operation: "deleted", deleted_at: deleted.deleted_at });
    expect((await db.get(ids.log))!.ph).toBe("good");
  });
});

async function drainPull(ctx: any, since: number) {
  const merged: Record<string, any[]> = {};
  let cursor: string | undefined;
  let rounds = 0;
  do {
    const result = await (pull as any)._handler(ctx, { cursor, since: cursor ? undefined : since, limit: 50 });
    for (const [key, value] of Object.entries(result)) {
      if (Array.isArray(value)) merged[key] = [...(merged[key] ?? []), ...value];
    }
    cursor = result.cursor ?? undefined;
    rounds += 1;
    if (rounds > 50) throw new Error("pull did not terminate");
  } while (cursor);
  return merged;
}

describe("pull tombstones and solo-user indexes", () => {
  it("returns tombstoned rows with deleted_at so clients can drop them", async () => {
    const db = new FakeDb();
    const ids = seedSoloTenant(db);
    const { ctx } = makeCtx(db, OWNER);
    const since = 5_000;

    const deleted = await (deleteRecord as any)._handler(ctx, { table: "saltCellLogs", id: ids.salt });
    expect(deleted.deleted_at).toBeGreaterThan(since);

    const incremental = await drainPull(ctx, since);
    expect(incremental.saltCellLogs).toEqual([
      expect.objectContaining({ _id: ids.salt, deleted_at: deleted.deleted_at, updated_at: deleted.deleted_at }),
    ]);
    // Untouched rows are older than the watermark and stay out of the delta.
    expect(incremental.serviceLogs).toEqual([]);
    expect(incremental.customers).toEqual([]);

    const initial = await drainPull(ctx, 0);
    expect(initial.saltCellLogs.map((row: any) => row._id)).toEqual([ids.salt]);
    expect(initial.customers.map((row: any) => row._id)).toEqual([ids.customer]);
    expect(initial.pools.map((row: any) => row._id)).toEqual([ids.pool]);
    expect(initial.equipment.map((row: any) => row._id)).toEqual([ids.equipment]);
  });

  it("reads every child table for solo users through by_created_by, including saltCellLogs", async () => {
    const db = new FakeDb();
    seedSoloTenant(db);
    // A row belonging to another tenant must never surface.
    db.seed("saltCellLogs", { customer_id: "customers:other", created_by: STRANGER, cleaning_date: "2026-01-01", condition: "good" });
    const { ctx } = makeCtx(db, OWNER);

    const result = await drainPull(ctx, 0);
    expect(result.saltCellLogs).toHaveLength(1);
    expect(result.saltCellLogs[0].created_by).toBe(OWNER);

    for (const table of ["serviceLogs", "chemicalUsage", "notes", "saltCellLogs"]) {
      const reads = db.indexReads.filter((read) => read.table === table);
      expect(reads.length, table).toBeGreaterThan(0);
      expect(reads.every((read) => read.index === "by_created_by"), table).toBe(true);
    }
    for (const table of ["pools", "equipment"]) {
      const reads = db.indexReads.filter((read) => read.table === table);
      expect(reads.length, table).toBeGreaterThan(0);
      expect(reads.every((read) => read.index === "by_customer"), table).toBe(true);
    }
  });

  it("never filters a child table without an index for business users", async () => {
    const db = new FakeDb();
    const business = db.seed("businesses", { name: "Biz", owner_email: OWNER, settings: {}, created_at: 1, updated_at: 1 });
    db.seed("team_members", { business_id: business, user_email: "tech@example.com", name: "Tech", role: "technician", is_active: true, invited_at: 1 });
    db.seed("team_members", { business_id: business, user_email: "gone@example.com", name: "Gone", role: "technician", is_active: false, invited_at: 1 });
    const customer = db.seed("customers", { full_name: "A", address: "x", service_day: "Monday", pool_type: "Salt", surface_type: "Plaster", created_by: OWNER, business_id: business });
    db.seed("serviceLogs", { customer_id: customer, created_by: "tech@example.com", service_date: "2026-01-01", status: "completed", ph: "good", chlorine: "good", alkalinity: "good", stabilizer: "good" });
    db.seed("serviceLogs", { customer_id: customer, created_by: "gone@example.com", service_date: "2026-01-01", status: "completed", ph: "good", chlorine: "good", alkalinity: "good", stabilizer: "good" });
    db.seed("serviceLogs", { customer_id: "customers:other", created_by: STRANGER, service_date: "2026-01-01", status: "completed", ph: "good", chlorine: "good", alkalinity: "good", stabilizer: "good" });
    const { ctx } = makeCtx(db, OWNER);

    const result = await drainPull(ctx, 0);
    expect(result.serviceLogs.map((row: any) => row.created_by)).toEqual(["tech@example.com"]);
    const childReads = db.indexReads.filter((read) => ["serviceLogs", "chemicalUsage", "notes", "saltCellLogs"].includes(read.table));
    expect(childReads.every((read) => read.index === "by_created_by")).toBe(true);
  });
});

describe("batchSyncCustomers bounds", () => {
  it("rejects batches above 100 items with a clear error", async () => {
    const db = new FakeDb();
    const { ctx } = makeCtx(db, OWNER);
    const customers = Array.from({ length: 101 }, (_, index) => ({
      local_id: index,
      local_updated_at: 1,
      data: { full_name: `C${index}`, address: "x", service_day: "Monday", pool_type: "Salt", surface_type: "Plaster" },
    }));
    await expect((batchSyncCustomers as any)._handler(ctx, { customers })).rejects.toThrow(/at most 100 customers/);
    expect(db.tables.get("customers") ?? []).toHaveLength(0);
  });
});
