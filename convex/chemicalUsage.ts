import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { enforceRateLimit } from "./rateLimit";
import {
    getBusinessContext,
    requireCustomerAccess,
    requireCustomerRole,
    requireUserEmail,
} from "./authorization";

const DEFAULT_PAGE_LIMIT = 100;
const MAX_PAGE_LIMIT = 500;
const CHEMICAL_WRITE_ROLES = ["owner", "admin", "technician"] as const;

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
        const email = await requireUserEmail(ctx);

        const sortOrder = args.order === "-created_date" ? "desc" : "asc";
        const business = await getBusinessContext(ctx, email);
        const usageQuery = (business
            ? ctx.db.query("chemicalUsage").withIndex("by_business_and_created_date", (q: any) =>
                q.eq("business_id", business.businessId)
            )
            : ctx.db.query("chemicalUsage").withIndex("by_created_by_and_created_date", (q: any) =>
                q.eq("created_by", email)
            ))
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
        const email = await requireUserEmail(ctx);

        if (args.customer_id) {
            // Verify ownership first
            const customer = await ctx.db.get(args.customer_id);
            if (!customer) {
                throw new Error("Customer not found or access denied");
            }
            await requireCustomerAccess(ctx, customer, email);
        }

        const business = await getBusinessContext(ctx, email);
        let usageQuery = business
            ? ctx.db.query("chemicalUsage").withIndex("by_business", (q: any) => q.eq("business_id", business.businessId))
            : ctx.db.query("chemicalUsage").withIndex("by_created_by", (q: any) => q.eq("created_by", email));

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
        const email = await requireUserEmail(ctx);

        // Verify customer belongs to current user (tenant isolation)
        const customer = await ctx.db.get(args.customer_id);
        if (!customer) {
            throw new Error("Customer not found or access denied");
        }
        await requireCustomerAccess(ctx, customer, email);

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
        const email = await requireUserEmail(ctx);

        // Enforce rate limiting (database-backed for distributed rate limiting)
        await enforceRateLimit(ctx, email, 'chemical.create');

        // Verify customer belongs to current user (tenant isolation)
        const customer = await ctx.db.get(args.customer_id);
        if (!customer) {
            throw new Error("Customer not found or access denied");
        }
        const business = await requireCustomerRole(ctx, customer, email, CHEMICAL_WRITE_ROLES);

        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

        const recordId = await ctx.db.insert("chemicalUsage", {
            ...args,
            created_date: today,
            created_by: email,
            business_id: business?.businessId,
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
        const email = await requireUserEmail(ctx);

        // Enforce rate limiting (database-backed for distributed rate limiting)
        await enforceRateLimit(ctx, email, 'chemical.update');

        // Verify record belongs to user's customer (tenant isolation)
        const record = await ctx.db.get(args.id);
        if (!record) throw new Error("Chemical usage record not found");

        const customer = await ctx.db.get(record.customer_id);
        if (!customer) {
            throw new Error("Access denied");
        }
        const business = await requireCustomerRole(ctx, customer, email, CHEMICAL_WRITE_ROLES);

        if (args.customer_id && args.customer_id !== record.customer_id) {
            const replacementCustomer = await ctx.db.get(args.customer_id);
            if (!replacementCustomer) throw new Error("Customer not found or access denied");
            const replacementBusiness = await requireCustomerRole(ctx, replacementCustomer, email, CHEMICAL_WRITE_ROLES);
            if (String(replacementBusiness?.businessId || "") !== String(business?.businessId || "")) {
                throw new Error("Chemical usage cannot be moved between businesses");
            }
        }

        const { id, ...updates } = args;
        await ctx.db.patch(id, { ...updates, business_id: business?.businessId ?? record.business_id });

        return id;
    },
});

// Delete a chemical usage record (with ownership verification)
export const remove = mutation({
    args: { id: v.id("chemicalUsage") },
    handler: async (ctx, args) => {
        const email = await requireUserEmail(ctx);

        // Enforce rate limiting (database-backed for distributed rate limiting)
        await enforceRateLimit(ctx, email, 'chemical.delete');

        // Verify record belongs to user's customer (tenant isolation)
        const record = await ctx.db.get(args.id);
        if (!record) throw new Error("Chemical usage record not found");

        const customer = await ctx.db.get(record.customer_id);
        if (!customer) {
            throw new Error("Access denied");
        }
        await requireCustomerRole(ctx, customer, email, CHEMICAL_WRITE_ROLES);

        await ctx.db.delete(args.id);
    },
});
