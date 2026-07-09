/**
 * Shared tenant authorization policy.
 *
 * Convex modules must use this boundary instead of comparing `created_by` to
 * the caller directly. Legacy records without a business remain owner-only
 * until they are backfilled; that is deliberately fail-closed for teams.
 */

import { Id } from "./_generated/dataModel";

export const BUSINESS_ROLES = ["owner", "admin", "technician", "viewer"] as const;
export type BusinessRole = (typeof BUSINESS_ROLES)[number];

export interface BusinessAccessCandidate {
  businessId: string | Id<"businesses">;
  ownerEmail: string;
  userEmail: string;
  membershipRole?: string | null;
  membershipActive?: boolean;
}

export interface AuthorizedBusinessContext {
  businessId: Id<"businesses">;
  ownerEmail: string;
  userEmail: string;
  role: BusinessRole;
}

export function normalizeEmail(email: unknown): string {
  return String(email || "").trim().toLowerCase();
}

function normalizeRole(role: unknown): BusinessRole | null {
  // `employee` was the pre-team role name. Map it during the migration so an
  // active technician never gains more access than intended.
  if (role === "employee") return "technician";
  return BUSINESS_ROLES.includes(role as BusinessRole) ? (role as BusinessRole) : null;
}

function isActiveCandidate(candidate: BusinessAccessCandidate): boolean {
  const userEmail = normalizeEmail(candidate.userEmail);
  const ownerEmail = normalizeEmail(candidate.ownerEmail);
  return userEmail.length > 0 && (userEmail === ownerEmail || candidate.membershipActive === true);
}

function toAuthorizedContext(candidate: BusinessAccessCandidate): AuthorizedBusinessContext {
  const userEmail = normalizeEmail(candidate.userEmail);
  const ownerEmail = normalizeEmail(candidate.ownerEmail);
  const role = userEmail === ownerEmail ? "owner" : normalizeRole(candidate.membershipRole);

  if (!role) {
    throw new Error("Access denied");
  }

  return {
    businessId: String(candidate.businessId) as Id<"businesses">,
    ownerEmail,
    userEmail,
    role,
  };
}

/**
 * Resolves one active business without silently choosing a tenant for a user
 * who belongs to multiple businesses. Callers with a selector should pass it.
 */
export function resolveSelectedBusinessContext(
  candidates: BusinessAccessCandidate[],
  requestedBusinessId?: string,
): AuthorizedBusinessContext {
  const active = new Map<string, BusinessAccessCandidate>();

  for (const candidate of candidates) {
    if (!isActiveCandidate(candidate)) continue;
    const businessId = String(candidate.businessId);
    const current = active.get(businessId);
    // Owner access always wins over a stale or duplicate team membership.
    if (!current || normalizeEmail(candidate.userEmail) === normalizeEmail(candidate.ownerEmail)) {
      active.set(businessId, candidate);
    }
  }

  if (requestedBusinessId) {
    const selected = active.get(String(requestedBusinessId));
    if (!selected) throw new Error("Access denied");
    return toAuthorizedContext(selected);
  }

  if (active.size === 0) throw new Error("Business access required");
  if (active.size > 1) throw new Error("Select an active business");

  return toAuthorizedContext(active.values().next().value as BusinessAccessCandidate);
}

export function assertBusinessRole(role: string | null | undefined, allowedRoles: readonly string[]): void {
  if (!role || !allowedRoles.includes(role)) {
    throw new Error("Insufficient role permissions");
  }
}

export async function requireUserEmail(ctx: any): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  const email = normalizeEmail(identity?.email);
  if (!email) throw new Error("Not authenticated");
  return email;
}

export async function listBusinessAccessCandidates(ctx: any, userEmail: string): Promise<BusinessAccessCandidate[]> {
  const normalizedUserEmail = normalizeEmail(userEmail);
  if (!normalizedUserEmail) return [];

  const [ownedBusinesses, memberships] = await Promise.all([
    ctx.db
      .query("businesses")
      .withIndex("by_owner_email", (q: any) => q.eq("owner_email", normalizedUserEmail))
      .collect(),
    ctx.db
      .query("team_members")
      .withIndex("by_user_email", (q: any) => q.eq("user_email", normalizedUserEmail))
      .collect(),
  ]);

  const candidates: BusinessAccessCandidate[] = ownedBusinesses.map((business: any) => ({
    businessId: String(business._id),
    ownerEmail: business.owner_email,
    userEmail: normalizedUserEmail,
    membershipRole: "owner",
    membershipActive: true,
  }));

  for (const membership of memberships) {
    const business = await ctx.db.get(membership.business_id);
    if (!business) continue;
    candidates.push({
      businessId: String(business._id),
      ownerEmail: business.owner_email,
      userEmail: normalizedUserEmail,
      membershipRole: membership.role,
      membershipActive: membership.is_active,
    });
  }

  return candidates;
}

export async function getBusinessContext(
  ctx: any,
  userEmail: string,
  requestedBusinessId?: string,
): Promise<AuthorizedBusinessContext | null> {
  const candidates = await listBusinessAccessCandidates(ctx, userEmail);
  if (candidates.length === 0 && !requestedBusinessId) return null;
  return resolveSelectedBusinessContext(candidates, requestedBusinessId);
}

export async function requireBusinessContext(
  ctx: any,
  userEmail: string,
  requestedBusinessId?: string,
): Promise<AuthorizedBusinessContext> {
  const context = await getBusinessContext(ctx, userEmail, requestedBusinessId);
  if (!context) throw new Error("Business access required");
  return context;
}

export async function canAccessCustomer(ctx: any, customer: any, userEmail: string): Promise<boolean> {
  if (!customer) return false;

  const customerBusinessId = customer.business_id ? String(customer.business_id) : "";
  if (!customerBusinessId) {
    // Do not broaden team access to unbackfilled records.
    return normalizeEmail(customer.created_by) === normalizeEmail(userEmail);
  }

  try {
    const business = await getBusinessContext(ctx, userEmail, customerBusinessId);
    return business?.businessId === customerBusinessId;
  } catch {
    return false;
  }
}

export async function requireCustomerAccess(ctx: any, customer: any, userEmail: string): Promise<AuthorizedBusinessContext | null> {
  if (!customer) throw new Error("Customer not found");

  const customerBusinessId = customer.business_id ? String(customer.business_id) : "";
  if (!customerBusinessId) {
    if (normalizeEmail(customer.created_by) !== normalizeEmail(userEmail)) {
      throw new Error("Access denied");
    }
    return null;
  }

  return requireBusinessContext(ctx, userEmail, customerBusinessId);
}

export async function requireCustomerRole(
  ctx: any,
  customer: any,
  userEmail: string,
  allowedRoles: readonly string[],
): Promise<AuthorizedBusinessContext | null> {
  const business = await requireCustomerAccess(ctx, customer, userEmail);
  // Legacy owner-only records preserve existing owner authority until backfill.
  if (!business) return null;
  assertBusinessRole(business.role, allowedRoles);
  return business;
}
