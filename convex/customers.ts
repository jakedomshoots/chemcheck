import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { enforceRateLimit } from "./rateLimit";
import { validateCustomerCreate, validateCustomerUpdate } from "./validation";

const CUSTOMER_WRITE_ROLES = new Set(["owner", "admin"]);

function normalizeEmail(email: any): string {
    return String(email || "").trim().toLowerCase();
}

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
    const normalizedEmail = normalizeEmail(userEmail);
    if (!normalizedEmail) {
        throw new Error("listAccessibleCustomers: userEmail is empty or undefined. Check that the Clerk JWT includes an email claim.");
    }

    const business = await resolveBusinessContext(ctx, userEmail);

    if (business) {
        return await ctx.db
            .query("customers")
            .withIndex("by_business", (q: any) => q.eq("business_id", String(business._id)))
            .collect();
    }

    return await ctx.db
        .query("customers")
        .withIndex("by_created_by", (q: any) => q.eq("created_by", userEmail))
        .collect();
}

async function canAccessCustomer(ctx: any, customer: any, userEmail: string): Promise<boolean> {
    if (!customer) return false;

    const business = await resolveBusinessContext(ctx, userEmail);
    if (business) {
        return String(customer.business_id || "") === String(business._id);
    }

    const normalizedUserEmail = normalizeEmail(userEmail);
    const createdBy = normalizeEmail(customer.created_by);
    return createdBy === normalizedUserEmail;
}

async function getBusinessRole(ctx: any, business: any, userEmail: string): Promise<string | null> {
    const normalizedUserEmail = normalizeEmail(userEmail);
    const ownerEmail = normalizeEmail(business?.owner_email);
    if (ownerEmail && normalizedUserEmail === ownerEmail) {
        return "owner";
    }

    const member = await ctx.db
        .query("team_members")
        .withIndex("by_user_email", (q: any) => q.eq("user_email", userEmail))
        .filter((q: any) =>
            q.and(
                q.eq(q.field("business_id"), business._id),
                q.eq(q.field("is_active"), true)
            )
        )
        .first();

    return member?.role || null;
}

async function assertBusinessRole(ctx: any, userEmail: string, allowedRoles: Set<string>): Promise<void> {
    const business = await resolveBusinessContext(ctx, userEmail);
    if (!business) return;

    const role = await getBusinessRole(ctx, business, userEmail);
    if (!role || !allowedRoles.has(role)) {
        throw new Error("Insufficient role permissions");
    }
}

// Count accessible customers for the current user, bounded by a safe cap.
export const count = query({
    args: {},
    handler: async (ctx) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        const COUNT_CAP = 1000;
        const business = await resolveBusinessContext(ctx, identity.email!);

        let customers;
        if (business) {
            customers = await ctx.db
                .query("customers")
                .withIndex("by_business", (q: any) => q.eq("business_id", String(business._id)))
                .take(COUNT_CAP + 1);
        } else {
            customers = await ctx.db
                .query("customers")
                .withIndex("by_created_by", (q: any) => q.eq("created_by", identity.email!))
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
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        const customers = await listAccessibleCustomers(ctx, identity.email!);
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
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        const limit = Math.max(1, Math.min(args.limit ?? 50, 200));
        const business = await resolveBusinessContext(ctx, identity.email!);

        let result: any;
        if (business) {
            result = await ctx.db
                .query("customers")
                .withIndex("by_business", (q: any) => q.eq("business_id", String(business._id)))
                .paginate({ cursor: args.cursor ?? null, numItems: limit });
        } else {
            result = await ctx.db
                .query("customers")
                .withIndex("by_created_by", (q: any) => q.eq("created_by", identity.email!))
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
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        // Ignore created_by input and enforce tenant-safe lookup on the server.
        const business = await resolveBusinessContext(ctx, identity.email!);

        if (business) {
            if (args.service_day) {
                return await ctx.db
                    .query("customers")
                    .withIndex("by_business_and_day", (q: any) =>
                        q.eq("business_id", String(business._id)).eq("service_day", args.service_day)
                    )
                    .collect();
            }

            return await ctx.db
                .query("customers")
                .withIndex("by_business", (q: any) => q.eq("business_id", String(business._id)))
                .collect();
        }

        if (args.service_day) {
            return await ctx.db
                .query("customers")
                .withIndex("by_created_by_and_service_day" as any, (q: any) =>
                    q.eq("created_by", identity.email!).eq("service_day", args.service_day)
                )
                .collect();
        }

        return await ctx.db
            .query("customers")
            .withIndex("by_created_by", (q: any) => q.eq("created_by", identity.email!))
            .collect();
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

        if (!(await canAccessCustomer(ctx, customer, identity.email!))) {
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
        await assertBusinessRole(ctx, identity.email!, CUSTOMER_WRITE_ROLES);

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
        await assertBusinessRole(ctx, identity.email!, CUSTOMER_WRITE_ROLES);

        await ctx.db.delete(args.id);
    },
});
