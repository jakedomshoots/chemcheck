import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { enforceRateLimit } from "./rateLimit";
import {
    getBusinessContext,
    requireBusinessContext,
    requireCustomerAccess,
    requireCustomerRole,
    requireUserEmail,
} from "./authorization";

const DEFAULT_PAGE_LIMIT = 100;
const MAX_PAGE_LIMIT = 500;
const NOTE_WRITE_ROLES = ["owner", "admin", "technician"] as const;

function boundedLimit(limit: number | undefined): number {
    if (limit === undefined) return DEFAULT_PAGE_LIMIT;
    if (limit > MAX_PAGE_LIMIT) return MAX_PAGE_LIMIT;
    if (limit < 1) return 1;
    return Math.floor(limit);
}

// Valid category values for notes
const VALID_CATEGORIES = ['general', 'equipment', 'chemical', 'customer', 'billing', 'maintenance', 'other'] as const;
type NoteCategory = typeof VALID_CATEGORIES[number];

// Valid priority values for notes
const VALID_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
type NotePriority = typeof VALID_PRIORITIES[number];

function validateCategory(category: string): void {
    if (!VALID_CATEGORIES.includes(category as NoteCategory)) {
        throw new Error(`Invalid category: "${category}". Must be one of: ${VALID_CATEGORIES.join(', ')}`);
    }
}

function validatePriority(priority: string): void {
    if (!VALID_PRIORITIES.includes(priority as NotePriority)) {
        throw new Error(`Invalid priority: "${priority}". Must be one of: ${VALID_PRIORITIES.join(', ')}`);
    }
}

// List all notes created by the current user, paginated.
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
        const noteQuery = (business
            ? ctx.db.query("notes").withIndex("by_business_and_created_date", (q: any) =>
                q.eq("business_id", business.businessId)
            )
            : ctx.db.query("notes").withIndex("by_created_by", (q: any) => q.eq("created_by", email)))
            .order(sortOrder);

        return await noteQuery.paginate({
            cursor: args.cursor || null,
            numItems: boundedLimit(args.limit),
        });
    },
});

// Filter notes by criteria, paginated.
export const filter = query({
    args: {
        customer_id: v.optional(v.id("customers")),
        completed: v.optional(v.boolean()),
        category: v.optional(v.string()),
        limit: v.optional(v.number()),
        cursor: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const email = await requireUserEmail(ctx);

        if (args.customer_id !== undefined) {
            // Verify ownership first
            const customer = await ctx.db.get(args.customer_id);
            if (!customer) {
                throw new Error("Customer not found or access denied");
            }
            await requireCustomerAccess(ctx, customer, email);
        }

        const business = await getBusinessContext(ctx, email);
        let noteQuery = business
            ? ctx.db.query("notes").withIndex("by_business", (q: any) => q.eq("business_id", business.businessId))
            : ctx.db.query("notes").withIndex("by_created_by", (q: any) => q.eq("created_by", email));

        if (args.customer_id !== undefined) {
            noteQuery = noteQuery.filter((q) => q.eq(q.field("customer_id"), args.customer_id!));
        } else if (args.completed !== undefined) {
            noteQuery = noteQuery.filter((q) => q.eq(q.field("completed"), args.completed!));
        }

        if (args.category) {
            noteQuery = noteQuery.filter((q) => q.eq(q.field("category"), args.category));
        }

        return await noteQuery.paginate({
            cursor: args.cursor || null,
            numItems: boundedLimit(args.limit),
        });
    },
});

// Get notes for a specific customer (with ownership verification), paginated.
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
            .query("notes")
            .withIndex("by_customer", (q) => q.eq("customer_id", args.customer_id))
            .order("desc")
            .paginate({
                cursor: args.cursor || null,
                numItems: boundedLimit(args.limit),
            });
    },
});

// Create a new note (with ownership verification for customer-linked notes)
export const create = mutation({
    args: {
        title: v.string(),
        content: v.string(),
        category: v.string(),
        customer_id: v.optional(v.id("customers")),
        priority: v.string(),
    },
    handler: async (ctx, args) => {
        const email = await requireUserEmail(ctx);

        // Enforce rate limiting (database-backed for distributed rate limiting)
        await enforceRateLimit(ctx, email, 'note.create');

        // Validate category and priority
        validateCategory(args.category);
        validatePriority(args.priority);

        // If note is linked to a customer, verify ownership (tenant isolation)
        let business;
        if (args.customer_id) {
            const customer = await ctx.db.get(args.customer_id);
            if (!customer) {
                throw new Error("Customer not found or access denied");
            }
            business = await requireCustomerRole(ctx, customer, email, NOTE_WRITE_ROLES);
        } else {
            business = await requireBusinessContext(ctx, email);
            if (business.role === "viewer") throw new Error("Insufficient role permissions");
        }

        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

        const noteId = await ctx.db.insert("notes", {
            ...args,
            completed: false,
            created_date: today,
            created_by: email,
            business_id: business?.businessId,
        });

        return noteId;
    },
});

// Update a note (with ownership verification)
export const update = mutation({
    args: {
        id: v.id("notes"),
        title: v.optional(v.string()),
        content: v.optional(v.string()),
        category: v.optional(v.string()),
        customer_id: v.optional(v.id("customers")),
        priority: v.optional(v.string()),
        completed: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const email = await requireUserEmail(ctx);

        // Enforce rate limiting (database-backed for distributed rate limiting)
        await enforceRateLimit(ctx, email, 'note.update');

        // Verify note access (tenant isolation)
        const note = await ctx.db.get(args.id);
        if (!note) throw new Error("Note not found");

        // SECURITY: Verify ownership - check both customer-linked and general notes
        let business;
        if (note.customer_id) {
            // Note is linked to a customer - verify customer ownership
            const customer = await ctx.db.get(note.customer_id);
            if (!customer) {
                throw new Error("Access denied");
            }
            business = await requireCustomerRole(ctx, customer, email, NOTE_WRITE_ROLES);
        } else {
            if (!note.business_id) {
                if (note.created_by !== email) throw new Error("Access denied");
            } else {
                business = await requireBusinessContext(ctx, email, String(note.business_id));
                if (business.role === "viewer") throw new Error("Insufficient role permissions");
            }
        }

        const { id, ...updates } = args;
        if (updates.customer_id && updates.customer_id !== note.customer_id) {
            const replacementCustomer = await ctx.db.get(updates.customer_id);
            if (!replacementCustomer) throw new Error("Customer not found or access denied");
            const replacementBusiness = await requireCustomerRole(ctx, replacementCustomer, email, NOTE_WRITE_ROLES);
            if (String(replacementBusiness?.businessId || "") !== String(business?.businessId || "")) {
                throw new Error("Notes cannot be moved between businesses");
            }
        }
        await ctx.db.patch(id, { ...updates, business_id: business?.businessId ?? note.business_id });

        return id;
    },
});

// Delete a note (with ownership verification)
export const remove = mutation({
    args: { id: v.id("notes") },
    handler: async (ctx, args) => {
        const email = await requireUserEmail(ctx);

        // Enforce rate limiting (database-backed for distributed rate limiting)
        await enforceRateLimit(ctx, email, 'note.delete');

        // Verify note access (tenant isolation)
        const note = await ctx.db.get(args.id);
        if (!note) throw new Error("Note not found");

        // SECURITY: Verify ownership - check both customer-linked and general notes
        if (note.customer_id) {
            // Note is linked to a customer - verify customer ownership
            const customer = await ctx.db.get(note.customer_id);
            if (!customer) {
                throw new Error("Access denied");
            }
            await requireCustomerRole(ctx, customer, email, NOTE_WRITE_ROLES);
        } else {
            if (!note.business_id) {
                if (note.created_by !== email) throw new Error("Access denied");
            } else {
                const business = await requireBusinessContext(ctx, email, String(note.business_id));
                if (business.role === "viewer") throw new Error("Insufficient role permissions");
            }
        }

        await ctx.db.delete(args.id);
    },
});
