import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { enforceRateLimit } from "./rateLimit";
import {
  FIELD_WRITE_ROLES,
  assertCustomerAccess,
  canAccessCustomer as canAccessCustomerShared,
  resolveBusinessForUser,
} from "./access";

async function resolveBusiness(ctx: any, email: string) {
  // Only accepted (active) memberships count; pending invites never grant access.
  return await resolveBusinessForUser(ctx, email);
}

async function canAccessCustomer(ctx: any, customer: any, email: string) {
  if (!customer) return false;
  return await canAccessCustomerShared(ctx, customer, email);
}

async function assertWriteAccess(ctx: any, customer: any, email: string) {
  await assertCustomerAccess(ctx, customer, email, { roles: FIELD_WRITE_ROLES });
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
    await enforceRateLimit(ctx, identity.email, "pool.write");
    const customer = await ctx.db.get(args.customer_id);
    if (!(await canAccessCustomer(ctx, customer, identity.email))) throw new Error("Access denied");
    await assertWriteAccess(ctx, customer, identity.email);
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
      business_id: customer!.business_id ?? (business ? String(business._id) : undefined),
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
    await enforceRateLimit(ctx, identity.email, "pool.write");
    const { customer } = await getOwnedPool(ctx, args.id, identity.email);
    await assertWriteAccess(ctx, customer, identity.email);
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
    await enforceRateLimit(ctx, identity.email, "pool.write");
    const { pool, customer } = await getOwnedPool(ctx, args.id, identity.email);
    await assertWriteAccess(ctx, customer, identity.email);
    const equipment = await ctx.db.query("equipment")
      .withIndex("by_pool", (q: any) => q.eq("pool_id", pool._id))
      .collect();
    if (equipment.length > 0) throw new Error("Retire the pool after moving or retiring its equipment");
    await ctx.db.patch(pool._id, { active: false, updated_at: Date.now() });
    return pool._id;
  },
});
