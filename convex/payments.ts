/**
 * Customer payments (invoices and quote deposits) via Square payment links.
 *
 * Links are created on the pool company's OWN connected Square seller account
 * with the seller's OAuth token (squareConnect.requireSellerCredentials), so
 * the money goes directly to the business. The platform never charges on its
 * own account for customer payments; businesses without a Square connection
 * get CONNECT_REQUIRED_MESSAGE. An optional platform app fee is added from
 * PLATFORM_FEE_BPS.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { type ActionCtx, action } from "./_generated/server";
import { validateEmail, validatePhone } from "./validation";
import { appBaseUrl, platformFeeCentsFromEnv, toUsdCents } from "./paymentMatching";
import { requireSellerCredentials, type SellerCredentials } from "./squareConnect";
import {
  buildPaymentLinkBody,
  isSquareHostedUrl,
  paymentFacts,
  parsePaymentLinkResponse,
  squareRequest,
} from "./squareApi";

type PaymentLinkResult = {
  success: boolean;
  payment_url?: string;
  square_payment_link_id?: string;
  communication_id?: string;
  reused?: boolean;
};

function hasValidSendDestination(customer: { phone?: string; email?: string }): boolean {
  try {
    if (validatePhone(customer.phone)) return true;
  } catch {}
  try {
    if (validateEmail(customer.email)) return true;
  } catch {}
  return false;
}

function normalizeSendDestinationOverride(
  channelOverride?: string,
  recipientOverride?: string
): { channel: "sms" | "email"; recipient: string } | null {
  const hasChannel = Boolean(channelOverride && channelOverride.trim());
  const hasRecipient = Boolean(recipientOverride && recipientOverride.trim());
  if (!hasChannel && !hasRecipient) return null;
  if (!hasChannel || !hasRecipient) {
    throw new Error("Alternate recipient requires both channel and recipient.");
  }

  const channel = channelOverride!.trim().toLowerCase();
  if (channel === "sms") {
    const recipient = validatePhone(recipientOverride!);
    if (!recipient) throw new Error("Alternate phone number is invalid.");
    return { channel: "sms", recipient };
  }
  if (channel === "email") {
    const recipient = validateEmail(recipientOverride!);
    if (!recipient) throw new Error("Alternate email is invalid.");
    return { channel: "email", recipient };
  }

  throw new Error("Alternate channel must be either sms or email.");
}

/**
 * A stored link is reused only when it was created on the same connected
 * merchant for exactly the current amount (so a total change always gets a
 * new link and order).
 */
export function isReusablePaymentLink(
  stored: { link_id?: string; order_id?: string; url?: string; merchant_id?: string; amount_cents?: number },
  current: { merchantId: string; amountCents: number },
): boolean {
  return Boolean(stored.link_id && stored.order_id)
    && isSquareHostedUrl(stored.url)
    && stored.merchant_id === current.merchantId
    && stored.amount_cents === current.amountCents;
}

/** Deterministic idempotency key so retries return the same Square link. */
export function paymentLinkIdempotencyKey(kind: "invoice" | "deposit", id: string, amountCents: number, merchantId: string): string {
  return `${kind}:${id}:${amountCents}:${merchantId}`;
}

async function createSellerPaymentLink(args: {
  seller: SellerCredentials;
  kind: "invoice" | "deposit";
  entityId: string;
  amountCents: number;
  name: string;
  redirectUrl: string;
  buyerEmail?: string;
}): Promise<{ id: string; url: string; order_id: string }> {
  const data = await squareRequest("/v2/online-checkout/payment-links", {
    method: "POST",
    token: args.seller.accessToken,
    body: buildPaymentLinkBody({
      idempotencyKey: paymentLinkIdempotencyKey(args.kind, args.entityId, args.amountCents, args.seller.merchantId),
      name: args.name,
      amountCents: args.amountCents,
      locationId: args.seller.locationId,
      redirectUrl: args.redirectUrl,
      appFeeCents: platformFeeCentsFromEnv(args.amountCents),
      paymentNote: `chemcheck:${args.kind === "invoice" ? "invoice" : "quote_deposit"}:${args.entityId}`,
      buyerEmail: args.buyerEmail,
    }),
  });
  return parsePaymentLinkResponse(data);
}

async function consumePaymentRateLimit(ctx: ActionCtx, email: string) {
  await ctx.runMutation(internal.squareConnect.consumeRateLimit, { user_email: email, action: "payment.link" });
}

function customerName(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 80) : "";
}

export const sendInvoiceWithPaymentLink = action({
  args: {
    id: v.id("invoices"),
    base_url: v.optional(v.string()),
    force_new_session: v.optional(v.boolean()),
    channel_override: v.optional(v.string()),
    recipient_override: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<PaymentLinkResult> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) throw new Error("Not authenticated");
    await consumePaymentRateLimit(ctx, identity.email);

    const paymentContext: any = await ctx.runQuery(internal.invoices.getForPayment, {
      id: args.id,
      user_email: identity.email,
    });
    const { invoice, customer } = paymentContext;
    const destinationOverride = normalizeSendDestinationOverride(args.channel_override, args.recipient_override);

    if (!hasValidSendDestination(customer) && !destinationOverride) {
      throw new Error("Cannot send invoice: customer needs a valid phone or email.");
    }

    if (invoice.status === "paid" || invoice.status === "cancelled") {
      throw new Error("Cannot send an invoice that is paid or cancelled");
    }

    const amountCents = toUsdCents(invoice.total);
    if (amountCents <= 0) {
      await ctx.runMutation(internal.invoices.markPaidZeroTotal, { invoice_id: args.id });
      return { success: true, payment_url: undefined };
    }

    // Card payments go to the pool company's own Square account, never the platform.
    const seller = await requireSellerCredentials(ctx, invoice.created_by);

    if (
      !args.force_new_session
      && !destinationOverride
      && invoice.status === "sent"
      && isReusablePaymentLink(
        {
          link_id: invoice.square_payment_link_id,
          order_id: invoice.square_order_id,
          url: invoice.payment_url,
          merchant_id: invoice.square_merchant_id,
          amount_cents: invoice.square_amount_cents,
        },
        { merchantId: seller.merchantId, amountCents },
      )
    ) {
      return {
        success: true,
        payment_url: invoice.payment_url,
        square_payment_link_id: invoice.square_payment_link_id,
        reused: true,
      };
    }

    const baseUrl = appBaseUrl();
    const name = customerName(customer.full_name);
    const link = await createSellerPaymentLink({
      seller,
      kind: "invoice",
      entityId: String(invoice._id),
      amountCents,
      name: `Invoice ${String(invoice._id).slice(-8)}${name ? ` for ${name}` : ""}`,
      redirectUrl: `${baseUrl}/workorders?square_payment=invoice_success&invoice_id=${invoice._id}`,
      buyerEmail: destinationOverride?.channel === "email"
        ? destinationOverride.recipient
        : customer.email || undefined,
    });

    return await ctx.runMutation(internal.invoices.finalizeSend, {
      id: args.id,
      user_email: identity.email,
      payment_url: link.url,
      square_payment_link_id: link.id,
      square_order_id: link.order_id,
      square_merchant_id: seller.merchantId,
      square_amount_cents: amountCents,
      channel_override: destinationOverride?.channel,
      recipient_override: destinationOverride?.recipient,
    });
  },
});

/** Completed payment for a Square order, fetched with the seller's token. */
async function completedPaymentForOrder(seller: SellerCredentials, orderId: string) {
  const data = await squareRequest(`/v2/orders/${encodeURIComponent(orderId)}`, { method: "GET", token: seller.accessToken });
  const tenders: any[] = Array.isArray(data?.order?.tenders) ? data.order.tenders : [];
  for (const tender of tenders) {
    const paymentId = typeof tender?.payment_id === "string" ? tender.payment_id : typeof tender?.id === "string" ? tender.id : "";
    if (!paymentId) continue;
    const payment = await squareRequest(`/v2/payments/${encodeURIComponent(paymentId)}`, { method: "GET", token: seller.accessToken });
    const facts = paymentFacts(payment?.payment);
    if (facts.status === "COMPLETED" && facts.order_id === orderId) return facts;
  }
  return null;
}

/**
 * User-triggered "check payment status" (e.g. after the customer returns from
 * Square checkout). Looks up the order on the business's own Square account
 * and applies the same verified settlement as the webhook.
 */
export const syncPaymentStatus = action({
  args: {
    invoice_id: v.optional(v.id("invoices")),
    quote_id: v.optional(v.id("quotes")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) throw new Error("Not authenticated");
    if (Boolean(args.invoice_id) === Boolean(args.quote_id)) throw new Error("Provide exactly one of invoice_id or quote_id.");
    await consumePaymentRateLimit(ctx, identity.email);

    if (args.invoice_id) {
      const { invoice }: any = await ctx.runQuery(internal.invoices.getForPayment, {
        id: args.invoice_id,
        user_email: identity.email,
      });
      if (invoice.status === "paid") return { success: true, synced: true, payment_type: "invoice", payment_status: "paid" };
      if (!invoice.square_order_id || !invoice.square_merchant_id) {
        return { success: false, synced: false, payment_type: "invoice", message: "This invoice has no Square payment link" };
      }
      const seller = await requireSellerCredentials(ctx, invoice.created_by);
      if (seller.merchantId !== invoice.square_merchant_id) {
        return { success: false, synced: false, payment_type: "invoice", message: "The payment link belongs to a different Square account" };
      }
      const payment = await completedPaymentForOrder(seller, invoice.square_order_id);
      if (!payment) return { success: true, synced: false, payment_type: "invoice", payment_status: "pending" };
      const result = await ctx.runMutation(internal.invoices.markPaidFromProvider, {
        order_id: invoice.square_order_id,
        merchant_id: seller.merchantId,
        payment_id: payment.payment_id,
        status: payment.status,
        amount_cents: payment.amount_cents,
        currency: payment.currency,
      });
      if (!result.applied && result.reason !== "already_paid") {
        return { success: false, synced: false, payment_type: "invoice", message: "Paid amount does not match the invoice" };
      }
      return { success: true, synced: true, payment_type: "invoice", entity_id: String(args.invoice_id) };
    }

    const { quote }: any = await ctx.runQuery(internal.quotes.getForDepositPayment, {
      id: args.quote_id!,
      user_email: identity.email,
    });
    if (quote.deposit_status === "paid") return { success: true, synced: true, payment_type: "quote_deposit", payment_status: "paid" };
    if (!quote.deposit_square_order_id || !quote.deposit_square_merchant_id) {
      return { success: false, synced: false, payment_type: "quote_deposit", message: "This quote has no Square deposit link" };
    }
    const seller = await requireSellerCredentials(ctx, quote.created_by);
    if (seller.merchantId !== quote.deposit_square_merchant_id) {
      return { success: false, synced: false, payment_type: "quote_deposit", message: "The deposit link belongs to a different Square account" };
    }
    const payment = await completedPaymentForOrder(seller, quote.deposit_square_order_id);
    if (!payment) return { success: true, synced: false, payment_type: "quote_deposit", payment_status: "pending" };
    const result = await ctx.runMutation(internal.quotes.markDepositPaidFromProvider, {
      order_id: quote.deposit_square_order_id,
      merchant_id: seller.merchantId,
      payment_id: payment.payment_id,
      status: payment.status,
      amount_cents: payment.amount_cents,
      currency: payment.currency,
    });
    if (!result.applied && result.reason !== "already_paid") {
      return { success: false, synced: false, payment_type: "quote_deposit", message: "Paid amount does not match the deposit" };
    }
    return { success: true, synced: true, payment_type: "quote_deposit", entity_id: String(args.quote_id) };
  },
});

export const createDepositPaymentLink = action({
  args: {
    id: v.id("quotes"),
    base_url: v.optional(v.string()),
    channel_override: v.optional(v.string()),
    recipient_override: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<PaymentLinkResult> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) throw new Error("Not authenticated");
    await consumePaymentRateLimit(ctx, identity.email);

    const paymentContext: any = await ctx.runQuery(internal.quotes.getForDepositPayment, {
      id: args.id,
      user_email: identity.email,
    });
    const { quote, customer } = paymentContext;
    const destinationOverride = normalizeSendDestinationOverride(args.channel_override, args.recipient_override);

    if (!hasValidSendDestination(customer) && !destinationOverride) {
      throw new Error("Cannot send deposit request: customer needs a valid phone or email.");
    }

    if (!quote.deposit_required || quote.deposit_required <= 0) {
      throw new Error("This quote does not require a deposit");
    }

    if (quote.deposit_status === "paid" && !destinationOverride) {
      return {
        success: true,
        payment_url: quote.deposit_payment_url,
        square_payment_link_id: quote.deposit_square_payment_link_id,
        reused: true,
      };
    }

    const amountCents = toUsdCents(quote.deposit_required);
    if (amountCents <= 0) {
      throw new Error("Deposit amount must be greater than zero");
    }

    // Deposits go to the pool company's own Square account, never the platform.
    const seller = await requireSellerCredentials(ctx, quote.created_by);

    if (
      quote.deposit_status === "pending"
      && !destinationOverride
      && isReusablePaymentLink(
        {
          link_id: quote.deposit_square_payment_link_id,
          order_id: quote.deposit_square_order_id,
          url: quote.deposit_payment_url,
          merchant_id: quote.deposit_square_merchant_id,
          amount_cents: quote.deposit_square_amount_cents,
        },
        { merchantId: seller.merchantId, amountCents },
      )
    ) {
      return {
        success: true,
        payment_url: quote.deposit_payment_url,
        square_payment_link_id: quote.deposit_square_payment_link_id,
        reused: true,
      };
    }

    const baseUrl = appBaseUrl();
    const link = await createSellerPaymentLink({
      seller,
      kind: "deposit",
      entityId: String(quote._id),
      amountCents,
      name: `Deposit: ${String(quote.title || "Quote").slice(0, 120)}`,
      redirectUrl: `${baseUrl}/workorders?square_payment=deposit_success&quote_id=${quote._id}`,
      buyerEmail: destinationOverride?.channel === "email"
        ? destinationOverride.recipient
        : customer.email || undefined,
    });

    return await ctx.runMutation(internal.quotes.storeDepositCheckoutLink, {
      id: args.id,
      user_email: identity.email,
      payment_url: link.url,
      square_payment_link_id: link.id,
      square_order_id: link.order_id,
      square_merchant_id: seller.merchantId,
      square_amount_cents: amountCents,
      channel_override: destinationOverride?.channel,
      recipient_override: destinationOverride?.recipient,
    });
  },
});
