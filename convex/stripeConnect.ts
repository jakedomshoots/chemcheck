/**
 * Stripe Connect (Express accounts) for pool-company customer payments.
 *
 * Invoice and quote-deposit Checkout Sessions are created as DIRECT CHARGES on
 * the pool company's connected Stripe account (`Stripe-Account` header), so the
 * money lands in the pool company's balance, never in the ChemCheck platform
 * balance. The platform may optionally take an application fee (PLATFORM_FEE_BPS).
 *
 * Why Express + Account Links: ChemCheck has no Stripe OAuth client set up and
 * pool companies should not need to create a full Stripe account first. Express
 * gives Stripe-hosted onboarding (account_links) plus a Stripe-hosted Express
 * dashboard (login_links) while ChemCheck keeps control of the onboarding flow.
 *
 * Security:
 * - Connected account ids are only ever read from the businesses table (written
 *   by our own server code or by a signature-verified Connect webhook). Clients
 *   never supply an account id.
 * - Only business owners/admins can create or manage the connected account.
 * - The Connect webhook verifies Stripe signatures with STRIPE_CONNECT_WEBHOOK_SECRET
 *   and only marks invoices/deposits paid when the event's account matches the
 *   owning business AND the paid amount/currency match the record.
 */

import { v } from "convex/values";
import { action, httpAction, internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { fetchProvider, requireStripeConfig } from "./providerConfig";

export const STRIPE_API_BASE = "https://api.stripe.com/v1";
const FALLBACK_APP_BASE_URL = "https://app.chemcheck.app";
const MANAGER_ROLES = new Set(["owner", "admin"]);

export const CONNECT_REQUIRED_MESSAGE =
  "Connect your Stripe account in Settings to accept card payments";

const STRIPE_ACCOUNT_ID_PATTERN = /^acct_[A-Za-z0-9]+$/;

// ---------------------------------------------------------------------------
// Pure helpers (unit tested in stripeConnect.test.ts)
// ---------------------------------------------------------------------------

export function isStripeAccountId(value: unknown): value is string {
  return typeof value === "string" && STRIPE_ACCOUNT_ID_PATTERN.test(value);
}

/** App origin for redirect URLs. Always from server env, never the caller. */
export function appBaseUrl(): string {
  const trimmedEnv = (process.env.APP_URL || "").trim().replace(/\/+$/, "");
  return trimmedEnv || FALLBACK_APP_BASE_URL;
}

export function toUsdCents(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.max(0, Math.round(amount * 100));
}

/**
 * Headers for a Stripe API call. When `stripeAccountId` is given the request is
 * made on behalf of that connected account (direct charge).
 */
export function buildStripeHeaders(args: {
  secretKey: string;
  stripeAccountId?: string;
  idempotencyKey?: string;
  form?: boolean;
}): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${args.secretKey}`,
  };
  if (args.form) headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (args.stripeAccountId !== undefined) {
    if (!isStripeAccountId(args.stripeAccountId)) {
      throw new Error("Invalid connected Stripe account id");
    }
    headers["Stripe-Account"] = args.stripeAccountId;
  }
  if (args.idempotencyKey) headers["Idempotency-Key"] = args.idempotencyKey;
  return headers;
}

/** Parse PLATFORM_FEE_BPS (basis points, 100 = 1%). Invalid/missing => 0. Clamped to [0, 10000]. */
export function parsePlatformFeeBps(raw: string | undefined): number {
  const trimmed = (raw || "").trim();
  if (!/^\d+$/.test(trimmed)) return 0;
  const bps = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(bps) || bps <= 0) return 0;
  return Math.min(bps, 10_000);
}

/** Application fee in cents for a charge of `amountCents`, rounded down, never above the charge. */
export function calculateApplicationFeeCents(amountCents: number, bps: number): number {
  if (!Number.isFinite(amountCents) || amountCents <= 0) return 0;
  if (!Number.isFinite(bps) || bps <= 0) return 0;
  const fee = Math.floor((Math.round(amountCents) * Math.min(bps, 10_000)) / 10_000);
  return Math.max(0, Math.min(fee, Math.round(amountCents)));
}

export function platformFeeCentsFromEnv(amountCents: number): number {
  return calculateApplicationFeeCents(amountCents, parsePlatformFeeBps(process.env.PLATFORM_FEE_BPS));
}

export function buildAccountCreateForm(args: {
  businessId: string;
  email?: string;
  businessName?: string;
}): URLSearchParams {
  const form = new URLSearchParams();
  form.set("type", "express");
  if (args.email) form.set("email", args.email);
  if (args.businessName) form.set("business_profile[name]", args.businessName);
  form.set("capabilities[card_payments][requested]", "true");
  form.set("capabilities[transfers][requested]", "true");
  form.set("metadata[business_id]", args.businessId);
  return form;
}

export function buildAccountLinkForm(args: {
  accountId: string;
  baseUrl: string;
}): URLSearchParams {
  const form = new URLSearchParams();
  form.set("account", args.accountId);
  form.set("type", "account_onboarding");
  form.set("refresh_url", `${args.baseUrl}/settings?stripe_connect=refresh#integrations`);
  form.set("return_url", `${args.baseUrl}/settings?stripe_connect=return#integrations`);
  return form;
}

export type ConnectFlags = {
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
};

export function connectFlagsFromAccount(account: any): ConnectFlags {
  return {
    charges_enabled: account?.charges_enabled === true,
    payouts_enabled: account?.payouts_enabled === true,
    details_submitted: account?.details_submitted === true,
  };
}

export type ConnectState = "not_connected" | "onboarding_incomplete" | "active";

export function deriveConnectState(business: {
  stripe_account_id?: string;
  stripe_charges_enabled?: boolean;
} | null | undefined): ConnectState {
  if (!business?.stripe_account_id) return "not_connected";
  return business.stripe_charges_enabled ? "active" : "onboarding_incomplete";
}

/**
 * Returns the connected account id that may accept card payments for this
 * business, or throws the user-facing "connect Stripe" error. Never falls back
 * to the platform account.
 */
export function requireChargeableAccount(account: {
  stripe_account_id?: string;
  stripe_charges_enabled?: boolean;
} | null | undefined): string {
  if (!account || !isStripeAccountId(account.stripe_account_id) || account.stripe_charges_enabled !== true) {
    throw new Error(CONNECT_REQUIRED_MESSAGE);
  }
  return account.stripe_account_id;
}

/** Confirms a Checkout Session was fully paid for exactly the expected amount in USD. */
export function checkoutPaymentMatches(
  session: any,
  expectedAmountCents: number,
): { ok: true } | { ok: false; reason: string } {
  if (session?.payment_status !== "paid") return { ok: false, reason: "not_paid" };
  const currency = typeof session?.currency === "string" ? session.currency.toLowerCase() : "";
  if (currency !== "usd") return { ok: false, reason: "currency_mismatch" };
  if (typeof session?.amount_total !== "number" || session.amount_total !== expectedAmountCents) {
    return { ok: false, reason: "amount_mismatch" };
  }
  return { ok: true };
}

function metadataString(source: any, key: string): string | undefined {
  const value = source?.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export type ConnectWebhookPlan =
  | { kind: "account_status"; account_id: string; business_id?: string; flags: ConnectFlags }
  | {
    kind: "checkout_paid";
    account_id: string;
    payment_type: "invoice" | "quote_deposit";
    entity_id: string;
    session: any;
    session_id?: string;
    payment_intent_id?: string;
  }
  | { kind: "ignore"; reason: string };

/** Decide what to do with a verified, parsed Connect webhook event. Pure. */
export function planConnectWebhookEvent(event: any): ConnectWebhookPlan {
  const type = typeof event?.type === "string" ? event.type : "";
  const eventAccount = typeof event?.account === "string" ? event.account : undefined;
  const object = event?.data?.object;

  switch (type) {
    case "account.updated": {
      const accountId = typeof object?.id === "string" ? object.id : eventAccount;
      if (!isStripeAccountId(accountId)) return { kind: "ignore", reason: "missing_account" };
      if (eventAccount && eventAccount !== accountId) return { kind: "ignore", reason: "account_mismatch" };
      return {
        kind: "account_status",
        account_id: accountId,
        business_id: metadataString(object, "business_id"),
        flags: connectFlagsFromAccount(object),
      };
    }
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      if (!isStripeAccountId(eventAccount)) return { kind: "ignore", reason: "not_connected_account_event" };
      if (object?.payment_status !== "paid") return { kind: "ignore", reason: "not_paid" };
      const paymentType = metadataString(object, "payment_type") || metadataString(object, "entity_type");
      const sessionId = typeof object?.id === "string" ? object.id : undefined;
      const paymentIntentId =
        typeof object?.payment_intent === "string"
          ? object.payment_intent
          : typeof object?.payment_intent?.id === "string"
            ? object.payment_intent.id
            : undefined;
      if (paymentType === "invoice") {
        const invoiceId = metadataString(object, "invoice_id");
        if (!invoiceId) return { kind: "ignore", reason: "missing_invoice_id" };
        return {
          kind: "checkout_paid",
          account_id: eventAccount,
          payment_type: "invoice",
          entity_id: invoiceId,
          session: object,
          session_id: sessionId,
          payment_intent_id: paymentIntentId,
        };
      }
      if (paymentType === "quote_deposit") {
        const quoteId = metadataString(object, "quote_id");
        if (!quoteId) return { kind: "ignore", reason: "missing_quote_id" };
        return {
          kind: "checkout_paid",
          account_id: eventAccount,
          payment_type: "quote_deposit",
          entity_id: quoteId,
          session: object,
          session_id: sessionId,
          payment_intent_id: paymentIntentId,
        };
      }
      return { kind: "ignore", reason: "unrecognized_payment_type" };
    }
    default:
      return { kind: "ignore", reason: "unhandled_event_type" };
  }
}

/**
 * Stripe webhook signature verification (HMAC-SHA256, 5 minute tolerance).
 * Mirrors the platform webhook implementation so this module has no dependency
 * on stripeWebhook.ts internals.
 */
export async function verifyStripeSignature(
  payload: string,
  sigHeader: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  toleranceSeconds = 5 * 60,
): Promise<boolean> {
  let timestamp: number | undefined;
  const signatures: string[] = [];
  for (const part of sigHeader.split(",")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key === "t") timestamp = Number.parseInt(value, 10);
    else if (key === "v1") signatures.push(value);
  }
  if (!timestamp || !Number.isFinite(timestamp) || signatures.length === 0) return false;
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signatureBuffer = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${payload}`));
  const expected = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return signatures.some((sig) => {
    if (sig.length !== expected.length) return false;
    let result = 0;
    for (let i = 0; i < sig.length; i++) result |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
    return result === 0;
  });
}

async function stripeRequest(
  path: string,
  init: { method: "GET" | "POST"; headers: Record<string, string>; body?: string },
): Promise<any> {
  const response = await fetchProvider(`${STRIPE_API_BASE}${path}`, init);
  let data: any = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    const message = typeof data?.error?.message === "string"
      ? data.error.message
      : `Stripe request failed (${response.status})`;
    throw new Error(message);
  }
  return data;
}

// ---------------------------------------------------------------------------
// Business / role resolution
// ---------------------------------------------------------------------------

async function resolveBusinessContext(ctx: any, userEmail: string) {
  const teamMember = await ctx.db
    .query("team_members")
    .withIndex("by_user_email", (q: any) => q.eq("user_email", userEmail))
    .filter((q: any) => q.eq(q.field("is_active"), true))
    .first();

  if (teamMember) {
    const teamBusiness = await ctx.db.get(teamMember.business_id);
    if (teamBusiness) return { business: teamBusiness, role: teamMember.role as string };
  }

  const owned = await ctx.db
    .query("businesses")
    .withIndex("by_owner_email", (q: any) => q.eq("owner_email", userEmail))
    .first();
  return owned ? { business: owned, role: "owner" } : null;
}

function canManage(context: { business: any; role: string } | null, email: string): boolean {
  if (!context) return false;
  return context.business.owner_email === email || MANAGER_ROLES.has(context.role);
}

function publicStatus(business: any, email: string, role: string) {
  return {
    state: deriveConnectState(business),
    connected: Boolean(business?.stripe_account_id),
    charges_enabled: business?.stripe_charges_enabled === true,
    payouts_enabled: business?.stripe_payouts_enabled === true,
    details_submitted: business?.stripe_details_submitted === true,
    updated_at: business?.stripe_connect_updated_at ?? null,
    can_manage: business?.owner_email === email || MANAGER_ROLES.has(role),
  };
}

/** Business the caller may manage Stripe Connect for (owner/admin only). */
export const getManagedBusiness = internalQuery({
  args: { user_email: v.string() },
  handler: async (ctx, args) => {
    const context = await resolveBusinessContext(ctx, args.user_email);
    if (!context) throw new Error("No business found for this account.");
    if (!canManage(context, args.user_email)) {
      throw new Error("Only business owners and admins can manage Stripe payments.");
    }
    const b = context.business;
    return {
      _id: b._id,
      name: b.name as string,
      email: (b.email || b.owner_email) as string,
      stripe_account_id: b.stripe_account_id as string | undefined,
    };
  },
});

/** Connected account for the business that `user_email` belongs to. */
export const getPaymentAccountForUser = internalQuery({
  args: { user_email: v.string() },
  handler: async (ctx, args) => {
    const context = await resolveBusinessContext(ctx, args.user_email);
    if (!context) return null;
    return {
      business_id: context.business._id,
      stripe_account_id: context.business.stripe_account_id as string | undefined,
      stripe_charges_enabled: context.business.stripe_charges_enabled === true,
    };
  },
});

export const setStripeAccountId = internalMutation({
  args: { business_id: v.id("businesses"), stripe_account_id: v.string() },
  handler: async (ctx, args) => {
    if (!isStripeAccountId(args.stripe_account_id)) throw new Error("Invalid Stripe account id");
    const business = await ctx.db.get(args.business_id);
    if (!business) throw new Error("Business not found");
    // Never overwrite an existing connection (concurrent onboarding clicks).
    if (business.stripe_account_id) return business.stripe_account_id;
    await ctx.db.patch(args.business_id, {
      stripe_account_id: args.stripe_account_id,
      stripe_charges_enabled: false,
      stripe_payouts_enabled: false,
      stripe_details_submitted: false,
      stripe_connect_updated_at: Date.now(),
    });
    return args.stripe_account_id;
  },
});

/**
 * Update connection flags. Matches on business_id when known, otherwise the
 * caller must supply a business that already stores this account id.
 */
export const updateConnectStatus = internalMutation({
  args: {
    business_id: v.id("businesses"),
    stripe_account_id: v.string(),
    charges_enabled: v.boolean(),
    payouts_enabled: v.boolean(),
    details_submitted: v.boolean(),
  },
  handler: async (ctx, args) => {
    const business = await ctx.db.get(args.business_id);
    if (!business || business.stripe_account_id !== args.stripe_account_id) return false;
    await ctx.db.patch(args.business_id, {
      stripe_charges_enabled: args.charges_enabled,
      stripe_payouts_enabled: args.payouts_enabled,
      stripe_details_submitted: args.details_submitted,
      stripe_connect_updated_at: Date.now(),
    });
    return true;
  },
});

/**
 * Validate a paid connected-account Checkout Session against our records.
 * The owning business is derived from the invoice/quote creator, never from
 * event metadata, and must store the event's connected account id.
 */
export const validateConnectedCheckout = internalQuery({
  args: {
    stripe_account_id: v.string(),
    payment_type: v.union(v.literal("invoice"), v.literal("quote_deposit")),
    entity_id: v.string(),
    amount_total: v.optional(v.number()),
    currency: v.optional(v.string()),
    payment_status: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ ok: true; entity_id: string } | { ok: false; reason: string }> => {
    const table = args.payment_type === "invoice" ? "invoices" : "quotes";
    const normalizedId = ctx.db.normalizeId(table, args.entity_id);
    if (!normalizedId) return { ok: false, reason: "unknown_entity" };
    const record: any = await ctx.db.get(normalizedId);
    if (!record) return { ok: false, reason: "unknown_entity" };

    const context = await resolveBusinessContext(ctx, record.created_by);
    if (!context || context.business.stripe_account_id !== args.stripe_account_id) {
      return { ok: false, reason: "account_mismatch" };
    }

    let expectedCents: number;
    if (args.payment_type === "invoice") {
      if (record.status === "cancelled") return { ok: false, reason: "invoice_cancelled" };
      expectedCents = toUsdCents(record.total);
    } else {
      expectedCents = toUsdCents(record.deposit_required ?? 0);
    }

    const match = checkoutPaymentMatches(
      { payment_status: args.payment_status, amount_total: args.amount_total, currency: args.currency },
      expectedCents,
    );
    if (!match.ok) return match;
    return { ok: true, entity_id: String(normalizedId) };
  },
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const getConnectStatus = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) return null;
    const context = await resolveBusinessContext(ctx, identity.email);
    if (!context) return null;
    return publicStatus(context.business, identity.email, context.role);
  },
});

export const createOnboardingLink = action({
  args: {},
  handler: async (ctx): Promise<{ url: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    if (!identity.email) throw new Error("Authenticated account is missing an email address.");

    const business: any = await ctx.runQuery(internal.stripeConnect.getManagedBusiness, {
      user_email: identity.email,
    });
    const { secretKey } = requireStripeConfig();

    let accountId: string | undefined = business.stripe_account_id;
    if (!accountId) {
      const account = await stripeRequest("/accounts", {
        method: "POST",
        headers: buildStripeHeaders({
          secretKey,
          form: true,
          // Collapses double-clicks into one connected account.
          idempotencyKey: `chemcheck-connect-account-${String(business._id)}`,
        }),
        body: buildAccountCreateForm({
          businessId: String(business._id),
          email: business.email,
          businessName: business.name,
        }).toString(),
      });
      if (!isStripeAccountId(account?.id)) throw new Error("Stripe did not return a connected account id");
      accountId = await ctx.runMutation(internal.stripeConnect.setStripeAccountId, {
        business_id: business._id,
        stripe_account_id: account.id,
      });
    }

    const link = await stripeRequest("/account_links", {
      method: "POST",
      headers: buildStripeHeaders({ secretKey, form: true }),
      body: buildAccountLinkForm({ accountId: accountId!, baseUrl: appBaseUrl() }).toString(),
    });
    if (typeof link?.url !== "string" || !/^https:\/\/connect\.stripe\.com\//.test(link.url)) {
      throw new Error("Stripe did not return an onboarding link");
    }
    return { url: link.url };
  },
});

export const refreshAccountStatus = action({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    if (!identity.email) throw new Error("Authenticated account is missing an email address.");

    const business: any = await ctx.runQuery(internal.stripeConnect.getManagedBusiness, {
      user_email: identity.email,
    });
    if (!business.stripe_account_id) {
      return { state: "not_connected" as ConnectState, charges_enabled: false, payouts_enabled: false, details_submitted: false };
    }

    const { secretKey } = requireStripeConfig();
    const account = await stripeRequest(`/accounts/${encodeURIComponent(business.stripe_account_id)}`, {
      method: "GET",
      headers: buildStripeHeaders({ secretKey }),
    });
    const flags = connectFlagsFromAccount(account);
    await ctx.runMutation(internal.stripeConnect.updateConnectStatus, {
      business_id: business._id,
      stripe_account_id: business.stripe_account_id,
      ...flags,
    });
    return {
      state: deriveConnectState({ stripe_account_id: business.stripe_account_id, stripe_charges_enabled: flags.charges_enabled }),
      ...flags,
    };
  },
});

export const createDashboardLink = action({
  args: {},
  handler: async (ctx): Promise<{ url: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    if (!identity.email) throw new Error("Authenticated account is missing an email address.");

    const business: any = await ctx.runQuery(internal.stripeConnect.getManagedBusiness, {
      user_email: identity.email,
    });
    if (!business.stripe_account_id) throw new Error(CONNECT_REQUIRED_MESSAGE);

    const { secretKey } = requireStripeConfig();
    const link = await stripeRequest(`/accounts/${encodeURIComponent(business.stripe_account_id)}/login_links`, {
      method: "POST",
      headers: buildStripeHeaders({ secretKey, form: true }),
      body: "",
    });
    if (typeof link?.url !== "string" || !/^https:\/\//.test(link.url)) {
      throw new Error("Stripe did not return a dashboard link");
    }
    return { url: link.url };
  },
});

// ---------------------------------------------------------------------------
// Connect webhook (events from connected accounts)
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export const handleStripeConnectWebhook = httpAction(async (ctx, request) => {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });

  const secret = (process.env.STRIPE_CONNECT_WEBHOOK_SECRET || "").trim();
  if (!/^whsec_[A-Za-z0-9]+$/.test(secret)) {
    console.error("[Connect Webhook] STRIPE_CONNECT_WEBHOOK_SECRET is not configured");
    return new Response("Service unavailable", { status: 503 });
  }

  if (!(await verifyStripeSignature(body, signature, secret))) {
    return new Response("Invalid signature", { status: 401 });
  }

  let event: any;
  try {
    event = JSON.parse(body);
  } catch {
    return new Response("Invalid payload", { status: 400 });
  }

  const eventId = typeof event?.id === "string" ? event.id : "";
  const eventType = typeof event?.type === "string" ? event.type : "unknown";

  try {
    if (eventId) {
      const { decision } = await ctx.runMutation(internal.stripeEvents.claimEvent, {
        event_id: eventId,
        event_type: eventType,
      });
      if (decision === "duplicate") return jsonResponse({ received: true, duplicate: true });
      if (decision === "in_progress") {
        return new Response("Event is already being processed", { status: 409 });
      }
    }

    const plan = planConnectWebhookEvent(event);
    switch (plan.kind) {
      case "account_status": {
        const businessId = plan.business_id
          ? await ctx.runQuery(internal.stripeConnect.normalizeBusinessId, { id: plan.business_id })
          : null;
        const updated = businessId
          ? await ctx.runMutation(internal.stripeConnect.updateConnectStatus, {
            business_id: businessId,
            stripe_account_id: plan.account_id,
            ...plan.flags,
          })
          : false;
        if (!updated) console.log("[Connect Webhook] account.updated for unknown account", plan.account_id);
        break;
      }
      case "checkout_paid": {
        const validation = await ctx.runQuery(internal.stripeConnect.validateConnectedCheckout, {
          stripe_account_id: plan.account_id,
          payment_type: plan.payment_type,
          entity_id: plan.entity_id,
          amount_total: typeof plan.session?.amount_total === "number" ? plan.session.amount_total : undefined,
          currency: typeof plan.session?.currency === "string" ? plan.session.currency : undefined,
          payment_status: typeof plan.session?.payment_status === "string" ? plan.session.payment_status : undefined,
        });
        if (!validation.ok) {
          console.error("[Connect Webhook] Refusing to mark paid:", {
            reason: validation.reason,
            eventId,
            sessionId: plan.session_id,
          });
          break;
        }
        if (plan.payment_type === "invoice") {
          await ctx.runMutation(internal.invoices.markPaidFromStripe, {
            invoice_id: validation.entity_id as any,
            stripe_checkout_session_id: plan.session_id,
            stripe_payment_intent_id: plan.payment_intent_id,
          });
        } else {
          await ctx.runMutation(internal.quotes.markDepositPaidFromStripe, {
            quote_id: validation.entity_id as any,
            stripe_checkout_session_id: plan.session_id,
          });
        }
        break;
      }
      case "ignore":
        break;
    }

    if (eventId) await ctx.runMutation(internal.stripeEvents.recordProcessed, { event_id: eventId });
    return jsonResponse({ received: true });
  } catch (err) {
    if (eventId) {
      await ctx.runMutation(internal.stripeEvents.recordFailed, {
        event_id: eventId,
        error: err instanceof Error ? err.message : "Unknown connect webhook error",
      });
    }
    console.error("[Connect Webhook] Handler error", { eventId, eventType, message: err instanceof Error ? err.message : String(err) });
    return new Response("Processing error", { status: 500 });
  }
});

export const normalizeBusinessId = internalQuery({
  args: { id: v.string() },
  handler: async (ctx, args) => ctx.db.normalizeId("businesses", args.id),
});
