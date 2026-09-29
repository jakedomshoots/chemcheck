/**
 * Square webhook (POST /square/webhook) for both money flows:
 *  - Customer payments on connected sellers' accounts (payment.created /
 *    payment.updated) settle invoices and quote deposits.
 *  - Platform subscription events (subscription.*, invoice.*) on the ChemCheck
 *    owner's merchant keep the `subscriptions` table in sync.
 *  - oauth.authorization.revoked forgets a seller's tokens.
 *
 * Security:
 *  - x-square-hmacsha256-signature is verified (HMAC-SHA256 over the exact
 *    notification URL + raw body, constant-time compare) before parsing.
 *  - Every event is claimed atomically by event_id (webhookEvents.ts), so
 *    retries and concurrent deliveries apply at most once.
 *  - Invoices/deposits are only settled for COMPLETED payments on the merchant
 *    the payment link was created on, for exactly the amount due in USD.
 *  - Subscription plans come only from env-configured plan variation ids;
 *    out-of-order events are ignored and ended subscriptions never resurrect.
 */

import { httpAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { fetchProvider, requireSquarePlatformConfig } from "./providerConfig";
import { paymentFacts, squareRequest, verifySquareSignature, type SquarePaymentFacts } from "./squareApi";
import {
  eventCreatedMs,
  statusAfterPaymentFailed,
  statusAfterPaymentSucceeded,
  subscriptionFieldsFromSquare,
} from "./squareSubscriptionState";

const PROVIDER = "square";

export type SquareWebhookPlan =
  | { kind: "payment_completed"; merchant_id: string; payment: SquarePaymentFacts & { order_id: string } }
  | { kind: "subscription"; subscription: Record<string, any> }
  | { kind: "subscription_invoice"; outcome: "paid" | "failed"; subscription_id: string; invoice: Record<string, any> }
  | { kind: "seller_revoked"; merchant_id: string }
  | { kind: "ignore"; reason: string };

/** Decide what to do with a verified, parsed Square event. Pure. */
export function planSquareWebhookEvent(event: any, platformMerchantId: string | undefined): SquareWebhookPlan {
  const type = typeof event?.type === "string" ? event.type : "";
  const merchantId = typeof event?.merchant_id === "string" ? event.merchant_id : "";
  const object = event?.data?.object;
  const isPlatform = Boolean(platformMerchantId) && merchantId === platformMerchantId;

  switch (type) {
    case "payment.created":
    case "payment.updated": {
      if (!merchantId) return { kind: "ignore", reason: "missing_merchant" };
      const facts = paymentFacts(object?.payment);
      if (facts.status !== "COMPLETED") return { kind: "ignore", reason: "not_completed" };
      if (!facts.order_id) return { kind: "ignore", reason: "missing_order" };
      return { kind: "payment_completed", merchant_id: merchantId, payment: { ...facts, order_id: facts.order_id } };
    }
    case "subscription.created":
    case "subscription.updated": {
      if (!isPlatform) return { kind: "ignore", reason: "not_platform_merchant" };
      const subscription = object?.subscription;
      if (!subscription || typeof subscription.id !== "string") return { kind: "ignore", reason: "missing_subscription" };
      return { kind: "subscription", subscription };
    }
    case "invoice.payment_made":
    case "invoice.scheduled_charge_failed": {
      if (!isPlatform) return { kind: "ignore", reason: "not_platform_merchant" };
      const invoice = object?.invoice;
      const subscriptionId = typeof invoice?.subscription_id === "string" ? invoice.subscription_id : "";
      if (!subscriptionId) return { kind: "ignore", reason: "not_subscription_invoice" };
      return {
        kind: "subscription_invoice",
        outcome: type === "invoice.payment_made" ? "paid" : "failed",
        subscription_id: subscriptionId,
        invoice,
      };
    }
    case "oauth.authorization.revoked": {
      if (!merchantId) return { kind: "ignore", reason: "missing_merchant" };
      return { kind: "seller_revoked", merchant_id: merchantId };
    }
    default:
      return { kind: "ignore", reason: "unhandled_event_type" };
  }
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function env(): Record<string, string | undefined> {
  return process.env as Record<string, string | undefined>;
}

async function fetchPlatform(path: string): Promise<any | null> {
  try {
    const { accessToken } = requireSquarePlatformConfig();
    return await squareRequest(path, { method: "GET", token: accessToken });
  } catch {
    return null;
  }
}

async function customerEmail(customerId: string | undefined): Promise<string | undefined> {
  if (!customerId) return undefined;
  const data = await fetchPlatform(`/v2/customers/${encodeURIComponent(customerId)}`);
  const email = data?.customer?.email_address;
  return typeof email === "string" && email ? email : undefined;
}

async function applySubscription(ctx: ActionCtx, subscription: Record<string, any>, eventCreated: number | undefined) {
  const fields = subscriptionFieldsFromSquare(subscription, env());
  const existing = await ctx.runQuery(internal.subscriptions.getBySquareSubscription, {
    square_subscription_id: fields.square_subscription_id,
  });
  let businessId = existing?.business_id;
  let checkoutId: any;
  if (!businessId) {
    // Prefer the stored checkout (matched by the paying customer), then the customer's email.
    const byCustomer = fields.square_customer_id
      ? await ctx.runQuery(internal.subscriptions.findBusinessForSquareCustomer, {
        customer_id: fields.square_customer_id,
        plan_variation_id: fields.square_plan_variation_id,
      })
      : null;
    const match = byCustomer ?? await ctx.runQuery(internal.subscriptions.findBusinessForSquareCustomer, {
      email: await customerEmail(fields.square_customer_id),
      plan_variation_id: fields.square_plan_variation_id,
    });
    businessId = match?.business_id;
    checkoutId = match?.checkout_id;
  }
  const result = await ctx.runMutation(internal.subscriptions.upsertFromSquare, {
    ...fields,
    business_id: businessId,
    event_created: eventCreated,
  });
  if (result.applied && checkoutId) {
    await ctx.runMutation(internal.subscriptions.markCheckoutLinked, {
      checkout_id: checkoutId,
      square_subscription_id: fields.square_subscription_id,
    });
  }
  if (!result.applied) {
    console.log("[Square Webhook] Subscription not applied", { id: fields.square_subscription_id, reason: result.reason });
  }
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
  return text.replace(/[&<>"']/g, (char) => map[char]);
}

/** Tell the business owner a subscription charge failed (best effort). */
async function sendPaymentFailedEmail(args: { to: string; businessName?: string; invoice: Record<string, any> }) {
  const apiKey = process.env.MAILERSEND_API_KEY;
  const fromEmail = process.env.FROM_EMAIL;
  if (!apiKey || !fromEmail || !args.to) return;
  const businessName = args.businessName || "ChemCheck";
  const cents = args.invoice?.payment_requests?.[0]?.computed_amount_money?.amount;
  const amount = typeof cents === "number" && Number.isFinite(cents) ? `$${(cents / 100).toFixed(2)}` : "your subscription payment";
  const invoiceUrl = typeof args.invoice?.public_url === "string" && /^https:\/\//.test(args.invoice.public_url) ? args.invoice.public_url : "";
  const text = [
    `Hi ${businessName},`,
    "",
    `We could not charge the card on file for your ChemCheck subscription (${amount}).`,
    invoiceUrl ? `Pay or update your card here: ${invoiceUrl}` : "Please update your payment method to keep access uninterrupted.",
  ].join("\n");
  const html = `<p>Hi ${escapeHtml(businessName)},</p><p>We could not charge the card on file for your ChemCheck subscription (<strong>${escapeHtml(amount)}</strong>).</p>${
    invoiceUrl ? `<p><a href="${escapeHtml(invoiceUrl)}">Pay or update your card</a></p>` : "<p>Please update your payment method to keep access uninterrupted.</p>"
  }`;
  const response = await fetchProvider("https://api.mailersend.com/v1/email", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      from: { email: fromEmail, name: "ChemCheck" },
      to: [{ email: args.to }],
      subject: "Action needed: ChemCheck subscription payment failed",
      text,
      html,
    }),
  });
  if (!response.ok) console.error("[Square Webhook] Payment-failed email not sent", response.status);
}

async function applySubscriptionInvoice(
  ctx: ActionCtx,
  plan: Extract<SquareWebhookPlan, { kind: "subscription_invoice" }>,
  eventCreated: number | undefined,
) {
  const subscription = await ctx.runQuery(internal.subscriptions.getBySquareSubscription, {
    square_subscription_id: plan.subscription_id,
  });
  // Prefer the live subscription; a payment must never resurrect a canceled one
  // (upsertFromSquare enforces that for the live snapshot too).
  const live = await fetchPlatform(`/v2/subscriptions/${encodeURIComponent(plan.subscription_id)}`);
  if (live?.subscription) {
    await applySubscription(ctx, live.subscription, eventCreated);
    if (plan.outcome === "paid" || !subscription) return;
  }
  if (!subscription) return;
  const nextStatus = plan.outcome === "paid"
    ? statusAfterPaymentSucceeded(subscription.status)
    : statusAfterPaymentFailed(subscription.status);
  if (nextStatus) {
    await ctx.runMutation(internal.subscriptions.updateStatus, {
      subscription_id: subscription._id,
      status: nextStatus,
      event_created: eventCreated,
    });
  }
  if (plan.outcome === "failed") {
    try {
      const business = subscription.business_id
        ? await ctx.runQuery(internal.businesses.getByIdInternal, { business_id: subscription.business_id })
        : null;
      await sendPaymentFailedEmail({
        to: business?.email || subscription.user_email,
        businessName: business?.name,
        invoice: plan.invoice,
      });
    } catch (error) {
      console.error("[Square Webhook] Payment-failed notification error", error instanceof Error ? error.message : String(error));
    }
  }
}

async function applyPayment(ctx: ActionCtx, plan: Extract<SquareWebhookPlan, { kind: "payment_completed" }>, eventId: string) {
  const args = {
    order_id: plan.payment.order_id,
    merchant_id: plan.merchant_id,
    payment_id: plan.payment.payment_id,
    status: plan.payment.status,
    amount_cents: plan.payment.amount_cents,
    currency: plan.payment.currency,
  };
  const invoiceResult = await ctx.runMutation(internal.invoices.markPaidFromProvider, args);
  if (invoiceResult.matched) {
    if (!invoiceResult.applied && invoiceResult.reason !== "already_paid") {
      console.error("[Square Webhook] Refusing to mark invoice paid", { eventId, reason: invoiceResult.reason });
    }
    return;
  }
  const depositResult = await ctx.runMutation(internal.quotes.markDepositPaidFromProvider, args);
  if (depositResult.matched) {
    if (!depositResult.applied && depositResult.reason !== "already_paid") {
      console.error("[Square Webhook] Refusing to mark deposit paid", { eventId, reason: depositResult.reason });
    }
    return;
  }
  // Platform subscription checkout payment: remember which Square customer paid.
  const platformMerchantId = (process.env.SQUARE_PLATFORM_MERCHANT_ID || "").trim();
  if (platformMerchantId && plan.merchant_id === platformMerchantId && plan.payment.customer_id) {
    await ctx.runMutation(internal.subscriptions.attachCheckoutCustomer, {
      order_id: plan.payment.order_id,
      customer_id: plan.payment.customer_id,
    });
  }
}

export const handleSquareWebhook = httpAction(async (ctx, request) => {
  const body = await request.text();
  const signatureKey = (process.env.SQUARE_WEBHOOK_SIGNATURE_KEY || "").trim();
  const notificationUrl = (process.env.SQUARE_WEBHOOK_URL || "").trim();
  if (!signatureKey || !notificationUrl) {
    console.error("[Square Webhook] SQUARE_WEBHOOK_SIGNATURE_KEY / SQUARE_WEBHOOK_URL not configured");
    return new Response("Service unavailable", { status: 503 });
  }
  const signature = request.headers.get("x-square-hmacsha256-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });
  if (!(await verifySquareSignature(body, signature, signatureKey, notificationUrl))) {
    return new Response("Invalid signature", { status: 401 });
  }

  let event: any;
  try {
    event = JSON.parse(body);
  } catch {
    return new Response("Invalid payload", { status: 400 });
  }

  const eventId = typeof event?.event_id === "string" ? event.event_id : "";
  const eventType = typeof event?.type === "string" ? event.type : "unknown";
  if (!eventId) return new Response("Missing event id", { status: 400 });

  try {
    const { decision } = await ctx.runMutation(internal.webhookEvents.claimEvent, {
      provider: PROVIDER,
      event_id: eventId,
      event_type: eventType,
    });
    if (decision === "duplicate") return jsonResponse({ received: true, duplicate: true });
    // A non-2xx makes Square retry later.
    if (decision === "in_progress") return new Response("Event is already being processed", { status: 409 });

    const plan = planSquareWebhookEvent(event, (process.env.SQUARE_PLATFORM_MERCHANT_ID || "").trim() || undefined);
    const eventCreated = eventCreatedMs(event);
    switch (plan.kind) {
      case "payment_completed":
        await applyPayment(ctx, plan, eventId);
        break;
      case "subscription":
        await applySubscription(ctx, plan.subscription, eventCreated);
        break;
      case "subscription_invoice":
        await applySubscriptionInvoice(ctx, plan, eventCreated);
        break;
      case "seller_revoked":
        await ctx.runMutation(internal.squareConnect.deleteSellerAccountsByMerchant, { merchant_id: plan.merchant_id });
        break;
      case "ignore":
        break;
    }

    await ctx.runMutation(internal.webhookEvents.recordProcessed, { provider: PROVIDER, event_id: eventId });
    return jsonResponse({ received: true });
  } catch (err) {
    await ctx.runMutation(internal.webhookEvents.recordFailed, {
      provider: PROVIDER,
      event_id: eventId,
      error: err instanceof Error ? err.message : "Unknown Square webhook error",
    });
    console.error("[Square Webhook] Handler error", {
      eventId,
      eventType,
      message: err instanceof Error ? err.message : String(err),
    });
    return new Response("Processing error", { status: 500 });
  }
});
