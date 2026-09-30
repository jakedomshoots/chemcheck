import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

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

function ownsCustomer(customer: any, business: any, email: string): boolean {
  if (!customer || customer.deleted_at !== undefined) return false;
  if (business) {
    return String(customer.business_id || "") === String(business._id)
      || normalizeEmail(customer.created_by) === normalizeEmail(business.owner_email);
  }
  return normalizeEmail(customer.created_by) === normalizeEmail(email);
}

async function getOwnedPool(ctx: any, poolId: any, email: string) {
  const pool = await ctx.db.get(poolId);
  if (!pool || pool.deleted_at !== undefined) throw new Error("Pool not found");
  const customer = await ctx.db.get(pool.customer_id);
  if (!customer) throw new Error("Customer not found");
  const business = await resolveBusiness(ctx, email);
  if (!ownsCustomer(customer, business, email)) throw new Error("Access denied");
  return { pool, customer };
}

export const listByPool = query({
  args: { pool_id: v.id("pools"), status: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) throw new Error("Not authenticated");
    await getOwnedPool(ctx, args.pool_id, identity.email);
    const equipment = await ctx.db.query("equipment")
      .withIndex("by_pool", (q: any) => q.eq("pool_id", args.pool_id))
      .filter((q: any) => q.eq(q.field("deleted_at"), undefined))
      .collect();
    return args.status ? equipment.filter((item: any) => item.status === args.status) : equipment;
  },
});

export const listByCustomer = query({
  args: { customer_id: v.id("customers") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) throw new Error("Not authenticated");
    const business = await resolveBusiness(ctx, identity.email);
    const customer = await ctx.db.get(args.customer_id);
    if (!customer) throw new Error("Customer not found");
    if (!ownsCustomer(customer, business, identity.email)) throw new Error("Access denied");
    return await ctx.db.query("equipment")
      .withIndex("by_customer", (q: any) => q.eq("customer_id", args.customer_id))
      .filter((q: any) => q.eq(q.field("deleted_at"), undefined))
      .collect();
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
    const { pool, customer } = await getOwnedPool(ctx, args.pool_id, identity.email);
    if (!args.equipment_type.trim() || !args.name.trim()) throw new Error("Equipment type and name are required");
    const business = await resolveBusiness(ctx, identity.email);
    const now = Date.now();
    return await ctx.db.insert("equipment", {
      ...args,
      equipment_type: args.equipment_type.trim(),
      name: args.name.trim(),
      status: args.status || "active",
      customer_id: customer._id,
      business_id: business ? String(business._id) : customer.business_id,
      created_by: customer.created_by || identity.email,
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
    if (!equipment || equipment.deleted_at !== undefined) throw new Error("Equipment not found");
    await getOwnedPool(ctx, equipment.pool_id, identity.email);
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
    await getOwnedPool(ctx, equipment.pool_id, identity.email);
    await ctx.db.patch(args.id, { status: "retired", updated_at: Date.now() });
    return args.id;
  },
});
