import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { enforceRateLimit } from "./rateLimit";
import { FIELD_WRITE_ROLES, assertCustomerAccess, normalizeEmail } from "./access";

async function assertNoteAccess(ctx: any, note: any, userEmail: string): Promise<void> {
    if (note.customer_id) {
        // Customer-linked notes are shared with the customer's team.
        await assertCustomerAccess(ctx, note.customer_id, userEmail, { roles: FIELD_WRITE_ROLES });
    } else if (normalizeEmail(note.created_by) !== normalizeEmail(userEmail)) {
        // General notes are private to their author.
        throw new Error("Access denied: cannot modify another user's note");
    }
}

const DEFAULT_PAGE_LIMIT = 100;
const MAX_PAGE_LIMIT = 500;

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
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        const sortOrder = args.order === "-created_date" ? "desc" : "asc";
        const noteQuery = ctx.db
            .query("notes")
            .withIndex("by_created_by", (q) => q.eq("created_by", identity.email!))
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
        pool_id: v.optional(v.id("pools")),
        completed: v.optional(v.boolean()),
        category: v.optional(v.string()),
        limit: v.optional(v.number()),
        cursor: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        if (args.customer_id !== undefined) {
            // Verify access first
            await assertCustomerAccess(ctx, args.customer_id, identity.email!);
        }

        if (args.pool_id) {
            const pool = await ctx.db.get(args.pool_id);
            if (!pool || (args.customer_id && pool.customer_id !== args.customer_id)) throw new Error("Pool not found or does not belong to customer");
        }

        let noteQuery = ctx.db
            .query("notes")
            .withIndex("by_created_by", (q) => q.eq("created_by", identity.email!));

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
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        // Verify customer belongs to the caller's tenant (creator or active member)
        await assertCustomerAccess(ctx, args.customer_id, identity.email!);

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
        pool_id: v.optional(v.id("pools")),
        priority: v.string(),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        // Enforce rate limiting (database-backed for distributed rate limiting)
        await enforceRateLimit(ctx, identity.email!, 'note.create');

        // Validate category and priority
        validateCategory(args.category);
        validatePriority(args.priority);

        // If note is linked to a customer, verify ownership (tenant isolation)
        if (args.customer_id) {
            await assertCustomerAccess(ctx, args.customer_id, identity.email!, { roles: FIELD_WRITE_ROLES });
        }

        if (args.pool_id) {
            const pool = await ctx.db.get(args.pool_id);
            if (!pool || (args.customer_id && pool.customer_id !== args.customer_id)) throw new Error("Pool not found or does not belong to customer");
        }

        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

        const noteId = await ctx.db.insert("notes", {
            ...args,
            completed: false,
            created_date: today,
            created_by: identity.email!,
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
        pool_id: v.optional(v.id("pools")),
        priority: v.optional(v.string()),
        completed: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        // Enforce rate limiting (database-backed for distributed rate limiting)
        await enforceRateLimit(ctx, identity.email!, 'note.create');

        // Verify note access (tenant isolation)
        const note = await ctx.db.get(args.id);
        if (!note) throw new Error("Note not found");

        // SECURITY: Verify access - check both customer-linked and general notes
        await assertNoteAccess(ctx, note, identity.email!);
        // Re-linking a note to another customer requires access to that customer too.
        if (args.customer_id && args.customer_id !== note.customer_id) {
            await assertCustomerAccess(ctx, args.customer_id, identity.email!, { roles: FIELD_WRITE_ROLES });
        }

        const { id, ...updates } = args;
        await ctx.db.patch(id, updates);

        return id;
    },
});

// Delete a note (with ownership verification)
export const remove = mutation({
    args: { id: v.id("notes") },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        // Enforce rate limiting (database-backed for distributed rate limiting)
        await enforceRateLimit(ctx, identity.email!, 'note.create');

        // Verify note access (tenant isolation)
        const note = await ctx.db.get(args.id);
        if (!note) throw new Error("Note not found");

        // SECURITY: Verify access - check both customer-linked and general notes
        await assertNoteAccess(ctx, note, identity.email!);

        await ctx.db.delete(args.id);
    },
});
