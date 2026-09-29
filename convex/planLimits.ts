import { isActiveMembership, isPendingMembership, normalizeEmail, resolveBusinessForUser } from "./access";

/**
 * Server-side plan limits. Mirrors SUBSCRIPTION_PLANS in src/lib/stripe.ts and
 * FREE_TIER_LIMITS in src/hooks/useSubscription.ts. -1 means unlimited.
 */
export type PlanLimits = { users: number; customers: number };

export const PLAN_LIMITS: Record<string, PlanLimits> = {
  starter: { users: 1, customers: 50 },
  professional: { users: 3, customers: 200 },
  business: { users: -1, customers: -1 },
};

/** Applies when there is no subscription or it no longer grants a paid plan. */
export const FREE_TIER_LIMITS: PlanLimits = { users: 1, customers: 10 };

/** Statuses that keep the paid plan's limits (trial via Stripe, and dunning grace). */
const ENTITLED_STATUSES = new Set(["active", "trialing", "past_due"]);

export function limitsForSubscription(subscription: { plan_id?: string; status?: string } | null | undefined): PlanLimits {
  if (!subscription || !ENTITLED_STATUSES.has(String(subscription.status))) {
    return FREE_TIER_LIMITS;
  }
  return PLAN_LIMITS[String(subscription.plan_id)] ?? PLAN_LIMITS.starter;
}

export function planLabel(subscription: { plan_id?: string; status?: string } | null | undefined): string {
  if (!subscription || !ENTITLED_STATUSES.has(String(subscription.status))) return "free";
  return PLAN_LIMITS[String(subscription.plan_id)] ? String(subscription.plan_id) : "starter";
}

export function isWithinLimit(limit: number, current: number, adding: number): boolean {
  return limit === -1 || current + adding <= limit;
}

declare const process: { env: Record<string, string | undefined> };

/**
 * Tenants (by owner email) that are never plan-limited, e.g. the operator's
 * own pool business. Comma-separated PLAN_LIMIT_EXEMPT_EMAILS.
 */
export function isPlanLimitExempt(ownerEmail: string, raw = process.env.PLAN_LIMIT_EXEMPT_EMAILS): boolean {
  const target = normalizeEmail(ownerEmail);
  if (!target || !raw) return false;
  return raw.split(",").some((entry) => normalizeEmail(entry) === target);
}

async function subscriptionForTenant(ctx: any, business: any | null, email: string): Promise<any | null> {
  if (business) {
    const byBusiness = await ctx.db
      .query("subscriptions")
      .withIndex("by_business", (q: any) => q.eq("business_id", business._id))
      .first();
    if (byBusiness) return byBusiness;
    // Legacy user-scoped subscription rows (business_id not yet backfilled).
    email = business.owner_email;
  }
  if (!email) return null;
  return await ctx.db
    .query("subscriptions")
    .withIndex("by_user_email", (q: any) => q.eq("user_email", email))
    .first();
}

async function resolveTenant(ctx: any, ownerEmailOrBusiness: any): Promise<{ business: any | null; email: string }> {
  if (ownerEmailOrBusiness && typeof ownerEmailOrBusiness === "object") {
    return { business: ownerEmailOrBusiness, email: ownerEmailOrBusiness.owner_email };
  }
  const email = String(ownerEmailOrBusiness ?? "");
  const business = await resolveBusinessForUser(ctx, email);
  return { business, email: business ? business.owner_email : email };
}

export async function getCustomerUsage(ctx: any, ownerEmailOrBusiness: any) {
  const { business, email } = await resolveTenant(ctx, ownerEmailOrBusiness);
  if (isPlanLimitExempt(email)) return { limit: -1, current: 0, plan: "exempt" };
  const subscription = await subscriptionForTenant(ctx, business, email);
  const limits = limitsForSubscription(subscription);
  const base = business
    ? ctx.db.query("customers").withIndex("by_business", (q: any) => q.eq("business_id", String(business._id)))
    : ctx.db.query("customers").withIndex("by_created_by", (q: any) => q.eq("created_by", email));
  // Bounded read: we only need to know whether the tenant is at the limit.
  const current = limits.customers === -1 ? 0 : (await base.take(limits.customers + 1)).length;
  return { limit: limits.customers, current, plan: planLabel(subscription) };
}

/**
 * Throws when adding `count` customers would exceed the tenant's plan.
 * Accepts either the business document or an email (resolved to its business).
 */
export async function assertCanAddCustomers(ctx: any, ownerEmailOrBusiness: any, count = 1): Promise<void> {
  const { limit, current, plan } = await getCustomerUsage(ctx, ownerEmailOrBusiness);
  if (limit === -1) return;
  if (!isWithinLimit(limit, current, count)) {
    throw new Error(
      `Plan limit reached: the ${plan} plan allows up to ${limit} customers. Upgrade your plan to add more.`
    );
  }
}

/** Seats = owner + every non-owner member that is active or has a pending invite. */
export async function countTeamSeats(ctx: any, business: any): Promise<number> {
  const members = await ctx.db
    .query("team_members")
    .withIndex("by_business", (q: any) => q.eq("business_id", business._id))
    .take(1000);
  const ownerEmail = normalizeEmail(business.owner_email);
  let seats = 1;
  for (const member of members) {
    if (member.role === "owner" || normalizeEmail(member.user_email) === ownerEmail) continue;
    if (isActiveMembership(member) || isPendingMembership(member)) seats += 1;
  }
  return seats;
}

export async function assertCanAddTeamMember(ctx: any, ownerEmailOrBusiness: any, count = 1): Promise<void> {
  const { business, email } = await resolveTenant(ctx, ownerEmailOrBusiness);
  if (!business) throw new Error("Create a business before inviting team members.");
  if (isPlanLimitExempt(email)) return;
  const subscription = await subscriptionForTenant(ctx, business, email);
  const limits = limitsForSubscription(subscription);
  if (limits.users === -1) return;
  const seats = await countTeamSeats(ctx, business);
  if (!isWithinLimit(limits.users, seats, count)) {
    throw new Error(
      `Plan limit reached: the ${planLabel(subscription)} plan allows up to ${limits.users} team member${limits.users === 1 ? "" : "s"}. Upgrade your plan to add more.`
    );
  }
}
