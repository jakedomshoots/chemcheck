import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import {
    canAccessCreatedBy,
    ensureCustomerAccess,
    ensureNoteAccess,
    getAccessibleCustomerIds,
    resolveBusinessAccess,
} from "./authz";
import { enforceRateLimit } from "./rateLimit";

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

// List all notes for the current user's customers only (or general notes)
export const list = query({
    args: {
        order: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        const access = await resolveBusinessAccess(ctx, identity.email!);
        const userCustomerIds = await getAccessibleCustomerIds(ctx, access);
        const allNotes = await ctx.db.query("notes").collect();
        const userNotes = allNotes.filter((note: any) =>
            note.customer_id
                ? userCustomerIds.has(note.customer_id.toString())
                : canAccessCreatedBy(access, note.created_by),
        );

        // Sort after collecting
        userNotes.sort((a, b) => {
            const dateA = a.created_date || "";
            const dateB = b.created_date || "";
            if (args.order === "-created_date") {
                return dateB.localeCompare(dateA);
            }
            return dateA.localeCompare(dateB);
        });

        return userNotes;
    },
});

// Filter notes by criteria
export const filter = query({
    args: {
        customer_id: v.optional(v.id("customers")),
        completed: v.optional(v.boolean()),
        category: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        const access = await resolveBusinessAccess(ctx, identity.email!);
        const userCustomerIds = await getAccessibleCustomerIds(ctx, access);

        let userNotes;
        if (args.customer_id !== undefined) {
            await ensureCustomerAccess(ctx, args.customer_id, identity.email!, "read");
            userNotes = await ctx.db.query("notes")
                .withIndex("by_customer", (q) => q.eq("customer_id", args.customer_id!))
                .collect();
        } else {
            const allNotes = await ctx.db.query("notes").collect();
            userNotes = allNotes.filter((note: any) =>
                note.customer_id
                    ? userCustomerIds.has(note.customer_id.toString())
                    : canAccessCreatedBy(access, note.created_by),
            );
        }

        if (args.completed !== undefined) {
            userNotes = userNotes.filter((note: any) => note.completed === args.completed);
        }

        if (args.category) {
            return userNotes.filter((n) => n.category === args.category);
        }

        return userNotes;
    },
});

// Get notes for a specific customer (with ownership verification)
export const getByCustomer = query({
    args: { customer_id: v.id("customers") },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        // Verify customer belongs to current user (tenant isolation)
        await ensureCustomerAccess(ctx, args.customer_id, identity.email!, "read");

        const notes = await ctx.db
            .query("notes")
            .withIndex("by_customer", (q) => q.eq("customer_id", args.customer_id))
            .order("desc")
            .collect();

        return notes;
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
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        // Enforce rate limiting (database-backed for distributed rate limiting)
        await enforceRateLimit(ctx, identity.email!, 'note.create');

        // Validate category and priority
        validateCategory(args.category);
        validatePriority(args.priority);

        // If note is linked to a customer, verify ownership (tenant isolation)
        if (args.customer_id) {
            await ensureCustomerAccess(ctx, args.customer_id, identity.email!, "write");
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
        priority: v.optional(v.string()),
        completed: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        // Enforce rate limiting (database-backed for distributed rate limiting)
        await enforceRateLimit(ctx, identity.email!, 'note.create');

        // Verify note access (tenant isolation)
        await ensureNoteAccess(ctx, args.id, identity.email!, "write");

        if (args.customer_id) {
            await ensureCustomerAccess(ctx, args.customer_id, identity.email!, "write");
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
        await ensureNoteAccess(ctx, args.id, identity.email!, "write");

        await ctx.db.delete(args.id);
    },
});
