import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import {
    assertPermission,
    ensureCustomerAccess,
    listAccessibleCustomers,
    resolveAccessContextForEmail,
} from "./authz";
import { enforceRateLimit } from "./rateLimit";
import { validateCustomerCreate, validateCustomerUpdate } from "./validation";

// Get all customers for the current user
export const list = query({
    args: {},
    handler: async (ctx) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        return await listAccessibleCustomers(ctx, identity.email!);
    },
});

// Paginated customer list for large datasets
export const listPaginated = query({
    args: {
        limit: v.optional(v.number()),
        cursor: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        const limit = Math.max(1, Math.min(args.limit ?? 50, 200));
        const allCustomers = await listAccessibleCustomers(ctx, identity.email!);
        const sortedCustomers = allCustomers.sort((a: any, b: any) =>
            String(a.full_name || "").localeCompare(String(b.full_name || ""))
        );

        const offset = args.cursor && Number.isFinite(Number(args.cursor))
            ? Math.max(0, Number(args.cursor))
            : 0;
        const page = sortedCustomers.slice(offset, offset + limit);
        const nextOffset = offset + page.length;
        const hasMore = nextOffset < sortedCustomers.length;

        return {
            customers: page,
            cursor: hasMore ? String(nextOffset) : undefined,
            hasMore,
        };
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

        // Ignore created_by input and enforce tenant-safe list on server
        const customers = await listAccessibleCustomers(ctx, identity.email!);

        if (args.service_day) {
            return customers.filter((c: any) => c.service_day === args.service_day);
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

        const { customer } = await ensureCustomerAccess(ctx, args.id, identity.email!, "read");
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

        // Enforce rate limiting (database-backed for distributed rate limiting)
        await enforceRateLimit(ctx, identity.email!, 'customer.create');

        // SECURITY: Server-side validation and sanitization
        // This cannot be bypassed by attackers sending data directly to Convex
        const validatedData = validateCustomerCreate(args);
        const access = await resolveAccessContextForEmail(ctx, identity.email!);
        assertPermission(access, "operational:write");

        const customerId = await ctx.db.insert("customers", {
            ...validatedData,
            created_by: access.business ? access.ownerEmail : access.userEmail,
            business_id: access.businessId ?? undefined,
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

        // Enforce rate limiting (database-backed for distributed rate limiting)
        await enforceRateLimit(ctx, identity.email!, 'customer.update');

        // Verify ownership (tenant isolation)
        const { customer } = await ensureCustomerAccess(ctx, args.id, identity.email!, "write");

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
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        // Enforce rate limiting (database-backed for distributed rate limiting)
        await enforceRateLimit(ctx, identity.email!, 'customer.delete');

        // Verify ownership (tenant isolation)
        await ensureCustomerAccess(ctx, args.id, identity.email!, "write");

        await ctx.db.delete(args.id);
    },
});
