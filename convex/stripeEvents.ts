import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

/** How long a "processing" claim blocks concurrent deliveries of the same event. */
export const PROCESSING_LEASE_MS = 5 * 60 * 1000;

export type ClaimDecision = "claim" | "duplicate" | "in_progress";

/** Pure decision for an incoming delivery given the stored event row. */
export function decideEventClaim(
  existing: { status: string; updated_at: number } | null | undefined,
  now: number
): ClaimDecision {
  if (!existing) return "claim";
  if (existing.status === "processed") return "duplicate";
  if (existing.status === "processing" && now - existing.updated_at < PROCESSING_LEASE_MS) return "in_progress";
  return "claim";
}

/**
 * Atomically claim a webhook event (insert-if-absent in one mutation), so two
 * concurrent deliveries cannot both process it. Convex mutations are
 * serializable, so the read and the write below cannot interleave.
 */
export const claimEvent = internalMutation({
  args: {
    event_id: v.string(),
    event_type: v.string(),
  },
  handler: async (ctx, args): Promise<{ decision: ClaimDecision }> => {
    const existing = await ctx.db
      .query("stripeWebhookEvents")
      .withIndex("by_event_id", (q) => q.eq("event_id", args.event_id))
      .first();

    const now = Date.now();
    const decision = decideEventClaim(existing, now);
    if (decision !== "claim") return { decision };

    if (existing) {
      await ctx.db.patch(existing._id, {
        event_type: args.event_type,
        status: "processing",
        attempts: (existing.attempts || 0) + 1,
        updated_at: now,
      });
      return { decision };
    }

    await ctx.db.insert("stripeWebhookEvents", {
      event_id: args.event_id,
      event_type: args.event_type,
      status: "processing",
      attempts: 1,
      last_error: undefined,
      processed_at: undefined,
      created_at: now,
      updated_at: now,
    });
    return { decision };
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
