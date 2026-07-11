import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { fetchProvider, requireStripeConfig } from "./providerConfig";

const STRIPE_API_BASE = "https://api.stripe.com/v1";
const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 500;

const subscriptionPlans = v.union(
  v.literal("starter"),
  v.literal("professional"),
  v.literal("business")
);
const subscriptionIntervals = v.union(v.literal("month"), v.literal("year"));
const subscriptionStatuses = v.union(
  v.literal("active"),
  v.literal("canceled"),
  v.literal("incomplete"),
  v.literal("incomplete_expired"),
  v.literal("past_due"),
  v.literal("trialing"),
  v.literal("unpaid")
);

function appUrl(path: string): string {
  const baseUrl = (process.env.APP_URL || "").trim().replace(/\/+$/, "");
  if (!baseUrl) throw new Error("Billing is not configured. Set APP_URL in Convex environment variables.");
  return `${baseUrl}${path}`;
}

function subscriptionPriceId(planId: "starter" | "professional" | "business", interval: "month" | "year"): string {
  const names = {
    starter: { month: "STRIPE_STARTER_MONTHLY_PRICE_ID", year: "STRIPE_STARTER_YEARLY_PRICE_ID" },
    professional: { month: "STRIPE_PROFESSIONAL_MONTHLY_PRICE_ID", year: "STRIPE_PROFESSIONAL_YEARLY_PRICE_ID" },
    business: { month: "STRIPE_BUSINESS_MONTHLY_PRICE_ID", year: "STRIPE_BUSINESS_YEARLY_PRICE_ID" },
  } as const;
  const priceId = (process.env[names[planId][interval]] || "").trim();
  if (!priceId.startsWith("price_")) {
    throw new Error(`Stripe price is not configured for ${planId}/${interval}.`);
  }
  return priceId;
}

async function stripeRequest(path: string, secretKey: string, form?: URLSearchParams): Promise<any> {
  const response = await fetchProvider(`${STRIPE_API_BASE}${path}`, {
    method: form ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: form?.toString(),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(typeof data?.error?.message === "string" ? data.error.message : `Stripe request failed (${response.status}).`);
  }
  return data;
}

async function currentBusiness(ctx: any, email: string) {
  const membership = await ctx.db
    .query("team_members")
    .withIndex("by_user_email", (q: any) => q.eq("user_email", email))
    .filter((q: any) => q.eq(q.field("is_active"), true))
    .first();
  if (membership) return await ctx.db.get(membership.business_id);
  return await ctx.db
    .query("businesses")
    .withIndex("by_owner_email", (q: any) => q.eq("owner_email", email))
    .first();
}

async function ownedBusiness(ctx: any, email: string) {
  return await ctx.db
    .query("businesses")
    .withIndex("by_owner_email", (q: any) => q.eq("owner_email", email))
    .first();
}

export const get = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) return null;
    const business = await currentBusiness(ctx, identity.email);
    if (!business) return null;
    return await ctx.db
      .query("subscriptions")
      .withIndex("by_business", (q) => q.eq("business_id", business._id))
      .first();
  },
});

export const getByBusiness = internalQuery({
  args: { business_id: v.id("businesses") },
  handler: async (ctx, args) => await ctx.db
    .query("subscriptions")
    .withIndex("by_business", (q) => q.eq("business_id", args.business_id))
    .first(),
});

export const upsert = internalMutation({
  args: {
    business_id: v.optional(v.id("businesses")),
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
    const existing = await ctx.db
      .query("subscriptions")
      .withIndex("by_stripe_subscription", (q) => q.eq("stripe_subscription_id", args.stripe_subscription_id))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        business_id: args.business_id ?? existing.business_id,
        user_email: args.user_email || existing.user_email,
        stripe_customer_id: args.stripe_customer_id,
        status: args.status,
        plan_id: args.plan_id,
        current_period_start: args.current_period_start,
        current_period_end: args.current_period_end,
        cancel_at_period_end: args.cancel_at_period_end,
        trial_end: args.trial_end,
        updated_at: Date.now(),
      });
      return existing._id;
    }
    return await ctx.db.insert("subscriptions", {
      ...args,
      created_at: Date.now(),
      updated_at: Date.now(),
    });
  },
});

export const getByStripeSubscription = internalQuery({
  args: { stripe_subscription_id: v.string() },
  handler: async (ctx, args) => await ctx.db
    .query("subscriptions")
    .withIndex("by_stripe_subscription", (q) => q.eq("stripe_subscription_id", args.stripe_subscription_id))
    .first(),
});

export const getByStripeCustomer = internalQuery({
  args: { stripe_customer_id: v.string() },
  handler: async (ctx, args) => await ctx.db
    .query("subscriptions")
    .withIndex("by_stripe_customer", (q) => q.eq("stripe_customer_id", args.stripe_customer_id))
    .first(),
});

export const updateStatus = internalMutation({
  args: { subscription_id: v.id("subscriptions"), status: subscriptionStatuses },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.subscription_id, { status: args.status, updated_at: Date.now() });
  },
});

/** Staged, resumable migration. Missing businesses are reported, never created. */
export const backfillBusinessId = mutation({
  args: {
    cursor: v.optional(v.string()),
    batch_size: v.optional(v.number()),
    dry_run: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) throw new Error("Not authenticated");
    if (!await ownedBusiness(ctx, identity.email)) {
      throw new Error("Only business owners can run the subscription migration.");
    }
    const page = await ctx.db.query("subscriptions").paginate({
      cursor: args.cursor ?? null,
      numItems: Math.max(1, Math.min(args.batch_size ?? DEFAULT_BATCH_SIZE, MAX_BATCH_SIZE)),
    });
    let linked = 0;
    let alreadyLinked = 0;
    let unlinked = 0;
    for (const subscription of page.page) {
      if (subscription.business_id) {
        alreadyLinked += 1;
        continue;
      }
      const business = await ownedBusiness(ctx, subscription.user_email);
      if (!business) {
        unlinked += 1;
        continue;
      }
      if (!args.dry_run) {
        await ctx.db.patch(subscription._id, { business_id: business._id, updated_at: Date.now() });
      }
      linked += 1;
    }
    return {
      processed: page.page.length,
      linked,
      already_linked: alreadyLinked,
      unlinked,
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

export const createCheckoutSession = action({
  args: { plan_id: subscriptionPlans, interval: subscriptionIntervals },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) throw new Error("Not authenticated");
    const business = await ownedBusiness(ctx, identity.email);
    if (!business) throw new Error("Only the business owner can manage subscriptions.");
    const { secretKey } = requireStripeConfig();
    const existingSubscription: any = await ctx.runQuery(internal.subscriptions.getByBusiness, { business_id: business._id });
    const form = new URLSearchParams({
      mode: "subscription",
      "line_items[0][price]": subscriptionPriceId(args.plan_id, args.interval),
      "line_items[0][quantity]": "1",
      success_url: appUrl("/pricing?checkout=success&session_id={CHECKOUT_SESSION_ID}"),
      cancel_url: appUrl("/pricing?checkout=cancelled"),
      client_reference_id: String(business._id),
      "metadata[business_id]": String(business._id),
      "metadata[user_email]": identity.email,
      "metadata[plan_id]": args.plan_id,
      "subscription_data[metadata][business_id]": String(business._id),
      "subscription_data[metadata][user_email]": identity.email,
      "subscription_data[metadata][plan_id]": args.plan_id,
      "subscription_data[trial_period_days]": "14",
    });
    if (existingSubscription?.stripe_customer_id) {
      form.set("customer", existingSubscription.stripe_customer_id);
    } else {
      form.set("customer_email", business.email || identity.email);
    }
    const session = await stripeRequest("/checkout/sessions", secretKey, form);
    if (typeof session?.url !== "string") throw new Error("Stripe Checkout did not return a URL.");
    return { url: session.url };
  },
});

export const createPortalSession = action({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) throw new Error("Not authenticated");
    const business = await ownedBusiness(ctx, identity.email);
    if (!business) throw new Error("Only the business owner can manage subscriptions.");
    const subscription: any = await ctx.runQuery(internal.subscriptions.getByBusiness, { business_id: business._id });
    if (!subscription?.stripe_customer_id) throw new Error("No Stripe billing customer exists for this business.");
    const { secretKey } = requireStripeConfig();
    const session = await stripeRequest("/billing_portal/sessions", secretKey, new URLSearchParams({
      customer: subscription.stripe_customer_id,
      return_url: appUrl("/pricing"),
    }));
    if (typeof session?.url !== "string") throw new Error("Stripe billing portal did not return a URL.");
    return { url: session.url };
  },
});

export const checkFeatureAccess = query({
  args: { feature: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) return false;
    const business = await currentBusiness(ctx, identity.email);
    if (!business) return false;
    const subscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_business", (q) => q.eq("business_id", business._id))
      .first();
    if (!subscription || !["active", "trialing"].includes(subscription.status)) return false;
    const featureAccess: Record<string, string[]> = {
      "route-optimization": ["professional", "business"],
      "chemical-tracking": ["professional", "business"],
      "advanced-reporting": ["professional", "business"],
      "api-access": ["business"],
      "white-label": ["business"],
      "custom-reporting": ["business"],
    };
    const requiredPlans = featureAccess[args.feature];
    return !requiredPlans || requiredPlans.includes(subscription.plan_id);
  },
});

export const checkLimit = query({
  args: { limitType: v.union(v.literal("users"), v.literal("customers")) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) return { allowed: false, current: 0, limit: 0 };
    const business = await currentBusiness(ctx, identity.email);
    if (!business) return { allowed: false, current: 0, limit: 0 };
    const subscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_business", (q) => q.eq("business_id", business._id))
      .first();
    const planLimits: Record<string, { users: number; customers: number }> = {
      starter: { users: 1, customers: 50 },
      professional: { users: 3, customers: 200 },
      business: { users: -1, customers: -1 },
    };
    const limits = subscription ? planLimits[subscription.plan_id] || planLimits.starter : { users: 1, customers: 10 };
    const limit = limits[args.limitType];
    let current = 0;
    if (args.limitType === "customers") {
      current = (await ctx.db
        .query("customers")
        .withIndex("by_business", (q) => q.eq("business_id", String(business._id)))
        .collect()).length;
    }
    return { allowed: limit === -1 || current < limit, current, limit: limit === -1 ? Infinity : limit };
  },
});
