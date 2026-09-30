import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

const WRITE_ROLES = new Set(["owner", "admin", "technician"]);

function normalizeEmail(email: any): string {
  return String(email || "").trim().toLowerCase();
}

function emailCandidates(email: string): string[] {
  const raw = String(email || "");
  const normalized = normalizeEmail(raw);
  if (!normalized) return [];
  return raw === normalized ? [raw] : [raw, normalized];
}

// Ownership first, then active team membership; every lookup is indexed.
async function resolveBusiness(ctx: any, email: string) {
  const candidates = emailCandidates(email);
  for (const candidate of candidates) {
    const owned = await ctx.db.query("businesses")
      .withIndex("by_owner_email", (q: any) => q.eq("owner_email", candidate))
      .first();
    if (owned) return owned;
  }
  for (const candidate of candidates) {
    const members = await ctx.db.query("team_members")
      .withIndex("by_user_email", (q: any) => q.eq("user_email", candidate))
      .filter((q: any) => q.eq(q.field("is_active"), true))
      .collect();
    for (const member of members) {
      if (member.is_active !== true) continue;
      const business = await ctx.db.get(member.business_id);
      if (business) return business;
    }
  }
  return null;
}

async function canAccessCustomer(ctx: any, customer: any, email: string) {
  if (!customer) return false;
  const business = await resolveBusiness(ctx, email);
  if (customer.deleted_at !== undefined) return false;
  if (business) {
    if (String(customer.business_id || "") === String(business._id)) return true;
    // Legacy customers may not have business_id until the existing backfill
    // runs; allow the owner/member email path during that migration window.
    return normalizeEmail(customer.created_by) === normalizeEmail(business.owner_email);
  }
  return normalizeEmail(customer.created_by) === normalizeEmail(email);
}

async function assertWriteAccess(ctx: any, email: string) {
  const business = await resolveBusiness(ctx, email);
  if (!business) return;
  const isOwner = normalizeEmail(business.owner_email) === normalizeEmail(email);
  if (isOwner) return;
  let member: any = null;
  for (const candidate of emailCandidates(email)) {
    member = await ctx.db.query("team_members")
      .withIndex("by_user_email", (q: any) => q.eq("user_email", candidate))
      .filter((q: any) => q.and(
        q.eq(q.field("business_id"), business._id),
        q.eq(q.field("is_active"), true),
      ))
      .first();
    if (member) break;
  }
  if (!member || member.is_active !== true || !WRITE_ROLES.has(member.role)) throw new Error("Insufficient role permissions");
}

async function getOwnedPool(ctx: any, poolId: any, email: string) {
  const pool = await ctx.db.get(poolId);
  if (!pool || pool.deleted_at !== undefined) throw new Error("Pool not found");
  const customer = await ctx.db.get(pool.customer_id);
  if (!(await canAccessCustomer(ctx, customer, email))) throw new Error("Access denied");
  return { pool, customer };
}

export const listByCustomer = query({
  args: { customer_id: v.id("customers"), include_inactive: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) throw new Error("Not authenticated");
    const customer = await ctx.db.get(args.customer_id);
    if (!(await canAccessCustomer(ctx, customer, identity.email))) throw new Error("Access denied");
    const pools = await ctx.db.query("pools")
      .withIndex("by_customer", (q: any) => q.eq("customer_id", args.customer_id))
      .filter((q: any) => q.eq(q.field("deleted_at"), undefined))
      .collect();
    return args.include_inactive ? pools : pools.filter((pool: any) => pool.active);
  },
});

export const get = query({
  args: { id: v.id("pools") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) throw new Error("Not authenticated");
    return (await getOwnedPool(ctx, args.id, identity.email)).pool;
  },
});

export const create = mutation({
  args: {
    customer_id: v.id("customers"),
    name: v.string(),
    address: v.optional(v.string()),
    service_day: v.string(),
    pool_gallons: v.optional(v.number()),
    pool_type: v.string(),
    surface_type: v.string(),
    sort_order: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) throw new Error("Not authenticated");
    const customer = await ctx.db.get(args.customer_id);
    if (!(await canAccessCustomer(ctx, customer, identity.email))) throw new Error("Access denied");
    await assertWriteAccess(ctx, identity.email);
    if (!args.name.trim()) throw new Error("Pool name is required");
    if (!args.service_day.trim()) throw new Error("Service day is required");
    const business = await resolveBusiness(ctx, identity.email);
    const now = Date.now();
    return await ctx.db.insert("pools", {
      ...args,
      name: args.name.trim(),
      service_day: args.service_day.trim(),
      pool_type: args.pool_type.trim(),
      surface_type: args.surface_type.trim(),
      active: true,
      business_id: business ? String(business._id) : customer!.business_id,
      created_by: customer!.created_by || identity.email,
      created_at: now,
      updated_at: now,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("pools"),
    name: v.optional(v.string()),
    address: v.optional(v.string()),
    service_day: v.optional(v.string()),
    pool_gallons: v.optional(v.number()),
    pool_type: v.optional(v.string()),
    surface_type: v.optional(v.string()),
    sort_order: v.optional(v.number()),
    notes: v.optional(v.string()),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) throw new Error("Not authenticated");
    await getOwnedPool(ctx, args.id, identity.email);
    await assertWriteAccess(ctx, identity.email);
    const { id, ...updates } = args;
    if (updates.name !== undefined && !updates.name.trim()) throw new Error("Pool name is required");
    await ctx.db.patch(id, { ...updates, updated_at: Date.now() });
    return id;
  },
});

export const remove = mutation({
  args: { id: v.id("pools") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) throw new Error("Not authenticated");
    const { pool } = await getOwnedPool(ctx, args.id, identity.email);
    await assertWriteAccess(ctx, identity.email);
    const equipment = await ctx.db.query("equipment")
      .withIndex("by_pool", (q: any) => q.eq("pool_id", pool._id))
      .filter((q: any) => q.eq(q.field("deleted_at"), undefined))
      .collect();
    if (equipment.length > 0) throw new Error("Retire the pool after moving or retiring its equipment");
    await ctx.db.patch(pool._id, { active: false, updated_at: Date.now() });
    return pool._id;
  },
});
