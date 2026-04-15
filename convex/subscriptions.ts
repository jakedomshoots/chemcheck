import { v } from "convex/values";
import { query, mutation, internalMutation, internalQuery } from "./_generated/server";

// Subscription status enum values
const subscriptionStatuses = v.union(
  v.literal("active"),
  v.literal("canceled"),
  v.literal("incomplete"),
  v.literal("incomplete_expired"),
  v.literal("past_due"),
  v.literal("trialing"),
  v.literal("unpaid")
);

// Get current user's subscription
export const get = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const subscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_user_email", (q) => q.eq("user_email", identity.email!))
      .first();

    return subscription;
  },
});

// Create or update subscription (called from webhook handler)
export const upsert = internalMutation({
  args: {
    user_email: v.string(),
    stripe_customer_id: v.string(),
    stripe_subscription_id: v.string(),
    plan_id: v.string(),
    status: subscriptionStatuses,
    current_period_start: v.number(),
    current_period_end: v.number(),
    cancel_at_period_end: v.boolean(),
    trial_end: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Check if subscription exists
    const existing = await ctx.db
      .query("subscriptions")
      .withIndex("by_stripe_subscription", (q) => 
        q.eq("stripe_subscription_id", args.stripe_subscription_id)
      )
      .first();

    if (existing) {
      // Update existing subscription
      await ctx.db.patch(existing._id, {
        status: args.status,
        plan_id: args.plan_id,
        current_period_start: args.current_period_start,
        current_period_end: args.current_period_end,
        cancel_at_period_end: args.cancel_at_period_end,
        trial_end: args.trial_end,
        updated_at: Date.now(),
      });
      return existing._id;
    } else {
      // Create new subscription
      return await ctx.db.insert("subscriptions", {
        ...args,
        created_at: Date.now(),
        updated_at: Date.now(),
      });
    }
  },
});

export const getByStripeSubscription = internalQuery({
  args: {
    stripe_subscription_id: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("subscriptions")
      .withIndex("by_stripe_subscription", (q) =>
        q.eq("stripe_subscription_id", args.stripe_subscription_id)
      )
      .first();
  },
});

export const getByStripeCustomer = internalQuery({
  args: {
    stripe_customer_id: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("subscriptions")
      .withIndex("by_stripe_customer", (q) =>
        q.eq("stripe_customer_id", args.stripe_customer_id)
      )
      .first();
  },
});

export const updateStatus = internalMutation({
  args: {
    subscription_id: v.id("subscriptions"),
    status: subscriptionStatuses,
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.subscription_id, {
      status: args.status,
      updated_at: Date.now(),
    });
  },
});

// Cancel subscription (mark as canceling at period end)
export const cancel = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const subscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_user_email", (q) => q.eq("user_email", identity.email!))
      .first();

    if (!subscription) {
      throw new Error("No subscription found");
    }

    await ctx.db.patch(subscription._id, {
      cancel_at_period_end: true,
      updated_at: Date.now(),
    });

    return { success: true };
  },
});

// Check if user has access to a feature based on their plan
export const checkFeatureAccess = query({
  args: {
    feature: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return false;

    const subscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_user_email", (q) => q.eq("user_email", identity.email!))
      .first();

    if (!subscription || !["active", "trialing"].includes(subscription.status)) {
      return false;
    }

    // Feature access by plan
    const featureAccess: Record<string, string[]> = {
      "route-optimization": ["professional", "business"],
      "chemical-tracking": ["professional", "business"],
      "advanced-reporting": ["professional", "business"],
      "api-access": ["business"],
      "white-label": ["business"],
      "custom-reporting": ["business"],
    };

    const requiredPlans = featureAccess[args.feature];
    if (!requiredPlans) return true; // Feature available to all

    return requiredPlans.includes(subscription.plan_id);
  },
});

// Check usage limits
export const checkLimit = query({
  args: {
    limitType: v.union(v.literal("users"), v.literal("customers")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { allowed: false, current: 0, limit: 0 };

    const subscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_user_email", (q) => q.eq("user_email", identity.email!))
      .first();

    // Plan limits
    const planLimits: Record<string, { users: number; customers: number }> = {
      starter: { users: 1, customers: 50 },
      professional: { users: 3, customers: 200 },
      business: { users: -1, customers: -1 }, // unlimited
    };

    const limits = subscription 
      ? planLimits[subscription.plan_id] || planLimits.starter
      : { users: 1, customers: 10 }; // Free tier

    const limit = limits[args.limitType];

    // Get current count
    let current = 0;
    if (args.limitType === "customers") {
      const customers = await ctx.db
        .query("customers")
        .withIndex("by_created_by", (q) => q.eq("created_by", identity.email!))
        .collect();
      current = customers.length;
    }

    return {
      allowed: limit === -1 || current < limit,
      current,
      limit: limit === -1 ? Infinity : limit,
    };
  },
});
