/**
 * Per-business chemical prices.
 *
 * Owners and admins maintain a small price table (USD per canonical unit).
 * chemicalUsage rows are costed at write time from this table, and the
 * cost dashboard falls back to computing on the fly for rows written before
 * a price existed.
 */
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { findActiveMembership, normalizeEmail, resolveBusinessForEmail } from "./entitlements";
import {
  CHEMICAL_CATALOG,
  computeUsageCost,
  findPriceForChemical,
  normalizeChemicalKey,
  normalizeUsageQuantity,
  resolveCatalogEntry,
} from "../src/lib/chemicalCosts";
import { CANONICAL_UNITS, isCanonicalUnit } from "../src/lib/quantityParser";

type DbCtx = Pick<MutationCtx | QueryCtx, "db">;
type WriteCtx = Pick<MutationCtx, "db">;

export const PRICE_UNITS = CANONICAL_UNITS;
const MAX_PRICES_PER_BUSINESS = 200;
const MANAGER_ROLES = new Set(["owner", "admin"]);

/** Business the caller may manage prices for (owner or admin), or throws. */
export async function requireBusinessManager(ctx: DbCtx, email: string): Promise<Doc<"businesses">> {
  const business = await resolveBusinessForEmail(ctx, email);
  if (!business) throw new Error("No business found for this account. Create a business in Settings first.");
  if (normalizeEmail(business.owner_email) === normalizeEmail(email)) return business;
  const membership = await findActiveMembership(ctx, email, business._id);
  if (membership && MANAGER_ROLES.has(String(membership.role))) return business;
  throw new Error("Only business owners and admins can manage chemical prices.");
}

export async function listPricesForBusiness(ctx: DbCtx, businessId: Id<"businesses">): Promise<Doc<"chemicalPrices">[]> {
  const rows = await ctx.db
    .query("chemicalPrices")
    .withIndex("by_business", (q) => q.eq("business_id", businessId))
    .take(MAX_PRICES_PER_BUSINESS);
  return rows.sort((a, b) => (a.label ?? a.chemical_type).localeCompare(b.label ?? b.chemical_type));
}

export interface PriceInput {
  chemical_type: string;
  unit: string;
  unit_price: number;
  package_size?: number;
  package_price?: number;
}

function validatePriceInput(input: PriceInput): { key: string; label: string } {
  const label = String(input.chemical_type ?? "").trim();
  const key = normalizeChemicalKey(label);
  if (!key) throw new Error("Chemical name is required.");
  if (label.length > 80) throw new Error("Chemical name must be 80 characters or fewer.");
  if (!isCanonicalUnit(input.unit)) throw new Error(`Unit must be one of: ${PRICE_UNITS.join(", ")}.`);
  if (!Number.isFinite(input.unit_price) || input.unit_price < 0 || input.unit_price > 100000) {
    throw new Error("Unit price must be a number between 0 and 100,000.");
  }
  if (input.package_size !== undefined && (!Number.isFinite(input.package_size) || input.package_size <= 0)) {
    throw new Error("Package size must be a positive number.");
  }
  if (input.package_price !== undefined && (!Number.isFinite(input.package_price) || input.package_price < 0)) {
    throw new Error("Package price must be zero or more.");
  }
  return { key, label };
}

export async function upsertPriceForBusiness(ctx: WriteCtx, email: string, input: PriceInput): Promise<Id<"chemicalPrices">> {
  const business = await requireBusinessManager(ctx, email);
  const { key, label } = validatePriceInput(input);
  const now = Date.now();
  const existing = await ctx.db
    .query("chemicalPrices")
    .withIndex("by_business_and_type", (q) => q.eq("business_id", business._id).eq("chemical_type", key))
    .first();
  const fields = {
    label,
    unit: input.unit,
    unit_price: Math.round(input.unit_price * 100) / 100,
    package_size: input.package_size,
    package_price: input.package_price === undefined ? undefined : Math.round(input.package_price * 100) / 100,
    updated_at: now,
  };
  if (existing) {
    await ctx.db.patch(existing._id, fields);
    return existing._id;
  }
  const count = (await ctx.db
    .query("chemicalPrices")
    .withIndex("by_business", (q) => q.eq("business_id", business._id))
    .take(MAX_PRICES_PER_BUSINESS)).length;
  if (count >= MAX_PRICES_PER_BUSINESS) throw new Error("Price table is full. Remove unused chemicals first.");
  return await ctx.db.insert("chemicalPrices", {
    business_id: business._id,
    chemical_type: key,
    ...fields,
    created_at: now,
  });
}

export async function removePriceForBusiness(ctx: WriteCtx, email: string, id: Id<"chemicalPrices">): Promise<void> {
  const business = await requireBusinessManager(ctx, email);
  const row = await ctx.db.get(id);
  if (!row || String(row.business_id) !== String(business._id)) throw new Error("Price not found.");
  await ctx.db.delete(id);
}

/**
 * Seed the catalog of common products with placeholder prices. Existing
 * rows (matched by catalog product) are left alone so re-seeding is safe.
 */
export async function seedDefaultPricesForBusiness(ctx: WriteCtx, email: string): Promise<{ inserted: number; skipped: number }> {
  const business = await requireBusinessManager(ctx, email);
  const existing = await listPricesForBusiness(ctx, business._id);
  const covered = new Set(existing.map((p) => resolveCatalogEntry(p.chemical_type)?.key ?? normalizeChemicalKey(p.chemical_type)));
  const now = Date.now();
  let inserted = 0;
  let skipped = 0;
  for (const entry of CHEMICAL_CATALOG) {
    if (covered.has(entry.key)) {
      skipped += 1;
      continue;
    }
    await ctx.db.insert("chemicalPrices", {
      business_id: business._id,
      chemical_type: entry.key,
      label: entry.label,
      unit: entry.unit,
      unit_price: entry.default_price,
      package_size: entry.package_size,
      package_price: entry.package_price,
      created_at: now,
      updated_at: now,
    });
    inserted += 1;
  }
  return { inserted, skipped };
}

export type UsageCostFields = {
  unit_cost?: number;
  total_cost?: number;
  normalized_amount?: number;
  normalized_unit?: string;
};

/**
 * Cost fields for a chemicalUsage row. Normalized amount/unit are set
 * whenever the quantity parses; unit/total cost only when a price exists.
 * Undefined fields clear stale values on update.
 */
export function usageCostFieldsFromPrices(
  prices: Doc<"chemicalPrices">[],
  chemicalType: string,
  quantity: string,
): UsageCostFields {
  const price = findPriceForChemical(prices, chemicalType);
  const cost = computeUsageCost(price, chemicalType, quantity);
  if (cost) {
    return {
      unit_cost: cost.unit_cost,
      total_cost: cost.total_cost,
      normalized_amount: cost.normalized_amount,
      normalized_unit: cost.normalized_unit,
    };
  }
  const parsed = normalizeUsageQuantity(chemicalType, quantity);
  return {
    unit_cost: undefined,
    total_cost: undefined,
    normalized_amount: parsed?.amount,
    normalized_unit: parsed?.unit,
  };
}

/** Resolve the caller's business prices and cost a usage row (write-time hook for chemicalUsage). */
export async function computeUsageCostFields(
  ctx: DbCtx,
  email: string,
  chemicalType: string,
  quantity: string,
): Promise<UsageCostFields> {
  const business = await resolveBusinessForEmail(ctx, email);
  const prices = business ? await listPricesForBusiness(ctx, business._id) : [];
  return usageCostFieldsFromPrices(prices, chemicalType, quantity);
}

// ============================================
// Convex API
// ============================================

export const list = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) throw new Error("Not authenticated");
    const business = await resolveBusinessForEmail(ctx, identity.email);
    if (!business) return { prices: [], can_manage: false, catalog: CHEMICAL_CATALOG.map(({ aliases: _a, ...rest }) => rest) };
    let canManage = normalizeEmail(business.owner_email) === normalizeEmail(identity.email);
    if (!canManage) {
      const membership = await findActiveMembership(ctx, identity.email, business._id);
      canManage = Boolean(membership && MANAGER_ROLES.has(String(membership.role)));
    }
    return {
      prices: await listPricesForBusiness(ctx, business._id),
      can_manage: canManage,
      catalog: CHEMICAL_CATALOG.map(({ aliases: _a, ...rest }) => rest),
    };
  },
});

export const upsert = mutation({
  args: {
    chemical_type: v.string(),
    unit: v.string(),
    unit_price: v.number(),
    package_size: v.optional(v.number()),
    package_price: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) throw new Error("Not authenticated");
    return await upsertPriceForBusiness(ctx, identity.email, args);
  },
});

export const remove = mutation({
  args: { id: v.id("chemicalPrices") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) throw new Error("Not authenticated");
    await removePriceForBusiness(ctx, identity.email, args.id);
  },
});

export const seedDefaults = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) throw new Error("Not authenticated");
    return await seedDefaultPricesForBusiness(ctx, identity.email);
  },
});
