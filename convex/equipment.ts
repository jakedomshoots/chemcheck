import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { enforceRateLimit } from "./rateLimit";
import {
  FIELD_WRITE_ROLES,
  assertCustomerAccess,
  canAccessCustomer,
  resolveBusinessForUser,
} from "./access";

async function resolveBusiness(ctx: any, email: string) {
  // Only accepted (active) memberships count; pending invites never grant access.
  return await resolveBusinessForUser(ctx, email);
}

async function getOwnedPool(ctx: any, poolId: any, email: string, write = false) {
  const pool = await ctx.db.get(poolId);
  if (!pool) throw new Error("Pool not found");
  const customer = await ctx.db.get(pool.customer_id);
  if (!customer) throw new Error("Customer not found");
  try {
    await assertCustomerAccess(ctx, customer, email, write ? { roles: FIELD_WRITE_ROLES } : {});
  } catch (error) {
    if (error instanceof Error && error.message === "Insufficient role permissions") throw error;
    throw new Error("Access denied");
  }
  return { pool, customer };
}

export const listByPool = query({
  args: { pool_id: v.id("pools"), status: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) throw new Error("Not authenticated");
    await getOwnedPool(ctx, args.pool_id, identity.email);
    const equipment = await ctx.db.query("equipment")
      .withIndex("by_pool", (q: any) => q.eq("pool_id", args.pool_id)).collect();
    return args.status ? equipment.filter((item: any) => item.status === args.status) : equipment;
  },
});

export const listByCustomer = query({
  args: { customer_id: v.id("customers") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) throw new Error("Not authenticated");
    const customer = await ctx.db.get(args.customer_id);
    if (!customer) throw new Error("Customer not found");
    if (!(await canAccessCustomer(ctx, customer, identity.email))) throw new Error("Access denied");
    return await ctx.db.query("equipment")
      .withIndex("by_customer", (q: any) => q.eq("customer_id", args.customer_id)).collect();
  },
});

export const create = mutation({
  args: {
    pool_id: v.id("pools"),
    equipment_type: v.string(),
    name: v.string(),
    brand: v.optional(v.string()),
    model: v.optional(v.string()),
    serial_number: v.optional(v.string()),
    install_date: v.optional(v.string()),
    status: v.optional(v.string()),
    last_service_date: v.optional(v.string()),
    next_service_due: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) throw new Error("Not authenticated");
    await enforceRateLimit(ctx, identity.email, "equipment.write");
    const { pool, customer } = await getOwnedPool(ctx, args.pool_id, identity.email, true);
    if (!args.equipment_type.trim() || !args.name.trim()) throw new Error("Equipment type and name are required");
    const business = await resolveBusiness(ctx, identity.email);
    const now = Date.now();
    return await ctx.db.insert("equipment", {
      ...args,
      equipment_type: args.equipment_type.trim(),
      name: args.name.trim(),
      status: args.status || "active",
      customer_id: customer._id,
      business_id: customer.business_id ?? (business ? String(business._id) : undefined),
      created_at: now,
      updated_at: now,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("equipment"),
    equipment_type: v.optional(v.string()),
    name: v.optional(v.string()),
    brand: v.optional(v.string()),
    model: v.optional(v.string()),
    serial_number: v.optional(v.string()),
    install_date: v.optional(v.string()),
    status: v.optional(v.string()),
    last_service_date: v.optional(v.string()),
    next_service_due: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) throw new Error("Not authenticated");
    const equipment = await ctx.db.get(args.id);
    if (!equipment) throw new Error("Equipment not found");
    await enforceRateLimit(ctx, identity.email, "equipment.write");
    await getOwnedPool(ctx, equipment.pool_id, identity.email, true);
    const { id, ...updates } = args;
    if (updates.name !== undefined && !updates.name.trim()) throw new Error("Equipment name is required");
    await ctx.db.patch(id, { ...updates, updated_at: Date.now() });
    return id;
  },
});

export const remove = mutation({
  args: { id: v.id("equipment") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) throw new Error("Not authenticated");
    const equipment = await ctx.db.get(args.id);
    if (!equipment) throw new Error("Equipment not found");
    await enforceRateLimit(ctx, identity.email, "equipment.write");
    await getOwnedPool(ctx, equipment.pool_id, identity.email, true);
    await ctx.db.patch(args.id, { status: "retired", updated_at: Date.now() });
    return args.id;
  },
});
