import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

const WRITE_ROLES = new Set(["owner", "admin", "technician"]);

async function resolveBusiness(ctx: any, email: string) {
  const member = await ctx.db.query("team_members")
    .withIndex("by_user_email", (q: any) => q.eq("user_email", email))
    .filter((q: any) => q.eq(q.field("is_active"), true))
    .first();
  if (member) return await ctx.db.get(member.business_id);
  return await ctx.db.query("businesses")
    .withIndex("by_owner_email", (q: any) => q.eq("owner_email", email))
    .first();
}

async function canAccessCustomer(ctx: any, customer: any, email: string) {
  if (!customer) return false;
  const business = await resolveBusiness(ctx, email);
  if (business) {
    if (String(customer.business_id || "") === String(business._id)) return true;
    // Legacy customers may not have business_id until the existing backfill
    // runs; allow the owner/member email path during that migration window.
    return String(customer.created_by || "").toLowerCase() === String(business.owner_email || "").toLowerCase();
  }
  return String(customer.created_by || "").toLowerCase() === String(email).toLowerCase();
}

async function assertWriteAccess(ctx: any, email: string) {
  const business = await resolveBusiness(ctx, email);
  if (!business) return;
  const isOwner = String(business.owner_email).toLowerCase() === String(email).toLowerCase();
  if (isOwner) return;
  const member = await ctx.db.query("team_members")
    .withIndex("by_user_email", (q: any) => q.eq("user_email", email))
    .filter((q: any) => q.and(
      q.eq(q.field("business_id"), business._id),
      q.eq(q.field("is_active"), true),
    ))
    .first();
  if (!member || !WRITE_ROLES.has(member.role)) throw new Error("Insufficient role permissions");
}

async function getOwnedPool(ctx: any, poolId: any, email: string) {
  const pool = await ctx.db.get(poolId);
  if (!pool) throw new Error("Pool not found");
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
      .collect();
    if (equipment.length > 0) throw new Error("Retire the pool after moving or retiring its equipment");
    await ctx.db.patch(pool._id, { active: false, updated_at: Date.now() });
    return pool._id;
  },
});
