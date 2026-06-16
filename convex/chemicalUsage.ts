import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { enforceRateLimit } from "./rateLimit";

const DEFAULT_PAGE_LIMIT = 100;
const MAX_PAGE_LIMIT = 500;

function boundedLimit(limit: number | undefined): number {
    if (limit === undefined) return DEFAULT_PAGE_LIMIT;
    if (limit > MAX_PAGE_LIMIT) return MAX_PAGE_LIMIT;
    if (limit < 1) return 1;
    return Math.floor(limit);
}

// List all chemical usage records created by the current user, paginated.
export const list = query({
    args: {
        order: v.optional(v.string()),
        limit: v.optional(v.number()),
        cursor: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        const sortOrder = args.order === "-created_date" ? "desc" : "asc";
        const usageQuery = ctx.db
            .query("chemicalUsage")
            .withIndex("by_created_by_and_created_date", (q) =>
                q.eq("created_by", identity.email!)
            )
            .order(sortOrder);

        return await usageQuery.paginate({
            cursor: args.cursor || null,
            numItems: boundedLimit(args.limit),
        });
    },
});

// Filter chemical usage by customer, paginated.
export const filter = query({
    args: {
        customer_id: v.optional(v.id("customers")),
        limit: v.optional(v.number()),
        cursor: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        if (args.customer_id) {
            // Verify ownership first
            const customer = await ctx.db.get(args.customer_id);
            if (!customer || customer.created_by !== identity.email) {
                throw new Error("Customer not found or access denied");
            }
        }

        let usageQuery = ctx.db
            .query("chemicalUsage")
            .withIndex("by_created_by", (q) => q.eq("created_by", identity.email!));

        if (args.customer_id) {
            usageQuery = usageQuery.filter((q) => q.eq(q.field("customer_id"), args.customer_id!));
        }

        return await usageQuery.paginate({
            cursor: args.cursor || null,
            numItems: boundedLimit(args.limit),
        });
    },
});

// Get chemical usage for a specific customer (with ownership verification), paginated.
export const getByCustomer = query({
    args: {
        customer_id: v.id("customers"),
        limit: v.optional(v.number()),
        cursor: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        // Verify customer belongs to current user (tenant isolation)
        const customer = await ctx.db.get(args.customer_id);
        if (!customer || customer.created_by !== identity.email) {
            throw new Error("Customer not found or access denied");
        }

        return await ctx.db
            .query("chemicalUsage")
            .withIndex("by_customer", (q) => q.eq("customer_id", args.customer_id))
            .order("desc")
            .paginate({
                cursor: args.cursor || null,
                numItems: boundedLimit(args.limit),
            });
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
            created_by: identity.email!,
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
