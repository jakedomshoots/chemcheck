import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { requireSquarePlatformConfig } from "./providerConfig";
import { getAccessContext, normalizeEmail, resolveBusinessForUser } from "./access";
import { enforceRateLimit } from "./rateLimit";
import { getCustomerUsage, limitsForSubscription } from "./planLimits";
import { buildPaymentLinkBody, parsePaymentLinkResponse, squareRequest } from "./squareApi";
import {
  decideSubscriptionTarget,
  isEntitledStatus,
  planPriceCents,
  shouldApplyEvent,
  subscriptionFieldsFromSquare,
  variationIdFor,
  wouldResurrect,
} from "./squareSubscriptionState";

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 500;
const CHECKOUT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MANAGER_ROLES = new Set(["owner", "admin"]);

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

const PLAN_NAMES = { starter: "Starter", professional: "Professional", business: "Business" } as const;

function appUrl(path: string): string {
  const baseUrl = (process.env.APP_URL || "").trim().replace(/\/+$/, "");
  if (!baseUrl) throw new Error("Billing is not configured. Set APP_URL in Convex environment variables.");
  return `${baseUrl}${path}`;
}

function requireVariationId(planId: "starter" | "professional" | "business", interval: "month" | "year"): string {
  const variationId = variationIdFor(planId, interval, process.env as Record<string, string | undefined>);
  if (!variationId) throw new Error(`Square subscription plan is not configured for ${planId}/${interval}.`);
  return variationId;
}

async function currentBusiness(ctx: any, email: string) {
  // Only accepted (active) memberships count; pending invites never grant access.
  return await resolveBusinessForUser(ctx, email);
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

const squareFieldsValidator = {
  square_subscription_id: v.string(),
  square_customer_id: v.optional(v.string()),
  square_plan_variation_id: v.optional(v.string()),
  square_status: v.string(),
  // Omitted when the variation is not a configured plan; the stored plan is then kept.
  plan_id: v.optional(v.string()),
  status: subscriptionStatuses,
  current_period_start: v.optional(v.number()),
  current_period_end: v.optional(v.number()),
  cancel_at_period_end: v.boolean(),
};

/**
 * Apply a Square subscription snapshot. Out-of-order events (older than the
 * last applied one) are ignored, CANCELED/DEACTIVATED subscriptions are never
 * resurrected, and a business keeps one subscription row.
 */
export const upsertFromSquare = internalMutation({
  args: {
    ...squareFieldsValidator,
    // Resolved by the webhook from the stored checkout; required for new rows.
    business_id: v.optional(v.id("businesses")),
    // Square event created_at in ms.
    event_created: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ applied: boolean; reason?: string; id?: Id<"subscriptions"> }> => {
    const now = Date.now();
    const { business_id, event_created, ...fields } = args;
    const existing = await ctx.db
      .query("subscriptions")
      .withIndex("by_square_subscription", (q) => q.eq("square_subscription_id", args.square_subscription_id))
      .first();

    if (existing) {
      if (!shouldApplyEvent(existing.last_event_created, event_created)) {
        return { applied: false, reason: "stale_event", id: existing._id };
      }
      if (wouldResurrect(existing.square_status, fields.square_status)) {
        return { applied: false, reason: "terminal", id: existing._id };
      }
      await ctx.db.patch(existing._id, {
        ...fields,
        plan_id: fields.plan_id ?? existing.plan_id,
        current_period_start: fields.current_period_start ?? existing.current_period_start,
        current_period_end: fields.current_period_end ?? existing.current_period_end,
        last_event_created: event_created ?? existing.last_event_created,
        updated_at: now,
      });
      return { applied: true, id: existing._id };
    }

    if (!business_id) return { applied: false, reason: "unlinked" };
    const business = await ctx.db.get(business_id);
    if (!business) return { applied: false, reason: "unknown_business" };

    const current = await ctx.db
      .query("subscriptions")
      .withIndex("by_business", (q) => q.eq("business_id", business_id))
      .first();
    const target = decideSubscriptionTarget(current, { status: fields.status, event_created });
    if (target === "skip") return { applied: false, reason: "superseded" };

    const row = {
      ...fields,
      provider: "square",
      business_id,
      user_email: business.owner_email,
      plan_id: fields.plan_id ?? "starter",
      current_period_start: fields.current_period_start ?? now,
      current_period_end: fields.current_period_end ?? now,
      trial_end: undefined,
      last_event_created: event_created,
      updated_at: now,
    };
    if (target === "replace" && current) {
      // Legacy stripe_* ids are left in place as history.
      await ctx.db.patch(current._id, row);
      return { applied: true, id: current._id };
    }
    const id = await ctx.db.insert("subscriptions", { ...row, created_at: now });
    return { applied: true, id };
  },
});

export const getBySquareSubscription = internalQuery({
  args: { square_subscription_id: v.string() },
  handler: async (ctx, args) => await ctx.db
    .query("subscriptions")
    .withIndex("by_square_subscription", (q) => q.eq("square_subscription_id", args.square_subscription_id))
    .first(),
});

export const updateStatus = internalMutation({
  args: {
    subscription_id: v.id("subscriptions"),
    status: subscriptionStatuses,
    event_created: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.subscription_id);
    if (!existing) return { applied: false };
    if (!shouldApplyEvent(existing.last_event_created, args.event_created)) {
      return { applied: false };
    }
    await ctx.db.patch(args.subscription_id, {
      status: args.status,
      last_event_created: args.event_created ?? existing.last_event_created,
      updated_at: Date.now(),
    });
    return { applied: true };
  },
});

// ---------------------------------------------------------------------------
// Checkout <-> business linking
// ---------------------------------------------------------------------------

export const recordCheckout = internalMutation({
  args: {
    business_id: v.id("businesses"),
    user_email: v.string(),
    buyer_email: v.string(),
    plan_id: v.string(),
    interval: v.string(),
    plan_variation_id: v.string(),
    payment_link_id: v.string(),
    order_id: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("squareSubscriptionCheckouts")
      .withIndex("by_order_id", (q) => q.eq("order_id", args.order_id))
      .first();
    const now = Date.now();
    if (existing) {
      // Same idempotent link: only refresh the expiry, never re-point it.
      if (String(existing.business_id) === String(args.business_id)) {
        await ctx.db.patch(existing._id, { expires_at: now + CHECKOUT_TTL_MS, updated_at: now });
      }
      return existing._id;
    }
    return await ctx.db.insert("squareSubscriptionCheckouts", {
      ...args,
      buyer_email: normalizeEmail(args.buyer_email),
      status: "pending",
      created_at: now,
      updated_at: now,
      expires_at: now + CHECKOUT_TTL_MS,
    });
  },
});

/** Platform payment for a subscription checkout: remember the Square customer who paid. */
export const attachCheckoutCustomer = internalMutation({
  args: { order_id: v.string(), customer_id: v.string() },
  handler: async (ctx, args) => {
    const checkout = await ctx.db
      .query("squareSubscriptionCheckouts")
      .withIndex("by_order_id", (q) => q.eq("order_id", args.order_id))
      .first();
    if (!checkout) return false;
    if (checkout.status === "pending") {
      await ctx.db.patch(checkout._id, { square_customer_id: args.customer_id, status: "paid", updated_at: Date.now() });
    }
    return true;
  },
});

/**
 * Business for a new Square subscription. Prefers the checkout the owner
 * started (matched by the paying Square customer, then by the buyer email),
 * then falls back to the business owned by the customer's email.
 */
export const findBusinessForSquareCustomer = internalQuery({
  args: {
    customer_id: v.optional(v.string()),
    email: v.optional(v.string()),
    plan_variation_id: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ business_id: Id<"businesses">; checkout_id?: Id<"squareSubscriptionCheckouts"> } | null> => {
    const now = Date.now();
    if (args.customer_id) {
      const byCustomer = await ctx.db
        .query("squareSubscriptionCheckouts")
        .withIndex("by_square_customer", (q) => q.eq("square_customer_id", args.customer_id))
        .order("desc")
        .take(10);
      const match = byCustomer.find((row) => !args.plan_variation_id || row.plan_variation_id === args.plan_variation_id)
        ?? byCustomer[0];
      if (match) return { business_id: match.business_id, checkout_id: match._id };
    }
    const email = normalizeEmail(args.email);
    if (!email) return null;
    const byEmail = await ctx.db
      .query("squareSubscriptionCheckouts")
      .withIndex("by_buyer_email", (q) => q.eq("buyer_email", email))
      .order("desc")
      .take(10);
    const pending = byEmail.find((row) => row.status !== "linked" && row.expires_at > now
      && (!args.plan_variation_id || row.plan_variation_id === args.plan_variation_id));
    if (pending) return { business_id: pending.business_id, checkout_id: pending._id };
    const owned = await ctx.db
      .query("businesses")
      .withIndex("by_owner_email", (q) => q.eq("owner_email", email))
      .first();
    return owned ? { business_id: owned._id } : null;
  },
});

export const markCheckoutLinked = internalMutation({
  args: { checkout_id: v.id("squareSubscriptionCheckouts"), square_subscription_id: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.checkout_id, {
      status: "linked",
      linked_subscription_id: args.square_subscription_id,
      updated_at: Date.now(),
    });
  },
});

/**
 * Manual grandfathering (e.g. an existing Stripe subscriber the owner moved by
 * hand). Run from the Convex dashboard / CLI only:
 *   npx convex run subscriptions:adminSetPlan '{"business_id":"...","plan_id":"professional","status":"active","current_period_end":1767225600000}'
 */
export const adminSetPlan = internalMutation({
  args: {
    business_id: v.id("businesses"),
    plan_id: subscriptionPlans,
    status: subscriptionStatuses,
    current_period_end: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const business = await ctx.db.get(args.business_id);
    if (!business) throw new Error("Business not found");
    const now = Date.now();
    const existing = await ctx.db
      .query("subscriptions")
      .withIndex("by_business", (q) => q.eq("business_id", args.business_id))
      .first();
    const fields = {
      provider: existing?.provider === "square" ? "square" : "manual",
      plan_id: args.plan_id,
      status: args.status,
      current_period_end: args.current_period_end ?? existing?.current_period_end ?? now,
      cancel_at_period_end: false,
      updated_at: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return existing._id;
    }
    return await ctx.db.insert("subscriptions", {
      ...fields,
      business_id: args.business_id,
      user_email: business.owner_email,
      current_period_start: now,
      created_at: now,
    });
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

/** Owner/admin billing context for the caller's business. */
export const getBillingContext = internalQuery({
  args: { user_email: v.string() },
  handler: async (ctx, args) => {
    const access = await getAccessContext(ctx, args.user_email);
    if (!access.business) throw new Error("No business found for this account.");
    if (!access.role || !MANAGER_ROLES.has(access.role)) {
      throw new Error("Only business owners and admins can manage subscriptions.");
    }
    const subscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_business", (q) => q.eq("business_id", access.business._id))
      .first();
    return {
      business_id: access.business._id as Id<"businesses">,
      business_name: access.business.name as string,
      owner_email: access.business.owner_email as string,
      subscription: subscription
        ? {
          provider: subscription.provider,
          status: subscription.status,
          square_subscription_id: subscription.square_subscription_id,
        }
        : null,
    };
  },
});

export const consumeBillingRateLimit = internalMutation({
  args: { user_email: v.string() },
  handler: async (ctx, args) => {
    await enforceRateLimit(ctx, args.user_email, "billing.manage");
  },
});

type BillingContext = {
  business_id: Id<"businesses">;
  business_name: string;
  owner_email: string;
  subscription: { provider?: string; status: string; square_subscription_id?: string } | null;
};

function activeSquareSubscriptionId(context: BillingContext): string | null {
  const sub = context.subscription;
  if (!sub || sub.provider !== "square" || !sub.square_subscription_id) return null;
  return isEntitledStatus(sub.status) ? sub.square_subscription_id : null;
}

/** Square-hosted subscription checkout on the platform account. Returns the payment link URL. */
export const createCheckoutSession = action({
  args: { plan_id: subscriptionPlans, interval: subscriptionIntervals },
  handler: async (ctx, args): Promise<{ url: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) throw new Error("Not authenticated");
    await ctx.runMutation(internal.subscriptions.consumeBillingRateLimit, { user_email: identity.email });
    const context: BillingContext = await ctx.runQuery(internal.subscriptions.getBillingContext, { user_email: identity.email });
    if (activeSquareSubscriptionId(context)) {
      throw new Error("This business already has an active subscription. Use Change plan on the billing page.");
    }
    const { accessToken, locationId } = requireSquarePlatformConfig();
    const variationId = requireVariationId(args.plan_id, args.interval);
    const buyerEmail = context.owner_email || identity.email;
    const hourBucket = Math.floor(Date.now() / (60 * 60 * 1000));
    const data = await squareRequest("/v2/online-checkout/payment-links", {
      method: "POST",
      token: accessToken,
      body: buildPaymentLinkBody({
        // Collapses double-clicks/retries within the hour into one link.
        idempotencyKey: `sub:${String(context.business_id)}:${variationId}:${hourBucket}`,
        name: `ChemCheck ${PLAN_NAMES[args.plan_id]} (${args.interval === "year" ? "annual" : "monthly"})`,
        amountCents: planPriceCents(args.plan_id, args.interval),
        locationId,
        redirectUrl: appUrl("/pricing?checkout=success"),
        subscriptionPlanVariationId: variationId,
        buyerEmail,
        paymentNote: `chemcheck:subscription:${String(context.business_id)}`,
      }),
    });
    const link = parsePaymentLinkResponse(data);
    await ctx.runMutation(internal.subscriptions.recordCheckout, {
      business_id: context.business_id,
      user_email: identity.email,
      buyer_email: buyerEmail,
      plan_id: args.plan_id,
      interval: args.interval,
      plan_variation_id: variationId,
      payment_link_id: link.id,
      order_id: link.order_id,
    });
    return { url: link.url };
  },
});

/** Cancel the Square subscription at the end of the paid period. */
export const cancelSubscription = action({
  args: {},
  handler: async (ctx): Promise<{ canceled: boolean }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) throw new Error("Not authenticated");
    await ctx.runMutation(internal.subscriptions.consumeBillingRateLimit, { user_email: identity.email });
    const context: BillingContext = await ctx.runQuery(internal.subscriptions.getBillingContext, { user_email: identity.email });
    const subscriptionId = activeSquareSubscriptionId(context);
    if (!subscriptionId) throw new Error("No active Square subscription to cancel.");
    const { accessToken } = requireSquarePlatformConfig();
    const data = await squareRequest(`/v2/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, {
      method: "POST",
      token: accessToken,
      body: {},
    });
    if (data?.subscription) {
      await ctx.runMutation(internal.subscriptions.upsertFromSquare, {
        ...subscriptionFieldsFromSquare(data.subscription, process.env as Record<string, string | undefined>),
      });
    }
    return { canceled: true };
  },
});

/** Switch plan/interval. Square applies the new plan variation from the next billing period. */
export const changePlan = action({
  args: { plan_id: subscriptionPlans, interval: subscriptionIntervals },
  handler: async (ctx, args): Promise<{ scheduled: boolean }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) throw new Error("Not authenticated");
    await ctx.runMutation(internal.subscriptions.consumeBillingRateLimit, { user_email: identity.email });
    const context: BillingContext = await ctx.runQuery(internal.subscriptions.getBillingContext, { user_email: identity.email });
    const subscriptionId = activeSquareSubscriptionId(context);
    if (!subscriptionId) throw new Error("No active Square subscription to change. Choose a plan to subscribe.");
    const { accessToken } = requireSquarePlatformConfig();
    await squareRequest(`/v2/subscriptions/${encodeURIComponent(subscriptionId)}/swap-plan`, {
      method: "POST",
      token: accessToken,
      body: { new_plan_variation_id: requireVariationId(args.plan_id, args.interval) },
    });
    // The plan is updated from the subscription.updated webhook (never from client input).
    return { scheduled: true };
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
    // Same limits the server enforces in planLimits.ts.
    const limits = limitsForSubscription(subscription);
    const limit = limits[args.limitType];
    let current = 0;
    if (args.limitType === "customers") {
      current = (await getCustomerUsage(ctx, business)).current;
    }
    return { allowed: limit === -1 || current < limit, current, limit: limit === -1 ? Infinity : limit };
  },
});
