import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { enforceRateLimit } from "./rateLimit";
import { NOT_DELETED_FILTER } from "./sync";
import {
    canAccessCustomerRecord,
    findActiveMembership,
    normalizeEmail,
    resolveBusinessForEmail,
} from "./entitlements";

type DbCtx = Pick<MutationCtx | QueryCtx, "db">;

/**
 * Owner-or-same-business check for a record that carries its own
 * `created_by` (general notes). Mirrors canAccessCustomerRecord: the creator
 * themselves, the owner of the caller's business, or an ACTIVE member of it.
 */
export async function canAccessOwnedRecord(
    ctx: DbCtx,
    createdBy: string | undefined | null,
    email: string
): Promise<boolean> {
    const callerEmail = normalizeEmail(email);
    const owner = normalizeEmail(createdBy);
    if (!owner) return false;
    if (owner === callerEmail) return true;

    const business = await resolveBusinessForEmail(ctx, email);
    if (!business) return false;
    if (owner === normalizeEmail(business.owner_email)) return true;
    const creatorMembership = await findActiveMembership(ctx, owner, business._id);
    return Boolean(creatorMembership);
}

/**
 * Tenant check for one note. Customer-linked notes follow the customer;
 * general notes follow their creator. A general note with no owner at all is
 * a legacy row that the backfill migration has not reached yet: it is never
 * readable or writable through the API until it has an owner.
 */
export async function canAccessNote(
    ctx: DbCtx,
    note: Pick<Doc<"notes">, "customer_id" | "created_by"> | null | undefined,
    email: string
): Promise<boolean> {
    if (!note) return false;
    if (note.customer_id) {
        const customer = await ctx.db.get(note.customer_id);
        return canAccessCustomerRecord(ctx, customer, email);
    }
    return canAccessOwnedRecord(ctx, note.created_by, email);
}

async function assertCustomerAccess(ctx: DbCtx, customerId: Id<"customers">, userEmail: string): Promise<Doc<"customers">> {
    const customer = await ctx.db.get(customerId);
    if (!customer || customer.deleted_at !== undefined || !(await canAccessCustomerRecord(ctx, customer, userEmail))) {
        throw new Error("Customer not found or access denied");
    }
    return customer;
}

const DEFAULT_PAGE_LIMIT = 100;
const MAX_PAGE_LIMIT = 500;

function boundedLimit(limit: number | undefined): number {
    if (limit === undefined) return DEFAULT_PAGE_LIMIT;
    if (limit > MAX_PAGE_LIMIT) return MAX_PAGE_LIMIT;
    if (limit < 1) return 1;
    return Math.floor(limit);
}

async function recordsOwnerEmail(ctx: any, email: string): Promise<string> {
    const business = await resolveBusinessForEmail(ctx, email);
    return business?.owner_email || email;
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
        const ownerEmail = await recordsOwnerEmail(ctx, identity.email!);
        const noteQuery = ctx.db
            .query("notes")
            .withIndex("by_created_by", (q) => q.eq("created_by", ownerEmail))
            .filter(NOT_DELETED_FILTER)
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
            // Verify ownership first (owner or same business)
            await assertCustomerAccess(ctx, args.customer_id, identity.email!);
        }

        if (args.pool_id) {
            const pool = await ctx.db.get(args.pool_id);
            if (!pool || (args.customer_id && pool.customer_id !== args.customer_id)) throw new Error("Pool not found or does not belong to customer");
        }

        const ownerEmail = await recordsOwnerEmail(ctx, identity.email!);
        let noteQuery = ctx.db
            .query("notes")
            .withIndex("by_created_by", (q) => q.eq("created_by", ownerEmail))
            .filter(NOT_DELETED_FILTER);

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

        // Verify customer belongs to current user or their business (tenant isolation)
        await assertCustomerAccess(ctx, args.customer_id, identity.email!);

        return await ctx.db
            .query("notes")
            .withIndex("by_customer", (q) => q.eq("customer_id", args.customer_id))
            .filter(NOT_DELETED_FILTER)
            .order("desc")
            .paginate({
                cursor: args.cursor || null,
                numItems: boundedLimit(args.limit),
            });
    },
});

// Fetch one note. Owner-or-same-business for general notes, customer access
// for customer-linked notes. Returns null (not an error) for rows the caller
// may not see, so a stale local id never reveals whether a note exists.
export const get = query({
    args: { id: v.id("notes") },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        const note = await ctx.db.get(args.id);
        if (!note || note.deleted_at !== undefined) return null;
        if (!(await canAccessNote(ctx, note, identity.email!))) return null;
        return note;
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
            await assertCustomerAccess(ctx, args.customer_id, identity.email!);
        }

        if (args.pool_id) {
            const pool = await ctx.db.get(args.pool_id);
            if (!pool || (args.customer_id && pool.customer_id !== args.customer_id)) throw new Error("Pool not found or does not belong to customer");
        }

        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const recordOwnerEmail = args.customer_id ? (await ctx.db.get(args.customer_id))?.created_by : identity.email!;

        const noteId = await ctx.db.insert("notes", {
            ...args,
            completed: false,
            created_date: today,
            // Every note is stamped with an owner so general notes stay scoped to
            // the account that wrote them; customer-linked notes follow the customer's owner.
            created_by: recordOwnerEmail || identity.email!,
            created_at: now.getTime(),
            updated_at: now.getTime(),
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
        if (!note || note.deleted_at !== undefined) throw new Error("Note not found");

        // SECURITY: owner-or-same-business for both customer-linked and general notes
        if (!(await canAccessNote(ctx, note, identity.email!))) {
            throw new Error("Access denied: cannot modify another user's note");
        }

        const { id, ...updates } = args;
        if (updates.category !== undefined) validateCategory(updates.category);
        if (updates.priority !== undefined) validatePriority(updates.priority);

        // Re-homing a note onto a customer requires access to that customer too.
        if (updates.customer_id !== undefined && updates.customer_id !== note.customer_id) {
            await assertCustomerAccess(ctx, updates.customer_id, identity.email!);
        }

        await ctx.db.patch(id, { ...updates, updated_at: Date.now() });

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

        // SECURITY: owner-or-same-business for both customer-linked and general notes
        if (!(await canAccessNote(ctx, note, identity.email!))) {
            throw new Error("Access denied: cannot delete another user's note");
        }

        // Tombstone instead of hard delete so offline devices drop the row on pull.
        const now = Date.now();
        await ctx.db.patch(args.id, { deleted_at: now, updated_at: now });
    },
});
