import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { enforceRateLimit } from "./rateLimit";

// Get all customers for the current user
export const list = query({
    args: {},
    handler: async (ctx) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        const customers = await ctx.db
            .query("customers")
            .withIndex("by_created_by", (q) => q.eq("created_by", identity.email!))
            .collect();

        return customers;
    },
});

// Filter customers by criteria
export const filter = query({
    args: {
        created_by: v.optional(v.string()),
        service_day: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        // Strictly enforce filtering by current user's email
        // We override any 'created_by' arg to ensure tenant isolation
        const customers = await ctx.db.query("customers")
            .withIndex("by_created_by", (q) => q.eq("created_by", identity.email!))
            .collect();

        if (args.service_day) {
            return customers.filter((c) => c.service_day === args.service_day);
        }

        return customers;
    },
});

// Get a single customer by ID (with ownership verification)
export const get = query({
    args: { id: v.id("customers") },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        const customer = await ctx.db.get(args.id);
        if (!customer) throw new Error("Customer not found");

        // Verify ownership (tenant isolation)
        if (customer.created_by !== identity.email) {
            throw new Error("Access denied");
        }

        return customer;
    },
});

// Create a new customer
export const create = mutation({
    args: {
        full_name: v.string(),
        address: v.string(),
        phone: v.optional(v.string()),
        email: v.optional(v.string()),
        gate_code: v.optional(v.string()),
        service_day: v.string(),
        pool_gallons: v.optional(v.number()),
        pool_type: v.string(),
        surface_type: v.string(),
        sort_order: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        // Enforce rate limiting
        enforceRateLimit(identity.email!, 'customer.create');

        const customerId = await ctx.db.insert("customers", {
            ...args,
            created_by: identity.email!,
        });

        return customerId;
    },
});

// Update a customer (with ownership verification)
export const update = mutation({
    args: {
        id: v.id("customers"),
        full_name: v.optional(v.string()),
        address: v.optional(v.string()),
        phone: v.optional(v.string()),
        email: v.optional(v.string()),
        gate_code: v.optional(v.string()),
        service_day: v.optional(v.string()),
        pool_gallons: v.optional(v.number()),
        pool_type: v.optional(v.string()),
        surface_type: v.optional(v.string()),
        sort_order: v.optional(v.number()),
        report_settings: v.optional(v.object({
            show_chemical_readings: v.optional(v.boolean()),
            show_photos: v.optional(v.boolean()),
            show_service_notes: v.optional(v.boolean()),
            show_technician_name: v.optional(v.boolean()),
            show_service_duration: v.optional(v.boolean()),
            show_overall_status: v.optional(v.boolean()),
        })),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        // Enforce rate limiting
        enforceRateLimit(identity.email!, 'customer.update');

        // Verify ownership (tenant isolation)
        const customer = await ctx.db.get(args.id);
        if (!customer) throw new Error("Customer not found");
        if (customer.created_by !== identity.email) {
            throw new Error("Access denied");
        }

        const { id, ...updates } = args;
        
        // Merge report_settings to avoid replacing the entire object
        if (updates.report_settings && customer.report_settings) {
            updates.report_settings = {
                ...customer.report_settings,
                ...updates.report_settings,
            };
        }
        
        await ctx.db.patch(id, updates);

        return id;
    },
});

// Delete a customer (with ownership verification)
export const remove = mutation({
    args: { id: v.id("customers") },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        // Enforce rate limiting
        enforceRateLimit(identity.email!, 'customer.delete');

        // Verify ownership (tenant isolation)
        const customer = await ctx.db.get(args.id);
        if (!customer) throw new Error("Customer not found");
        if (customer.created_by !== identity.email) {
            throw new Error("Access denied");
        }

        await ctx.db.delete(args.id);
    },
});
