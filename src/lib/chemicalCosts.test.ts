import { describe, expect, it } from "vitest";
import {
  amountInPriceUnit,
  chemicalFamilyFor,
  computeUsageCost,
  defaultUnitForChemical,
  effectiveUnitPrice,
  findPriceForChemical,
  formatCurrency,
  isIsoDate,
  normalizeChemicalKey,
  resolveCatalogEntry,
  resolveRange,
  rollupCosts,
  type CostRow,
} from "./chemicalCosts";
import { parseQuantity } from "./quantityParser";

describe("catalog resolution", () => {
  it("normalizes labels into stable keys", () => {
    expect(normalizeChemicalKey("  Liquid Chlorine ")).toBe("liquid_chlorine");
    expect(normalizeChemicalKey("pH Down (Muriatic)")).toBe("ph_down_muriatic");
    expect(normalizeChemicalKey("")).toBe("");
  });

  it("resolves the app's default chemical labels to catalog products", () => {
    expect(resolveCatalogEntry("Chlorine Tablets")?.key).toBe("trichlor_tabs");
    expect(resolveCatalogEntry("Liquid Chlorine")?.key).toBe("liquid_chlorine");
    expect(resolveCatalogEntry("pH Up")?.key).toBe("soda_ash");
    expect(resolveCatalogEntry("pH Down")?.key).toBe("muriatic_acid");
    expect(resolveCatalogEntry("Alkalinity Up")?.key).toBe("sodium_bicarb");
    expect(resolveCatalogEntry("Stabilizer")?.key).toBe("cyanuric_acid");
    expect(resolveCatalogEntry("chlorine_tabs")?.key).toBe("trichlor_tabs");
    expect(resolveCatalogEntry("Cal Hypo 73%")?.key).toBe("cal_hypo");
    expect(resolveCatalogEntry("Pool Salt 40lb")?.key).toBe("salt");
    expect(resolveCatalogEntry("Algaecide 60")).toBeNull();
  });

  it("infers families for unknown products", () => {
    expect(chemicalFamilyFor("Liquid Chlorine")).toBe("liquid");
    expect(chemicalFamilyFor("Algaecide")).toBe("liquid");
    expect(chemicalFamilyFor("Mystery Powder")).toBe("solid");
    expect(chemicalFamilyFor("Something")).toBe("unknown");
    expect(defaultUnitForChemical("Chlorine Tablets")).toBe("tabs");
    expect(defaultUnitForChemical("Something")).toBe("each");
  });
});

describe("cost computation", () => {
  const liquidChlorine = { chemical_type: "liquid_chlorine", unit: "gal", unit_price: 4 };
  const tabs = { chemical_type: "trichlor_tabs", unit: "tabs", unit_price: 3 };
  const salt = { chemical_type: "salt", unit: "bags", unit_price: 12, package_size: 40 };
  const bicarb = { chemical_type: "sodium_bicarb", unit: "lb", unit_price: 1.5 };

  it("prices quantities in the price's unit", () => {
    expect(computeUsageCost(liquidChlorine, "Liquid Chlorine", "1/2 gal")).toEqual({ normalized_amount: 0.5, normalized_unit: "gal", unit_cost: 4, total_cost: 2 });
    expect(computeUsageCost(liquidChlorine, "Liquid Chlorine", "32 oz")).toMatchObject({ normalized_amount: 0.25, total_cost: 1 });
    expect(computeUsageCost(tabs, "Chlorine Tablets", "3 tabs")).toMatchObject({ total_cost: 9, unit_cost: 3 });
    expect(computeUsageCost(tabs, "Chlorine Tablets", "2")).toMatchObject({ total_cost: 6 });
    expect(computeUsageCost(bicarb, "Alkalinity Up", "8 oz")).toMatchObject({ normalized_amount: 0.5, total_cost: 0.75 });
  });

  it("bridges bags and pounds through the package size", () => {
    expect(computeUsageCost(salt, "Salt", "2 bags")).toMatchObject({ total_cost: 24 });
    expect(computeUsageCost(salt, "Salt", "80 lb")).toMatchObject({ normalized_unit: "lb", total_cost: 24 });
    const perPound = { chemical_type: "salt", unit: "lb", unit_price: 0.3, package_size: 40 };
    expect(computeUsageCost(perPound, "Salt", "1 bag")).toMatchObject({ total_cost: 12 });
    expect(computeUsageCost(perPound, "Salt", "2 bags (40lb)")).toMatchObject({ total_cost: 24 });
  });

  it("returns null when there is no price, the quantity is unparseable, or units do not bridge", () => {
    expect(computeUsageCost(null, "Liquid Chlorine", "1 gal")).toBeNull();
    expect(computeUsageCost(liquidChlorine, "Liquid Chlorine", "some")).toBeNull();
    expect(computeUsageCost(liquidChlorine, "Liquid Chlorine", "3 tabs")).toBeNull();
    expect(amountInPriceUnit(parseQuantity("3 tabs")!, liquidChlorine)).toBeNull();
  });

  it("derives a unit price from the package when unit_price is zero", () => {
    expect(effectiveUnitPrice({ chemical_type: "x", unit: "lb", unit_price: 0, package_size: 40, package_price: 20 })).toBe(0.5);
    expect(effectiveUnitPrice({ chemical_type: "x", unit: "lb", unit_price: 0 })).toBe(0);
    expect(effectiveUnitPrice({ chemical_type: "x", unit: "lb", unit_price: 2, package_size: 40, package_price: 20 })).toBe(2);
  });

  it("finds prices by exact key or catalog alias", () => {
    const prices = [liquidChlorine, { chemical_type: "ph_down", unit: "gal", unit_price: 9 }];
    expect(findPriceForChemical(prices, "Liquid Chlorine")).toBe(liquidChlorine);
    expect(findPriceForChemical(prices, "Muriatic Acid")?.chemical_type).toBe("ph_down");
    expect(findPriceForChemical(prices, "Algaecide")).toBeNull();
    expect(findPriceForChemical(prices, "")).toBeNull();
  });
});

describe("rollupCosts", () => {
  const row = (overrides: Partial<CostRow>): CostRow => ({
    id: "r",
    customer_id: "c1",
    customer_name: "Alice",
    technician: "tech@example.com",
    date: "2026-03-02",
    chemical_type: "Liquid Chlorine",
    quantity: "1 gal",
    normalized_amount: 1,
    normalized_unit: "gal",
    cost: 4,
    service_day: "Monday",
    ...overrides,
  });

  it("aggregates totals, visits and per-visit cost", () => {
    const rows = [
      row({ id: "1" }),
      row({ id: "2", chemical_type: "Chlorine Tablets", quantity: "3 tabs", normalized_amount: 3, normalized_unit: "tabs", cost: 9 }),
      row({ id: "3", date: "2026-03-09", cost: 4 }),
      row({ id: "4", customer_id: "c2", customer_name: "Bob", technician: "owner@example.com", service_day: "Tuesday", date: "2026-04-01", cost: null, chemical_type: "Algaecide", normalized_amount: undefined, normalized_unit: undefined }),
    ];
    const result = rollupCosts(rows, { topN: 1 });
    expect(result.totals).toEqual({ total_cost: 17, rows: 4, priced_rows: 3, unpriced_rows: 1, visits: 3, cost_per_visit: 5.67 });
    expect(result.top_pools).toHaveLength(1);
    expect(result.top_pools[0]).toMatchObject({ customer_id: "c1", label: "Alice", total_cost: 17, visits: 2, cost_per_visit: 8.5, service_day: "Monday" });
    expect(result.by_customer).toHaveLength(2);
    expect(result.by_customer[1]).toMatchObject({ label: "Bob", total_cost: 0, visits: 1 });
    expect(result.by_customer[0].chemicals.map((c) => c.chemical_type)).toEqual(["Chlorine Tablets", "Liquid Chlorine"]);
    expect(result.by_customer[0].chemicals[1]).toMatchObject({ amount: 2, unit: "gal", total_cost: 8 });
    expect(result.by_technician.map((t) => [t.key, t.total_cost])).toEqual([["tech@example.com", 17], ["owner@example.com", 0]]);
    expect(result.by_route_day.map((d) => d.key)).toEqual(["Monday", "Tuesday"]);
    expect(result.by_month.map((m) => [m.key, m.total_cost, m.visits])).toEqual([["2026-03", 17, 2], ["2026-04", 0, 1]]);
    expect(result.unpriced_chemicals).toEqual(["Algaecide"]);
    expect(result.by_chemical[0]).toMatchObject({ chemical_type: "Chlorine Tablets", total_cost: 9 });
  });

  it("separates pools of the same customer and labels them", () => {
    const rows = [
      row({ id: "1", pool_id: "p1", pool_name: "Main" }),
      row({ id: "2", pool_id: "p2", pool_name: "Spa", cost: 1 }),
    ];
    const result = rollupCosts(rows);
    expect(result.top_pools.map((p) => p.label)).toEqual(["Alice · Main", "Alice · Spa"]);
    expect(result.totals.visits).toBe(2);
  });

  it("handles empty input", () => {
    const result = rollupCosts([]);
    expect(result.totals).toEqual({ total_cost: 0, rows: 0, priced_rows: 0, unpriced_rows: 0, visits: 0, cost_per_visit: 0 });
    expect(result.top_pools).toEqual([]);
  });
});

describe("UI helpers", () => {
  it("formats currency and validates dates", () => {
    expect(formatCurrency(12.5)).toBe("$12.50");
    expect(formatCurrency(null)).toBe("—");
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2026-03-01")).toBe(true);
    expect(isIsoDate("2026-3-1")).toBe(false);
  });

  it("resolves range presets relative to now", () => {
    const now = new Date(2026, 2, 15);
    expect(resolveRange("this_month", now)).toEqual({ start: "2026-03-01", end: "2026-03-15" });
    expect(resolveRange("last_30", now)).toEqual({ start: "2026-02-14", end: "2026-03-15" });
    expect(resolveRange("last_90", now)).toEqual({ start: "2025-12-16", end: "2026-03-15" });
    expect(resolveRange("ytd", now)).toEqual({ start: "2026-01-01", end: "2026-03-15" });
  });
});
