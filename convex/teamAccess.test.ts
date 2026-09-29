import { describe, expect, it } from "vitest";
import {
  assertCustomerAccess,
  getAccessContext,
  isActiveMembership,
  resolveBusinessForUser,
} from "./access";
import { assertCanAddCustomers, assertCanAddTeamMember, limitsForSubscription } from "./planLimits";
import { acceptInvite, declineInvite, inviteTeamMember, leaveBusiness, listMyInvites } from "./businesses";
import { deletePhoto, uploadPhoto } from "./servicePhotos";

// ---------------------------------------------------------------------------
// Minimal in-memory stand-in for the Convex db used by these helpers.
// ---------------------------------------------------------------------------
type Row = Record<string, any> & { _id: string };

function createFakeDb(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {};
  let counter = 0;
  for (const [table, rows] of Object.entries(seed)) {
    tables[table] = rows.map((row) => ({ ...row }));
  }
  const tableOf = (id: string) => id.split(":")[0];

  function query(table: string) {
    const constraints: Array<(row: Row) => boolean> = [];
    const builder: any = {
      eq(field: string, value: unknown) {
        constraints.push((row) => row[field] === value);
        return builder;
      },
      lt(field: string, value: any) {
        constraints.push((row) => row[field] < value);
        return builder;
      },
      gte(field: string, value: any) {
        constraints.push((row) => row[field] >= value);
        return builder;
      },
      lte(field: string, value: any) {
        constraints.push((row) => row[field] <= value);
        return builder;
      },
    };
    const rows = () => (tables[table] ?? []).filter((row) => constraints.every((c) => c(row)));
    const q: any = {
      withIndex(_name: string, fn?: (b: any) => any) {
        if (fn) fn(builder);
        return q;
      },
      order() {
        return q;
      },
      async first() {
        return rows()[0] ?? null;
      },
      async take(n: number) {
        return rows().slice(0, n);
      },
      async collect() {
        return rows();
      },
    };
    return q;
  }

  const db = {
    tables,
    query,
    async get(id: string) {
      return (tables[tableOf(String(id))] ?? []).find((row) => row._id === id) ?? null;
    },
    normalizeId(table: string, id: string) {
      return typeof id === "string" && id.startsWith(`${table}:`) ? id : null;
    },
    async insert(table: string, doc: Record<string, any>) {
      const _id = `${table}:new${++counter}`;
      (tables[table] ??= []).push({ ...doc, _id });
      return _id;
    },
    async patch(id: string, fields: Record<string, any>) {
      const row = (tables[tableOf(id)] ?? []).find((r) => r._id === id);
      if (!row) throw new Error(`missing ${id}`);
      for (const [key, value] of Object.entries(fields)) {
        if (value === undefined) delete row[key];
        else row[key] = value;
      }
    },
    async delete(id: string) {
      const table = tables[tableOf(id)] ?? [];
      const index = table.findIndex((r) => r._id === id);
      if (index >= 0) table.splice(index, 1);
    },
    system: {
      async get(id: string) {
        return (tables._storage ?? []).find((row) => row._id === id) ?? null;
      },
    },
  };
  return db;
}

function ctxFor(db: ReturnType<typeof createFakeDb>, email: string | null) {
  return {
    db,
    auth: {
      async getUserIdentity() {
        return email ? { email, name: email.split("@")[0] } : null;
      },
    },
  } as any;
}

const settings = {
  working_days: [],
  working_hours_start: "08:00",
  working_hours_end: "17:00",
  service_types: [],
  chemical_types: [],
  route_optimization: true,
  require_photos: false,
  require_signatures: false,
};

function baseSeed() {
  return {
    businesses: [
      { _id: "businesses:acme", name: "Acme Pools", owner_email: "owner@acme.test", settings },
      { _id: "businesses:victim", name: "Victim Pools", owner_email: "victim@pools.test", settings },
    ],
    team_members: [
      { _id: "team_members:o1", business_id: "businesses:acme", user_email: "owner@acme.test", role: "owner", is_active: true, status: "active", invited_at: 1 },
      { _id: "team_members:o2", business_id: "businesses:victim", user_email: "victim@pools.test", role: "owner", is_active: true, invited_at: 1 },
    ],
    customers: [
      { _id: "customers:c1", full_name: "A", created_by: "owner@acme.test", business_id: "businesses:acme" },
      { _id: "customers:v1", full_name: "V", created_by: "victim@pools.test", business_id: "businesses:victim" },
    ],
    subscriptions: [
      { _id: "subscriptions:s1", business_id: "businesses:acme", user_email: "owner@acme.test", plan_id: "professional", status: "active" },
    ],
  } as Record<string, Row[]>;
}

const call = (fn: any, ctx: any, args: any = {}) => fn._handler(ctx, args);

describe("membership rule", () => {
  it("treats legacy rows without status as active and pending rows as inactive", () => {
    expect(isActiveMembership({ is_active: true })).toBe(true);
    expect(isActiveMembership({ is_active: true, status: "active" })).toBe(true);
    expect(isActiveMembership({ is_active: true, status: "pending" })).toBe(false);
    expect(isActiveMembership({ is_active: false, status: "active" })).toBe(false);
  });
});

describe("team invites", () => {
  it("does not hijack the invitee's own business until they accept", async () => {
    const db = createFakeDb(baseSeed());
    const owner = ctxFor(db, "owner@acme.test");
    const memberId = await call(inviteTeamMember, owner, { email: "Victim@Pools.test", name: "V", role: "admin" });

    const inviteRow = await db.get(memberId);
    expect(inviteRow).toMatchObject({ status: "pending", is_active: false, user_email: "victim@pools.test" });

    // The invitee still resolves to their own business and cannot reach Acme's customers.
    const victim = ctxFor(db, "victim@pools.test");
    expect((await resolveBusinessForUser(victim, "victim@pools.test"))?._id).toBe("businesses:victim");
    await expect(assertCustomerAccess(victim, "customers:c1", "victim@pools.test")).rejects.toThrow();
    // ...and the inviter gets no access to the invitee's data either.
    await expect(assertCustomerAccess(owner, "customers:v1", "owner@acme.test")).rejects.toThrow();

    const invites = await call(listMyInvites, victim);
    expect(invites).toHaveLength(1);
    expect(invites[0]).toMatchObject({ business_name: "Acme Pools", role: "admin" });
  });

  it("only lets the addressed user accept, then grants access", async () => {
    const db = createFakeDb(baseSeed());
    const owner = ctxFor(db, "owner@acme.test");
    const memberId = await call(inviteTeamMember, owner, { email: "tech@acme.test", name: "T", role: "technician" });

    await expect(call(acceptInvite, ctxFor(db, "intruder@evil.test"), { memberId })).rejects.toThrow("Invite not found");

    const tech = ctxFor(db, "tech@acme.test");
    await expect(assertCustomerAccess(tech, "customers:c1", "tech@acme.test")).rejects.toThrow();
    await call(acceptInvite, tech, { memberId });
    expect(await db.get(memberId)).toMatchObject({ status: "active", is_active: true });

    const access = await getAccessContext(tech, "tech@acme.test");
    expect(access).toMatchObject({ businessId: "businesses:acme", role: "technician", tenantEmail: "owner@acme.test" });
    await expect(assertCustomerAccess(tech, "customers:c1", "tech@acme.test")).resolves.toBeTruthy();
    // Technicians cannot write customer records (owner/admin only)...
    await expect(assertCustomerAccess(tech, "customers:c1", "tech@acme.test", { write: true })).rejects.toThrow(
      "Insufficient role permissions"
    );
    // ...but may record field work.
    await expect(
      assertCustomerAccess(tech, "customers:c1", "tech@acme.test", { roles: ["owner", "admin", "technician"] })
    ).resolves.toBeTruthy();

    // Accepting twice is rejected.
    await expect(call(acceptInvite, tech, { memberId })).rejects.toThrow("no longer pending");

    // Leaving removes access.
    await call(leaveBusiness, tech);
    await expect(assertCustomerAccess(tech, "customers:c1", "tech@acme.test")).rejects.toThrow();
  });

  it("declines invites and blocks owners from leaving their own business", async () => {
    const db = createFakeDb(baseSeed());
    const owner = ctxFor(db, "owner@acme.test");
    const memberId = await call(inviteTeamMember, owner, { email: "x@y.test", name: "X", role: "viewer" });
    await call(declineInvite, ctxFor(db, "x@y.test"), { memberId });
    expect(await db.get(memberId)).toMatchObject({ status: "declined", is_active: false });
    await expect(call(leaveBusiness, owner)).rejects.toThrow();
  });

  it("enforces the plan's user limit, counting pending invites", async () => {
    const db = createFakeDb(baseSeed());
    const owner = ctxFor(db, "owner@acme.test");
    // Professional = 3 users: owner + 2 invites.
    await call(inviteTeamMember, owner, { email: "a@acme.test", name: "A", role: "technician" });
    await call(inviteTeamMember, owner, { email: "b@acme.test", name: "B", role: "technician" });
    await expect(
      call(inviteTeamMember, owner, { email: "c@acme.test", name: "C", role: "technician" })
    ).rejects.toThrow(/Plan limit reached/);
  });
});

describe("service photo storage ownership", () => {
  function photoSeed() {
    const seed = baseSeed();
    seed.serviceLogs = [
      { _id: "serviceLogs:l1", customer_id: "customers:c1" },
      { _id: "serviceLogs:v1", customer_id: "customers:v1" },
    ];
    seed._storage = [
      { _id: "_storage:victimFile", contentType: "image/jpeg", size: 1000 },
      { _id: "_storage:mine", contentType: "image/jpeg", size: 1000 },
    ];
    seed.servicePhotos = [
      { _id: "servicePhotos:vp", service_log_id: "serviceLogs:v1", customer_id: "customers:v1", storage_id: "_storage:victimFile", category: "before" },
    ];
    return seed;
  }

  it("refuses to attach a storage id that another photo already owns", async () => {
    const db = createFakeDb(photoSeed());
    const deleted: string[] = [];
    const ctx = { ...ctxFor(db, "owner@acme.test"), storage: { delete: async (id: string) => deleted.push(id) } };
    const base = { service_log_id: "serviceLogs:l1", customer_id: "customers:c1", category: "before", timestamp: new Date().toISOString() };

    await expect(call(uploadPhoto, ctx, { ...base, storage_id: "_storage:victimFile" })).rejects.toThrow(/already attached/);
    await expect(call(uploadPhoto, ctx, { ...base, storage_id: "_storage:missing" })).rejects.toThrow(/does not exist/);
    // Service log must belong to the given customer.
    await expect(
      call(uploadPhoto, ctx, { ...base, service_log_id: "serviceLogs:v1", storage_id: "_storage:mine" })
    ).rejects.toThrow();

    const photoId = await call(uploadPhoto, ctx, { ...base, storage_id: "_storage:mine" });
    await call(deletePhoto, ctx, { photo_id: photoId });
    expect(deleted).toEqual(["_storage:mine"]);
    // The victim's file was never touched.
    expect(await db.get("servicePhotos:vp")).toBeTruthy();
  });
});

describe("plan limits", () => {
  it("maps subscriptions to limits, with a free tier for missing/ended plans", () => {
    expect(limitsForSubscription(null)).toEqual({ users: 1, customers: 10 });
    expect(limitsForSubscription({ plan_id: "starter", status: "trialing" })).toEqual({ users: 1, customers: 50 });
    expect(limitsForSubscription({ plan_id: "professional", status: "canceled" })).toEqual({ users: 1, customers: 10 });
    expect(limitsForSubscription({ plan_id: "business", status: "active" })).toEqual({ users: -1, customers: -1 });
  });

  it("blocks adding customers beyond the plan limit", async () => {
    const seed = baseSeed();
    seed.subscriptions = [];
    seed.customers = Array.from({ length: 10 }, (_, i) => ({
      _id: `customers:x${i}`,
      created_by: "owner@acme.test",
      business_id: "businesses:acme",
    }));
    const db = createFakeDb(seed);
    const ctx = ctxFor(db, "owner@acme.test");
    await expect(assertCanAddCustomers(ctx, "owner@acme.test", 1)).rejects.toThrow(/allows up to 10 customers/);

    db.tables.subscriptions = [
      { _id: "subscriptions:s2", business_id: "businesses:acme", user_email: "owner@acme.test", plan_id: "starter", status: "active" },
    ];
    await expect(assertCanAddCustomers(ctx, "owner@acme.test", 1)).resolves.toBeUndefined();
    await expect(assertCanAddCustomers(ctx, "owner@acme.test", 41)).rejects.toThrow(/Plan limit reached/);
  });

  it("starter plans cannot add team members", async () => {
    const seed = baseSeed();
    seed.subscriptions = [
      { _id: "subscriptions:s1", business_id: "businesses:acme", user_email: "owner@acme.test", plan_id: "starter", status: "active" },
    ];
    const db = createFakeDb(seed);
    const business = await db.get("businesses:acme");
    await expect(assertCanAddTeamMember(ctxFor(db, "owner@acme.test"), business, 1)).rejects.toThrow(/Plan limit reached/);
  });
});
