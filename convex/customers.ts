import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

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

        let query = ctx.db.query("customers");

        if (args.created_by) {
            query = query.withIndex("by_created_by", (q) =>
                q.eq("created_by", args.created_by!)
            );
        } else {
            query = query.withIndex("by_created_by", (q) =>
                q.eq("created_by", identity.email!)
            );
        }

        const customers = await query.collect();

        if (args.service_day) {
            return customers.filter((c) => c.service_day === args.service_day);
        }

        return customers;
    },
});

// Get a single customer by ID
export const get = query({
    args: { id: v.id("customers") },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        const customer = await ctx.db.get(args.id);
        if (!customer) throw new Error("Customer not found");

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

        const customerId = await ctx.db.insert("customers", {
            ...args,
            created_by: identity.email!,
        });

        return customerId;
    },
});

// Update a customer
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
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        const { id, ...updates } = args;
        await ctx.db.patch(id, updates);

        return id;
    },
});

// Delete a customer
export const remove = mutation({
    args: { id: v.id("customers") },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        await ctx.db.delete(args.id);
    },
});
