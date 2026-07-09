import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { enforceRateLimit } from "./rateLimit";
import {
    getBusinessContext,
    requireCustomerAccess,
    requireCustomerRole,
    requireUserEmail,
} from "./authorization";

/**
 * Validates that a string is a valid ISO 8601 date format
 * Returns true if valid, false otherwise
 */
function isValidDateString(dateStr: string): boolean {
    if (!dateStr || typeof dateStr !== 'string') {
        return false;
    }
    const date = new Date(dateStr);
    return !isNaN(date.getTime());
}

/**
 * Safely calculates duration between two date strings
 * Returns undefined if either date is invalid or if duration would be negative
 * Throws an error if dates are provided but invalid (to prevent data corruption)
 */
function calculateDuration(startTime: string | undefined, endTime: string | undefined): number | undefined {
    if (!startTime || !endTime) {
        return undefined;
    }

    // Validate both date strings before parsing
    if (!isValidDateString(startTime)) {
        throw new Error(`Invalid start_time format: "${startTime}". Expected ISO 8601 date string.`);
    }
    if (!isValidDateString(endTime)) {
        throw new Error(`Invalid end_time format: "${endTime}". Expected ISO 8601 date string.`);
    }

    const startDate = new Date(startTime);
    const endDate = new Date(endTime);
    const duration = endDate.getTime() - startDate.getTime();

    // Return 0 for negative durations (end before start)
    // This is a data integrity safeguard, but we log a warning
    if (duration < 0) {
        console.warn(`Warning: end_time (${endTime}) is before start_time (${startTime}). Setting duration to 0.`);
        return 0;
    }

    return duration;
}

// Valid status values for service logs
const VALID_STATUS_VALUES = ['completed', 'pending', 'scheduled', 'in_progress', 'cancelled'] as const;
type ServiceLogStatus = typeof VALID_STATUS_VALUES[number];
const SERVICE_LOG_WRITE_ROLES = ["owner", "admin", "technician"] as const;

function validateStatus(status: string): void {
    if (!VALID_STATUS_VALUES.includes(status as ServiceLogStatus)) {
        throw new Error(`Invalid status: "${status}". Must be one of: ${VALID_STATUS_VALUES.join(', ')}`);
    }
}

function clampLimit(limit: number | undefined): number {
    return Math.max(1, Math.min(limit || 100, 500));
}

// List all service logs for the current user using cursor-based pagination.
export const list = query({
    args: {
        order: v.optional(v.string()),
        limit: v.optional(v.number()),
        cursor: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const email = await requireUserEmail(ctx);

        const descending = args.order === "-service_date";
        const numItems = clampLimit(args.limit);

        const business = await getBusinessContext(ctx, email);
        const serviceLogs = business
            ? ctx.db.query("serviceLogs").withIndex("by_business_and_service_date", (q: any) =>
                q.eq("business_id", business.businessId)
            )
            : ctx.db.query("serviceLogs").withIndex("by_created_by_and_service_date", (q: any) =>
                q.eq("created_by", email)
            );

        return await serviceLogs
            .order(descending ? "desc" : "asc")
            .paginate({ cursor: args.cursor ?? null, numItems });
    },
});

// Filter service logs by criteria using cursor-based pagination.
// Filters are applied in JS after fetching a bounded page from the primary index.
export const filter = query({
    args: {
        customer_id: v.optional(v.id("customers")),
        service_date_from: v.optional(v.string()),
        service_date_to: v.optional(v.string()),
        status: v.optional(v.string()),
        limit: v.optional(v.number()),
        cursor: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const email = await requireUserEmail(ctx);

        if (args.service_date_from && !isValidDateString(args.service_date_from)) {
            throw new Error(`Invalid service_date_from: "${args.service_date_from}". Expected ISO 8601 date string.`);
        }
        if (args.service_date_to && !isValidDateString(args.service_date_to)) {
            throw new Error(`Invalid service_date_to: "${args.service_date_to}". Expected ISO 8601 date string.`);
        }
        if (args.status) {
            validateStatus(args.status);
        }

        const numItems = clampLimit(args.limit);
        const business = await getBusinessContext(ctx, email);
        const serviceLogs = business
            ? ctx.db.query("serviceLogs").withIndex("by_business_and_service_date", (q: any) =>
                q.eq("business_id", business.businessId)
            )
            : ctx.db.query("serviceLogs").withIndex("by_created_by_and_service_date", (q: any) =>
                q.eq("created_by", email)
            );
        const result = await serviceLogs
            .order("desc")
            .paginate({ cursor: args.cursor ?? null, numItems });

        let page = result.page;

        if (args.customer_id) {
            page = page.filter((log: any) => log.customer_id === args.customer_id);
        }
        if (args.service_date_from) {
            page = page.filter((log: any) => log.service_date >= args.service_date_from!);
        }
        if (args.service_date_to) {
            page = page.filter((log: any) => log.service_date <= args.service_date_to!);
        }
        if (args.status) {
            page = page.filter((log: any) => log.status === args.status);
        }

        return { ...result, page };
    },
});

// Get logs for a specific customer (with ownership verification)
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

        const numItems = clampLimit(args.limit);
        return await ctx.db
            .query("serviceLogs")
            .withIndex("by_customer", (q) => q.eq("customer_id", args.customer_id))
            .order("desc")
            .paginate({ cursor: args.cursor ?? null, numItems });
    },
});

// Get logs for a specific date
export const getByDate = query({
    args: {
        service_date: v.string(),
        limit: v.optional(v.number()),
        cursor: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const email = await requireUserEmail(ctx);

        const numItems = clampLimit(args.limit);
        const business = await getBusinessContext(ctx, email);
        const serviceLogs = business
            ? ctx.db.query("serviceLogs").withIndex("by_business_and_service_date", (q: any) =>
                q.eq("business_id", business.businessId).eq("service_date", args.service_date)
            )
            : ctx.db.query("serviceLogs").withIndex("by_created_by_and_service_date", (q: any) =>
                q.eq("created_by", email).eq("service_date", args.service_date)
            );
        return await serviceLogs
            .paginate({ cursor: args.cursor ?? null, numItems });
    },
});

// Create a new service log (with ownership verification)
export const create = mutation({
    args: {
        customer_id: v.id("customers"),
        service_date: v.string(),
        status: v.string(),
        service_type: v.optional(v.string()),
        notes: v.optional(v.string()),
        ph: v.string(),
        chlorine: v.string(),
        alkalinity: v.string(),
        stabilizer: v.string(),
        salt: v.optional(v.number()),
        ph_value: v.optional(v.number()),
        chlorine_value: v.optional(v.number()),
        alkalinity_value: v.optional(v.number()),
        stabilizer_value: v.optional(v.number()),
        // Proof-of-service time tracking fields
        start_time: v.optional(v.string()),
        end_time: v.optional(v.string()),
        // Proof-of-service photo tracking fields
        photo_count: v.optional(v.number()),
        has_before_photos: v.optional(v.boolean()),
        has_after_photos: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const email = await requireUserEmail(ctx);

        // Enforce rate limiting (database-backed for distributed rate limiting)
        await enforceRateLimit(ctx, email, 'serviceLog.create');

        // Verify customer belongs to current user (tenant isolation)
        const customer = await ctx.db.get(args.customer_id);
        if (!customer) {
            throw new Error("Customer not found or access denied");
        }
        const business = await requireCustomerRole(ctx, customer, email, SERVICE_LOG_WRITE_ROLES);

        // Calculate duration with validation (throws if dates are invalid)
        const duration_ms = calculateDuration(args.start_time, args.end_time);

        // Validate status value
        validateStatus(args.status);

        const logData = {
            customer_id: args.customer_id,
            created_by: email,
            business_id: business?.businessId,
            service_date: args.service_date,
            status: args.status,
            service_type: args.service_type,
            notes: args.notes,
            ph: args.ph,
            chlorine: args.chlorine,
            alkalinity: args.alkalinity,
            stabilizer: args.stabilizer,
            salt: args.salt,
            ph_value: args.ph_value,
            chlorine_value: args.chlorine_value,
            alkalinity_value: args.alkalinity_value,
            stabilizer_value: args.stabilizer_value,
            start_time: args.start_time,
            end_time: args.end_time,
            duration_ms,
            photo_count: args.photo_count,
            has_before_photos: args.has_before_photos,
            has_after_photos: args.has_after_photos,
        };

        const logId = await ctx.db.insert("serviceLogs", logData);

        return logId;
    },
});

// Update a service log (with ownership verification)
export const update = mutation({
    args: {
        id: v.id("serviceLogs"),
        customer_id: v.optional(v.id("customers")),
        service_date: v.optional(v.string()),
        status: v.optional(v.string()),
        service_type: v.optional(v.string()),
        notes: v.optional(v.string()),
        ph: v.optional(v.string()),
        chlorine: v.optional(v.string()),
        alkalinity: v.optional(v.string()),
        stabilizer: v.optional(v.string()),
        salt: v.optional(v.number()),
        ph_value: v.optional(v.number()),
        chlorine_value: v.optional(v.number()),
        alkalinity_value: v.optional(v.number()),
        stabilizer_value: v.optional(v.number()),
        // Proof-of-service time tracking fields
        start_time: v.optional(v.string()),
        end_time: v.optional(v.string()),
        // Proof-of-service photo tracking fields
        photo_count: v.optional(v.number()),
        has_before_photos: v.optional(v.boolean()),
        has_after_photos: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const email = await requireUserEmail(ctx);

        // Verify log belongs to user's customer (tenant isolation)
        const log = await ctx.db.get(args.id);
        if (!log) throw new Error("Service log not found");

        const customer = await ctx.db.get(log.customer_id);
        if (!customer) {
            throw new Error("Access denied");
        }
        const business = await requireCustomerRole(ctx, customer, email, SERVICE_LOG_WRITE_ROLES);

        if (args.customer_id && args.customer_id !== log.customer_id) {
            const replacementCustomer = await ctx.db.get(args.customer_id);
            if (!replacementCustomer) throw new Error("Customer not found or access denied");
            const replacementBusiness = await requireCustomerRole(ctx, replacementCustomer, email, SERVICE_LOG_WRITE_ROLES);
            if (String(replacementBusiness?.businessId || "") !== String(business?.businessId || "")) {
                throw new Error("Service logs cannot be moved between businesses");
            }
        }

        const { id, ...updates } = args;
        if (updates.status !== undefined) validateStatus(updates.status);

        // Calculate duration if both start_time and end_time are available
        // Use provided values or fall back to existing log values
        const startTime = updates.start_time ?? log.start_time;
        const endTime = updates.end_time ?? log.end_time;

        // Calculate duration with validation (throws if dates are invalid)
        const duration_ms = calculateDuration(startTime, endTime);

        // Include calculated duration in updates
        const finalUpdates = {
            ...updates,
            duration_ms,
            created_by: log.created_by ?? email,
            business_id: business?.businessId ?? log.business_id,
        };

        await ctx.db.patch(id, finalUpdates);

        return id;
    },
});

// Delete a service log (with ownership verification)
export const remove = mutation({
    args: { id: v.id("serviceLogs") },
    handler: async (ctx, args) => {
        const email = await requireUserEmail(ctx);

        // Verify log belongs to user's customer (tenant isolation)
        const log = await ctx.db.get(args.id);
        if (!log) throw new Error("Service log not found");

        const customer = await ctx.db.get(log.customer_id);
        if (!customer) {
            throw new Error("Access denied");
        }
        await requireCustomerRole(ctx, customer, email, SERVICE_LOG_WRITE_ROLES);

        await ctx.db.delete(args.id);
    },
});
