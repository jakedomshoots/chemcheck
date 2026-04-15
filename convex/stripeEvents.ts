import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const getByEventId = internalQuery({
  args: {
    event_id: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("stripeWebhookEvents")
      .withIndex("by_event_id", (q) => q.eq("event_id", args.event_id))
      .first();
  },
});

export const recordProcessing = internalMutation({
  args: {
    event_id: v.string(),
    event_type: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("stripeWebhookEvents")
      .withIndex("by_event_id", (q) => q.eq("event_id", args.event_id))
      .first();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        event_type: args.event_type,
        status: "processing",
        attempts: (existing.attempts || 0) + 1,
        updated_at: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("stripeWebhookEvents", {
      event_id: args.event_id,
      event_type: args.event_type,
      status: "processing",
      attempts: 1,
      last_error: undefined,
      processed_at: undefined,
      created_at: now,
      updated_at: now,
    });
  },
});

export const recordProcessed = internalMutation({
  args: {
    event_id: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("stripeWebhookEvents")
      .withIndex("by_event_id", (q) => q.eq("event_id", args.event_id))
      .first();
    if (!existing) return null;

    const now = Date.now();
    await ctx.db.patch(existing._id, {
      status: "processed",
      processed_at: now,
      updated_at: now,
      last_error: undefined,
    });
    return existing._id;
  },
});

export const recordFailed = internalMutation({
  args: {
    event_id: v.string(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("stripeWebhookEvents")
      .withIndex("by_event_id", (q) => q.eq("event_id", args.event_id))
      .first();
    if (!existing) return null;

    await ctx.db.patch(existing._id, {
      status: "failed",
      last_error: args.error.slice(0, 500),
      updated_at: Date.now(),
    });
    return existing._id;
  },
});
