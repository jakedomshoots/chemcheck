import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

// List all notes (with optional ordering)
export const list = query({
    args: {
        order: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        const notes = await ctx.db
            .query("notes")
            .order(args.order === "-created_date" ? "desc" : "asc")
            .collect();

        return notes;
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

        let query = ctx.db.query("notes");

        if (args.customer_id !== undefined) {
            query = query.withIndex("by_customer", (q) =>
                q.eq("customer_id", args.customer_id!)
            );
        } else if (args.completed !== undefined) {
            query = query.withIndex("by_completed", (q) =>
                q.eq("completed", args.completed!)
            );
        }

        const notes = await query.collect();

        if (args.category) {
            return notes.filter((n) => n.category === args.category);
        }

        return notes;
    },
});

// Get notes for a specific customer
export const getByCustomer = query({
    args: { customer_id: v.id("customers") },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        const notes = await ctx.db
            .query("notes")
            .withIndex("by_customer", (q) => q.eq("customer_id", args.customer_id))
            .order("desc")
            .collect();

        return notes;
    },
});

// Create a new note
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

        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

        const noteId = await ctx.db.insert("notes", {
            ...args,
            completed: false,
            created_date: today,
        });

        return noteId;
    },
});

// Update a note
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

        const { id, ...updates } = args;
        await ctx.db.patch(id, updates);

        return id;
    },
});

// Delete a note
export const remove = mutation({
    args: { id: v.id("notes") },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        await ctx.db.delete(args.id);
    },
});
