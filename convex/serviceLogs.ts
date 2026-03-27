import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import {
    ensureCustomerAccess,
    ensureServiceLogAccess,
    getAccessibleCustomerIds,
} from "./authz";
import { enforceRateLimit } from "./rateLimit";

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

function sortLogsByServiceDate<T extends { service_date: string }>(logs: T[], descending: boolean): T[] {
    logs.sort((a, b) => descending
        ? b.service_date.localeCompare(a.service_date)
        : a.service_date.localeCompare(b.service_date)
    );
    return logs;
}

function dedupeLogsById<T extends { _id: any }>(logs: T[]): T[] {
    const seen = new Set<string>();
    const deduped: T[] = [];

    for (const log of logs) {
        const id = log._id.toString();
        if (seen.has(id)) continue;
        seen.add(id);
        deduped.push(log);
    }

    return deduped;
}

async function getLegacyLogsForUser(ctx: any, userEmail: string, serviceDate?: string) {
    const userCustomerIds = await getAccessibleCustomerIds(ctx, userEmail);
    const logPromises = Array.from(userCustomerIds).map(customerId => {
        if (serviceDate) {
            return ctx.db.query("serviceLogs")
                .withIndex("by_customer_and_date", (q: any) =>
                    q.eq("customer_id", customerId as any).eq("service_date", serviceDate)
                )
                .collect();
        }

        return ctx.db.query("serviceLogs")
            .withIndex("by_customer", (q: any) => q.eq("customer_id", customerId as any))
            .collect();
    });

    const logsPerCustomer = await Promise.all(logPromises);
    return logsPerCustomer.flat();
}

// Valid status values for service logs
const VALID_STATUS_VALUES = ['completed', 'pending', 'scheduled', 'in_progress', 'cancelled'] as const;
type ServiceLogStatus = typeof VALID_STATUS_VALUES[number];

function validateStatus(status: string): void {
    if (!VALID_STATUS_VALUES.includes(status as ServiceLogStatus)) {
        throw new Error(`Invalid status: "${status}". Must be one of: ${VALID_STATUS_VALUES.join(', ')}`);
    }
}

// List all service logs for the current user's customers only
export const list = query({
    args: {
        order: v.optional(v.string()),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        const descending = args.order === "-service_date";
        const limit = Math.max(1, Math.min(args.limit || 100, 500));
        const accessibleCustomerIds = await getAccessibleCustomerIds(ctx, identity.email!);
        const allLogs = await ctx.db.query("serviceLogs").collect();
        const accessibleLogs = allLogs.filter((log: any) =>
            accessibleCustomerIds.has(log.customer_id.toString()),
        );

        return sortLogsByServiceDate(dedupeLogsById(accessibleLogs), descending).slice(0, limit);
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

        if (args.customer_id) {
            await ensureCustomerAccess(ctx, args.customer_id, identity.email!, "read");
            // Query with index
            return await ctx.db.query("serviceLogs")
                .withIndex("by_customer", (q) => q.eq("customer_id", args.customer_id!))
                .collect();
        }

        if (args.service_date) {
            const accessibleCustomerIds = await getAccessibleCustomerIds(ctx, identity.email!);
            const allLogs = await ctx.db.query("serviceLogs")
                .withIndex("by_service_date", (q: any) => q.eq("service_date", args.service_date!))
                .collect();
            return allLogs.filter((log: any) => accessibleCustomerIds.has(log.customer_id.toString()));
        }

        return await getLegacyLogsForUser(ctx, identity.email!);
    },
});

// Get logs for a specific customer (with ownership verification)
export const getByCustomer = query({
    args: { customer_id: v.id("customers") },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        // Verify customer belongs to current user (tenant isolation)
        await ensureCustomerAccess(ctx, args.customer_id, identity.email!, "read");

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

        const accessibleCustomerIds = await getAccessibleCustomerIds(ctx, identity.email!);
        const logs = await ctx.db.query("serviceLogs")
            .withIndex("by_service_date", (q: any) => q.eq("service_date", args.service_date))
            .collect();
        return logs.filter((log: any) => accessibleCustomerIds.has(log.customer_id.toString()));
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
        // Proof-of-service time tracking fields
        start_time: v.optional(v.string()),
        end_time: v.optional(v.string()),
        // Proof-of-service photo tracking fields
        photo_count: v.optional(v.number()),
        has_before_photos: v.optional(v.boolean()),
        has_after_photos: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        // Enforce rate limiting (database-backed for distributed rate limiting)
        await enforceRateLimit(ctx, identity.email!, 'serviceLog.create');

        // Verify customer belongs to current user (tenant isolation)
        const { customer } = await ensureCustomerAccess(ctx, args.customer_id, identity.email!, "write");

        // Calculate duration with validation (throws if dates are invalid)
        const duration_ms = calculateDuration(args.start_time, args.end_time);

        // Validate status value
        validateStatus(args.status);

        const logData = {
            customer_id: args.customer_id,
            created_by: customer.created_by,
            service_date: args.service_date,
            status: args.status,
            service_type: args.service_type,
            notes: args.notes,
            ph: args.ph,
            chlorine: args.chlorine,
            alkalinity: args.alkalinity,
            stabilizer: args.stabilizer,
            salt: args.salt,
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
        // Proof-of-service time tracking fields
        start_time: v.optional(v.string()),
        end_time: v.optional(v.string()),
        // Proof-of-service photo tracking fields
        photo_count: v.optional(v.number()),
        has_before_photos: v.optional(v.boolean()),
        has_after_photos: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        // Verify log belongs to user's customer (tenant isolation)
        const { customer, serviceLog: log } = await ensureServiceLogAccess(ctx, args.id, identity.email!, "write");

        const { id, ...updates } = args;

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
            created_by: log.created_by ?? customer.created_by,
        };

        await ctx.db.patch(id, finalUpdates);

        return id;
    },
});

// Delete a service log (with ownership verification)
export const remove = mutation({
    args: { id: v.id("serviceLogs") },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        // Verify log belongs to user's customer (tenant isolation)
        await ensureServiceLogAccess(ctx, args.id, identity.email!, "write");

        await ctx.db.delete(args.id);
    },
});
