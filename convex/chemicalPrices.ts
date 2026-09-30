/**
 * Per-business prices for extra chemicals billed by "visits" billing
 * schedules (docs/WORK_TICKETS_API.md). Prices are cents in the db and
 * dollars at the API boundary.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { CUSTOMER_WRITE_ROLES, getAccessContext } from "./access";
import { enforceRateLimit } from "./rateLimit";
import { requireBusinessRole } from "./tickets";
import { MAX_ITEM_AMOUNT_CENTS, centsToDollars, dollarsToCents, normalizeChemicalType } from "./ticketLogic";

export const MAX_CHEMICAL_PRICES = 100;

export type ChemicalPriceInput = { chemical_type: string; unit: string; price: number };

/** Whether the current user may manage billing-related chemical prices. */
export const canManage = query({
  args: {},
  returns: v.boolean(),
  handler: async (ctx): Promise<boolean> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) return false;
    const access = await getAccessContext(ctx, identity.email);
    return Boolean(access.business && access.role && CUSTOMER_WRITE_ROLES.includes(access.role));
  },
});

/** Validate a full price list; later duplicates (case-insensitive type) replace earlier ones. */
export function normalizeChemicalPrices(prices: ChemicalPriceInput[]): { chemical_type: string; unit: string; price_cents: number }[] {
  if (!Array.isArray(prices)) throw new Error("Prices are missing.");
  if (prices.length > MAX_CHEMICAL_PRICES) throw new Error(`At most ${MAX_CHEMICAL_PRICES} chemical prices are allowed.`);
  const byType = new Map<string, { chemical_type: string; unit: string; price_cents: number }>();
  prices.forEach((row, index) => {
    const type = String(row?.chemical_type ?? "").trim().replace(/\s+/g, " ");
    const unit = String(row?.unit ?? "").trim();
    const label = `Price ${index + 1}`;
    if (!type) throw new Error(`${label}: chemical is required.`);
    if (type.length > 80) throw new Error(`${label}: chemical name is too long.`);
    if (unit.length > 20) throw new Error(`${label}: unit is too long.`);
    if (typeof row.price !== "number" || !Number.isFinite(row.price) || row.price < 0) {
      throw new Error(`${label}: price must be a positive amount.`);
    }
    const cents = dollarsToCents(row.price);
    if (cents > MAX_ITEM_AMOUNT_CENTS) throw new Error(`${label}: price is too high.`);
    byType.set(normalizeChemicalType(type), { chemical_type: type, unit, price_cents: cents });
  });
  return Array.from(byType.values());
}

export const list = query({
  args: {},
  handler: async (ctx): Promise<{ chemical_type: string; unit: string; price: number }[]> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) return [];
    const access = await getAccessContext(ctx, identity.email);
    if (!access.business || !access.role) return [];
    const rows = await ctx.db
      .query("chemicalPrices")
      .withIndex("by_business", (q) => q.eq("business_id", access.business._id))
      .take(MAX_CHEMICAL_PRICES * 2);
    return rows
      .map((row) => ({ chemical_type: row.chemical_type, unit: row.unit, price: centsToDollars(row.price_cents) }))
      .sort((a, b) => a.chemical_type.localeCompare(b.chemical_type));
  },
});

/** Replace the business's price list (owner/admin). */
export const set = mutation({
  args: { prices: v.array(v.object({ chemical_type: v.string(), unit: v.string(), price: v.number() })) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) throw new Error("Not authenticated");
    await enforceRateLimit(ctx, identity.email, "schedule.write");
    const access = await requireBusinessRole(ctx, identity.email, CUSTOMER_WRITE_ROLES);
    const prices = normalizeChemicalPrices(args.prices);
    const existing = await ctx.db
      .query("chemicalPrices")
      .withIndex("by_business", (q) => q.eq("business_id", access.businessId))
      .take(MAX_CHEMICAL_PRICES * 2);
    for (const row of existing) await ctx.db.delete(row._id);
    const now = Date.now();
    for (const price of prices) {
      await ctx.db.insert("chemicalPrices", { business_id: access.businessId, ...price, updated_at: now });
    }
    return null;
  },
});
