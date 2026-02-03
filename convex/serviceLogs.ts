import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
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

// Helper: Get all customer IDs owned by the current user (for tenant isolation)
async function getUserCustomerIds(ctx: any, userEmail: string): Promise<Set<string>> {
    const customers = await ctx.db
        .query("customers")
        .withIndex("by_created_by", (q: any) => q.eq("created_by", userEmail))
        .collect();
    return new Set(customers.map((c: any) => c._id.toString()));
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

        // Get user's customer IDs for tenant isolation
        const userCustomerIds = await getUserCustomerIds(ctx, identity.email!);

        // Query logs for each customer using index
        const logPromises = Array.from(userCustomerIds).map(customerId =>
            ctx.db.query("serviceLogs")
                .withIndex("by_customer", (q) => q.eq("customer_id", customerId as any))
                .collect()
        );
        const logsPerCustomer = await Promise.all(logPromises);
        const userLogs = logsPerCustomer.flat();

        // Sort after collecting
        userLogs.sort((a, b) => {
            if (args.order === "-service_date") {
                return b.service_date.localeCompare(a.service_date);
            }
            return a.service_date.localeCompare(b.service_date);
        });

        return userLogs.slice(0, args.limit || 100);
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

        // Get user's customer IDs for tenant isolation
        const userCustomerIds = await getUserCustomerIds(ctx, identity.email!);

        if (args.customer_id) {
            // Verify ownership first
            const customer = await ctx.db.get(args.customer_id);
            if (!customer || customer.created_by !== identity.email) {
                throw new Error("Customer not found or access denied");
            }
            // Query with index
            return await ctx.db.query("serviceLogs")
                .withIndex("by_customer", (q) => q.eq("customer_id", args.customer_id!))
                .collect();
        }

        // For service_date or no args, query per customer for tenant isolation (reuse userCustomerIds from above)
        const logPromises = Array.from(userCustomerIds).map(customerId => {
            if (args.service_date) {
                // Use the new compound index
                return ctx.db.query("serviceLogs")
                    .withIndex("by_customer_and_date", (q) =>
                        q.eq("customer_id", customerId as any).eq("service_date", args.service_date!)
                    )
                    .collect();
            }
            return ctx.db.query("serviceLogs")
                .withIndex("by_customer", (q) => q.eq("customer_id", customerId as any))
                .collect();
        });
        const logsPerCustomer = await Promise.all(logPromises);
        return logsPerCustomer.flat();
    },
});

// Get logs for a specific customer (with ownership verification)
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

        // Get user's customer IDs for tenant isolation
        const userCustomerIds = await getUserCustomerIds(ctx, identity.email!);

        // Query each customer's logs for this date using the new compound index
        const logPromises = Array.from(userCustomerIds).map(customerId =>
            ctx.db.query("serviceLogs")
                .withIndex("by_customer_and_date", (q) =>
                    q.eq("customer_id", customerId as any).eq("service_date", args.service_date)
                )
                .collect()
        );
        const logsPerCustomer = await Promise.all(logPromises);
        return logsPerCustomer.flat();
    },
});

// Create a new service log (with ownership verification)
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
        const customer = await ctx.db.get(args.customer_id);
        if (!customer || customer.created_by !== identity.email) {
            throw new Error("Customer not found or access denied");
        }

        // Calculate duration with validation (throws if dates are invalid)
        const duration_ms = calculateDuration(args.start_time, args.end_time);

        // Validate status value
        validateStatus(args.status);

        const logData = {
            customer_id: args.customer_id,
            service_date: args.service_date,
            status: args.status,
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
        const log = await ctx.db.get(args.id);
        if (!log) throw new Error("Service log not found");

        const customer = await ctx.db.get(log.customer_id);
        if (!customer || customer.created_by !== identity.email) {
            throw new Error("Access denied");
        }

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
        const log = await ctx.db.get(args.id);
        if (!log) throw new Error("Service log not found");

        const customer = await ctx.db.get(log.customer_id);
        if (!customer || customer.created_by !== identity.email) {
            throw new Error("Access denied");
        }

        await ctx.db.delete(args.id);
    },
});
