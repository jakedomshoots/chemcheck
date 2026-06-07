import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { validateEmail, validatePhone } from "./validation";

const STRIPE_API_BASE = "https://api.stripe.com/v1";
const FALLBACK_APP_BASE_URL = "https://app.chemcheck.app";

type StripeLinkResult = {
  success: boolean;
  payment_url?: string;
  stripe_checkout_session_id?: string;
  communication_id?: string;
  reused?: boolean;
};

function normalizeBaseUrl(baseUrl?: string): string {
  void baseUrl;
  const trimmedEnv = (process.env.APP_URL || "").trim().replace(/\/+$/, "");
  return trimmedEnv || FALLBACK_APP_BASE_URL;
}

function toUsdCents(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.max(0, Math.round(amount * 100));
}

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

async function createStripeCheckoutSession(args: {
  stripeSecretKey: string;
  amountCents: number;
  customerEmail?: string;
  customMessage?: string;
  lineItemName: string;
  lineItemDescription: string;
  successUrl: string;
  cancelUrl: string;
  clientReferenceId: string;
  metadata: Record<string, string>;
}): Promise<{ id: string; url: string }> {
  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("success_url", args.successUrl);
  form.set("cancel_url", args.cancelUrl);
  form.set("client_reference_id", args.clientReferenceId);
  form.set("line_items[0][quantity]", "1");
  form.set("line_items[0][price_data][currency]", "usd");
  form.set("line_items[0][price_data][unit_amount]", String(args.amountCents));
  form.set("line_items[0][price_data][product_data][name]", args.lineItemName);
  form.set("line_items[0][price_data][product_data][description]", args.lineItemDescription);

  for (const [key, value] of Object.entries(args.metadata)) {
    form.set(`metadata[${key}]`, value);
    form.set(`payment_intent_data[metadata][${key}]`, value);
  }

  if (args.customerEmail) {
    form.set("customer_email", args.customerEmail);
  }

  if (args.customMessage) {
    form.set("custom_text[submit][message]", args.customMessage);
  }

  const response = await fetch(`${STRIPE_API_BASE}/checkout/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.stripeSecretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  const data = await response.json();
  if (!response.ok) {
    const message = typeof data?.error?.message === "string"
      ? data.error.message
      : `Stripe checkout creation failed (${response.status})`;
    throw new Error(message);
  }

  if (!data?.id || !data?.url) {
    throw new Error("Stripe checkout session response is missing required fields");
  }

  return { id: data.id as string, url: data.url as string };
}

async function getStripeCheckoutSession(args: {
  stripeSecretKey: string;
  sessionId: string;
}): Promise<any> {
  const response = await fetch(`${STRIPE_API_BASE}/checkout/sessions/${encodeURIComponent(args.sessionId)}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${args.stripeSecretKey}`,
    },
  });

  const data = await response.json();
  if (!response.ok) {
    const message = typeof data?.error?.message === "string"
      ? data.error.message
      : `Stripe checkout fetch failed (${response.status})`;
    throw new Error(message);
  }

  return data;
}

export const sendInvoiceWithStripe = action({
  args: {
    id: v.id("invoices"),
    base_url: v.optional(v.string()),
    force_new_session: v.optional(v.boolean()),
    channel_override: v.optional(v.string()),
    recipient_override: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<StripeLinkResult> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const paymentContext: any = await ctx.runQuery(internal.invoices.getForPayment, {
      id: args.id,
      user_email: identity.email!,
    });
    const { invoice, customer } = paymentContext;
    const destinationOverride = normalizeSendDestinationOverride(args.channel_override, args.recipient_override);

    if (!hasValidSendDestination(customer) && !destinationOverride) {
      throw new Error("Cannot send invoice: customer needs a valid phone or email.");
    }

    if (invoice.status === "paid" || invoice.status === "cancelled") {
      throw new Error("Cannot send an invoice that is paid or cancelled");
    }

    const hasReusableStripeLink =
      invoice.status === "sent"
      && Boolean(invoice.stripe_checkout_session_id)
      && Boolean(invoice.payment_url)
      && /^https:\/\/(checkout|pay)\.stripe\.com\//i.test(invoice.payment_url || "");

    if (!args.force_new_session && hasReusableStripeLink && !destinationOverride) {
      return {
        success: true,
        payment_url: invoice.payment_url,
        stripe_checkout_session_id: invoice.stripe_checkout_session_id,
        reused: true,
      };
    }

    if (invoice.total <= 0) {
      await ctx.runMutation(internal.invoices.markPaidFromStripe, {
        invoice_id: args.id,
      });
      return {
        success: true,
        payment_url: undefined,
        stripe_checkout_session_id: undefined,
      };
    }

    const baseUrl = normalizeBaseUrl(args.base_url);
    const amountCents = toUsdCents(invoice.total);
    let paymentUrl: string;
    let stripeCheckoutSessionId: string | undefined;

    if (amountCents > 0) {
      const stripeSecretKey = (process.env.STRIPE_SECRET_KEY || "").trim();
      if (!stripeSecretKey) {
        throw new Error("Stripe is not configured. Set STRIPE_SECRET_KEY to send invoice payment links.");
      }

      const session = await createStripeCheckoutSession({
        stripeSecretKey,
        amountCents,
        customerEmail: destinationOverride?.channel === "email"
          ? destinationOverride.recipient
          : customer.email || undefined,
        customMessage: customer.full_name ? `Paying invoice for ${customer.full_name}` : undefined,
        lineItemName: `ChemCheck Invoice ${String(invoice._id).slice(-8)}`,
        lineItemDescription: invoice.line_items[0]?.description || invoice.notes || "Pool service invoice",
        successUrl: `${baseUrl}/workorders?stripe_payment=invoice_success&invoice_id=${invoice._id}&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${baseUrl}/workorders?stripe_payment=invoice_cancel&invoice_id=${invoice._id}`,
        clientReferenceId: String(invoice._id),
        metadata: {
          payment_type: "invoice",
          invoice_id: String(invoice._id),
        },
      });

      paymentUrl = session.url;
      stripeCheckoutSessionId = session.id;
    } else {
      paymentUrl = `${baseUrl}/workorders?invoice_id=${invoice._id}`;
    }

    return await ctx.runMutation(internal.invoices.finalizeSend, {
      id: args.id,
      user_email: identity.email!,
      payment_url: paymentUrl,
      stripe_checkout_session_id: stripeCheckoutSessionId,
      channel_override: destinationOverride?.channel,
      recipient_override: destinationOverride?.recipient,
    });
  },
});

export const syncCheckoutSessionStatus = action({
  args: {
    session_id: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const stripeSecretKey = (process.env.STRIPE_SECRET_KEY || "").trim();
    if (!stripeSecretKey) {
      throw new Error("Stripe is not configured. Set STRIPE_SECRET_KEY to sync checkout sessions.");
    }

    const session = await getStripeCheckoutSession({
      stripeSecretKey,
      sessionId: args.session_id,
    });

    const paymentType = session?.metadata?.payment_type || session?.metadata?.entity_type;
    const paymentStatus = typeof session?.payment_status === "string" ? session.payment_status : "";
    const sessionStatus = typeof session?.status === "string" ? session.status : "";
    const stripeCheckoutSessionId = typeof session?.id === "string" ? session.id : undefined;
    const stripePaymentIntentId =
      typeof session?.payment_intent === "string"
        ? session.payment_intent
        : typeof session?.payment_intent?.id === "string"
          ? session.payment_intent.id
          : undefined;

    const isPaid = paymentStatus === "paid";
    if (!isPaid) {
      return {
        success: true,
        synced: false,
        payment_type: paymentType || undefined,
        payment_status: paymentStatus || sessionStatus || "pending",
      };
    }

    if (paymentType === "invoice") {
      const invoiceId = session?.metadata?.invoice_id;
      if (!invoiceId || typeof invoiceId !== "string") {
        return { success: false, synced: false, payment_type: "invoice", message: "Missing invoice metadata" };
      }

      await ctx.runQuery(internal.invoices.getForPayment, {
        id: invoiceId as any,
        user_email: identity.email!,
      });
      await ctx.runMutation(internal.invoices.markPaidFromStripe, {
        invoice_id: invoiceId as any,
        stripe_checkout_session_id: stripeCheckoutSessionId,
        stripe_payment_intent_id: stripePaymentIntentId,
      });

      return {
        success: true,
        synced: true,
        payment_type: "invoice",
        entity_id: invoiceId,
      };
    }

    if (paymentType === "quote_deposit") {
      const quoteId = session?.metadata?.quote_id;
      if (!quoteId || typeof quoteId !== "string") {
        return { success: false, synced: false, payment_type: "quote_deposit", message: "Missing quote metadata" };
      }

      await ctx.runQuery(internal.quotes.getForDepositPayment, {
        id: quoteId as any,
        user_email: identity.email!,
      });
      await ctx.runMutation(internal.quotes.markDepositPaidFromStripe, {
        quote_id: quoteId as any,
        stripe_checkout_session_id: stripeCheckoutSessionId,
      });

      return {
        success: true,
        synced: true,
        payment_type: "quote_deposit",
        entity_id: quoteId,
      };
    }

    return {
      success: false,
      synced: false,
      payment_type: paymentType || undefined,
      message: "Unsupported payment type",
    };
  },
});

export const createDepositPaymentLink = action({
  args: {
    id: v.id("quotes"),
    base_url: v.optional(v.string()),
    channel_override: v.optional(v.string()),
    recipient_override: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<StripeLinkResult> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const paymentContext: any = await ctx.runQuery(internal.quotes.getForDepositPayment, {
      id: args.id,
      user_email: identity.email!,
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
        stripe_checkout_session_id: quote.deposit_checkout_session_id,
        reused: true,
      };
    }

    if (
      quote.deposit_payment_url
      && quote.deposit_checkout_session_id
      && quote.deposit_status === "pending"
      && !destinationOverride
    ) {
      return {
        success: true,
        payment_url: quote.deposit_payment_url,
        stripe_checkout_session_id: quote.deposit_checkout_session_id,
        reused: true,
      };
    }

    const stripeSecretKey = (process.env.STRIPE_SECRET_KEY || "").trim();
    if (!stripeSecretKey) {
      throw new Error("Stripe is not configured. Set STRIPE_SECRET_KEY to send deposit payment links.");
    }

    const amountCents = toUsdCents(quote.deposit_required);
    if (amountCents <= 0) {
      throw new Error("Deposit amount must be greater than zero");
    }

    const baseUrl = normalizeBaseUrl(args.base_url);
    const session = await createStripeCheckoutSession({
      stripeSecretKey,
      amountCents,
      customerEmail: destinationOverride?.channel === "email"
        ? destinationOverride.recipient
        : customer.email || undefined,
      customMessage: customer.full_name ? `Paying deposit for ${customer.full_name}` : undefined,
      lineItemName: `ChemCheck Deposit ${String(quote._id).slice(-8)}`,
      lineItemDescription: quote.title,
      successUrl: `${baseUrl}/workorders?stripe_payment=deposit_success&quote_id=${quote._id}&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${baseUrl}/workorders?stripe_payment=deposit_cancel&quote_id=${quote._id}`,
      clientReferenceId: String(quote._id),
      metadata: {
        payment_type: "quote_deposit",
        quote_id: String(quote._id),
      },
    });

    return await ctx.runMutation(internal.quotes.storeDepositCheckoutLink, {
      id: args.id,
      user_email: identity.email!,
      payment_url: session.url,
      stripe_checkout_session_id: session.id,
      channel_override: destinationOverride?.channel,
      recipient_override: destinationOverride?.recipient,
    });
  },
});
