import { describe, expect, it } from "vitest";
import { backfillCreatedByBatch, backfillDeletedAtBatch, countMissingCreatedBy } from "./migrations";
import { FakeDb, makeCtx, seedCustomer } from "./fakeConvexDb.testing";

const OWNER = "owner@example.com";

async function seedWorld(db: FakeDb) {
  const owned = await seedCustomer(db, OWNER, { full_name: "Owned" });
  const unowned = await db.insert("customers", { full_name: "No owner", address: "", service_day: "Monday", pool_type: "Chlorine", surface_type: "Plaster" });

  const ids = {
    owned,
    unowned,
    pool: await db.insert("pools", { customer_id: owned, name: "Primary", service_day: "Monday", pool_type: "Chlorine", surface_type: "Plaster", active: true }),
    poolOwned: await db.insert("pools", { customer_id: owned, name: "Spa", service_day: "Monday", pool_type: "Chlorine", surface_type: "Plaster", active: true, created_by: "already@example.com" }),
    equipment: await db.insert("equipment", { customer_id: owned, pool_id: "pools:1", equipment_type: "Pump", name: "Pump", status: "active" }),
    usage: await db.insert("chemicalUsage", { customer_id: owned, chemical_type: "Chlorine", quantity: "1" }),
    usageOrphan: await db.insert("chemicalUsage", { customer_id: "customers:999", chemical_type: "Acid", quantity: "1" }),
    usageUnowned: await db.insert("chemicalUsage", { customer_id: unowned, chemical_type: "Acid", quantity: "1" }),
    salt: await db.insert("saltCellLogs", { customer_id: owned, cleaning_date: "2026-01-01", condition: "good" }),
    note: await db.insert("notes", { customer_id: owned, title: "Gate", content: "1234", category: "general", priority: "low" }),
    generalNote: await db.insert("notes", { title: "General", content: "x", category: "general", priority: "low" }),
  };
  return ids;
}

describe("backfillCreatedByBatch", () => {
  it("fills created_by from the customer and reports what it skipped", async () => {
    const db = new FakeDb();
    const ids = await seedWorld(db);
    const { db: ctxDb } = makeCtx(db);

    const result = await (backfillCreatedByBatch as any)._handler({ db: ctxDb }, { table: "chemicalUsage" });

    expect(result).toMatchObject({
      table: "chemicalUsage",
      dry_run: false,
      processed: 3,
      updated: 1,
      skipped: { alreadyOwned: 0, noCustomer: 0, customerMissing: 1, customerUnowned: 1 },
      isDone: true,
    });
    expect((await db.get(ids.usage))?.created_by).toBe(OWNER);
    expect((await db.get(ids.usageOrphan))?.created_by).toBeUndefined();
    expect((await db.get(ids.usageUnowned))?.created_by).toBeUndefined();
  });

  it("dry_run reports the same counts without writing", async () => {
    const db = new FakeDb();
    const ids = await seedWorld(db);
    const { db: ctxDb } = makeCtx(db);

    const result = await (backfillCreatedByBatch as any)._handler({ db: ctxDb }, { table: "pools", dry_run: true });

    expect(result.updated).toBe(1);
    expect(result.skipped.alreadyOwned).toBe(1);
    expect((await db.get(ids.pool))?.created_by).toBeUndefined();
    expect((await db.get(ids.poolOwned))?.created_by).toBe("already@example.com");
  });

  it("is idempotent and leaves customer-less notes alone", async () => {
    const db = new FakeDb();
    const ids = await seedWorld(db);
    const { db: ctxDb } = makeCtx(db);

    const first = await (backfillCreatedByBatch as any)._handler({ db: ctxDb }, { table: "notes" });
    expect(first.updated).toBe(1);
    expect(first.skipped.noCustomer).toBe(1);
    expect((await db.get(ids.note))?.created_by).toBe(OWNER);
    expect((await db.get(ids.generalNote))?.created_by).toBeUndefined();

    const second = await (backfillCreatedByBatch as any)._handler({ db: ctxDb }, { table: "notes" });
    expect(second.updated).toBe(0);
    expect(second.skipped.alreadyOwned).toBe(1);
  });

  it("pages with the returned cursor", async () => {
    const db = new FakeDb();
    const owned = await seedCustomer(db, OWNER);
    for (let i = 0; i < 5; i += 1) {
      await db.insert("equipment", { customer_id: owned, pool_id: "pools:1", equipment_type: "Pump", name: `Pump ${i}`, status: "active" });
    }
    const { db: ctxDb } = makeCtx(db);

    const page1 = await (backfillCreatedByBatch as any)._handler({ db: ctxDb }, { table: "equipment", batchSize: 2 });
    expect(page1).toMatchObject({ processed: 2, updated: 2, isDone: false });
    const page2 = await (backfillCreatedByBatch as any)._handler({ db: ctxDb }, { table: "equipment", batchSize: 2, cursor: page1.continueCursor });
    expect(page2).toMatchObject({ processed: 2, updated: 2, isDone: false });
    const page3 = await (backfillCreatedByBatch as any)._handler({ db: ctxDb }, { table: "equipment", batchSize: 2, cursor: page2.continueCursor });
    expect(page3).toMatchObject({ processed: 1, updated: 1, isDone: true });

    expect(db.all("equipment").every((row) => row.created_by === OWNER)).toBe(true);
  });
});

describe("backfillDeletedAtBatch", () => {
  async function seedDeleted(db: FakeDb) {
    const deletedAt = 1_700_000_000_000;
    const deleted = await seedCustomer(db, OWNER, { full_name: "Gone", deleted_at: deletedAt, updated_at: deletedAt });
    const live = await seedCustomer(db, OWNER, { full_name: "Alive" });
    const ids = {
      deleted,
      live,
      deletedAt,
      pool: await db.insert("pools", { customer_id: deleted, name: "P", service_day: "Monday", pool_type: "Chlorine", surface_type: "Plaster", active: true, updated_at: 1 }),
      equipment: await db.insert("equipment", { customer_id: deleted, pool_id: "pools:1", equipment_type: "Pump", name: "Pump", status: "active" }),
      log: await db.insert("serviceLogs", { customer_id: deleted, service_date: "2026-01-01", status: "completed", ph: "good", chlorine: "good", alkalinity: "good", stabilizer: "good", updated_at: deletedAt + 5000 }),
      usage: await db.insert("chemicalUsage", { customer_id: deleted, chemical_type: "Chlorine", quantity: "1" }),
      note: await db.insert("notes", { customer_id: deleted, title: "n", content: "c", category: "general", priority: "low" }),
      salt: await db.insert("saltCellLogs", { customer_id: deleted, cleaning_date: "2026-01-01", condition: "good" }),
      alreadyTombstoned: await db.insert("notes", { customer_id: deleted, title: "old", content: "c", category: "general", priority: "low", deleted_at: 5, updated_at: 5 }),
      liveLog: await db.insert("serviceLogs", { customer_id: live, service_date: "2026-01-02", status: "completed", ph: "good", chlorine: "good", alkalinity: "good", stabilizer: "good" }),
    };
    return ids;
  }

  it("tombstones every child of a soft-deleted customer, once", async () => {
    const db = new FakeDb();
    const ids = await seedDeleted(db);
    const { db: ctxDb } = makeCtx(db);

    const result = await (backfillDeletedAtBatch as any)._handler({ db: ctxDb }, {});
    expect(result).toMatchObject({
      dry_run: false,
      processed: 2,
      deletedCustomers: 1,
      updated: { pools: 1, equipment: 1, serviceLogs: 1, chemicalUsage: 1, notes: 1, saltCellLogs: 1 },
      isDone: true,
    });

    for (const id of [ids.pool, ids.equipment, ids.log, ids.usage, ids.note, ids.salt]) {
      expect((await db.get(id))?.deleted_at).toBe(ids.deletedAt);
    }
    // updated_at is bumped to at least the tombstone time, never lowered.
    expect((await db.get(ids.pool))?.updated_at).toBe(ids.deletedAt);
    expect((await db.get(ids.log))?.updated_at).toBe(ids.deletedAt + 5000);
    // Existing tombstones and live customers' children are untouched.
    expect((await db.get(ids.alreadyTombstoned))?.deleted_at).toBe(5);
    expect((await db.get(ids.liveLog))?.deleted_at).toBeUndefined();

    const again = await (backfillDeletedAtBatch as any)._handler({ db: ctxDb }, {});
    expect(again.updated).toEqual({ pools: 0, equipment: 0, serviceLogs: 0, chemicalUsage: 0, notes: 0, saltCellLogs: 0 });
  });

  it("dry_run counts but does not write", async () => {
    const db = new FakeDb();
    const ids = await seedDeleted(db);
    const { db: ctxDb } = makeCtx(db);

    const result = await (backfillDeletedAtBatch as any)._handler({ db: ctxDb }, { dry_run: true });
    expect(result.updated.notes).toBe(1);
    expect((await db.get(ids.note))?.deleted_at).toBeUndefined();
  });
});

describe("countMissingCreatedBy", () => {
  it("reports per-table totals", async () => {
    const db = new FakeDb();
    await seedWorld(db);
    const { db: ctxDb } = makeCtx(db);

    const counts = await (countMissingCreatedBy as any)._handler({ db: ctxDb }, {});
    expect(counts.pools).toEqual({ total: 2, missingCreatedBy: 1 });
    expect(counts.notes).toEqual({ total: 2, missingCreatedBy: 2 });
    expect(counts.chemicalUsage).toEqual({ total: 3, missingCreatedBy: 3 });
  });
});
