import { describe, expect, it } from "vitest";
import { FakeDb, makeCtx, seedBusiness, seedCustomer, seedMember } from "./fakeConvexDb.testing";
import { loadCostSummary, technicianEmailsForCaller } from "./chemicalCosts";
import { upsertPriceForBusiness } from "./chemicalPricing";

const OWNER = "owner@example.com";
const TECH = "tech@example.com";

async function usage(db: FakeDb, fields: Record<string, any>) {
  return await db.insert("chemicalUsage", { created_by: OWNER, quantity: "1 gal", chemical_type: "Liquid Chlorine", created_date: "2026-03-02", ...fields });
}

describe("chemical cost roll-ups", () => {
  it("collects technician emails for the caller's business without case duplicates", async () => {
    const db = new FakeDb();
    const ctx = makeCtx(db);
    const biz = await seedBusiness(db, OWNER);
    await seedMember(db, biz, "tech@example.com");
    await seedMember(db, biz, "gone@example.com", { is_active: false });
    const { emails } = await technicianEmailsForCaller(ctx, "Tech@Example.com");
    expect(emails.map((e) => e.toLowerCase()).sort()).toEqual([OWNER, "tech@example.com"]);
    expect(emails).toHaveLength(2);
  });

  it("rolls up stored and on-the-fly costs across the business within the range", async () => {
    const db = new FakeDb();
    const ctx = makeCtx(db);
    const biz = await seedBusiness(db, OWNER);
    await seedMember(db, biz, TECH);
    await upsertPriceForBusiness(ctx as any, OWNER, { chemical_type: "Liquid Chlorine", unit: "gal", unit_price: 4 });

    const alice = await seedCustomer(db, OWNER, { full_name: "Alice", service_day: "Monday" });
    const bob = await seedCustomer(db, TECH, { full_name: "Bob", service_day: "Tuesday" });
    const spa = await db.insert("pools", { customer_id: alice, name: "Spa", service_day: "Monday", pool_type: "Chlorine", surface_type: "Plaster", active: true, created_at: 1, updated_at: 1 });

    await usage(db, { customer_id: alice });                                  // on the fly: $4
    await usage(db, { customer_id: alice, pool_id: spa, quantity: "2 gal", total_cost: 7.5, normalized_amount: 2, normalized_unit: "gal" }); // stored
    await usage(db, { customer_id: bob, created_by: TECH, chemical_type: "Algaecide", quantity: "8 oz", created_date: "2026-03-03" }); // unpriced
    await usage(db, { customer_id: bob, created_by: TECH, created_date: "2026-02-01" }); // out of range
    await usage(db, { customer_id: alice, created_date: "2026-03-04", deleted_at: 5 }); // tombstoned
    await usage(db, { customer_id: alice, created_by: "stranger@example.com" }); // not in business
    // Alice's Mar 2 visit was logged by the tech, so the cost is attributed to the tech.
    await db.insert("serviceLogs", { customer_id: alice, created_by: TECH, service_date: "2026-03-02", status: "completed", ph: "good", chlorine: "good", alkalinity: "good", stabilizer: "good" });

    const summary = await loadCostSummary(ctx, TECH, { start: "2026-03-01", end: "2026-03-31", top_n: 5 });
    expect(summary.totals).toEqual({ total_cost: 11.5, rows: 3, priced_rows: 2, unpriced_rows: 1, visits: 3, cost_per_visit: 3.83 });
    expect(summary.top_pools.map((p) => [p.label, p.total_cost])).toEqual([["Alice · Spa", 7.5], ["Alice", 4], ["Bob", 0]]);
    expect(summary.by_technician).toEqual([
      expect.objectContaining({ key: TECH, total_cost: 11.5 }),
    ]);
    expect(summary.by_route_day.map((d) => [d.key, d.total_cost])).toEqual([["Monday", 11.5], ["Tuesday", 0]]);
    expect(summary.unpriced_chemicals).toEqual(["Algaecide"]);
    expect(summary.has_prices).toBe(true);
    expect(summary.truncated).toBe(false);
    expect(summary.range).toEqual({ start: "2026-03-01", end: "2026-03-31" });
  });

  it("limits a caller without a business to their own rows", async () => {
    const db = new FakeDb();
    const ctx = makeCtx(db);
    const solo = "solo@example.com";
    const customer = await seedCustomer(db, solo, { full_name: "Solo" });
    await usage(db, { customer_id: customer, created_by: solo });
    await usage(db, { customer_id: customer, created_by: OWNER });
    const summary = await loadCostSummary(ctx, solo, { start: "2026-03-01", end: "2026-03-31" });
    expect(summary.totals.rows).toBe(1);
    expect(summary.has_prices).toBe(false);
    expect(summary.technicians).toEqual([solo]);
  });

  it("rejects bad ranges", async () => {
    const ctx = makeCtx(new FakeDb());
    await expect(loadCostSummary(ctx, OWNER, { start: "2026-03-31", end: "2026-03-01" })).rejects.toThrow(/Start date/);
    await expect(loadCostSummary(ctx, OWNER, { start: "nope", end: "2026-03-01" })).rejects.toThrow(/YYYY-MM-DD/);
    await expect(loadCostSummary(ctx, OWNER, { start: "2024-01-01", end: "2026-03-01" })).rejects.toThrow(/limited/);
  });
});
