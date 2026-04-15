import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { enforceRateLimit } from "./rateLimit";
import { validateCustomerCreate, validateCustomerUpdate } from "./validation";

async function resolveBusinessContext(ctx: any, userEmail: string) {
    const teamMember = await ctx.db
        .query("team_members")
        .withIndex("by_user_email", (q: any) => q.eq("user_email", userEmail))
        .filter((q: any) => q.eq(q.field("is_active"), true))
        .first();

    if (teamMember) {
        const teamBusiness = await ctx.db.get(teamMember.business_id);
        if (teamBusiness) return teamBusiness;
    }

    return await ctx.db
        .query("businesses")
        .withIndex("by_owner_email", (q: any) => q.eq("owner_email", userEmail))
        .first();
}

async function getActiveBusinessMemberEmails(
    ctx: any,
    businessId: any,
    ownerEmail: string
): Promise<Set<string>> {
    const members = await ctx.db
        .query("team_members")
        .withIndex("by_business", (q: any) => q.eq("business_id", businessId))
        .filter((q: any) => q.eq(q.field("is_active"), true))
        .collect();

    const emails = new Set<string>([ownerEmail]);
    for (const member of members) {
        if (member.user_email) {
            emails.add(member.user_email);
        }
    }
    return emails;
}

async function listAccessibleCustomers(ctx: any, userEmail: string) {
    // Guard: if userEmail is undefined/empty (e.g. Clerk token missing email claim),
    // throw a clear error instead of silently returning an empty list.
    const normalizedEmail = String(userEmail || "").trim().toLowerCase();
    if (!normalizedEmail) {
        throw new Error("listAccessibleCustomers: userEmail is empty or undefined. Check that the Clerk JWT includes an email claim.");
    }

    const business = await resolveBusinessContext(ctx, userEmail);

    if (business) {
        const allowedEmails = await getActiveBusinessMemberEmails(ctx, business._id, business.owner_email);
        const normalizedAllowedEmails = new Set(
            [...allowedEmails]
                .map((email) => String(email || "").trim().toLowerCase())
                .filter(Boolean)
        );
        const businessId = String(business._id);

        const allCustomers = await ctx.db.query("customers").collect();
        return allCustomers.filter((customer: any) => {
            const customerBusinessId = customer?.business_id ? String(customer.business_id) : "";
            if (customerBusinessId && customerBusinessId === businessId) {
                return true;
            }

            const createdBy = String(customer?.created_by || "").trim().toLowerCase();
            return createdBy ? normalizedAllowedEmails.has(createdBy) : false;
        });
    }

    const normalizedUserEmail = String(userEmail || "").trim().toLowerCase();
    const allCustomers = await ctx.db.query("customers").collect();
    return allCustomers.filter((customer: any) =>
        String(customer?.created_by || "").trim().toLowerCase() === normalizedUserEmail
    );
}

async function canAccessCustomer(ctx: any, customer: any, userEmail: string): Promise<boolean> {
    if (!customer) return false;
    const customers = await listAccessibleCustomers(ctx, userEmail);
    return customers.some((item: any) => String(item._id) === String(customer._id));
}

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

        const customer = await ctx.db.get(args.id);
        if (!customer) throw new Error("Customer not found");

        const accessibleCustomers = await listAccessibleCustomers(ctx, identity.email!);
        const canAccess = accessibleCustomers.some((item: any) => String(item._id) === String(customer._id));
        if (!canAccess) {
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
        const business = await resolveBusinessContext(ctx, identity.email!);
        const createdBy = business ? business.owner_email : identity.email!;
        const businessId = business ? String(business._id) : undefined;

        const customerId = await ctx.db.insert("customers", {
            ...validatedData,
            created_by: createdBy,
            business_id: businessId,
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
        if (!(await canAccessCustomer(ctx, customer, identity.email!))) {
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
        if (!(await canAccessCustomer(ctx, customer, identity.email!))) {
            throw new Error("Access denied");
        }

        await ctx.db.delete(args.id);
    },
});
