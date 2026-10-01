import { describe, expect, it } from "vitest";
import { FakeDb, makeCtx, seedBusiness, seedMember } from "./fakeConvexDb.testing";
import {
  computeUsageCostFields,
  listPricesForBusiness,
  removePriceForBusiness,
  requireBusinessManager,
  seedDefaultPricesForBusiness,
  upsertPriceForBusiness,
  usageCostFieldsFromPrices,
} from "./chemicalPricing";
import { CHEMICAL_CATALOG } from "../src/lib/chemicalCosts";

const OWNER = "owner@example.com";
const ADMIN = "admin@example.com";
const TECH = "tech@example.com";

async function setup() {
  const db = new FakeDb();
  const ctx = makeCtx(db);
  const biz = await seedBusiness(db, OWNER, "Pool Co");
  await seedMember(db, biz, ADMIN, { role: "admin" });
  await seedMember(db, biz, TECH, { role: "technician" });
  return { db, ctx, biz };
}

describe("chemical pricing", () => {
  it("lets owners and admins manage prices but not technicians or strangers", async () => {
    const { ctx } = await setup();
    await expect(requireBusinessManager(ctx, OWNER)).resolves.toMatchObject({ name: "Pool Co" });
    await expect(requireBusinessManager(ctx, "ADMIN@example.com")).resolves.toMatchObject({ name: "Pool Co" });
    await expect(requireBusinessManager(ctx, TECH)).rejects.toThrow(/owners and admins/);
    await expect(requireBusinessManager(ctx, "nobody@example.com")).rejects.toThrow(/No business/);
  });

  it("upserts by normalized chemical key and keeps a display label", async () => {
    const { ctx, biz } = await setup();
    const id = await upsertPriceForBusiness(ctx as any, OWNER, { chemical_type: " Liquid Chlorine ", unit: "gal", unit_price: 4.499 });
    const again = await upsertPriceForBusiness(ctx as any, ADMIN, { chemical_type: "liquid chlorine", unit: "gal", unit_price: 5, package_size: 2.5, package_price: 12 });
    expect(again).toBe(id);
    const prices = await listPricesForBusiness(ctx, biz as any);
    expect(prices).toHaveLength(1);
    expect(prices[0]).toMatchObject({ chemical_type: "liquid_chlorine", label: "liquid chlorine", unit: "gal", unit_price: 5, package_size: 2.5, package_price: 12 });
  });

  it("validates input", async () => {
    const { ctx } = await setup();
    await expect(upsertPriceForBusiness(ctx as any, OWNER, { chemical_type: "", unit: "gal", unit_price: 1 })).rejects.toThrow(/name is required/);
    await expect(upsertPriceForBusiness(ctx as any, OWNER, { chemical_type: "x", unit: "fl_oz", unit_price: 1 })).rejects.toThrow(/Unit must be/);
    await expect(upsertPriceForBusiness(ctx as any, OWNER, { chemical_type: "x", unit: "gal", unit_price: -1 })).rejects.toThrow(/Unit price/);
    await expect(upsertPriceForBusiness(ctx as any, OWNER, { chemical_type: "x", unit: "gal", unit_price: 1, package_size: 0 })).rejects.toThrow(/Package size/);
    await expect(upsertPriceForBusiness(ctx as any, TECH, { chemical_type: "x", unit: "gal", unit_price: 1 })).rejects.toThrow(/owners and admins/);
  });

  it("removes only prices that belong to the caller's business", async () => {
    const { db, ctx, biz } = await setup();
    const id = await upsertPriceForBusiness(ctx as any, OWNER, { chemical_type: "Salt", unit: "bags", unit_price: 12 });
    const otherBiz = await seedBusiness(db, "other@example.com", "Other");
    const foreign = await db.insert("chemicalPrices", { business_id: otherBiz, chemical_type: "salt", unit: "bags", unit_price: 1, created_at: 1, updated_at: 1 });
    await expect(removePriceForBusiness(ctx as any, OWNER, foreign as any)).rejects.toThrow(/not found/);
    await removePriceForBusiness(ctx as any, OWNER, id);
    expect(await listPricesForBusiness(ctx, biz as any)).toHaveLength(0);
    expect(db.all("chemicalPrices")).toHaveLength(1);
  });

  it("seeds the catalog once and skips products the owner already priced", async () => {
    const { ctx, biz } = await setup();
    await upsertPriceForBusiness(ctx as any, OWNER, { chemical_type: "Chlorine Tablets", unit: "tabs", unit_price: 2 });
    const first = await seedDefaultPricesForBusiness(ctx as any, OWNER);
    expect(first).toEqual({ inserted: CHEMICAL_CATALOG.length - 1, skipped: 1 });
    const second = await seedDefaultPricesForBusiness(ctx as any, OWNER);
    expect(second).toEqual({ inserted: 0, skipped: CHEMICAL_CATALOG.length });
    const prices = await listPricesForBusiness(ctx, biz as any);
    expect(prices).toHaveLength(CHEMICAL_CATALOG.length);
    expect(prices.find((p) => p.chemical_type === "salt")).toMatchObject({ unit: "bags", package_size: 40 });
    expect(prices.find((p) => p.chemical_type === "chlorine_tablets")).toMatchObject({ unit_price: 2 });
  });

  it("costs usage rows at write time and clears costs when no price exists", async () => {
    const { ctx } = await setup();
    expect(await computeUsageCostFields(ctx, OWNER, "Liquid Chlorine", "1/2 gal")).toEqual({
      unit_cost: undefined, total_cost: undefined, normalized_amount: 0.5, normalized_unit: "gal",
    });
    await upsertPriceForBusiness(ctx as any, OWNER, { chemical_type: "Liquid Chlorine", unit: "gal", unit_price: 4 });
    expect(await computeUsageCostFields(ctx, TECH, "Liquid Chlorine", "1/2 gal")).toEqual({
      unit_cost: 4, total_cost: 2, normalized_amount: 0.5, normalized_unit: "gal",
    });
    expect(await computeUsageCostFields(ctx, "nobody@example.com", "Liquid Chlorine", "1 gal")).toMatchObject({ total_cost: undefined, normalized_amount: 1 });
    expect(usageCostFieldsFromPrices([], "Mystery", "a splash")).toEqual({ unit_cost: undefined, total_cost: undefined, normalized_amount: undefined, normalized_unit: undefined });
  });
});
