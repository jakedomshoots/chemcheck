import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { enforceRateLimit } from "./rateLimit";

// Helper: Get all customer IDs owned by the current user (for tenant isolation)
async function getUserCustomerIds(ctx: any, userEmail: string): Promise<Set<string>> {
    const customers = await ctx.db
        .query("customers")
        .withIndex("by_created_by", (q: any) => q.eq("created_by", userEmail))
        .collect();
    return new Set(customers.map((c: any) => c._id.toString()));
}

// List all chemical usage records for the current user's customers only
export const list = query({
    args: {
        order: v.optional(v.string()),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        // Get user's customer IDs for tenant isolation
        const userCustomerIds = await getUserCustomerIds(ctx, identity.email!);

        // Query records for each customer using index
        const logPromises = Array.from(userCustomerIds).map(customerId =>
            ctx.db.query("chemicalUsage")
                .withIndex("by_customer", (q) => q.eq("customer_id", customerId as any))
                .collect()
        );
        const logsPerCustomer = await Promise.all(logPromises);
        const userRecords = logsPerCustomer.flat();

        // Sort after collecting
        userRecords.sort((a, b) => {
            const dateA = a.created_date || "";
            const dateB = b.created_date || "";
            if (args.order === "-created_date") {
                return dateB.localeCompare(dateA);
            }
            return dateA.localeCompare(dateB);
        });

        return userRecords.slice(0, args.limit || 100);
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

        // Get user's customer IDs for tenant isolation
        const userCustomerIds = await getUserCustomerIds(ctx, identity.email!);

        if (args.customer_id) {
            // Verify ownership first
            const customer = await ctx.db.get(args.customer_id);
            if (!customer || customer.created_by !== identity.email) {
                throw new Error("Customer not found or access denied");
            }
            // Query with index
            return await ctx.db
                .query("chemicalUsage")
                .withIndex("by_customer", (q) => q.eq("customer_id", args.customer_id!))
                .collect();
        }

        // For no args, query per customer for tenant isolation (reuse userCustomerIds from above)
        const logPromises = Array.from(userCustomerIds).map(customerId =>
            ctx.db.query("chemicalUsage")
                .withIndex("by_customer", (q) => q.eq("customer_id", customerId as any))
                .collect()
        );
        const logsPerCustomer = await Promise.all(logPromises);
        return logsPerCustomer.flat();
    },
});

// Get chemical usage for a specific customer (with ownership verification)
export const getByCustomer = query({
    args: { customer_id: v.id("customers") },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        // Verify customer belongs to current user (tenant isolation)
        const customer = await ctx.db.get(args.customer_id);
        if (!customer || customer.created_by !== identity.email) {
            throw new Error("Customer not found or access denied");
        }

        const records = await ctx.db
            .query("chemicalUsage")
            .withIndex("by_customer", (q) => q.eq("customer_id", args.customer_id))
            .order("desc")
            .collect();

        return records;
    },
});

// Create a new chemical usage record (with ownership verification)
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

        // Enforce rate limiting (database-backed for distributed rate limiting)
        await enforceRateLimit(ctx, identity.email!, 'chemical.create');

        // Verify customer belongs to current user (tenant isolation)
        const customer = await ctx.db.get(args.customer_id);
        if (!customer || customer.created_by !== identity.email) {
            throw new Error("Customer not found or access denied");
        }

        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

        const recordId = await ctx.db.insert("chemicalUsage", {
            ...args,
            created_date: today,
        });

        return recordId;
    },
});

// Update a chemical usage record (with ownership verification)
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

        // Enforce rate limiting (database-backed for distributed rate limiting)
        await enforceRateLimit(ctx, identity.email!, 'chemical.create');

        // Verify record belongs to user's customer (tenant isolation)
        const record = await ctx.db.get(args.id);
        if (!record) throw new Error("Chemical usage record not found");

        const customer = await ctx.db.get(record.customer_id);
        if (!customer || customer.created_by !== identity.email) {
            throw new Error("Access denied");
        }

        const { id, ...updates } = args;
        await ctx.db.patch(id, updates);

        return id;
    },
});

// Delete a chemical usage record (with ownership verification)
export const remove = mutation({
    args: { id: v.id("chemicalUsage") },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        // Enforce rate limiting (database-backed for distributed rate limiting)
        await enforceRateLimit(ctx, identity.email!, 'chemical.create');

        // Verify record belongs to user's customer (tenant isolation)
        const record = await ctx.db.get(args.id);
        if (!record) throw new Error("Chemical usage record not found");

        const customer = await ctx.db.get(record.customer_id);
        if (!customer || customer.created_by !== identity.email) {
            throw new Error("Access denied");
        }

        await ctx.db.delete(args.id);
    },
});
