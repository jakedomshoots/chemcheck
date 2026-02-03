import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { enforceRateLimit } from "./rateLimit";
import { validateCustomerCreate, validateCustomerUpdate } from "./validation";

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

        // Enforce rate limiting (database-backed for distributed rate limiting)
        await enforceRateLimit(ctx, identity.email!, 'customer.create');

        // SECURITY: Server-side validation and sanitization
        // This cannot be bypassed by attackers sending data directly to Convex
        const validatedData = validateCustomerCreate(args);

        const customerId = await ctx.db.insert("customers", {
            ...validatedData,
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

        // Enforce rate limiting (database-backed for distributed rate limiting)
        await enforceRateLimit(ctx, identity.email!, 'customer.update');

        // Verify ownership (tenant isolation)
        const customer = await ctx.db.get(args.id);
        if (!customer) throw new Error("Customer not found");
        if (customer.created_by !== identity.email) {
            throw new Error("Access denied");
        }

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
        const customer = await ctx.db.get(args.id);
        if (!customer) throw new Error("Customer not found");
        if (customer.created_by !== identity.email) {
            throw new Error("Access denied");
        }

        await ctx.db.delete(args.id);
    },
});
