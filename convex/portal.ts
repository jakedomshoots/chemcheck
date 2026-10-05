/**
 * Customer portal: a public, token-addressed read-only view for a customer
 * plus a rate-limited "request service" form.
 *
 * Tokens are UUIDs with a 1 year expiry, one active token per customer,
 * revocable at any time. Everything the customer sees is filtered
 * server-side by the customer's report_settings.
 */
/// <reference types="node" />
import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { canAccessCustomerRecord, findActiveMembership, normalizeEmail, resolveBusinessForEmail } from "./entitlements";
import { NOT_DELETED_FILTER } from "./sync";
import { DEFAULT_BUSINESS_NAME, resolveReportSettings } from "./serviceReports";
import { businessForCustomer } from "./quickbooksSync";

type DbCtx = Pick<MutationCtx | QueryCtx, "db">;
type WriteCtx = Pick<MutationCtx, "db">;
type StorageLike = { getUrl: (id: Id<"_storage">) => Promise<string | null> };

export const PORTAL_TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000;
export const PORTAL_MAX_VISITS = 12;
export const PORTAL_MAX_PHOTOS_PER_VISIT = 6;
export const PORTAL_MAX_OPEN_REQUESTS = 10;
export const PORTAL_MESSAGE_MIN = 3;
export const PORTAL_MESSAGE_MAX = 1000;
const MANAGER_ROLES = new Set(["owner", "admin"]);

export type TokenState = "ok" | "revoked" | "expired";

export function validatePortalToken(row: Pick<Doc<"portalTokens">, "revoked_at" | "expires_at">, now = Date.now()): TokenState {
  if (row.revoked_at !== undefined) return "revoked";
  if (row.expires_at !== undefined && now >= row.expires_at) return "expired";
  return "ok";
}

export function isPlausibleToken(token: unknown): token is string {
  return typeof token === "string" && token.length >= 16 && token.length <= 64 && /^[A-Za-z0-9-]+$/.test(token);
}

export function firstNameOf(fullName: string | null | undefined): string {
  return String(fullName ?? "").trim().split(/\s+/)[0] || "there";
}

/** An owner/admin of the customer's current business. */
export async function canManagePortalLink(ctx: DbCtx, customer: Doc<"customers">, email: string): Promise<boolean> {
  if (!(await canAccessCustomerRecord(ctx, customer, email))) return false;
  const business = await resolveBusinessForEmail(ctx, email);
  if (!business) return false;
  if (normalizeEmail(business.owner_email) === normalizeEmail(email)) return true;
  const membership = await findActiveMembership(ctx, email, business._id);
  return Boolean(membership && MANAGER_ROLES.has(String(membership.role)));
}

async function requireManagedCustomer(ctx: DbCtx, email: string, customerId: Id<"customers">): Promise<Doc<"customers">> {
  const customer = await ctx.db.get(customerId);
  if (!customer || customer.deleted_at !== undefined) throw new Error("Customer not found or access denied");
  if (!(await canManagePortalLink(ctx, customer, email))) throw new Error("Only the account owner or an admin can manage portal links.");
  return customer;
}

async function activeTokensForCustomer(ctx: DbCtx, customerId: Id<"customers">, now: number): Promise<Doc<"portalTokens">[]> {
  const rows = await ctx.db
    .query("portalTokens")
    .withIndex("by_customer", (q) => q.eq("customer_id", customerId))
    .take(50);
  return rows.filter((row) => validatePortalToken(row, now) === "ok");
}

export async function createOrRotatePortalLinkForCustomer(
  ctx: WriteCtx,
  email: string,
  customerId: Id<"customers">,
  options: { now?: number; token?: string } = {},
): Promise<{ token: string; expires_at: number }> {
  const now = options.now ?? Date.now();
  const customer = await requireManagedCustomer(ctx, email, customerId);
  for (const row of await activeTokensForCustomer(ctx, customerId, now)) {
    await ctx.db.patch(row._id, { revoked_at: now });
  }
  const business = await businessForCustomer(ctx, customer);
  const token = options.token ?? crypto.randomUUID();
  const expiresAt = now + PORTAL_TOKEN_TTL_MS;
  await ctx.db.insert("portalTokens", {
    customer_id: customerId,
    business_id: business?._id,
    token,
    created_by: email,
    created_at: now,
    expires_at: expiresAt,
  });
  return { token, expires_at: expiresAt };
}

export async function revokePortalLinksForCustomer(ctx: WriteCtx, email: string, customerId: Id<"customers">, now = Date.now()): Promise<number> {
  await requireManagedCustomer(ctx, email, customerId);
  const active = await activeTokensForCustomer(ctx, customerId, now);
  for (const row of active) await ctx.db.patch(row._id, { revoked_at: now });
  return active.length;
}

export async function portalLinkStatusForCustomer(
  ctx: DbCtx,
  email: string,
  customerId: Id<"customers">,
  now = Date.now(),
): Promise<{ token: string; expires_at: number | null; created_at: number; last_access_at: number | null } | null> {
  const customer = await ctx.db.get(customerId);
  if (!customer || !(await canAccessCustomerRecord(ctx, customer, email))) return null;
  const active = (await activeTokensForCustomer(ctx, customerId, now)).sort((a, b) => b.created_at - a.created_at);
  const row = active[0];
  if (!row) return null;
  return { token: row.token, expires_at: row.expires_at ?? null, created_at: row.created_at, last_access_at: row.last_access_at ?? null };
}

// ============================================
// Public portal payload
// ============================================

export interface PortalVisit {
  id: string;
  date: string;
  status: string;
  service_type: string | null;
  overall_status: "good" | "needs_attention" | null;
  readings: { ph: string | null; chlorine: string | null; alkalinity: string | null; stabilizer: string | null; salt: number | null } | null;
  notes: string | null;
  technician: string | null;
  duration_ms: number | null;
  photos: Array<{ id: string; category: string; url: string }>;
}

export interface PortalPayload {
  business: { name: string; phone: string | null; email: string | null };
  customer: { first_name: string; service_day: string };
  visits: PortalVisit[];
  open_invoices: Array<{ id: string; total: number; due_date: string | null; payment_url: string | null; sent_at: number | null }>;
  quotes: Array<{ id: string; title: string; total: number; valid_until: string | null; deposit_required: number | null; deposit_status: string | null; deposit_payment_url: string | null }>;
  open_requests: Array<{ id: string; title: string; scheduled_date: string; created_at: number }>;
  allow_service_requests: boolean;
  expires_at: number | null;
}

export type PortalLookup =
  | { found: false; failure_reason: "not_found" | "revoked" | "expired" | "disabled"; error: string }
  | { found: true; portal: PortalPayload };

function overallStatus(log: Doc<"serviceLogs">): "good" | "needs_attention" {
  const readings = [log.ph, log.chlorine, log.alkalinity, log.stabilizer];
  return readings.some((r) => r === "low" || r === "high" || r === "critical") ? "needs_attention" : "good";
}

async function resolveTokenRow(ctx: DbCtx, token: string, now: number): Promise<
  | { ok: true; row: Doc<"portalTokens">; customer: Doc<"customers">; business: Doc<"businesses"> | null }
  | { ok: false; failure_reason: "not_found" | "revoked" | "expired" | "disabled"; error: string }
> {
  if (!isPlausibleToken(token)) return { ok: false, failure_reason: "not_found", error: "This portal link is not valid." };
  const row = await ctx.db.query("portalTokens").withIndex("by_token", (q) => q.eq("token", token)).first();
  if (!row) return { ok: false, failure_reason: "not_found", error: "This portal link is not valid." };
  const state = validatePortalToken(row, now);
  if (state === "revoked") return { ok: false, failure_reason: "revoked", error: "This portal link was turned off. Ask your pool service for a new one." };
  if (state === "expired") return { ok: false, failure_reason: "expired", error: "This portal link has expired. Ask your pool service for a new one." };
  const customer = await ctx.db.get(row.customer_id);
  if (!customer || customer.deleted_at !== undefined) return { ok: false, failure_reason: "not_found", error: "This portal link is not valid." };
  const business = await businessForCustomer(ctx, customer);
  if (business?.settings?.customer_portal?.enabled === false) {
    return { ok: false, failure_reason: "disabled", error: "The customer portal is currently turned off." };
  }
  return { ok: true, row, customer, business };
}

export async function loadPortalForToken(
  ctx: DbCtx & { storage?: StorageLike },
  token: string,
  now = Date.now(),
): Promise<PortalLookup> {
  const resolved = await resolveTokenRow(ctx, token, now);
  if (!resolved.ok) return { found: false, failure_reason: resolved.failure_reason, error: resolved.error };
  const { row, customer, business } = resolved;
  const settings = resolveReportSettings(customer.report_settings);

  const logs = (await ctx.db
    .query("serviceLogs")
    .withIndex("by_customer_and_date", (q) => q.eq("customer_id", customer._id))
    .filter(NOT_DELETED_FILTER)
    .order("desc")
    .take(PORTAL_MAX_VISITS))
    .sort((a, b) => b.service_date.localeCompare(a.service_date))
    .slice(0, PORTAL_MAX_VISITS);

  const technicianLabel = business?.name || (customer.created_by.includes("@") ? customer.created_by.split("@")[0] : customer.created_by);

  const visits: PortalVisit[] = [];
  for (const log of logs) {
    const photos: PortalVisit["photos"] = [];
    if (settings.show_photos && ctx.storage) {
      const rows = await ctx.db
        .query("servicePhotos")
        .withIndex("by_service_log", (q) => q.eq("service_log_id", log._id))
        .take(PORTAL_MAX_PHOTOS_PER_VISIT);
      for (const photo of rows) {
        const url = await ctx.storage.getUrl(photo.storage_id);
        if (url) photos.push({ id: String(photo._id), category: photo.category, url });
      }
    }
    visits.push({
      id: String(log._id),
      date: log.service_date,
      status: log.status,
      service_type: log.service_type ?? null,
      overall_status: settings.show_overall_status ? overallStatus(log) : null,
      readings: settings.show_chemical_readings
        ? { ph: log.ph ?? null, chlorine: log.chlorine ?? null, alkalinity: log.alkalinity ?? null, stabilizer: log.stabilizer ?? null, salt: log.salt ?? null }
        : null,
      notes: settings.show_service_notes ? (log.notes ?? null) : null,
      technician: settings.show_technician_name ? technicianLabel : null,
      duration_ms: settings.show_service_duration ? (log.duration_ms ?? null) : null,
      photos,
    });
  }

  const invoices = await ctx.db.query("invoices").withIndex("by_customer", (q) => q.eq("customer_id", customer._id)).take(100);
  const openInvoices = invoices
    .filter((inv) => inv.status === "sent")
    .map((inv) => ({ id: String(inv._id), total: inv.total, due_date: inv.due_date ?? null, payment_url: inv.payment_url ?? null, sent_at: inv.sent_at ?? null }))
    .sort((a, b) => String(a.due_date ?? "9999").localeCompare(String(b.due_date ?? "9999")));

  const quotes = (await ctx.db.query("quotes").withIndex("by_customer", (q) => q.eq("customer_id", customer._id)).take(50))
    .filter((quote) => quote.status === "sent")
    .map((quote) => ({
      id: String(quote._id),
      title: quote.title,
      total: quote.total,
      valid_until: quote.valid_until ?? null,
      deposit_required: quote.deposit_required ?? null,
      deposit_status: quote.deposit_status ?? null,
      deposit_payment_url: quote.deposit_payment_url ?? null,
    }));

  const openRequests = (await ctx.db.query("workOrders").withIndex("by_customer", (q) => q.eq("customer_id", customer._id)).take(50))
    .filter((wo) => wo.status === "requested")
    .map((wo) => ({ id: String(wo._id), title: wo.title, scheduled_date: wo.scheduled_date, created_at: wo.created_at }))
    .sort((a, b) => b.created_at - a.created_at);

  return {
    found: true,
    portal: {
      business: { name: business?.name || DEFAULT_BUSINESS_NAME, phone: business?.phone ?? null, email: business?.email ?? null },
      customer: { first_name: firstNameOf(customer.full_name), service_day: customer.service_day },
      visits,
      open_invoices: openInvoices,
      quotes,
      open_requests: openRequests,
      allow_service_requests: business?.settings?.customer_portal?.allow_service_requests !== false,
      expires_at: row.expires_at ?? null,
    },
  };
}

// ============================================
// Service requests
// ============================================

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function validateServiceRequest(input: { message: string; preferred_date?: string }, now = Date.now()): { message: string; preferred_date?: string } {
  const message = String(input.message ?? "").replace(/\s+/g, " ").trim();
  if (message.length < PORTAL_MESSAGE_MIN) throw new Error("Please tell us a little about what you need.");
  if (message.length > PORTAL_MESSAGE_MAX) throw new Error(`Message must be ${PORTAL_MESSAGE_MAX} characters or fewer.`);
  let preferredDate: string | undefined;
  if (input.preferred_date !== undefined && String(input.preferred_date).trim() !== "") {
    if (!isIsoDate(input.preferred_date)) throw new Error("Preferred date must be a valid date.");
    // Allow "today" in any time zone: reject only dates before yesterday (UTC).
    const yesterday = new Date(now - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (input.preferred_date < yesterday) throw new Error("Preferred date cannot be in the past.");
    preferredDate = input.preferred_date;
  }
  return { message, preferred_date: preferredDate };
}

export async function createServiceRequestForToken(
  ctx: WriteCtx,
  token: string,
  input: { message: string; preferred_date?: string },
  now = Date.now(),
): Promise<{ ok: true; work_order_id: Id<"workOrders"> } | { ok: false; error: string }> {
  const resolved = await resolveTokenRow(ctx, token, now);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const { customer, business } = resolved;
  if (business?.settings?.customer_portal?.allow_service_requests === false) {
    return { ok: false, error: "Service requests are not available through this portal. Please call or email instead." };
  }
  const { message, preferred_date } = validateServiceRequest(input, now);

  const open = (await ctx.db.query("workOrders").withIndex("by_customer", (q) => q.eq("customer_id", customer._id)).take(100))
    .filter((wo) => wo.status === "requested");
  if (open.length >= PORTAL_MAX_OPEN_REQUESTS) {
    return { ok: false, error: "You already have several open requests. We'll be in touch soon." };
  }

  const today = new Date(now).toISOString().slice(0, 10);
  const title = `Customer request: ${message.slice(0, 60)}${message.length > 60 ? "…" : ""}`;
  const workOrderId = await ctx.db.insert("workOrders", {
    customer_id: customer._id,
    business_id: business?._id,
    created_by: customer.created_by,
    title,
    description: message,
    status: "requested",
    scheduled_date: preferred_date ?? today,
    is_recurring: false,
    priority: "medium",
    created_at: now,
    updated_at: now,
  });
  await ctx.db.insert("notes", {
    title: `Portal request from ${customer.full_name}`,
    content: preferred_date ? `${message}\n\nPreferred date: ${preferred_date}` : message,
    category: "Customer",
    customer_id: customer._id,
    priority: "medium",
    completed: false,
    created_date: today,
    created_at: now,
    updated_at: now,
    created_by: customer.created_by,
  });
  return { ok: true, work_order_id: workOrderId };
}

// ============================================
// Convex API — authenticated management
// ============================================

export const createOrRotatePortalLink = mutation({
  args: { customer_id: v.id("customers") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) throw new Error("Not authenticated");
    return await createOrRotatePortalLinkForCustomer(ctx, identity.email, args.customer_id);
  },
});

export const revokePortalLink = mutation({
  args: { customer_id: v.id("customers") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) throw new Error("Not authenticated");
    return { revoked: await revokePortalLinksForCustomer(ctx, identity.email, args.customer_id) };
  },
});

export const getPortalLinkStatus = query({
  args: { customer_id: v.id("customers") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) throw new Error("Not authenticated");
    return await portalLinkStatusForCustomer(ctx, identity.email, args.customer_id);
  },
});

// ============================================
// Convex API — public (no auth), rate limited per token
// ============================================

export const getPortalInternal = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<PortalLookup> => await loadPortalForToken(ctx, args.token),
});

export const touchPortalToken = internalMutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("portalTokens").withIndex("by_token", (q) => q.eq("token", args.token)).first();
    if (row) await ctx.db.patch(row._id, { last_access_at: Date.now() });
  },
});

export const createServiceRequest = internalMutation({
  args: { token: v.string(), message: v.string(), preferred_date: v.optional(v.string()) },
  handler: async (ctx, args) => await createServiceRequestForToken(ctx, args.token, { message: args.message, preferred_date: args.preferred_date }),
});

/** Public. Per-token limiter reuses the report-access bucket (60/hour). */
export const getPortal = action({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<PortalLookup | { found: false; failure_reason: "rate_limited"; error: string }> => {
    if (!isPlausibleToken(args.token)) return { found: false, failure_reason: "not_found", error: "This portal link is not valid." };
    const limit: { allowed: boolean; retryAfter?: number } = await ctx.runMutation(internal.rateLimit.checkAndConsumeRateLimit, {
      userId: `portal:${args.token}`,
      action: "report.access",
    });
    if (!limit.allowed) {
      return { found: false, failure_reason: "rate_limited", error: "Too many requests. Please try again in a few minutes." };
    }
    const result: PortalLookup = await ctx.runQuery(internal.portal.getPortalInternal, { token: args.token });
    if (result.found) await ctx.runMutation(internal.portal.touchPortalToken, { token: args.token });
    return result;
  },
});

/** Public. Stricter per-token limiter (20/minute) for writes. */
export const requestService = action({
  args: { token: v.string(), message: v.string(), preferred_date: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ ok: true; work_order_id: Id<"workOrders"> } | { ok: false; error: string }> => {
    if (!isPlausibleToken(args.token)) return { ok: false, error: "This portal link is not valid." };
    const limit: { allowed: boolean } = await ctx.runMutation(internal.rateLimit.checkAndConsumeRateLimit, {
      userId: `portal:${args.token}`,
      action: "customer.create",
    });
    if (!limit.allowed) return { ok: false, error: "Too many requests. Please try again in a minute." };
    try {
      return await ctx.runMutation(internal.portal.createServiceRequest, args);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Could not send your request." };
    }
  },
});
