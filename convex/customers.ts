import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { enforceRateLimit } from "./rateLimit";
import { validateCustomerCreate, validateCustomerUpdate } from "./validation";
import {
    canAccessCustomer,
    getBusinessContext,
    requireBusinessContext,
    requireCustomerRole,
    requireUserEmail,
} from "./authorization";

const CUSTOMER_WRITE_ROLES = ["owner", "admin"] as const;

async function listAccessibleCustomers(ctx: any, userEmail: string) {
    // Guard: if userEmail is undefined/empty (e.g. Clerk token missing email claim),
    // throw a clear error instead of silently returning an empty list.
    const business = await getBusinessContext(ctx, userEmail);

    if (business) {
        return await ctx.db
            .query("customers")
            .withIndex("by_business", (q: any) => q.eq("business_id", business.businessId))
            .collect();
    }

    return await ctx.db
        .query("customers")
        .withIndex("by_created_by", (q: any) => q.eq("created_by", userEmail))
        .collect();
}

// Count accessible customers for the current user, bounded by a safe cap.
export const count = query({
    args: {},
    handler: async (ctx) => {
        const email = await requireUserEmail(ctx);

        const COUNT_CAP = 1000;
        const business = await getBusinessContext(ctx, email);

        let customers;
        if (business) {
            customers = await ctx.db
                .query("customers")
                .withIndex("by_business", (q: any) => q.eq("business_id", business.businessId))
                .take(COUNT_CAP + 1);
        } else {
            customers = await ctx.db
                .query("customers")
                .withIndex("by_created_by", (q: any) => q.eq("created_by", email))
                .take(COUNT_CAP + 1);
        }

        const isCapped = customers.length > COUNT_CAP;
        return { count: Math.min(customers.length, COUNT_CAP), isCapped };
    },
});

// Get customers for the current user, bounded to a safe default page size.
export const list = query({
    args: {},
    handler: async (ctx) => {
        const email = await requireUserEmail(ctx);
        const customers = await listAccessibleCustomers(ctx, email);
        // Default limit keeps the query bounded while remaining compatible with existing callers.
        const DEFAULT_LIST_LIMIT = 100;
        return customers.slice(0, DEFAULT_LIST_LIMIT);
    },
});

// Cursor-paginated customer list for large datasets.
export const listPaginated = query({
    args: {
        limit: v.optional(v.number()),
        cursor: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const email = await requireUserEmail(ctx);

        const limit = Math.max(1, Math.min(args.limit ?? 50, 200));
        const business = await getBusinessContext(ctx, email);

        let result: any;
        if (business) {
            result = await ctx.db
                .query("customers")
                .withIndex("by_business", (q: any) => q.eq("business_id", business.businessId))
                .paginate({ cursor: args.cursor ?? null, numItems: limit });
        } else {
            result = await ctx.db
                .query("customers")
                .withIndex("by_created_by", (q: any) => q.eq("created_by", email))
                .paginate({ cursor: args.cursor ?? null, numItems: limit });
        }

        return {
            customers: result.page.sort((a: any, b: any) =>
                String(a.full_name || "").localeCompare(String(b.full_name || ""))
            ),
            cursor: result.continueCursor,
            hasMore: !result.isDone,
        };
    },
});

// Filter customers by criteria using indexed queries.
export const filter = query({
    args: {
        created_by: v.optional(v.string()),
        service_day: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const email = await requireUserEmail(ctx);

        // Ignore created_by input and enforce tenant-safe lookup on the server.
        const business = await getBusinessContext(ctx, email);

        if (business) {
            if (args.service_day) {
                return await ctx.db
                    .query("customers")
                    .withIndex("by_business_and_day", (q: any) =>
                        q.eq("business_id", business.businessId).eq("service_day", args.service_day)
                    )
                    .collect();
            }

            return await ctx.db
                .query("customers")
                .withIndex("by_business", (q: any) => q.eq("business_id", business.businessId))
                .collect();
        }

        if (args.service_day) {
            return await ctx.db
                .query("customers")
                .withIndex("by_created_by_and_service_day" as any, (q: any) =>
                    q.eq("created_by", email).eq("service_day", args.service_day)
                )
                .collect();
        }

        return await ctx.db
            .query("customers")
            .withIndex("by_created_by", (q: any) => q.eq("created_by", email))
            .collect();
    },
});

// Get a single customer by ID (with ownership verification)
export const get = query({
    args: { id: v.id("customers") },
    handler: async (ctx, args) => {
        const email = await requireUserEmail(ctx);

        const customer = await ctx.db.get(args.id);
        if (!customer) throw new Error("Customer not found");

        if (!(await canAccessCustomer(ctx, customer, email))) {
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
        const email = await requireUserEmail(ctx);

        // Enforce rate limiting (database-backed for distributed rate limiting)
        await enforceRateLimit(ctx, email, 'customer.create');

        // SECURITY: Server-side validation and sanitization
        // This cannot be bypassed by attackers sending data directly to Convex
        const validatedData = validateCustomerCreate(args);
        const business = await requireBusinessContext(ctx, email);

        const customerId = await ctx.db.insert("customers", {
            ...validatedData,
            created_by: business.ownerEmail,
            business_id: business.businessId,
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
        const email = await requireUserEmail(ctx);

        // Enforce rate limiting (database-backed for distributed rate limiting)
        await enforceRateLimit(ctx, email, 'customer.update');

        // Verify ownership (tenant isolation)
        const customer = await ctx.db.get(args.id);
        if (!customer) throw new Error("Customer not found");
        await requireCustomerRole(ctx, customer, email, CUSTOMER_WRITE_ROLES);

        const { id, report_settings, ...otherArgs } = args;

        // SECURITY: Server-side validation and sanitization for update fields
        const validatedData = validateCustomerUpdate(otherArgs);

        // Handle report_settings separately with proper type safety
        let mergedReportSettings: {
            show_chemical_readings: boolean;
            show_photos: boolean;
            show_service_notes: boolean;
            show_technician_name: boolean;
            show_service_duration: boolean;
            show_overall_status: boolean;
        } | undefined;

        if (report_settings) {
            // Default settings
            const defaults = {
                show_chemical_readings: true,
                show_photos: true,
                show_service_notes: true,
                show_technician_name: true,
                show_service_duration: true,
                show_overall_status: true,
            };

            // Merge with existing settings or defaults
            const existingSettings = customer.report_settings || defaults;

            mergedReportSettings = {
                show_chemical_readings: report_settings.show_chemical_readings ?? existingSettings.show_chemical_readings,
                show_photos: report_settings.show_photos ?? existingSettings.show_photos,
                show_service_notes: report_settings.show_service_notes ?? existingSettings.show_service_notes,
                show_technician_name: report_settings.show_technician_name ?? existingSettings.show_technician_name,
                show_service_duration: report_settings.show_service_duration ?? existingSettings.show_service_duration,
                show_overall_status: report_settings.show_overall_status ?? existingSettings.show_overall_status,
            };
        }

        const updates = mergedReportSettings
            ? { ...validatedData, report_settings: mergedReportSettings }
            : validatedData;

        await ctx.db.patch(id, updates);

        return id;
    },
});

// Delete a customer (with ownership verification)
export const remove = mutation({
    args: { id: v.id("customers") },
    handler: async (ctx, args) => {
        const email = await requireUserEmail(ctx);

        // Enforce rate limiting (database-backed for distributed rate limiting)
        await enforceRateLimit(ctx, email, 'customer.delete');

        // Verify ownership (tenant isolation)
        const customer = await ctx.db.get(args.id);
        if (!customer) throw new Error("Customer not found");
        await requireCustomerRole(ctx, customer, email, CUSTOMER_WRITE_ROLES);

        await ctx.db.delete(args.id);
    },
});
