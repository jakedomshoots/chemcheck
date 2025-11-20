import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

// List all service logs (with optional ordering and limit)
export const list = query({
    args: {
        order: v.optional(v.string()),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        const logs = await ctx.db
            .query("serviceLogs")
            .order(args.order === "-service_date" ? "desc" : "asc")
            .take(args.limit || 100);

        return logs;
    },
});

// Filter service logs by criteria
export const filter = query({
    args: {
        customer_id: v.optional(v.id("customers")),
        service_date: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        let query = ctx.db.query("serviceLogs");

        if (args.customer_id) {
            query = query.withIndex("by_customer", (q) =>
                q.eq("customer_id", args.customer_id!)
            );
        } else if (args.service_date) {
            query = query.withIndex("by_service_date", (q) =>
                q.eq("service_date", args.service_date!)
            );
        }

        return await query.collect();
    },
});

// Get logs for a specific customer
export const getByCustomer = query({
    args: { customer_id: v.id("customers") },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        const logs = await ctx.db
            .query("serviceLogs")
            .withIndex("by_customer", (q) => q.eq("customer_id", args.customer_id))
            .order("desc")
            .collect();

        return logs;
    },
});

// Get logs for a specific date
export const getByDate = query({
    args: { service_date: v.string() },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        const logs = await ctx.db
            .query("serviceLogs")
            .withIndex("by_service_date", (q) => q.eq("service_date", args.service_date))
            .collect();

        return logs;
    },
});

// Create a new service log
export const create = mutation({
    args: {
        customer_id: v.id("customers"),
        service_date: v.string(),
        status: v.string(),
        notes: v.optional(v.string()),
        ph: v.string(),
        chlorine: v.string(),
        alkalinity: v.string(),
        stabilizer: v.string(),
        salt: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        const logId = await ctx.db.insert("serviceLogs", args);

        return logId;
    },
});

// Update a service log
export const update = mutation({
    args: {
        id: v.id("serviceLogs"),
        customer_id: v.optional(v.id("customers")),
        service_date: v.optional(v.string()),
        status: v.optional(v.string()),
        notes: v.optional(v.string()),
        ph: v.optional(v.string()),
        chlorine: v.optional(v.string()),
        alkalinity: v.optional(v.string()),
        stabilizer: v.optional(v.string()),
        salt: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        const { id, ...updates } = args;
        await ctx.db.patch(id, updates);

        return id;
    },
});

// Delete a service log
export const remove = mutation({
    args: { id: v.id("serviceLogs") },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        await ctx.db.delete(args.id);
    },
});
