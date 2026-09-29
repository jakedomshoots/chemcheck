/**
 * Shared tenant access helpers.
 *
 * Membership rule: a team_members row only grants access when it is active,
 * i.e. `is_active === true` and `status` is either absent (legacy rows) or
 * "active". Pending invites never grant access until the invitee accepts.
 */

export const ROLE_OWNER = "owner";
export const ROLE_ADMIN = "admin";

/** Roles allowed to change customer records, billing documents and settings. */
export const CUSTOMER_WRITE_ROLES: readonly string[] = ["owner", "admin"];
/** Roles allowed to record field work (service logs, photos, chemicals, notes, pools, work orders). */
export const FIELD_WRITE_ROLES: readonly string[] = ["owner", "admin", "technician", "employee"];

const MEMBERSHIP_SCAN_LIMIT = 100;

export function normalizeEmail(email: unknown): string {
  return String(email ?? "").trim().toLowerCase();
}

export function isActiveMembership(member: any): boolean {
  return (
    !!member &&
    member.is_active === true &&
    (member.status === undefined || member.status === null || member.status === "active")
  );
}

export function isPendingMembership(member: any): boolean {
  return !!member && member.status === "pending";
}

function emailVariants(email: string): string[] {
  const raw = String(email ?? "").trim();
  const normalized = normalizeEmail(email);
  return Array.from(new Set([raw, normalized].filter(Boolean)));
}

/** All team_members rows for an email (any status). */
export async function getMembershipsForEmail(ctx: any, email: string): Promise<any[]> {
  const rows: any[] = [];
  const seen = new Set<string>();
  for (const variant of emailVariants(email)) {
    const found = await ctx.db
      .query("team_members")
      .withIndex("by_user_email", (q: any) => q.eq("user_email", variant))
      .take(MEMBERSHIP_SCAN_LIMIT);
    for (const row of found) {
      const key = String(row._id);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
  }
  return rows;
}

/** First active membership for an email, optionally restricted to one business. */
export async function getActiveMembership(ctx: any, email: string, businessId?: unknown): Promise<any | null> {
  const rows = await getMembershipsForEmail(ctx, email);
  return (
    rows.find(
      (row) =>
        isActiveMembership(row) &&
        (businessId === undefined || String(row.business_id) === String(businessId))
    ) ?? null
  );
}

export async function getOwnedBusiness(ctx: any, email: string): Promise<any | null> {
  for (const variant of emailVariants(email)) {
    const business = await ctx.db
      .query("businesses")
      .withIndex("by_owner_email", (q: any) => q.eq("owner_email", variant))
      .first();
    if (business) return business;
  }
  return null;
}

/**
 * The business the user currently works in: an active (accepted) membership
 * first, then an owned business.
 */
export async function resolveBusinessForUser(ctx: any, email: string): Promise<any | null> {
  if (!normalizeEmail(email)) return null;
  const membership = await getActiveMembership(ctx, email);
  if (membership) {
    const business = await ctx.db.get(membership.business_id);
    if (business) return business;
  }
  return await getOwnedBusiness(ctx, email);
}

export async function getRoleInBusiness(ctx: any, business: any, email: string): Promise<string | null> {
  if (!business) return null;
  const normalized = normalizeEmail(email);
  if (normalized && normalizeEmail(business.owner_email) === normalized) return ROLE_OWNER;
  const membership = await getActiveMembership(ctx, email, business._id);
  return membership?.role || null;
}

export interface AccessContext {
  email: string;
  business: any | null;
  businessId: any | null;
  role: string | null;
  /** Value stored in `created_by` for tenant-owned records (business owner email, or the solo user's email). */
  tenantEmail: string;
}

export async function getAccessContext(ctx: any, email: string): Promise<AccessContext> {
  const business = await resolveBusinessForUser(ctx, email);
  const role = business ? await getRoleInBusiness(ctx, business, email) : null;
  return {
    email,
    business,
    businessId: business?._id ?? null,
    role,
    tenantEmail: business ? business.owner_email : email,
  };
}

export function assertRole(role: string | null, roles: readonly string[]): void {
  if (!role || !roles.includes(role)) {
    throw new Error("Insufficient role permissions");
  }
}

/**
 * Throws unless the caller has one of `roles` in their current business.
 * Solo users (no business) are unrestricted over their own data.
 */
export async function assertBusinessRole(ctx: any, email: string, roles: readonly string[]): Promise<AccessContext> {
  const access = await getAccessContext(ctx, email);
  if (access.business) assertRole(access.role, roles);
  return access;
}

async function getBusinessById(ctx: any, businessId: unknown): Promise<any | null> {
  if (!businessId) return null;
  const normalizedId =
    typeof ctx.db.normalizeId === "function"
      ? ctx.db.normalizeId("businesses", String(businessId))
      : businessId;
  if (!normalizedId) return null;
  return await ctx.db.get(normalizedId);
}

export interface CustomerAccessOptions {
  /** Require a write role (defaults to CUSTOMER_WRITE_ROLES when `roles` is not given). */
  write?: boolean;
  /** Explicit allow-list of roles for business members. */
  roles?: readonly string[];
}

/**
 * Permits the customer's creator, or an active owner/member of the customer's
 * business. Role restrictions apply to business members; a solo creator with no
 * business role keeps full access to their own customers.
 */
export async function assertCustomerAccess(
  ctx: any,
  customerOrId: any,
  email: string,
  options: CustomerAccessOptions = {}
): Promise<{ customer: any; role: string | null }> {
  const customer =
    customerOrId && typeof customerOrId === "object" ? customerOrId : customerOrId ? await ctx.db.get(customerOrId) : null;
  const normalized = normalizeEmail(email);
  if (!customer || !normalized) {
    throw new Error("Customer not found or access denied");
  }

  const isCreator = normalizeEmail(customer.created_by) === normalized;
  let role: string | null = null;

  if (customer.business_id) {
    const business = await getBusinessById(ctx, customer.business_id);
    role = await getRoleInBusiness(ctx, business, email);
  } else {
    // Legacy customer without business_id: it belongs to the business whose
    // owner created it.
    const business = await resolveBusinessForUser(ctx, email);
    if (business && normalizeEmail(business.owner_email) === normalizeEmail(customer.created_by)) {
      role = await getRoleInBusiness(ctx, business, email);
    }
  }

  if (!role && !isCreator) {
    throw new Error("Customer not found or access denied");
  }

  if (role && (options.write || options.roles)) {
    assertRole(role, options.roles ?? CUSTOMER_WRITE_ROLES);
  }

  return { customer, role };
}

/** Boolean variant of assertCustomerAccess for filtering. */
export async function canAccessCustomer(
  ctx: any,
  customerOrId: any,
  email: string,
  options: CustomerAccessOptions = {}
): Promise<boolean> {
  try {
    await assertCustomerAccess(ctx, customerOrId, email, options);
    return true;
  } catch {
    return false;
  }
}
