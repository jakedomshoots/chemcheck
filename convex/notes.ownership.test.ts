import { describe, expect, it } from "vitest";
import { create, get, list, remove, update, canAccessNote } from "./notes";
import { syncNote } from "./sync";
import { FakeDb, seedBusiness, seedCustomer, seedMember } from "./fakeConvexDb.testing";

const OWNER = "owner@example.com";
const TECH = "tech@example.com";
const STRANGER = "stranger@example.com";

function ctxFor(db: FakeDb, email: string | null) {
  return {
    db,
    auth: { getUserIdentity: async () => (email ? { email, tokenIdentifier: `t|${email}` } : null) },
  };
}

async function seedTenants(db: FakeDb) {
  const businessId = await seedBusiness(db, OWNER);
  await seedMember(db, businessId, TECH);
  await seedBusiness(db, STRANGER, "Other business");
  const customer = await seedCustomer(db, OWNER, { business_id: businessId });
  return { businessId, customer };
}

describe("notes.create", () => {
  it("stamps created_by from the identity, never from the caller's arguments", async () => {
    const db = new FakeDb();
    await seedTenants(db);
    const id = await (create as any)._handler(ctxFor(db, OWNER), {
      title: "Gate code", content: "1234", category: "general", priority: "low",
    });
    const note = await db.get(id);
    expect(note?.created_by).toBe(OWNER);
    expect(note?.customer_id).toBeUndefined();
    expect(typeof note?.updated_at).toBe("number");
  });

  it("rejects linking a note to another tenant's customer", async () => {
    const db = new FakeDb();
    const { customer } = await seedTenants(db);
    await expect((create as any)._handler(ctxFor(db, STRANGER), {
      title: "x", content: "y", category: "general", priority: "low", customer_id: customer,
    })).rejects.toThrow(/access denied/i);
  });

  it("stamps a team member's customer-linked note with the customer's owner so business listings include it", async () => {
    const db = new FakeDb();
    const { customer } = await seedTenants(db);
    const id = await (create as any)._handler(ctxFor(db, TECH), {
      title: "x", content: "y", category: "general", priority: "low", customer_id: customer,
    });
    expect((await db.get(id))?.created_by).toBe(OWNER);
  });
});

describe("notes.get / update / remove ownership", () => {
  async function seedNotes(db: FakeDb) {
    const { customer } = await seedTenants(db);
    const general = await db.insert("notes", { title: "mine", content: "c", category: "general", priority: "low", created_by: OWNER });
    const linked = await db.insert("notes", { title: "linked", content: "c", category: "general", priority: "low", customer_id: customer, created_by: OWNER });
    const legacy = await db.insert("notes", { title: "legacy", content: "c", category: "general", priority: "low" });
    return { customer, general, linked, legacy };
  }

  it("get returns the note to its owner and same-business members, null to strangers", async () => {
    const db = new FakeDb();
    const ids = await seedNotes(db);
    expect((await (get as any)._handler(ctxFor(db, OWNER), { id: ids.general }))?.title).toBe("mine");
    expect((await (get as any)._handler(ctxFor(db, TECH), { id: ids.general }))?.title).toBe("mine");
    expect((await (get as any)._handler(ctxFor(db, TECH), { id: ids.linked }))?.title).toBe("linked");
    expect(await (get as any)._handler(ctxFor(db, STRANGER), { id: ids.general })).toBeNull();
    expect(await (get as any)._handler(ctxFor(db, STRANGER), { id: ids.linked })).toBeNull();
    // Ownerless legacy rows are invisible to everyone until backfilled.
    expect(await (get as any)._handler(ctxFor(db, OWNER), { id: ids.legacy })).toBeNull();
    await expect((get as any)._handler(ctxFor(db, null), { id: ids.general })).rejects.toThrow(/Not authenticated/);
  });

  it("update is refused for strangers and for ownerless legacy notes", async () => {
    const db = new FakeDb();
    const ids = await seedNotes(db);
    await expect((update as any)._handler(ctxFor(db, STRANGER), { id: ids.general, title: "stolen" }))
      .rejects.toThrow(/Access denied/);
    await expect((update as any)._handler(ctxFor(db, STRANGER), { id: ids.linked, title: "stolen" }))
      .rejects.toThrow(/Access denied/);
    await expect((update as any)._handler(ctxFor(db, OWNER), { id: ids.legacy, title: "claimed" }))
      .rejects.toThrow(/Access denied/);

    await (update as any)._handler(ctxFor(db, TECH), { id: ids.general, title: "team edit", priority: "high" });
    expect((await db.get(ids.general))?.title).toBe("team edit");
    expect((await db.get(ids.general))?.created_by).toBe(OWNER);
  });

  it("update validates category/priority and re-homing onto a foreign customer", async () => {
    const db = new FakeDb();
    const ids = await seedNotes(db);
    const foreignCustomer = await seedCustomer(db, STRANGER);
    await expect((update as any)._handler(ctxFor(db, OWNER), { id: ids.general, priority: "silly" }))
      .rejects.toThrow(/Invalid priority/);
    await expect((update as any)._handler(ctxFor(db, OWNER), { id: ids.general, customer_id: foreignCustomer }))
      .rejects.toThrow(/access denied/i);
  });

  it("remove tombstones for owner/team and refuses strangers", async () => {
    const db = new FakeDb();
    const ids = await seedNotes(db);
    await expect((remove as any)._handler(ctxFor(db, STRANGER), { id: ids.general })).rejects.toThrow(/Access denied/);
    await (remove as any)._handler(ctxFor(db, TECH), { id: ids.general });
    expect(typeof (await db.get(ids.general))?.deleted_at).toBe("number");
    await expect((remove as any)._handler(ctxFor(db, OWNER), { id: ids.legacy })).rejects.toThrow(/Access denied/);
  });

  it("list only returns the caller's own notes", async () => {
    const db = new FakeDb();
    await seedNotes(db);
    await db.insert("notes", { title: "theirs", content: "c", category: "general", priority: "low", created_by: STRANGER });
    const page = await (list as any)._handler(ctxFor(db, OWNER), {});
    expect(page.page.map((n: any) => n.title).sort()).toEqual(["linked", "mine"]);
    const strangerPage = await (list as any)._handler(ctxFor(db, STRANGER), {});
    expect(strangerPage.page.map((n: any) => n.title)).toEqual(["theirs"]);
  });

  it("canAccessNote handles missing rows", async () => {
    const db = new FakeDb();
    expect(await canAccessNote({ db } as any, null, OWNER)).toBe(false);
    expect(await canAccessNote({ db } as any, { created_by: undefined } as any, OWNER)).toBe(false);
  });
});

describe("sync.syncNote ownership", () => {
  it("stamps a customer-linked offline note with the customer's owner", async () => {
    const db = new FakeDb();
    const { customer } = await seedTenants(db);

    const created = await (syncNote as any)._handler(ctxFor(db, TECH), {
      local_id: 1,
      convex_customer_id: customer,
      data: { title: "Filter pressure", content: "18 PSI", category: "Equipment", priority: "medium" },
      local_updated_at: 10,
    });

    expect((await db.get(created.convex_id))?.created_by).toBe(OWNER);
  });

  it("sets created_by on insert and refuses updates from another tenant", async () => {
    const db = new FakeDb();
    await seedTenants(db);
    const ctx = ctxFor(db, OWNER);
    const created = await (syncNote as any)._handler(ctx, {
      local_id: 1,
      data: { title: "General", content: "c", category: "General", priority: "low" },
      local_updated_at: 10,
    });
    expect(created.success).toBe(true);
    expect((await db.get(created.convex_id))?.created_by).toBe(OWNER);

    await expect((syncNote as any)._handler(ctxFor(db, STRANGER), {
      local_id: 1,
      convex_id: created.convex_id,
      data: { title: "Hijack", content: "c", category: "General", priority: "low" },
      local_updated_at: Date.now() + 1000,
    })).rejects.toThrow(/Access denied: cannot update another user's note/);

    // A same-business technician may update it; the owner stays recorded.
    const teamUpdate = await (syncNote as any)._handler(ctxFor(db, TECH), {
      local_id: 1,
      convex_id: created.convex_id,
      data: { title: "Team edit", content: "c", category: "General", priority: "low" },
      local_updated_at: Date.now() + 1000,
    });
    expect(teamUpdate.success).toBe(true);
    const after = await db.get(created.convex_id);
    expect(after?.title).toBe("Team edit");
    expect(after?.created_by).toBe(OWNER);
  });

  it("lets the first syncing account claim an ownerless legacy note", async () => {
    const db = new FakeDb();
    await seedTenants(db);
    const legacy = await db.insert("notes", { title: "legacy", content: "c", category: "General", priority: "low", updated_at: 1 });
    const result = await (syncNote as any)._handler(ctxFor(db, OWNER), {
      local_id: 5,
      convex_id: legacy,
      data: { title: "legacy edited", content: "c", category: "General", priority: "low" },
      local_updated_at: Date.now(),
    });
    expect(result.success).toBe(true);
    expect((await db.get(legacy))?.created_by).toBe(OWNER);
  });
});
