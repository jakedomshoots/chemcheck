import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  getBusinessContext,
  requireCustomerAccess,
  requireCustomerRole,
  requireUserEmail,
} from "./authorization";

const PROFILE_WRITE_ROLES = ["owner", "admin"] as const;

function requiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function optionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

async function getCustomerForAccess(ctx: any, customerId: any, email: string, write = false) {
  const customer = await ctx.db.get(customerId);
  if (!customer) throw new Error("Customer not found or access denied");
  const business = write
    ? await requireCustomerRole(ctx, customer, email, PROFILE_WRITE_ROLES)
    : (await requireCustomerAccess(ctx, customer, email), undefined);
  return { customer, business };
}

async function getSiteForAccess(ctx: any, siteId: any, email: string, write = false) {
  const site = await ctx.db.get(siteId);
  if (!site) throw new Error("Site not found or access denied");
  const access = await getCustomerForAccess(ctx, site.customer_id, email, write);
  return { site, ...access };
}

async function getPoolForAccess(ctx: any, poolId: any, email: string, write = false) {
  const pool = await ctx.db.get(poolId);
  if (!pool) throw new Error("Pool not found or access denied");
  const access = await getCustomerForAccess(ctx, pool.customer_id, email, write);
  return { pool, ...access };
}

async function assertSiteMatchesCustomer(ctx: any, siteId: any, customerId: any) {
  const site = await ctx.db.get(siteId);
  if (!site || String(site.customer_id) !== String(customerId)) {
    throw new Error("Site does not belong to this customer");
  }
  return site;
}

async function assertPoolMatchesSite(ctx: any, poolId: any, siteId: any, customerId: any) {
  const pool = await ctx.db.get(poolId);
  if (
    !pool ||
    String(pool.site_id) !== String(siteId) ||
    String(pool.customer_id) !== String(customerId)
  ) {
    throw new Error("Pool does not belong to this site");
  }
  return pool;
}

export const getCustomerProfile = query({
  args: { customer_id: v.id("customers") },
  handler: async (ctx, args) => {
    const email = await requireUserEmail(ctx);
    await getCustomerForAccess(ctx, args.customer_id, email);

    const sites = await ctx.db
      .query("sites")
      .withIndex("by_customer", (q) => q.eq("customer_id", args.customer_id))
      .collect();
    const pools = await ctx.db
      .query("pools")
      .withIndex("by_customer", (q) => q.eq("customer_id", args.customer_id))
      .collect();
    const equipment = await ctx.db
      .query("equipment")
      .withIndex("by_customer", (q) => q.eq("customer_id", args.customer_id))
      .collect();

    return {
      sites: sites.filter((site) => site.active).sort((a, b) => a.name.localeCompare(b.name)),
      pools: pools.filter((pool) => pool.active).sort((a, b) => a.name.localeCompare(b.name)),
      equipment: equipment
        .filter((item) => item.active)
        .sort((a, b) => (a.next_service_due || "9999-12-31").localeCompare(b.next_service_due || "9999-12-31")),
    };
  },
});

export const createSite = mutation({
  args: {
    customer_id: v.id("customers"),
    name: v.string(),
    street_address: v.string(),
    access_notes: v.optional(v.string()),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    geocode_provider: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const email = await requireUserEmail(ctx);
    const { customer, business } = await getCustomerForAccess(ctx, args.customer_id, email, true);
    const now = Date.now();
    return await ctx.db.insert("sites", {
      customer_id: customer._id,
      business_id: business?.businessId ?? customer.business_id,
      created_by: customer.created_by,
      name: requiredText(args.name, "Site name"),
      street_address: requiredText(args.street_address, "Site address"),
      access_notes: optionalText(args.access_notes),
      latitude: args.latitude,
      longitude: args.longitude,
      geocode_provider: optionalText(args.geocode_provider),
      geocoded_at: Number.isFinite(args.latitude) && Number.isFinite(args.longitude) ? now : undefined,
      active: true,
      created_at: now,
      updated_at: now,
    });
  },
});

export const updateSite = mutation({
  args: {
    id: v.id("sites"),
    name: v.optional(v.string()),
    street_address: v.optional(v.string()),
    access_notes: v.optional(v.string()),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    geocode_provider: v.optional(v.string()),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const email = await requireUserEmail(ctx);
    const { site } = await getSiteForAccess(ctx, args.id, email, true);
    const now = Date.now();
    await ctx.db.patch(site._id, {
      ...(args.name !== undefined ? { name: requiredText(args.name, "Site name") } : {}),
      ...(args.street_address !== undefined ? { street_address: requiredText(args.street_address, "Site address") } : {}),
      ...(args.access_notes !== undefined ? { access_notes: optionalText(args.access_notes) } : {}),
      ...(args.latitude !== undefined ? { latitude: args.latitude } : {}),
      ...(args.longitude !== undefined ? { longitude: args.longitude } : {}),
      ...(args.geocode_provider !== undefined ? { geocode_provider: optionalText(args.geocode_provider) } : {}),
      ...(args.active !== undefined ? { active: args.active } : {}),
      geocoded_at: args.latitude !== undefined && args.longitude !== undefined ? now : site.geocoded_at,
      updated_at: now,
    });
    return site._id;
  },
});

export const createPool = mutation({
  args: {
    customer_id: v.id("customers"),
    site_id: v.id("sites"),
    name: v.string(),
    volume_gallons: v.optional(v.number()),
    sanitizer_type: v.string(),
    surface_type: v.string(),
    shape: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const email = await requireUserEmail(ctx);
    const { customer, business } = await getCustomerForAccess(ctx, args.customer_id, email, true);
    await assertSiteMatchesCustomer(ctx, args.site_id, customer._id);
    if (args.volume_gallons !== undefined && (!Number.isFinite(args.volume_gallons) || args.volume_gallons <= 0)) {
      throw new Error("Pool volume must be greater than zero");
    }
    const now = Date.now();
    return await ctx.db.insert("pools", {
      customer_id: customer._id,
      site_id: args.site_id,
      business_id: business?.businessId ?? customer.business_id,
      created_by: customer.created_by,
      name: requiredText(args.name, "Pool name"),
      volume_gallons: args.volume_gallons,
      sanitizer_type: requiredText(args.sanitizer_type, "Sanitizer type"),
      surface_type: requiredText(args.surface_type, "Surface type"),
      shape: optionalText(args.shape),
      active: true,
      created_at: now,
      updated_at: now,
    });
  },
});

export const updatePool = mutation({
  args: {
    id: v.id("pools"),
    name: v.optional(v.string()),
    volume_gallons: v.optional(v.number()),
    sanitizer_type: v.optional(v.string()),
    surface_type: v.optional(v.string()),
    shape: v.optional(v.string()),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const email = await requireUserEmail(ctx);
    const { pool } = await getPoolForAccess(ctx, args.id, email, true);
    if (args.volume_gallons !== undefined && (!Number.isFinite(args.volume_gallons) || args.volume_gallons <= 0)) {
      throw new Error("Pool volume must be greater than zero");
    }
    await ctx.db.patch(pool._id, {
      ...(args.name !== undefined ? { name: requiredText(args.name, "Pool name") } : {}),
      ...(args.volume_gallons !== undefined ? { volume_gallons: args.volume_gallons } : {}),
      ...(args.sanitizer_type !== undefined ? { sanitizer_type: requiredText(args.sanitizer_type, "Sanitizer type") } : {}),
      ...(args.surface_type !== undefined ? { surface_type: requiredText(args.surface_type, "Surface type") } : {}),
      ...(args.shape !== undefined ? { shape: optionalText(args.shape) } : {}),
      ...(args.active !== undefined ? { active: args.active } : {}),
      updated_at: Date.now(),
    });
    return pool._id;
  },
});

export const createEquipment = mutation({
  args: {
    customer_id: v.id("customers"),
    site_id: v.id("sites"),
    pool_id: v.optional(v.id("pools")),
    kind: v.string(),
    manufacturer: v.optional(v.string()),
    model: v.optional(v.string()),
    serial_number: v.optional(v.string()),
    status: v.string(),
    installed_date: v.optional(v.string()),
    last_serviced_date: v.optional(v.string()),
    next_service_due: v.optional(v.string()),
    service_interval_days: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const email = await requireUserEmail(ctx);
    const { customer, business } = await getCustomerForAccess(ctx, args.customer_id, email, true);
    await assertSiteMatchesCustomer(ctx, args.site_id, customer._id);
    if (args.pool_id) await assertPoolMatchesSite(ctx, args.pool_id, args.site_id, customer._id);
    if (args.service_interval_days !== undefined && (!Number.isFinite(args.service_interval_days) || args.service_interval_days <= 0)) {
      throw new Error("Service interval must be greater than zero");
    }
    const now = Date.now();
    return await ctx.db.insert("equipment", {
      customer_id: customer._id,
      site_id: args.site_id,
      pool_id: args.pool_id,
      business_id: business?.businessId ?? customer.business_id,
      created_by: customer.created_by,
      kind: requiredText(args.kind, "Equipment type"),
      manufacturer: optionalText(args.manufacturer),
      model: optionalText(args.model),
      serial_number: optionalText(args.serial_number),
      status: requiredText(args.status, "Equipment status"),
      installed_date: optionalText(args.installed_date),
      last_serviced_date: optionalText(args.last_serviced_date),
      next_service_due: optionalText(args.next_service_due),
      service_interval_days: args.service_interval_days,
      notes: optionalText(args.notes),
      active: true,
      created_at: now,
      updated_at: now,
    });
  },
});

export const updateEquipment = mutation({
  args: {
    id: v.id("equipment"),
    kind: v.optional(v.string()),
    manufacturer: v.optional(v.string()),
    model: v.optional(v.string()),
    serial_number: v.optional(v.string()),
    status: v.optional(v.string()),
    installed_date: v.optional(v.string()),
    last_serviced_date: v.optional(v.string()),
    next_service_due: v.optional(v.string()),
    service_interval_days: v.optional(v.number()),
    notes: v.optional(v.string()),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const email = await requireUserEmail(ctx);
    const item = await ctx.db.get(args.id);
    if (!item) throw new Error("Equipment not found or access denied");
    await getCustomerForAccess(ctx, item.customer_id, email, true);
    if (args.service_interval_days !== undefined && (!Number.isFinite(args.service_interval_days) || args.service_interval_days <= 0)) {
      throw new Error("Service interval must be greater than zero");
    }
    await ctx.db.patch(item._id, {
      ...(args.kind !== undefined ? { kind: requiredText(args.kind, "Equipment type") } : {}),
      ...(args.manufacturer !== undefined ? { manufacturer: optionalText(args.manufacturer) } : {}),
      ...(args.model !== undefined ? { model: optionalText(args.model) } : {}),
      ...(args.serial_number !== undefined ? { serial_number: optionalText(args.serial_number) } : {}),
      ...(args.status !== undefined ? { status: requiredText(args.status, "Equipment status") } : {}),
      ...(args.installed_date !== undefined ? { installed_date: optionalText(args.installed_date) } : {}),
      ...(args.last_serviced_date !== undefined ? { last_serviced_date: optionalText(args.last_serviced_date) } : {}),
      ...(args.next_service_due !== undefined ? { next_service_due: optionalText(args.next_service_due) } : {}),
      ...(args.service_interval_days !== undefined ? { service_interval_days: args.service_interval_days } : {}),
      ...(args.notes !== undefined ? { notes: optionalText(args.notes) } : {}),
      ...(args.active !== undefined ? { active: args.active } : {}),
      updated_at: Date.now(),
    });
    return item._id;
  },
});

// Explicit, owner/admin-only migration for the legacy one-address/one-pool
// customer record. It never runs silently and never copies a gate code.
export const ensureLegacyProfile = mutation({
  args: { customer_id: v.id("customers") },
  handler: async (ctx, args) => {
    const email = await requireUserEmail(ctx);
    const { customer, business } = await getCustomerForAccess(ctx, args.customer_id, email, true);
    const existingSite = await ctx.db
      .query("sites")
      .withIndex("by_customer", (q) => q.eq("customer_id", customer._id))
      .filter((q) => q.eq(q.field("active"), true))
      .first();
    const now = Date.now();
    const siteId = existingSite?._id ?? await ctx.db.insert("sites", {
      customer_id: customer._id,
      business_id: business?.businessId ?? customer.business_id,
      created_by: customer.created_by,
      name: "Primary service address",
      street_address: customer.address,
      access_notes: undefined,
      latitude: undefined,
      longitude: undefined,
      geocode_provider: undefined,
      geocoded_at: undefined,
      active: true,
      created_at: now,
      updated_at: now,
    });
    const existingPool = await ctx.db
      .query("pools")
      .withIndex("by_site", (q) => q.eq("site_id", siteId))
      .filter((q) => q.eq(q.field("active"), true))
      .first();
    const poolId = existingPool?._id ?? await ctx.db.insert("pools", {
      customer_id: customer._id,
      site_id: siteId,
      business_id: business?.businessId ?? customer.business_id,
      created_by: customer.created_by,
      name: "Primary pool",
      volume_gallons: customer.pool_gallons,
      sanitizer_type: customer.pool_type || "chlorine",
      surface_type: customer.surface_type || "unknown",
      shape: undefined,
      active: true,
      created_at: now,
      updated_at: now,
    });
    return { site_id: siteId, pool_id: poolId, created: !existingSite || !existingPool };
  },
});

export const listEquipmentDue = query({
  args: { through_date: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const email = await requireUserEmail(ctx);
    const business = await getBusinessContext(ctx, email);
    const throughDate = args.through_date || new Date().toISOString().slice(0, 10);
    if (!business) return [];
    const items = await ctx.db
      .query("equipment")
      .withIndex("by_business", (q: any) => q.eq("business_id", business.businessId))
      .collect();
    return items
      .filter((item) => item.active && Boolean(item.next_service_due) && item.next_service_due! <= throughDate)
      .sort((a, b) => a.next_service_due!.localeCompare(b.next_service_due!));
  },
});
