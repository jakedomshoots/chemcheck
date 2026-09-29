import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { resolveBusinessForUser } from "./access";

// Resolve the caller's business the same way businesses.getCurrent does:
// accepted team membership first, then ownership.
async function resolveBusiness(ctx: any) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.email) return null;

  const business = await resolveBusinessForUser(ctx, identity.email);
  return business ? { business, email: identity.email as string } : null;
}

export const listForWeek = query({
  args: { weekStart: v.string() },
  handler: async (ctx, args) => {
    const resolved = await resolveBusiness(ctx);
    if (!resolved) return [];

    const rows = await ctx.db
      .query("skippedStops")
      .withIndex("by_business_and_week", (q) =>
        q.eq("business_id", resolved.business._id).eq("week_start", args.weekStart)
      )
      .collect();

    return rows.map((row) => ({
      customer_key: row.customer_key,
      created_by: row.created_by,
      created_at: row.created_at,
    }));
  },
});

export const skip = mutation({
  args: { customerKey: v.string(), weekStart: v.string() },
  handler: async (ctx, args) => {
    const resolved = await resolveBusiness(ctx);
    if (!resolved) throw new Error("Not authorized");

    const existing = await ctx.db
      .query("skippedStops")
      .withIndex("by_business_week_customer", (q) =>
        q
          .eq("business_id", resolved.business._id)
          .eq("week_start", args.weekStart)
          .eq("customer_key", args.customerKey)
      )
      .first();

    if (existing) return existing._id;

    return await ctx.db.insert("skippedStops", {
      business_id: resolved.business._id,
      customer_key: args.customerKey,
      week_start: args.weekStart,
      created_by: resolved.email,
      created_at: Date.now(),
    });
  },
});

export const unskip = mutation({
  args: { customerKey: v.string(), weekStart: v.string() },
  handler: async (ctx, args) => {
    const resolved = await resolveBusiness(ctx);
    if (!resolved) throw new Error("Not authorized");

    const rows = await ctx.db
      .query("skippedStops")
      .withIndex("by_business_week_customer", (q) =>
        q
          .eq("business_id", resolved.business._id)
          .eq("week_start", args.weekStart)
          .eq("customer_key", args.customerKey)
      )
      .collect();

    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
  },
});
