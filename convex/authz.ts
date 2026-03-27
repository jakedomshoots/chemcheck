const READ_WRITE_ROLES = new Set(["owner", "admin", "technician"]);
const READ_ONLY_ROLES = new Set(["viewer"]);

export type TeamMemberRole = "owner" | "admin" | "technician" | "viewer";
export type Permission = "operational:read" | "operational:write" | "business:owner";

function normalizeEmail(email?: string | null): string {
  return String(email || "").trim().toLowerCase();
}

function normalizeId(value: unknown): string {
  return String(value || "").trim();
}

export function normalizeTeamMemberRole(role?: string | null): TeamMemberRole {
  const normalizedRole = String(role || "").trim().toLowerCase();
  if (normalizedRole === "employee") return "technician";
  if (normalizedRole === "owner") return "owner";
  if (normalizedRole === "admin") return "admin";
  if (normalizedRole === "technician") return "technician";
  return "viewer";
}

export function canReadOperationalData(role?: string | null): boolean {
  const normalizedRole = normalizeTeamMemberRole(role);
  return READ_WRITE_ROLES.has(normalizedRole) || READ_ONLY_ROLES.has(normalizedRole);
}

export function canWriteOperationalData(role?: string | null): boolean {
  return READ_WRITE_ROLES.has(normalizeTeamMemberRole(role));
}

export function canManageBusinessSettings(role?: string | null): boolean {
  return normalizeTeamMemberRole(role) === "owner";
}

export function getRoleCapabilities(role?: string | null) {
  return {
    canReadOperationalData: canReadOperationalData(role),
    canWriteOperationalData: canWriteOperationalData(role),
    canManageBusinessSettings: canManageBusinessSettings(role),
    canManageBilling: canManageBusinessSettings(role),
  };
}

export function assertPermission<T extends { role: TeamMemberRole }>(access: T, permission: Permission): T {
  if (permission === "operational:read" && canReadOperationalData(access.role)) {
    return access;
  }

  if (permission === "operational:write" && canWriteOperationalData(access.role)) {
    return access;
  }

  if (permission === "business:owner" && canManageBusinessSettings(access.role)) {
    return access;
  }

  throw new Error("Access denied");
}

export async function resolveAccessContextForEmail(ctx: any, userEmail: string) {
  const normalizedUserEmail = normalizeEmail(userEmail);

  const teamMember = await ctx.db
    .query("team_members")
    .withIndex("by_user_email", (q: any) => q.eq("user_email", userEmail))
    .filter((q: any) => q.eq(q.field("is_active"), true))
    .first();

  let business = null;
  let role: TeamMemberRole = "owner";

  if (teamMember) {
    business = await ctx.db.get(teamMember.business_id);
    role = normalizeTeamMemberRole(teamMember.role);
  } else {
    business = await ctx.db
      .query("businesses")
      .withIndex("by_owner_email", (q: any) => q.eq("owner_email", userEmail))
      .first();
  }

  if (business && normalizeEmail(business.owner_email) === normalizedUserEmail) {
    role = "owner";
  }

  const allowedUserEmails = new Set<string>([normalizedUserEmail]);

  if (business) {
    allowedUserEmails.add(normalizeEmail(business.owner_email));

    const members = await ctx.db
      .query("team_members")
      .withIndex("by_business", (q: any) => q.eq("business_id", business._id))
      .filter((q: any) => q.eq(q.field("is_active"), true))
      .collect();

    for (const member of members) {
      allowedUserEmails.add(normalizeEmail(member.user_email));
    }
  }

  return {
    business,
    businessId: business ? normalizeId(business._id) : null,
    ownerEmail: business ? normalizeEmail(business.owner_email) : normalizedUserEmail,
    role,
    userEmail: normalizedUserEmail,
    allowedUserEmails,
    // Backward-compatible alias for older callers.
    allowedCreatedByEmails: allowedUserEmails,
  };
}

export async function resolveBusinessAccess(ctx: any, userEmail: string) {
  return await resolveAccessContextForEmail(ctx, userEmail);
}

export function canAccessCreatedBy(
  access: { allowedUserEmails?: Set<string>; allowedCreatedByEmails?: Set<string> },
  createdBy?: string | null,
): boolean {
  const allowedEmails = access.allowedUserEmails ?? access.allowedCreatedByEmails;
  if (!allowedEmails) return false;
  return allowedEmails.has(normalizeEmail(createdBy));
}

export function ensureOperationalReadAccess(access: { role: TeamMemberRole }) {
  return assertPermission(access, "operational:read");
}

export function ensureOperationalWriteAccess(access: { role: TeamMemberRole }) {
  return assertPermission(access, "operational:write");
}

export function ensureOwnerAccess(access: { role: TeamMemberRole }) {
  return assertPermission(access, "business:owner");
}

export function canAccessCustomerDoc(
  access: { allowedUserEmails: Set<string>; businessId?: string | null },
  customer: any,
): boolean {
  if (!customer) return false;

  const customerBusinessId = customer.business_id ? normalizeId(customer.business_id) : "";
  if (access.businessId && customerBusinessId && customerBusinessId === access.businessId) {
    return true;
  }

  return canAccessCreatedBy(access, customer.created_by);
}

export function canAccessGeneralRecord(
  access: { allowedUserEmails: Set<string>; businessId?: string | null },
  record: any,
): boolean {
  if (!record) return false;

  const recordBusinessId = record.business_id ? normalizeId(record.business_id) : "";
  if (access.businessId && recordBusinessId && recordBusinessId === access.businessId) {
    return true;
  }

  return canAccessCreatedBy(access, record.created_by);
}

export async function listAccessibleCustomers(
  ctx: any,
  userEmailOrAccess: string | Awaited<ReturnType<typeof resolveAccessContextForEmail>>,
) {
  const access = typeof userEmailOrAccess === "string"
    ? await resolveAccessContextForEmail(ctx, userEmailOrAccess)
    : userEmailOrAccess;

  assertPermission(access, "operational:read");

  const customers = await ctx.db.query("customers").collect();
  return customers.filter((customer: any) => canAccessCustomerDoc(access, customer));
}

export async function getAccessibleCustomerIds(
  ctx: any,
  userEmailOrAccess: string | Awaited<ReturnType<typeof resolveAccessContextForEmail>>,
): Promise<Set<string>> {
  const customers = await listAccessibleCustomers(ctx, userEmailOrAccess);
  return new Set(customers.map((customer: any) => normalizeId(customer._id)));
}

export async function ensureCustomerAccess(
  ctx: any,
  customerId: any,
  userEmail: string,
  mode: "read" | "write" = "write",
) {
  const access = await resolveAccessContextForEmail(ctx, userEmail);
  assertPermission(access, mode === "write" ? "operational:write" : "operational:read");

  const customer = await ctx.db.get(customerId);
  if (!customer || !canAccessCustomerDoc(access, customer)) {
    throw new Error("Customer not found or access denied");
  }

  return { access, customer };
}

export async function ensureServiceLogAccess(
  ctx: any,
  serviceLogId: any,
  userEmail: string,
  mode: "read" | "write" = "write",
) {
  const access = await resolveAccessContextForEmail(ctx, userEmail);
  assertPermission(access, mode === "write" ? "operational:write" : "operational:read");

  const serviceLog = await ctx.db.get(serviceLogId);
  if (!serviceLog) {
    throw new Error("Service log not found");
  }

  const { customer } = await ensureCustomerAccess(ctx, serviceLog.customer_id, userEmail, mode);
  return { access, customer, serviceLog };
}

export async function ensureNoteAccess(
  ctx: any,
  noteId: any,
  userEmail: string,
  mode: "read" | "write" = "write",
) {
  const access = await resolveAccessContextForEmail(ctx, userEmail);
  assertPermission(access, mode === "write" ? "operational:write" : "operational:read");

  const note = await ctx.db.get(noteId);
  if (!note) {
    throw new Error("Note not found");
  }

  if (note.customer_id) {
    const { customer } = await ensureCustomerAccess(ctx, note.customer_id, userEmail, mode);
    return { access, customer, note };
  }

  if (!canAccessGeneralRecord(access, note)) {
    throw new Error("Access denied");
  }

  return { access, note };
}

export async function ensureWorkOrderAccess(
  ctx: any,
  workOrderId: any,
  userEmail: string,
  mode: "read" | "write" = "write",
) {
  const access = await resolveAccessContextForEmail(ctx, userEmail);
  assertPermission(access, mode === "write" ? "operational:write" : "operational:read");

  const workOrder = await ctx.db.get(workOrderId);
  if (!workOrder) {
    throw new Error("Work order not found");
  }

  const { customer } = await ensureCustomerAccess(ctx, workOrder.customer_id, userEmail, mode);
  return { access, customer, workOrder };
}

export async function ensureQuoteAccess(
  ctx: any,
  quoteId: any,
  userEmail: string,
  mode: "read" | "write" = "write",
) {
  const access = await resolveAccessContextForEmail(ctx, userEmail);
  assertPermission(access, mode === "write" ? "operational:write" : "operational:read");

  const quote = await ctx.db.get(quoteId);
  if (!quote) {
    throw new Error("Quote not found or access denied");
  }

  const { customer } = await ensureCustomerAccess(ctx, quote.customer_id, userEmail, mode);
  return { access, customer, quote };
}

export async function ensureInvoiceAccess(
  ctx: any,
  invoiceId: any,
  userEmail: string,
  mode: "read" | "write" = "write",
) {
  const access = await resolveAccessContextForEmail(ctx, userEmail);
  assertPermission(access, mode === "write" ? "operational:write" : "operational:read");

  const invoice = await ctx.db.get(invoiceId);
  if (!invoice) {
    throw new Error("Invoice not found or access denied");
  }

  const { customer } = await ensureCustomerAccess(ctx, invoice.customer_id, userEmail, mode);
  return { access, customer, invoice };
}

export async function ensurePhotoAccess(
  ctx: any,
  photoId: any,
  userEmail: string,
  mode: "read" | "write" = "write",
) {
  const access = await resolveAccessContextForEmail(ctx, userEmail);
  assertPermission(access, mode === "write" ? "operational:write" : "operational:read");

  const photo = await ctx.db.get(photoId);
  if (!photo) {
    throw new Error("Photo not found");
  }

  const { customer, serviceLog } = await ensureServiceLogAccess(ctx, photo.service_log_id, userEmail, mode);
  if (normalizeId(photo.customer_id) !== normalizeId(customer._id)) {
    throw new Error("Access denied");
  }

  return { access, customer, serviceLog, photo };
}
