/**
 * Work tickets (docs/WORK_TICKETS_API.md): a customer, line items, photos and
 * a status, mirrored into the business's connected Square account as a real
 * Square invoice.
 *
 * Queries/mutations own all db work; actions do Square and messaging I/O and
 * call the internal functions below. Money is cents in the db, dollars at the
 * API boundary.
 */

import { v } from "convex/values";
import {
  type ActionCtx,
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import {
  CUSTOMER_WRITE_ROLES,
  FIELD_WRITE_ROLES,
  assertCustomerAccess,
  getAccessContext,
  type AccessContext,
} from "./access";
import { enforceRateLimit } from "./rateLimit";
import { connectionNeedsReconnect } from "./squareConnect";
import { validateEmail, validatePhone } from "./validation";
import { MAX_SMS_MESSAGE_LENGTH, deliverCommunicationNow } from "./communications";
import {
  type ExternalMethod,
  TICKET_CONNECT_MESSAGE,
  cancelInvoice,
  deleteDraftInvoice,
  ensureSquareCustomer,
  getInvoice,
  readableSquareError,
  recordExternalPayment,
  requireTicketSeller,
  pushTicketToSquare,
  type TicketSendContext,
} from "./squareInvoices";
import {
  type TicketFilter,
  type TicketItemCents,
  type TimelineEvent,
  MAX_TICKET_PHOTOS,
  appendTimeline,
  assertSendableTotal,
  centsToDollars,
  formatUsd,
  invoiceEventFacts,
  isOverdue,
  itemsToDollars,
  itemsTotalCents,
  legacyInvoiceStatus,
  legacyItems,
  legacyQuoteStatus,
  localDateString,
  matchesFilter,
  normalizeNote,
  normalizeTicketItems,
  planTicketInvoiceEvent,
  safeNetDays,
  safeTimeZone,
} from "./ticketLogic";
import { scheduleNextTotalCents } from "./billingCompute";

const itemValidator = v.object({ label: v.string(), amount: v.number() });
const kindValidator = v.union(v.literal("charge"), v.literal("quote"));
const methodValidator = v.union(v.literal("cash"), v.literal("check"), v.literal("other"));

const NO_BUSINESS_MESSAGE = "Set up your business in Settings to use tickets.";
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const LIST_LIMIT = 300;
const REMINDER_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const SEND_LOCK_MS = 2 * 60 * 1000;

export type TicketView = {
  _id: Id<"tickets">;
  customer_id: Id<"customers">;
  customer_name: string;
  kind: "charge" | "quote";
  status: "draft" | "quote" | "requested" | "paid" | "canceled";
  overdue: boolean;
  note: string;
  items: { label: string; amount: number }[];
  total: number;
  photo_urls: string[];
  paid_method?: "square" | "cash" | "check" | "other";
  square_invoice_number?: string;
  square_invoice_url?: string;
  schedule_id?: Id<"billingSchedules">;
  timeline: TimelineEvent[];
  created_at: number;
  updated_at: number;
};

// ---------------------------------------------------------------------------
// Access helpers
// ---------------------------------------------------------------------------

async function identityEmail(ctx: { auth: { getUserIdentity: () => Promise<any> } }): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not authenticated");
  if (!identity.email) throw new Error("Authenticated account is missing an email address.");
  return identity.email as string;
}

type BusinessAccess = AccessContext & { business: Doc<"businesses">; businessId: Id<"businesses"> };

/** Caller's business + role; throws unless the role is in `roles`. */
export async function requireBusinessRole(ctx: any, email: string, roles: readonly string[] | null): Promise<BusinessAccess> {
  const access = await getAccessContext(ctx, email);
  if (!access.business) throw new Error(NO_BUSINESS_MESSAGE);
  if (!access.role || (roles && !roles.includes(access.role))) {
    throw new Error(roles === CUSTOMER_WRITE_ROLES
      ? "Only business owners and admins can do this."
      : "Your role does not allow this.");
  }
  return access as BusinessAccess;
}

async function optionalBusinessAccess(ctx: any): Promise<BusinessAccess | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.email) return null;
  const access = await getAccessContext(ctx, identity.email);
  if (!access.business || !access.role) return null;
  return access as BusinessAccess;
}

/** The customer must be accessible to the caller AND belong to the caller's business. */
export async function requireBusinessCustomer(
  ctx: any,
  access: BusinessAccess,
  customerId: Id<"customers">,
  roles: readonly string[],
): Promise<Doc<"customers">> {
  const { customer } = await assertCustomerAccess(ctx, customerId, access.email, { roles });
  const sameBusiness = customer.business_id
    ? String(customer.business_id) === String(access.businessId)
    : String(customer.created_by).toLowerCase() === String(access.business.owner_email).toLowerCase();
  if (!sameBusiness) throw new Error("Customer not found or access denied");
  return customer as Doc<"customers">;
}

async function loadTicket(ctx: any, access: BusinessAccess, id: Id<"tickets">): Promise<Doc<"tickets">> {
  const ticket = await ctx.db.get(id);
  if (!ticket || String(ticket.business_id) !== String(access.businessId)) throw new Error("Ticket not found.");
  return ticket;
}

export function businessTimeZone(business: { timezone?: string } | null | undefined): string {
  return safeTimeZone(business?.timezone);
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export async function toTicketView(ctx: any, ticket: Doc<"tickets">, customerName: string, today: string): Promise<TicketView> {
  const photoUrls: string[] = [];
  for (const storageId of ticket.photo_storage_ids ?? []) {
    const url = await ctx.storage.getUrl(storageId);
    if (url) photoUrls.push(url);
  }
  return {
    _id: ticket._id,
    customer_id: ticket.customer_id,
    customer_name: customerName,
    kind: ticket.kind as TicketView["kind"],
    status: ticket.status as TicketView["status"],
    overdue: isOverdue(ticket, today),
    note: ticket.note,
    items: itemsToDollars(ticket.items),
    total: centsToDollars(ticket.total_cents),
    photo_urls: photoUrls,
    paid_method: ticket.paid_method as TicketView["paid_method"],
    square_invoice_number: ticket.square_invoice_number,
    square_invoice_url: ticket.square_invoice_url,
    schedule_id: ticket.schedule_id,
    timeline: ticket.timeline,
    created_at: ticket.created_at,
    updated_at: ticket.updated_at,
  };
}

async function customerNames(ctx: any, ids: Id<"customers">[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (const id of ids) {
    const key = String(id);
    if (names.has(key)) continue;
    const customer = await ctx.db.get(id);
    names.set(key, customer?.full_name || "Customer");
  }
  return names;
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

async function claimPhotos(ctx: any, businessId: Id<"businesses">, ids: Id<"_storage">[] | undefined): Promise<Id<"_storage">[]> {
  const unique = Array.from(new Set((ids ?? []).map(String))) as Id<"_storage">[];
  if (unique.length > MAX_TICKET_PHOTOS) throw new Error(`A ticket can have at most ${MAX_TICKET_PHOTOS} photos.`);
  for (const storageId of unique) {
    const claim = await ctx.db
      .query("ticketPhotoClaims")
      .withIndex("by_storage_id", (q: any) => q.eq("storage_id", storageId))
      .first();
    if (claim) {
      if (String(claim.business_id) !== String(businessId)) throw new Error("A photo could not be attached.");
      continue;
    }
    const metadata = await ctx.db.system.get(storageId);
    if (!metadata) throw new Error("A photo upload is missing. Please upload it again.");
    if (metadata.contentType && !String(metadata.contentType).startsWith("image/")) throw new Error("Only images can be attached.");
    if (typeof metadata.size === "number" && metadata.size > MAX_PHOTO_BYTES) throw new Error("Photos must be 10 MB or smaller.");
    const servicePhoto = await ctx.db
      .query("servicePhotos")
      .withIndex("by_storage_id", (q: any) => q.eq("storage_id", storageId))
      .first();
    if (servicePhoto) throw new Error("A photo could not be attached.");
    await ctx.db.insert("ticketPhotoClaims", { storage_id: storageId, business_id: businessId, created_at: Date.now() });
  }
  return unique;
}

export async function releasePhotos(ctx: any, ids: Id<"_storage">[]): Promise<void> {
  for (const storageId of ids) {
    const claims = await ctx.db
      .query("ticketPhotoClaims")
      .withIndex("by_storage_id", (q: any) => q.eq("storage_id", storageId))
      .take(5);
    for (const claim of claims) await ctx.db.delete(claim._id);
    try {
      await ctx.storage.delete(storageId);
    } catch (error) {
      console.warn("[Tickets] Photo delete failed", error instanceof Error ? error.message : String(error));
    }
  }
}

// ---------------------------------------------------------------------------
// Draft upsert (shared by saveDraft / send / recordPaidInPerson)
// ---------------------------------------------------------------------------

type DraftInput = {
  id?: Id<"tickets">;
  customer_id: Id<"customers">;
  kind: "charge" | "quote";
  note: string;
  items: { label: string; amount: number }[];
  photo_storage_ids?: Id<"_storage">[];
};

async function upsertDraft(ctx: any, access: BusinessAccess, input: DraftInput): Promise<Doc<"tickets">> {
  await requireBusinessCustomer(ctx, access, input.customer_id, FIELD_WRITE_ROLES);
  const items = normalizeTicketItems(input.items);
  const note = normalizeNote(input.note);
  const now = Date.now();
  if (input.id) {
    const existing = await loadTicket(ctx, access, input.id);
    if (existing.status !== "draft") throw new Error("Only drafts can be edited.");
    if (existing.square_invoice_id) {
      // A send reached Square but was not confirmed; resend as-is so the existing invoice is adopted.
      const unchanged = JSON.stringify(normalizeTicketItems(input.items)) === JSON.stringify(existing.items)
        && input.customer_id === existing.customer_id;
      if (!unchanged) throw new Error("This ticket has a Square invoice in progress. Send it again without changes, or cancel it.");
    }
    const photos = input.photo_storage_ids === undefined
      ? existing.photo_storage_ids
      : await claimPhotos(ctx, access.businessId, input.photo_storage_ids);
    const removed = existing.photo_storage_ids.filter((id) => !photos.map(String).includes(String(id)));
    await releasePhotos(ctx, removed);
    await ctx.db.patch(existing._id, {
      customer_id: input.customer_id,
      kind: input.kind,
      note,
      items,
      total_cents: itemsTotalCents(items),
      photo_storage_ids: photos,
      updated_at: now,
    });
    return (await ctx.db.get(existing._id))!;
  }
  const photos = await claimPhotos(ctx, access.businessId, input.photo_storage_ids);
  const id = await ctx.db.insert("tickets", {
    business_id: access.businessId,
    created_by: access.tenantEmail,
    created_by_user: access.email,
    customer_id: input.customer_id,
    kind: input.kind,
    status: "draft",
    note,
    items,
    total_cents: itemsTotalCents(items),
    photo_storage_ids: photos,
    timeline: [{ type: "created", text: input.kind === "quote" ? "Quote drafted" : "Ticket created", at: now }],
    created_at: now,
    updated_at: now,
  });
  return (await ctx.db.get(id))!;
}

/** Everything an action needs to send a ticket to Square / message the customer. */
export async function buildSendContext(ctx: any, ticket: Doc<"tickets">): Promise<TicketSendContext> {
  const business = await ctx.db.get(ticket.business_id);
  const customer = await ctx.db.get(ticket.customer_id);
  if (!business) throw new Error(NO_BUSINESS_MESSAGE);
  if (!customer) throw new Error("Customer not found.");
  return {
    ticket_id: ticket._id,
    business_id: ticket.business_id,
    tenant_email: business.owner_email,
    business_name: business.name || "ChemCheck",
    timezone: businessTimeZone(business),
    net_days: safeNetDays(business.invoice_net_days),
    kind: ticket.kind,
    status: ticket.status,
    note: ticket.note,
    items: ticket.items,
    total_cents: ticket.total_cents,
    square_invoice_id: ticket.square_invoice_id,
    square_invoice_version: ticket.square_invoice_version,
    square_invoice_number: ticket.square_invoice_number,
    square_invoice_url: ticket.square_invoice_url,
    square_due_date: ticket.square_due_date,
    square_customer_id: ticket.square_customer_id,
    period_label: ticket.period_label,
    customer: {
      _id: customer._id,
      full_name: customer.full_name,
      email: customer.email ?? null,
      phone: customer.phone ?? null,
      square_customer_id: customer.square_customer_id ?? null,
      square_merchant_id: customer.square_merchant_id ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const list = query({
  args: { filter: v.optional(v.union(v.literal("all"), v.literal("open"), v.literal("quote"), v.literal("paid"))) },
  handler: async (ctx, args): Promise<TicketView[]> => {
    const access = await optionalBusinessAccess(ctx);
    if (!access) return [];
    const rows = await ctx.db
      .query("tickets")
      .withIndex("by_business_and_updated", (q) => q.eq("business_id", access.businessId))
      .order("desc")
      .take(LIST_LIMIT);
    const filtered = rows
      .filter((row) => matchesFilter(row.status, args.filter as TicketFilter | undefined))
      .sort((a, b) => b.created_at - a.created_at);
    const names = await customerNames(ctx, filtered.map((row) => row.customer_id));
    const today = localDateString(Date.now(), businessTimeZone(access.business));
    const views: TicketView[] = [];
    for (const row of filtered) views.push(await toTicketView(ctx, row, names.get(String(row.customer_id)) ?? "Customer", today));
    return views;
  },
});

export const get = query({
  args: { id: v.id("tickets") },
  handler: async (ctx, args): Promise<TicketView | null> => {
    const access = await optionalBusinessAccess(ctx);
    if (!access) return null;
    const ticket = await ctx.db.get(args.id);
    if (!ticket || String(ticket.business_id) !== String(access.businessId)) return null;
    const customer = await ctx.db.get(ticket.customer_id);
    const today = localDateString(Date.now(), businessTimeZone(access.business));
    return await toTicketView(ctx, ticket, customer?.full_name || "Customer", today);
  },
});

/** Resolve an old invoice URL to the migrated ticket in the caller's business. */
export const findMigratedInvoice = query({
  args: { invoice_id: v.string() },
  returns: v.union(v.id("tickets"), v.null()),
  handler: async (ctx, args): Promise<Id<"tickets"> | null> => {
    const access = await optionalBusinessAccess(ctx);
    if (!access || !args.invoice_id.trim()) return null;
    const ticket = await ctx.db
      .query("tickets")
      .withIndex("by_legacy_source", (q) => q.eq("legacy_source", `invoice:${args.invoice_id}`))
      .first();
    return ticket && String(ticket.business_id) === String(access.businessId) ? ticket._id : null;
  },
});

export const summary = query({
  args: {},
  handler: async (ctx) => {
    const empty = {
      outstanding: 0,
      open_requests: 0,
      paid_this_week: 0,
      recurring_active: 0,
      recurring_next_total: 0,
      recurring_next_run_at: null as number | null,
      square: { connected: false, needs_reconnect: false },
    };
    const access = await optionalBusinessAccess(ctx);
    if (!access) return empty;
    const now = Date.now();

    const requested = await ctx.db
      .query("tickets")
      .withIndex("by_business_and_status", (q) => q.eq("business_id", access.businessId).eq("status", "requested"))
      .take(1000);
    const paid = await ctx.db
      .query("tickets")
      .withIndex("by_business_and_status", (q) => q.eq("business_id", access.businessId).eq("status", "paid"))
      .order("desc")
      .take(1000);
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const paidThisWeek = paid.filter((t) => typeof t.paid_at === "number" && t.paid_at >= weekAgo);

    const schedules = await ctx.db
      .query("billingSchedules")
      .withIndex("by_business", (q) => q.eq("business_id", access.businessId))
      .take(200);
    const active = schedules.filter((s) => !s.paused);
    let nextTotal = 0;
    let nextRun: number | null = null;
    for (const schedule of active) {
      nextTotal += await scheduleNextTotalCents(ctx, schedule, access.business, now);
      if (typeof schedule.next_run_at === "number" && (nextRun === null || schedule.next_run_at < nextRun)) nextRun = schedule.next_run_at;
    }

    const account = await ctx.db
      .query("squareSellerAccounts")
      .withIndex("by_business", (q) => q.eq("business_id", access.businessId))
      .first();

    return {
      outstanding: centsToDollars(requested.reduce((sum, t) => sum + t.total_cents, 0)),
      open_requests: requested.length,
      paid_this_week: centsToDollars(paidThisWeek.reduce((sum, t) => sum + t.total_cents, 0)),
      recurring_active: active.length,
      recurring_next_total: centsToDollars(nextTotal),
      recurring_next_run_at: nextRun,
      square: {
        connected: Boolean(account?.location_id),
        needs_reconnect: connectionNeedsReconnect(account, now),
      },
    };
  },
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const generatePhotoUploadUrl = mutation({
  args: {},
  handler: async (ctx): Promise<string> => {
    const email = await identityEmail(ctx);
    await requireBusinessRole(ctx, email, FIELD_WRITE_ROLES);
    await enforceRateLimit(ctx, email, "ticket.write");
    return await ctx.storage.generateUploadUrl();
  },
});

export const saveDraft = mutation({
  args: {
    id: v.optional(v.id("tickets")),
    customer_id: v.id("customers"),
    kind: kindValidator,
    note: v.string(),
    items: v.array(itemValidator),
    photo_storage_ids: v.optional(v.array(v.id("_storage"))),
  },
  handler: async (ctx, args): Promise<Id<"tickets">> => {
    const email = await identityEmail(ctx);
    await enforceRateLimit(ctx, email, "ticket.write");
    const access = await requireBusinessRole(ctx, email, FIELD_WRITE_ROLES);
    const ticket = await upsertDraft(ctx, access, args);
    return ticket._id;
  },
});

export const declineQuote = mutation({
  args: { id: v.id("tickets") },
  handler: async (ctx, args) => {
    const email = await identityEmail(ctx);
    await enforceRateLimit(ctx, email, "ticket.write");
    const access = await requireBusinessRole(ctx, email, FIELD_WRITE_ROLES);
    const ticket = await loadTicket(ctx, access, args.id);
    if (ticket.status !== "quote") throw new Error("Only a sent quote can be declined.");
    const now = Date.now();
    await ctx.db.patch(ticket._id, {
      status: "canceled",
      timeline: appendTimeline(ticket.timeline, { type: "declined", text: "Quote declined", at: now }),
      updated_at: now,
    });
    return null;
  },
});

export const deleteDraft = mutation({
  args: { id: v.id("tickets") },
  handler: async (ctx, args) => {
    const email = await identityEmail(ctx);
    await enforceRateLimit(ctx, email, "ticket.write");
    const access = await requireBusinessRole(ctx, email, FIELD_WRITE_ROLES);
    const ticket = await loadTicket(ctx, access, args.id);
    if (ticket.status !== "draft") throw new Error("Only drafts can be deleted.");
    if (ticket.square_invoice_id) throw new Error("This draft has a Square invoice in progress. Cancel it instead.");
    await releasePhotos(ctx, ticket.photo_storage_ids);
    await ctx.db.delete(ticket._id);
    return null;
  },
});

// ---------------------------------------------------------------------------
// Internal functions used by actions
// ---------------------------------------------------------------------------

const draftArgs = {
  user_email: v.string(),
  id: v.optional(v.id("tickets")),
  customer_id: v.id("customers"),
  kind: kindValidator,
  note: v.string(),
  items: v.array(itemValidator),
  photo_storage_ids: v.optional(v.array(v.id("_storage"))),
};

/** Save the draft, check it can be sent, return the send context. */
export const prepareSend = internalMutation({
  args: draftArgs,
  handler: async (ctx, args): Promise<TicketSendContext> => {
    await enforceRateLimit(ctx, args.user_email, "ticket.send");
    const access = await requireBusinessRole(ctx, args.user_email, FIELD_WRITE_ROLES);
    const { user_email: _email, ...input } = args;
    const ticket = await upsertDraft(ctx, access, input);
    assertSendableTotal(ticket.total_cents);
    return await buildSendContext(ctx, ticket);
  },
});

/** Load a ticket for an action after checking the caller's role and the expected status. */
export const getForAction = internalMutation({
  args: {
    user_email: v.string(),
    id: v.id("tickets"),
    billing: v.optional(v.boolean()),
    statuses: v.array(v.string()),
    rate_action: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<TicketSendContext> => {
    await enforceRateLimit(ctx, args.user_email, args.rate_action ?? "ticket.send");
    const access = await requireBusinessRole(ctx, args.user_email, args.billing ? CUSTOMER_WRITE_ROLES : FIELD_WRITE_ROLES);
    const ticket = await loadTicket(ctx, access, args.id);
    if (!args.statuses.includes(ticket.status)) {
      throw new Error(ticketStatusError(ticket.status));
    }
    return await buildSendContext(ctx, ticket);
  },
});

function ticketStatusError(status: string): string {
  switch (status) {
    case "paid":
      return "This ticket is already paid.";
    case "canceled":
      return "This ticket is canceled.";
    case "requested":
      return "This ticket was already sent.";
    case "quote":
      return "This quote is waiting for the customer's approval.";
    default:
      return "This ticket is still a draft.";
  }
}

/** Starts a Square send attempt: returns the attempt number (scopes idempotency keys). */
export const startSquareAttempt = internalMutation({
  args: { ticket_id: v.id("tickets"), statuses: v.array(v.string()) },
  handler: async (ctx, args): Promise<{ attempt: number; square_invoice_id?: string }> => {
    const ticket = await ctx.db.get(args.ticket_id);
    if (!ticket) throw new Error("Ticket not found.");
    if (!args.statuses.includes(ticket.status)) throw new Error(ticketStatusError(ticket.status));
    const now = Date.now();
    if (typeof ticket.square_lock_until === "number" && ticket.square_lock_until > now) {
      throw new Error("This ticket is already being sent. Try again in a minute.");
    }
    const attempt = (ticket.square_attempts ?? 0) + 1;
    await ctx.db.patch(ticket._id, { square_attempts: attempt, square_lock_until: now + SEND_LOCK_MS, updated_at: now });
    return { attempt, square_invoice_id: ticket.square_invoice_id };
  },
});

/** Remember the unpublished Square order/invoice so a retry can clean it up. */
export const recordSquareDraft = internalMutation({
  args: {
    ticket_id: v.id("tickets"),
    square_customer_id: v.string(),
    square_order_id: v.string(),
    square_invoice_id: v.optional(v.string()),
    square_invoice_version: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const ticket = await ctx.db.get(args.ticket_id);
    if (!ticket) return;
    await ctx.db.patch(ticket._id, {
      square_customer_id: args.square_customer_id,
      square_order_id: args.square_order_id,
      square_invoice_id: args.square_invoice_id,
      square_invoice_version: args.square_invoice_version,
      updated_at: Date.now(),
    });
  },
});

export const markRequested = internalMutation({
  args: {
    ticket_id: v.id("tickets"),
    from_statuses: v.array(v.string()),
    square_customer_id: v.optional(v.string()),
    square_order_id: v.optional(v.string()),
    square_invoice_id: v.string(),
    square_invoice_version: v.number(),
    square_invoice_number: v.optional(v.string()),
    square_invoice_url: v.optional(v.string()),
    square_due_date: v.optional(v.string()),
    events: v.array(v.object({ type: v.string(), text: v.string() })),
    paid: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const ticket = await ctx.db.get(args.ticket_id);
    if (!ticket) throw new Error("Ticket not found.");
    if (ticket.status === "requested" && ticket.square_invoice_id === args.square_invoice_id) return;
    if (!args.from_statuses.includes(ticket.status)) throw new Error(ticketStatusError(ticket.status));
    const now = Date.now();
    let timeline = ticket.timeline;
    for (const event of args.events) timeline = appendTimeline(timeline, { ...event, at: now });
    await ctx.db.patch(ticket._id, {
      status: args.paid ? "paid" : "requested",
      ...(args.paid ? { paid_method: "square", paid_at: now } : {}),
      square_customer_id: args.square_customer_id ?? ticket.square_customer_id,
      square_order_id: args.square_order_id ?? ticket.square_order_id,
      square_invoice_id: args.square_invoice_id,
      square_invoice_version: args.square_invoice_version,
      square_invoice_number: args.square_invoice_number,
      square_invoice_url: args.square_invoice_url,
      square_due_date: args.square_due_date,
      square_lock_until: undefined,
      timeline,
      updated_at: now,
    });
  },
});

export const addTimeline = internalMutation({
  args: {
    ticket_id: v.id("tickets"),
    type: v.string(),
    text: v.string(),
    clear_square_draft: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const ticket = await ctx.db.get(args.ticket_id);
    if (!ticket) return;
    const now = Date.now();
    await ctx.db.patch(ticket._id, {
      timeline: appendTimeline(ticket.timeline, { type: args.type, text: args.text, at: now }),
      ...(args.type === "error" ? { square_lock_until: undefined } : {}),
      ...(args.clear_square_draft ? { square_invoice_id: undefined, square_invoice_version: undefined, square_order_id: undefined } : {}),
      updated_at: now,
    });
  },
});

export const markQuoteSent = internalMutation({
  args: { ticket_id: v.id("tickets"), text: v.string() },
  handler: async (ctx, args) => {
    const ticket = await ctx.db.get(args.ticket_id);
    if (!ticket) throw new Error("Ticket not found.");
    if (ticket.status !== "draft") throw new Error(ticketStatusError(ticket.status));
    const now = Date.now();
    await ctx.db.patch(ticket._id, {
      status: "quote",
      timeline: appendTimeline(ticket.timeline, { type: "quote_sent", text: args.text, at: now }),
      updated_at: now,
    });
  },
});

export const setSettling = internalMutation({
  args: { ticket_id: v.id("tickets"), settling: v.boolean() },
  handler: async (ctx, args) => {
    const ticket = await ctx.db.get(args.ticket_id);
    if (!ticket) return;
    await ctx.db.patch(ticket._id, { settling_outside_square: args.settling ? true : undefined, updated_at: Date.now() });
  },
});

export const markPaidInternal = internalMutation({
  args: {
    ticket_id: v.id("tickets"),
    method: v.string(),
    from_statuses: v.array(v.string()),
    square_payment_id: v.optional(v.string()),
    square_order_id: v.optional(v.string()),
    square_customer_id: v.optional(v.string()),
    events: v.array(v.object({ type: v.string(), text: v.string() })),
  },
  handler: async (ctx, args) => {
    const ticket = await ctx.db.get(args.ticket_id);
    if (!ticket) throw new Error("Ticket not found.");
    if (ticket.status === "paid") return;
    // A ticket whose Square invoice was canceled for settlement may already read canceled.
    const allowed = args.from_statuses.includes(ticket.status)
      || (ticket.status === "canceled" && ticket.settling_outside_square === true);
    if (!allowed) throw new Error(ticketStatusError(ticket.status));
    const now = Date.now();
    let timeline = ticket.timeline;
    for (const event of args.events) timeline = appendTimeline(timeline, { ...event, at: now });
    await ctx.db.patch(ticket._id, {
      status: "paid",
      paid_method: args.method,
      paid_at: now,
      square_payment_id: args.square_payment_id ?? ticket.square_payment_id,
      square_customer_id: args.square_customer_id ?? ticket.square_customer_id,
      // Keep the invoice's order id when there was one; external orders are logged via the payment.
      square_order_id: ticket.square_order_id ?? args.square_order_id,
      settling_outside_square: undefined,
      timeline,
      updated_at: now,
    });
  },
});

export const markCanceled = internalMutation({
  args: { ticket_id: v.id("tickets"), text: v.string(), square_invoice_version: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const ticket = await ctx.db.get(args.ticket_id);
    if (!ticket) throw new Error("Ticket not found.");
    if (ticket.status === "canceled") return;
    if (ticket.status === "paid") throw new Error("This ticket is already paid.");
    const now = Date.now();
    await ctx.db.patch(ticket._id, {
      status: "canceled",
      square_invoice_version: args.square_invoice_version ?? ticket.square_invoice_version,
      timeline: appendTimeline(ticket.timeline, { type: "canceled", text: args.text, at: now }),
      updated_at: now,
    });
  },
});

export const linkSquareCustomer = internalMutation({
  args: { customer_id: v.id("customers"), square_customer_id: v.string(), square_merchant_id: v.string() },
  handler: async (ctx, args) => {
    const customer = await ctx.db.get(args.customer_id);
    if (!customer) return;
    if (customer.square_customer_id === args.square_customer_id && customer.square_merchant_id === args.square_merchant_id) return;
    await ctx.db.patch(customer._id, {
      square_customer_id: args.square_customer_id,
      square_merchant_id: args.square_merchant_id,
    });
  },
});

/** Queue a ticket message to the customer's own phone/email (sent by the tenant). */
export const queueCustomerMessage = internalMutation({
  args: {
    ticket_id: v.id("tickets"),
    channel: v.union(v.literal("sms"), v.literal("email")),
    template_key: v.string(),
    message: v.string(),
  },
  handler: async (ctx, args): Promise<Id<"communications">> => {
    const ticket = await ctx.db.get(args.ticket_id);
    if (!ticket) throw new Error("Ticket not found.");
    const customer = await ctx.db.get(ticket.customer_id);
    if (!customer) throw new Error("Customer not found.");
    const business = await ctx.db.get(ticket.business_id);
    if (!business) throw new Error(NO_BUSINESS_MESSAGE);
    let recipient: string | undefined;
    try {
      recipient = args.channel === "sms" ? validatePhone(customer.phone) : validateEmail(customer.email);
    } catch {
      recipient = undefined;
    }
    if (!recipient) throw new Error(args.channel === "sms" ? "The customer's phone number is invalid." : "The customer's email is invalid.");
    const now = Date.now();
    return await ctx.db.insert("communications", {
      type: "ticket",
      channel: args.channel,
      recipient,
      customer_id: customer._id,
      ticket_id: ticket._id,
      template_key: args.template_key,
      status: "queued",
      message: args.message,
      scheduled_for: now,
      attempts: 0,
      created_by: business.owner_email,
      created_at: now,
      updated_at: now,
    });
  },
});

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

function firstName(fullName: string): string {
  return String(fullName || "").trim().split(/\s+/)[0] || "there";
}

/** Quote text: items and total; trimmed to fit an SMS when needed. */
export function buildQuoteMessage(args: {
  businessName: string;
  customerName: string;
  items: TicketItemCents[];
  totalCents: number;
  note: string;
  channel: "sms" | "email";
}): string {
  const header = `Hi ${firstName(args.customerName)}, here is your quote from ${args.businessName}:`;
  const footer = `Total: ${formatUsd(args.totalCents)}\nReply to this message to approve.`;
  const lines = args.items.map((item) => `- ${item.label}: ${formatUsd(item.amount_cents)}`);
  const note = args.note ? `\n${args.note}` : "";
  const full = [header, ...lines, footer].join("\n") + note;
  if (args.channel === "email" || full.length <= MAX_SMS_MESSAGE_LENGTH) return full.slice(0, 5000);
  const kept: string[] = [];
  for (const line of lines) {
    const candidate = [header, ...kept, line, `(+${lines.length - kept.length - 1} more)`, footer].join("\n");
    if (candidate.length > MAX_SMS_MESSAGE_LENGTH) break;
    kept.push(line);
  }
  const more = lines.length - kept.length;
  return [header, ...kept, ...(more > 0 ? [`(+${more} more)`] : []), footer].join("\n").slice(0, MAX_SMS_MESSAGE_LENGTH);
}

export function preferredChannel(customer: { email?: string | null; phone?: string | null }, prefer: "sms" | "email"): "sms" | "email" | null {
  let phone: string | undefined;
  let email: string | undefined;
  try {
    phone = validatePhone(customer.phone ?? undefined);
  } catch {
    phone = undefined;
  }
  try {
    email = validateEmail(customer.email ?? undefined);
  } catch {
    email = undefined;
  }
  if (prefer === "sms") return phone ? "sms" : email ? "email" : null;
  return email ? "email" : phone ? "sms" : null;
}

async function sendCustomerMessage(
  ctx: ActionCtx,
  sc: TicketSendContext,
  channel: "sms" | "email",
  templateKey: string,
  message: string,
): Promise<{ ok: boolean; error?: string }> {
  const id = await ctx.runMutation(internal.tickets.queueCustomerMessage, {
    ticket_id: sc.ticket_id,
    channel,
    template_key: templateKey,
    message,
  });
  const result = await deliverCommunicationNow(ctx, id, sc.tenant_email);
  return result.success ? { ok: true } : { ok: false, error: result.error || "Message could not be delivered." };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

const sendArgs = {
  id: v.optional(v.id("tickets")),
  customer_id: v.id("customers"),
  kind: kindValidator,
  note: v.string(),
  items: v.array(itemValidator),
  photo_storage_ids: v.optional(v.array(v.id("_storage"))),
};

export const send = action({
  args: sendArgs,
  handler: async (ctx, args): Promise<{
    id: Id<"tickets">;
    status: string;
    square_invoice_number?: string;
    delivered_via: "email" | "sms" | "link";
  }> => {
    const email = await identityEmail(ctx);
    const sc: TicketSendContext = await ctx.runMutation(internal.tickets.prepareSend, { user_email: email, ...args });

    if (sc.kind === "quote") {
      const channel = preferredChannel(sc.customer, "sms");
      if (!channel) {
        const message = "Add a phone number or email to this customer to send the quote.";
        await ctx.runMutation(internal.tickets.addTimeline, { ticket_id: sc.ticket_id, type: "error", text: message });
        throw new Error(message);
      }
      const text = buildQuoteMessage({
        businessName: sc.business_name,
        customerName: sc.customer.full_name,
        items: sc.items,
        totalCents: sc.total_cents,
        note: sc.note,
        channel,
      });
      const result = await sendCustomerMessage(ctx, sc, channel, "ticket_quote", text);
      if (!result.ok) {
        const message = `The quote could not be sent: ${result.error}`;
        await ctx.runMutation(internal.tickets.addTimeline, { ticket_id: sc.ticket_id, type: "error", text: message });
        throw new Error(message);
      }
      await ctx.runMutation(internal.tickets.markQuoteSent, {
        ticket_id: sc.ticket_id,
        text: `Quote sent by ${channel === "sms" ? "text" : "email"}`,
      });
      return { id: sc.ticket_id, status: "quote", delivered_via: channel };
    }

    const result = await pushTicketToSquare(ctx, sc, { fromStatuses: ["draft"], autopay: false, events: [] });
    return {
      id: sc.ticket_id,
      status: result.status,
      square_invoice_number: result.square_invoice_number,
      delivered_via: result.delivered_via,
    };
  },
});

export const approveQuote = action({
  args: { id: v.id("tickets") },
  handler: async (ctx, args): Promise<{ id: Id<"tickets">; square_invoice_number?: string }> => {
    const email = await identityEmail(ctx);
    const sc: TicketSendContext = await ctx.runMutation(internal.tickets.getForAction, {
      user_email: email,
      id: args.id,
      statuses: ["quote"],
    });
    assertSendableTotal(sc.total_cents);
    const result = await pushTicketToSquare(ctx, sc, {
      fromStatuses: ["quote"],
      autopay: false,
      events: [{ type: "approved", text: "Quote approved" }],
    });
    return { id: sc.ticket_id, square_invoice_number: result.square_invoice_number };
  },
});

const METHOD_LABEL: Record<ExternalMethod, string> = { cash: "cash", check: "check", other: "other" };

/** Best-effort bookkeeping of an in-person payment in Square. Returns events + warning. */
async function recordInSquare(
  ctx: ActionCtx,
  sc: TicketSendContext,
  method: ExternalMethod,
): Promise<{ events: { type: string; text: string }[]; warning?: string; payment_id?: string; order_id?: string; square_customer_id?: string }> {
  const account = await ctx.runQuery(internal.squareConnect.getSellerAccountByBusiness, { business_id: sc.business_id });
  if (!account?.location_id) {
    return { events: [{ type: "note", text: "Not recorded in Square (Square is not connected)" }] };
  }
  try {
    const seller = await requireTicketSeller(ctx, sc.business_id);
    const squareCustomerId = await ensureSquareCustomer(ctx, seller, sc.customer);
    const payment = await recordExternalPayment(seller, {
      ticketId: String(sc.ticket_id),
      squareCustomerId,
      items: sc.items,
      totalCents: sc.total_cents,
      method,
    });
    return {
      events: [{ type: "square", text: "Recorded in Square sales" }],
      payment_id: payment.payment_id,
      order_id: payment.order_id,
      square_customer_id: squareCustomerId,
    };
  } catch (error) {
    const warning = readableSquareError(error, "record the payment");
    return { events: [{ type: "error", text: warning }], warning };
  }
}

export const recordPaidInPerson = action({
  args: {
    id: v.optional(v.id("tickets")),
    customer_id: v.id("customers"),
    note: v.string(),
    items: v.array(itemValidator),
    photo_storage_ids: v.optional(v.array(v.id("_storage"))),
    method: methodValidator,
  },
  handler: async (ctx, args): Promise<{ id: Id<"tickets">; warning?: string }> => {
    const email = await identityEmail(ctx);
    const { method, ...draft } = args;
    const sc: TicketSendContext = await ctx.runMutation(internal.tickets.prepareSend, {
      user_email: email,
      ...draft,
      kind: "charge",
    });
    const square = await recordInSquare(ctx, sc, method);
    await ctx.runMutation(internal.tickets.markPaidInternal, {
      ticket_id: sc.ticket_id,
      method,
      from_statuses: ["draft"],
      square_payment_id: square.payment_id,
      square_order_id: square.order_id,
      square_customer_id: square.square_customer_id,
      events: [{ type: "paid", text: `Paid in person (${METHOD_LABEL[method]})` }, ...square.events],
    });
    return square.warning ? { id: sc.ticket_id, warning: square.warning } : { id: sc.ticket_id };
  },
});

export const markPaid = action({
  args: { id: v.id("tickets"), method: methodValidator },
  handler: async (ctx, args): Promise<{ id: Id<"tickets">; warning?: string }> => {
    const email = await identityEmail(ctx);
    const sc: TicketSendContext = await ctx.runMutation(internal.tickets.getForAction, {
      user_email: email,
      id: args.id,
      statuses: ["requested"],
    });
    const events: { type: string; text: string }[] = [];

    if (sc.square_invoice_id) {
      // Square does not allow paying an invoice's order through the API, so
      // cancel the invoice first and record the payment on a fresh order.
      let seller;
      try {
        seller = await requireTicketSeller(ctx, sc.business_id);
      } catch (error) {
        const message = error instanceof Error ? error.message : TICKET_CONNECT_MESSAGE;
        throw new Error(`${message} The Square invoice must be canceled before marking it paid.`);
      }
      await ctx.runMutation(internal.tickets.setSettling, { ticket_id: sc.ticket_id, settling: true });
      try {
        const current = await getInvoice(seller, sc.square_invoice_id);
        if (current.status === "PAID") {
          await ctx.runMutation(internal.tickets.markPaidInternal, {
            ticket_id: sc.ticket_id,
            method: "square",
            from_statuses: ["requested"],
            events: [{ type: "paid", text: "Already paid in Square" }],
          });
          return { id: sc.ticket_id };
        }
        await cancelInvoice(seller, sc.square_invoice_id, current.version);
        events.push({
          type: "square_canceled",
          text: `Square invoice${sc.square_invoice_number ? ` #${sc.square_invoice_number}` : ""} canceled (paid outside Square)`,
        });
      } catch (error) {
        const message = readableSquareError(error, "cancel the invoice");
        await ctx.runMutation(internal.tickets.setSettling, { ticket_id: sc.ticket_id, settling: false });
        await ctx.runMutation(internal.tickets.addTimeline, { ticket_id: sc.ticket_id, type: "error", text: message });
        throw new Error(message);
      }
    }

    const square = await recordInSquare(ctx, sc, args.method);
    await ctx.runMutation(internal.tickets.markPaidInternal, {
      ticket_id: sc.ticket_id,
      method: args.method,
      from_statuses: ["requested"],
      square_payment_id: square.payment_id,
      square_order_id: square.order_id,
      square_customer_id: square.square_customer_id,
      events: [...events, { type: "paid", text: `Marked paid (${METHOD_LABEL[args.method]})` }, ...square.events],
    });
    return square.warning ? { id: sc.ticket_id, warning: square.warning } : { id: sc.ticket_id };
  },
});

export const remind = action({
  args: { id: v.id("tickets") },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const email = await identityEmail(ctx);
    const sc: TicketSendContext = await ctx.runMutation(internal.tickets.getForAction, {
      user_email: email,
      id: args.id,
      statuses: ["requested"],
    });
    const ticket = await ctx.runQuery(internal.tickets.getTimeline, { ticket_id: sc.ticket_id });
    const lastReminder = [...ticket].reverse().find((event) => event.type === "reminder");
    if (lastReminder && Date.now() - lastReminder.at < REMINDER_COOLDOWN_MS) {
      throw new Error("A reminder was sent recently. Try again later.");
    }
    if (!sc.square_invoice_url) throw new Error("This ticket has no Square payment link to send.");
    // Square has no on-demand "send reminder" API (reminders are scheduled on
    // the invoice), so the reminder goes out through ChemCheck messaging.
    const channel = preferredChannel(sc.customer, "sms");
    if (!channel) throw new Error("Add a phone number or email to this customer to send a reminder.");
    const due = sc.square_due_date ? ` due ${sc.square_due_date}` : "";
    const text = `Reminder from ${sc.business_name}: invoice${sc.square_invoice_number ? ` #${sc.square_invoice_number}` : ""} for ${formatUsd(sc.total_cents)} is${due ? due : " open"}. Pay here: ${sc.square_invoice_url}`;
    const result = await sendCustomerMessage(ctx, sc, channel, "ticket_reminder", text);
    if (!result.ok) {
      const message = `The reminder could not be sent: ${result.error}`;
      await ctx.runMutation(internal.tickets.addTimeline, { ticket_id: sc.ticket_id, type: "error", text: message });
      throw new Error(message);
    }
    await ctx.runMutation(internal.tickets.addTimeline, {
      ticket_id: sc.ticket_id,
      type: "reminder",
      text: `Reminder sent by ${channel === "sms" ? "text" : "email"}`,
    });
    return { ok: true };
  },
});

export const getTimeline = internalQuery({
  args: { ticket_id: v.id("tickets") },
  handler: async (ctx, args): Promise<TimelineEvent[]> => (await ctx.db.get(args.ticket_id))?.timeline ?? [],
});

export const cancel = action({
  args: { id: v.id("tickets") },
  handler: async (ctx, args) => {
    const email = await identityEmail(ctx);
    const sc: TicketSendContext = await ctx.runMutation(internal.tickets.getForAction, {
      user_email: email,
      id: args.id,
      billing: true,
      statuses: ["draft", "quote", "requested"],
    });
    if (!sc.square_invoice_id || sc.status !== "requested") {
      if (sc.square_invoice_id && sc.status === "draft") {
        // Unpublished Square draft left from a failed send: delete it best effort.
        try {
          const seller = await requireTicketSeller(ctx, sc.business_id);
          const invoice = await getInvoice(seller, sc.square_invoice_id);
          if (invoice.status === "DRAFT") await deleteDraftInvoice(seller, invoice);
        } catch {
          // ignore: a draft invoice is never shown to the customer
        }
      }
      await ctx.runMutation(internal.tickets.markCanceled, { ticket_id: sc.ticket_id, text: "Canceled" });
      return null;
    }
    let seller;
    try {
      seller = await requireTicketSeller(ctx, sc.business_id);
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : TICKET_CONNECT_MESSAGE} The Square invoice must be canceled there too.`);
    }
    try {
      const result = await cancelInvoice(seller, sc.square_invoice_id, sc.square_invoice_version);
      await ctx.runMutation(internal.tickets.markCanceled, {
        ticket_id: sc.ticket_id,
        text: `Canceled; Square invoice${sc.square_invoice_number ? ` #${sc.square_invoice_number}` : ""} canceled`,
        square_invoice_version: result.version,
      });
    } catch (error) {
      const message = readableSquareError(error, "cancel the invoice");
      await ctx.runMutation(internal.tickets.addTimeline, { ticket_id: sc.ticket_id, type: "error", text: message });
      throw new Error(message);
    }
    return null;
  },
});

// ---------------------------------------------------------------------------
// Square webhook (seller invoice events)
// ---------------------------------------------------------------------------

export const applyInvoiceEvent = internalMutation({
  args: { event: v.any() },
  handler: async (ctx, args): Promise<{ matched: boolean; applied: boolean; reason?: string }> => {
    const facts = invoiceEventFacts(args.event);
    if (!facts) return { matched: false, applied: false, reason: "missing_invoice" };
    const ticket = await ctx.db
      .query("tickets")
      .withIndex("by_square_invoice_id", (q) => q.eq("square_invoice_id", facts.invoice_id))
      .first();
    if (!ticket) return { matched: false, applied: false, reason: "no_ticket" };
    const account = await ctx.db
      .query("squareSellerAccounts")
      .withIndex("by_business", (q) => q.eq("business_id", ticket.business_id))
      .first();
    const plan = planTicketInvoiceEvent(ticket, account?.merchant_id, facts);
    if (!plan.apply) return { matched: true, applied: false, reason: plan.reason };
    const now = Date.now();
    const patch: Record<string, unknown> = { updated_at: now };
    if (plan.status) patch.status = plan.status;
    if (plan.paid_method) patch.paid_method = plan.paid_method;
    if (plan.set_paid_at) patch.paid_at = now;
    if (typeof plan.version === "number" && plan.version >= (ticket.square_invoice_version ?? 0)) patch.square_invoice_version = plan.version;
    if (plan.public_url && /^https:\/\//.test(plan.public_url)) patch.square_invoice_url = plan.public_url;
    if (plan.invoice_number) patch.square_invoice_number = plan.invoice_number;
    if (plan.due_date) patch.square_due_date = plan.due_date;
    if (plan.timeline) patch.timeline = appendTimeline(ticket.timeline, { ...plan.timeline, at: now });
    await ctx.db.patch(ticket._id, patch);
    return { matched: true, applied: true };
  },
});

// ---------------------------------------------------------------------------
// Legacy migration: invoices + quotes -> tickets (idempotent, paginated)
// ---------------------------------------------------------------------------

async function businessForLegacy(ctx: any, customer: any, createdBy: string): Promise<any | null> {
  if (customer?.business_id) {
    const id = ctx.db.normalizeId("businesses", String(customer.business_id));
    const business = id ? await ctx.db.get(id) : null;
    if (business) return business;
  }
  return await ctx.db
    .query("businesses")
    .withIndex("by_owner_email", (q: any) => q.eq("owner_email", createdBy))
    .first();
}

export function legacyInvoiceToTicket(invoice: any, businessId: Id<"businesses">, tenantEmail: string) {
  const status = legacyInvoiceStatus(invoice.status);
  const items = legacyItems(invoice.line_items, invoice.tax);
  const events: TimelineEvent[] = [{ type: "created", text: "Imported from the old invoices", at: invoice.created_at }];
  if (invoice.deposit_applied > 0) events.push({ type: "note", text: `Deposit applied: ${formatUsd(Math.round(invoice.deposit_applied * 100))}`, at: invoice.created_at });
  if (invoice.sent_at) events.push({ type: "sent", text: "Sent", at: invoice.sent_at });
  if (status === "paid") events.push({ type: "paid", text: "Paid", at: invoice.paid_at ?? invoice.updated_at });
  if (status === "canceled") events.push({ type: "canceled", text: "Canceled", at: invoice.updated_at });
  return {
    business_id: businessId,
    created_by: tenantEmail,
    customer_id: invoice.customer_id,
    kind: "charge",
    status,
    note: String(invoice.notes ?? "").slice(0, 2000),
    items,
    total_cents: Math.max(0, Math.round((Number(invoice.total) || 0) * 100)),
    photo_storage_ids: [] as Id<"_storage">[],
    paid_method: status === "paid" ? (invoice.square_payment_id || invoice.stripe_payment_intent_id ? "square" : "other") : undefined,
    paid_at: status === "paid" ? invoice.paid_at ?? invoice.updated_at : undefined,
    square_order_id: invoice.square_order_id,
    square_invoice_url: invoice.payment_url,
    square_due_date: invoice.due_date,
    legacy_source: `invoice:${invoice._id}`,
    timeline: events,
    created_at: invoice.created_at,
    updated_at: invoice.updated_at,
  };
}

export function legacyQuoteToTicket(quote: any, businessId: Id<"businesses">, tenantEmail: string) {
  const status = legacyQuoteStatus(quote.status);
  const items = legacyItems(quote.line_items, quote.tax);
  const events: TimelineEvent[] = [{ type: "created", text: `Imported quote: ${String(quote.title ?? "").slice(0, 100)}`, at: quote.created_at }];
  if (quote.status === "approved") events.push({ type: "approved", text: "Approved in the old system (not yet invoiced)", at: quote.updated_at });
  if (quote.status === "declined") events.push({ type: "declined", text: "Quote declined", at: quote.updated_at });
  if (quote.status === "converted") events.push({ type: "canceled", text: "Converted to a work order in the old system", at: quote.updated_at });
  if (quote.deposit_status === "paid") events.push({ type: "note", text: `Deposit paid: ${formatUsd(Math.round((quote.deposit_required ?? 0) * 100))}`, at: quote.deposit_paid_at ?? quote.updated_at });
  const note = [quote.title, quote.description].filter(Boolean).join("\n").slice(0, 2000);
  return {
    business_id: businessId,
    created_by: tenantEmail,
    customer_id: quote.customer_id,
    kind: "quote",
    status,
    note,
    items,
    total_cents: Math.max(0, Math.round((Number(quote.total) || 0) * 100)),
    photo_storage_ids: [] as Id<"_storage">[],
    legacy_source: `quote:${quote._id}`,
    timeline: events,
    created_at: quote.created_at,
    updated_at: quote.updated_at,
  };
}

/**
 * Copy legacy invoices and quotes into tickets. Idempotent (legacy_source),
 * paginated: call repeatedly with the returned cursor until done. Legacy rows
 * are never modified or deleted.
 *   npx convex run tickets:migrateLegacy '{"table":"invoices"}'
 */
export const migrateLegacy = internalMutation({
  args: {
    table: v.optional(v.union(v.literal("invoices"), v.literal("quotes"))),
    cursor: v.optional(v.union(v.string(), v.null())),
    batch_size: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const table = args.table ?? "invoices";
    const numItems = Math.max(1, Math.min(200, Math.floor(args.batch_size ?? 100)));
    const page = await ctx.db.query(table).paginate({ cursor: args.cursor ?? null, numItems });
    let created = 0;
    let skipped = 0;
    for (const row of page.page as any[]) {
      const source = `${table === "invoices" ? "invoice" : "quote"}:${row._id}`;
      const existing = await ctx.db.query("tickets").withIndex("by_legacy_source", (q) => q.eq("legacy_source", source)).first();
      if (existing) {
        skipped += 1;
        continue;
      }
      const customer = await ctx.db.get(row.customer_id);
      const business = customer ? await businessForLegacy(ctx, customer, row.created_by) : null;
      if (!customer || !business) {
        skipped += 1;
        continue;
      }
      const doc = table === "invoices"
        ? legacyInvoiceToTicket(row, business._id, business.owner_email)
        : legacyQuoteToTicket(row, business._id, business.owner_email);
      await ctx.db.insert("tickets", doc as any);
      created += 1;
    }
    const nextTable = page.isDone && table === "invoices" ? "quotes" : table;
    return {
      table,
      created,
      skipped,
      done: page.isDone && table === "quotes",
      next: page.isDone
        ? (table === "invoices" ? { table: nextTable, cursor: null } : null)
        : { table, cursor: page.continueCursor },
    };
  },
});
