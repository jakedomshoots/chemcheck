import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

// List all chemical usage records
export const list = query({
    args: {
        order: v.optional(v.string()),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        const records = await ctx.db
            .query("chemicalUsage")
            .order(args.order === "-created_date" ? "desc" : "asc")
            .take(args.limit || 100);

        return records;
    },
});

// Filter chemical usage by customer
export const filter = query({
    args: {
        customer_id: v.optional(v.id("customers")),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        if (args.customer_id) {
            return await ctx.db
                .query("chemicalUsage")
                .withIndex("by_customer", (q) => q.eq("customer_id", args.customer_id!))
                .collect();
        }

        return await ctx.db.query("chemicalUsage").collect();
    },
});

// Get chemical usage for a specific customer
export const getByCustomer = query({
    args: { customer_id: v.id("customers") },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        const records = await ctx.db
            .query("chemicalUsage")
            .withIndex("by_customer", (q) => q.eq("customer_id", args.customer_id))
            .order("desc")
            .collect();

        return records;
    },
});

// Create a new chemical usage record
export const create = mutation({
    args: {
        customer_id: v.id("customers"),
        chemical_type: v.string(),
        quantity: v.string(),
        notes: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

        const recordId = await ctx.db.insert("chemicalUsage", {
            ...args,
            created_date: today,
        });

        return recordId;
    },
});

// Update a chemical usage record
export const update = mutation({
    args: {
        id: v.id("chemicalUsage"),
        customer_id: v.optional(v.id("customers")),
        chemical_type: v.optional(v.string()),
        quantity: v.optional(v.string()),
        notes: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        const { id, ...updates } = args;
        await ctx.db.patch(id, updates);

        return id;
    },
});

// Delete a chemical usage record
export const remove = mutation({
    args: { id: v.id("chemicalUsage") },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        await ctx.db.delete(args.id);
    },
});
