import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { enforceRateLimit } from "./rateLimit";

// Helper: Get all customer IDs owned by the current user (for tenant isolation)
async function getUserCustomerIds(ctx: any, userEmail: string): Promise<Set<string>> {
    const customers = await ctx.db
        .query("customers")
        .withIndex("by_created_by", (q: any) => q.eq("created_by", userEmail))
        .collect();
    return new Set(customers.map((c: any) => c._id.toString()));
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

// List all notes for the current user's customers only (or general notes)
export const list = query({
    args: {
        order: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        // Get user's customer IDs for tenant isolation
        const userCustomerIds = await getUserCustomerIds(ctx, identity.email!);

        // Query records for each customer using index
        const customerNotePromises = Array.from(userCustomerIds).map(customerId =>
            ctx.db.query("notes")
                .withIndex("by_customer", (q) => q.eq("customer_id", customerId as any))
                .collect()
        );

        // Query general notes created by this user
        const generalNotePromise = ctx.db.query("notes")
            .withIndex("by_created_by", (q) => q.eq("created_by", identity.email!))
            .filter(q => q.eq(q.field("customer_id"), undefined))
            .collect();

        const [customerNotesResults, generalNotes] = await Promise.all([
            Promise.all(customerNotePromises),
            generalNotePromise
        ]);

        const userNotes = [...customerNotesResults.flat(), ...generalNotes];

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

        // Get user's customer IDs for tenant isolation
        const userCustomerIds = await getUserCustomerIds(ctx, identity.email!);

        let userNotes;
        if (args.customer_id !== undefined) {
            // Verify ownership first
            const customer = await ctx.db.get(args.customer_id);
            if (!customer || customer.created_by !== identity.email) {
                throw new Error("Customer not found or access denied");
            }
            userNotes = await ctx.db.query("notes")
                .withIndex("by_customer", (q) => q.eq("customer_id", args.customer_id!))
                .collect();
        } else if (args.completed !== undefined) {
            // Parallel indexed queries per customer
            const customerNotePromises = Array.from(userCustomerIds).map(customerId =>
                ctx.db.query("notes")
                    .withIndex("by_customer", (q) => q.eq("customer_id", customerId as any))
                    .filter(q => q.eq(q.field("completed"), args.completed!))
                    .collect()
            );

            // General notes for this user
            const generalNotePromise = ctx.db.query("notes")
                .withIndex("by_created_by", (q) => q.eq("created_by", identity.email!))
                .filter(q => q.eq(q.field("customer_id"), undefined) && q.eq(q.field("completed"), args.completed!))
                .collect();

            const [customerNotesResults, generalNotes] = await Promise.all([
                Promise.all(customerNotePromises),
                generalNotePromise
            ]);
            userNotes = [...customerNotesResults.flat(), ...generalNotes];
        } else {
            // Same as list pattern
            const customerNotePromises = Array.from(userCustomerIds).map(customerId =>
                ctx.db.query("notes")
                    .withIndex("by_customer", (q) => q.eq("customer_id", customerId as any))
                    .collect()
            );
            const generalNotes = await ctx.db.query("notes")
                .withIndex("by_created_by", (q) => q.eq("created_by", identity.email!))
                .filter(q => q.eq(q.field("customer_id"), undefined))
                .collect();

            const customerNotesResults = await Promise.all(customerNotePromises);
            userNotes = [...customerNotesResults.flat(), ...generalNotes];
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
        const customer = await ctx.db.get(args.customer_id);
        if (!customer || customer.created_by !== identity.email) {
            throw new Error("Customer not found or access denied");
        }

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
            const customer = await ctx.db.get(args.customer_id);
            if (!customer || customer.created_by !== identity.email) {
                throw new Error("Customer not found or access denied");
            }
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
        const note = await ctx.db.get(args.id);
        if (!note) throw new Error("Note not found");

        // SECURITY: Verify ownership - check both customer-linked and general notes
        if (note.customer_id) {
            // Note is linked to a customer - verify customer ownership
            const customer = await ctx.db.get(note.customer_id);
            if (!customer || customer.created_by !== identity.email) {
                throw new Error("Access denied");
            }
        } else {
            // General note (no customer_id) - verify created_by matches user
            if (note.created_by !== identity.email) {
                throw new Error("Access denied: cannot modify another user's note");
            }
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

        // SECURITY: Verify ownership - check both customer-linked and general notes
        if (note.customer_id) {
            // Note is linked to a customer - verify customer ownership
            const customer = await ctx.db.get(note.customer_id);
            if (!customer || customer.created_by !== identity.email) {
                throw new Error("Access denied");
            }
        } else {
            // General note (no customer_id) - verify created_by matches user
            if (note.created_by !== identity.email) {
                throw new Error("Access denied: cannot delete another user's note");
            }
        }

        await ctx.db.delete(args.id);
    },
});
