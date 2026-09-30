/// <reference types="node" />
/**
 * Shared tenant resolution and subscription entitlement helpers.
 *
 * Resolution order everywhere is OWNERSHIP FIRST, then active team
 * membership. Team invites are inserted as pending (is_active: false, no
 * joined_at) and only become memberships once the invited user accepts them
 * while signed in with the invited email, so a membership row alone can never
 * redirect an owner into somebody else's tenant.
 */
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

type DbCtx = Pick<MutationCtx | QueryCtx, "db">;

/** Canonical form for every email comparison in the backend. */
export function normalizeEmail(email: string | null | undefined): string {
  return String(email ?? "").trim().toLowerCase();
}

function emailVariants(email: string): string[] {
  const raw = String(email ?? "");
  const normalized = normalizeEmail(raw);
  return raw === normalized ? [normalized] : [normalized, raw];
}

/** A team_members row is a live membership only when it has been accepted. */
export function isActiveMembership(member: Pick<Doc<"team_members">, "is_active"> | null | undefined): boolean {
  return Boolean(member && member.is_active === true);
}

/** Pending invite: inserted by inviteTeamMember, not yet accepted or declined. */
export function isPendingInvite(member: Pick<Doc<"team_members">, "is_active" | "joined_at"> | null | undefined): boolean {
  return Boolean(member && member.is_active !== true && member.joined_at === undefined);
}

/**
 * Find the caller's first ACTIVE membership. Looks up both the normalized
 * email and the raw identity email so legacy rows stored before
 * normalization keep working.
 */
export async function findActiveMembership(
  ctx: DbCtx,
  email: string,
  businessId?: Doc<"businesses">["_id"]
): Promise<Doc<"team_members"> | null> {
  for (const candidate of emailVariants(email)) {
    const member = await ctx.db
      .query("team_members")
      .withIndex("by_user_email", (q) => q.eq("user_email", candidate))
      .filter((q) =>
        businessId
          ? q.and(q.eq(q.field("is_active"), true), q.eq(q.field("business_id"), businessId))
          : q.eq(q.field("is_active"), true)
      )
      .first();
    if (member) return member;
  }
  return null;
}

/** Business the caller OWNS (by_owner_email), or null. */
export async function findOwnedBusiness(ctx: DbCtx, email: string): Promise<Doc<"businesses"> | null> {
  for (const candidate of emailVariants(email)) {
    const business = await ctx.db
      .query("businesses")
      .withIndex("by_owner_email", (q) => q.eq("owner_email", candidate))
      .first();
    if (business) return business;
  }
  return null;
}

/**
 * Resolve the caller's business: ownership first, then active membership.
 */
export async function resolveBusinessForEmail(ctx: DbCtx, email: string): Promise<Doc<"businesses"> | null> {
  const owned = await findOwnedBusiness(ctx, email);
  if (owned) return owned;

  const membership = await findActiveMembership(ctx, email);
  if (membership) {
    const business = await ctx.db.get(membership.business_id);
    if (business) return business;
  }
  return null;
}

/**
 * Team-collaboration access check for customer-scoped records.
 *
 * Allowed when:
 *  - the caller created the customer, or
 *  - the customer belongs to the caller's business (business_id match), or
 *  - the customer was created by the business owner or by another ACTIVE
 *    member of the caller's business.
 * Same business only; nothing crosses tenants.
 */
export async function canAccessCustomerRecord(
  ctx: DbCtx,
  customer: Pick<Doc<"customers">, "created_by" | "business_id"> | null | undefined,
  email: string
): Promise<boolean> {
  if (!customer) return false;
  const callerEmail = normalizeEmail(email);
  const createdBy = normalizeEmail(customer.created_by);
  if (createdBy && createdBy === callerEmail) return true;

  const business = await resolveBusinessForEmail(ctx, email);
  if (!business) return false;

  if (customer.business_id && String(customer.business_id) === String(business._id)) return true;
  if (createdBy && createdBy === normalizeEmail(business.owner_email)) return true;
  if (createdBy) {
    const creatorMembership = await findActiveMembership(ctx, customer.created_by, business._id);
    if (creatorMembership) return true;
  }
  return false;
}

// ============================================
// Subscription entitlement
// ============================================

/** Statuses that block writes. `canceled` only blocks once the paid period has ended. */
export const BLOCKING_SUBSCRIPTION_STATUSES = new Set(["canceled", "unpaid", "incomplete_expired"]);

export type EntitlementSubscription = Pick<Doc<"subscriptions">, "status" | "current_period_end">;

/**
 * Pure decision: is a write allowed given the (possibly missing) subscription?
 * No subscription row at all is allowed so existing users are never locked out.
 */
export function evaluateWriteEntitlement(
  subscription: EntitlementSubscription | null | undefined,
  now: number = Date.now()
): { allowed: true } | { allowed: false; reason: string } {
  if (!subscription) return { allowed: true };
  const status = String(subscription.status || "").toLowerCase();
  if (!BLOCKING_SUBSCRIPTION_STATUSES.has(status)) return { allowed: true };
  if (status === "canceled") {
    const periodEnd = Number(subscription.current_period_end);
    if (Number.isFinite(periodEnd) && periodEnd >= now) return { allowed: true };
    return { allowed: false, reason: "subscription was canceled and the paid period has ended" };
  }
  if (status === "unpaid") return { allowed: false, reason: "subscription is unpaid" };
  return { allowed: false, reason: "subscription checkout expired before payment" };
}

/** Subscription row for a business (by_business), falling back to legacy by_user_email rows. */
export async function findSubscriptionForBusiness(
  ctx: DbCtx,
  business: Doc<"businesses"> | null,
  email: string
): Promise<Doc<"subscriptions"> | null> {
  if (business) {
    const byBusiness = await ctx.db
      .query("subscriptions")
      .withIndex("by_business", (q) => q.eq("business_id", business._id))
      .first();
    if (byBusiness) return byBusiness;
  }
  const legacyEmails = new Set<string>(emailVariants(email));
  if (business?.owner_email) {
    for (const candidate of emailVariants(business.owner_email)) legacyEmails.add(candidate);
  }
  for (const candidate of legacyEmails) {
    const legacy = await ctx.db
      .query("subscriptions")
      .withIndex("by_user_email", (q) => q.eq("user_email", candidate))
      .first();
    if (legacy) return legacy;
  }
  return null;
}

/**
 * Throws `Subscription inactive: ...` when the caller's business has a
 * subscription row in a blocking state. Missing subscription = allowed.
 */
export async function assertWriteAllowed(ctx: MutationCtx | QueryCtx, email: string): Promise<void> {
  const business = await resolveBusinessForEmail(ctx, email);
  const subscription = await findSubscriptionForBusiness(ctx, business, email);
  const verdict = evaluateWriteEntitlement(subscription);
  if (!verdict.allowed) {
    throw new Error(`Subscription inactive: ${verdict.reason}. Update billing to continue.`);
  }
}
