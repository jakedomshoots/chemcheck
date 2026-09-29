import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { validateEmail, validatePhone } from "./validation";
import { fetchProvider, requireStripeConfig } from "./providerConfig";
import {
  STRIPE_API_BASE,
  appBaseUrl,
  buildStripeHeaders,
  checkoutPaymentMatches,
  isStripeAccountId,
  platformFeeCentsFromEnv,
  requireChargeableAccount,
  toUsdCents,
} from "./stripeConnect";

type StripeLinkResult = {
  success: boolean;
  payment_url?: string;
  stripe_checkout_session_id?: string;
  communication_id?: string;
  reused?: boolean;
};

function normalizeBaseUrl(baseUrl?: string): string {
  // Redirect origins always come from server env, never the caller.
  void baseUrl;
  return appBaseUrl();
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

type CheckoutSessionArgs = {
  amountCents: number;
  applicationFeeCents?: number;
  customerEmail?: string;
  customMessage?: string;
  lineItemName: string;
  lineItemDescription: string;
  successUrl: string;
  cancelUrl: string;
  clientReferenceId: string;
  metadata: Record<string, string>;
};

/** Form body for a Checkout Session created as a direct charge on a connected account. */
export function buildCheckoutSessionForm(args: CheckoutSessionArgs): URLSearchParams {
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

  if (args.applicationFeeCents && args.applicationFeeCents > 0) {
    form.set("payment_intent_data[application_fee_amount]", String(args.applicationFeeCents));
  }

  if (args.customerEmail) {
    form.set("customer_email", args.customerEmail);
  }

  if (args.customMessage) {
    form.set("custom_text[submit][message]", args.customMessage);
  }

  return form;
}

class StripeRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function createStripeCheckoutSession(
  args: CheckoutSessionArgs & { stripeSecretKey: string; stripeAccountId: string },
): Promise<{ id: string; url: string }> {
  // Direct charge: the session (and the money) belongs to the connected account.
  const response = await fetchProvider(`${STRIPE_API_BASE}/checkout/sessions`, {
    method: "POST",
    headers: buildStripeHeaders({
      secretKey: args.stripeSecretKey,
      stripeAccountId: args.stripeAccountId,
      form: true,
    }),
    body: buildCheckoutSessionForm(args).toString(),
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
  /** Connected account that owns the session; omit only for legacy platform sessions. */
  stripeAccountId?: string;
}): Promise<any> {
  const response = await fetchProvider(`${STRIPE_API_BASE}/checkout/sessions/${encodeURIComponent(args.sessionId)}`, {
    method: "GET",
    headers: buildStripeHeaders({
      secretKey: args.stripeSecretKey,
      stripeAccountId: args.stripeAccountId,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    const message = typeof data?.error?.message === "string"
      ? data.error.message
      : `Stripe checkout fetch failed (${response.status})`;
    throw new StripeRequestError(message, response.status);
  }

  return data;
}

/**
 * Retrieve a Checkout Session for the caller's business. Sessions live on the
 * business's connected account; sessions created before Stripe Connect was
 * introduced live on the platform account, so a missing session falls back to
 * a platform lookup (ownership is still enforced by the invoice/quote checks).
 */
async function retrieveCheckoutSessionForBusiness(args: {
  stripeSecretKey: string;
  sessionId: string;
  stripeAccountId?: string;
}): Promise<any> {
  if (isStripeAccountId(args.stripeAccountId)) {
    try {
      return await getStripeCheckoutSession(args);
    } catch (error) {
      if (!(error instanceof StripeRequestError) || error.status !== 404) throw error;
    }
  }
  return await getStripeCheckoutSession({ stripeSecretKey: args.stripeSecretKey, sessionId: args.sessionId });
}

/**
 * A stored payment link is only reused when its session still exists ON THE
 * CONNECTED ACCOUNT, is open, and charges the current amount. Links created on
 * the platform account before Stripe Connect are never reused.
 */
async function isReusableConnectedSession(args: {
  stripeSecretKey: string;
  stripeAccountId: string;
  sessionId: string;
  amountCents: number;
}): Promise<boolean> {
  try {
    const session = await getStripeCheckoutSession(args);
    return session?.status === "open"
      && session?.amount_total === args.amountCents
      && String(session?.currency || "").toLowerCase() === "usd";
  } catch {
    return false;
  }
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
      // Card payments go to the pool company's connected account, never the platform.
      const stripeAccountId = requireChargeableAccount(
        await ctx.runQuery(internal.stripeConnect.getPaymentAccountForUser, {
          user_email: invoice.created_by,
        }),
      );
      const { secretKey: stripeSecretKey } = requireStripeConfig();

      const hasReusableStripeLink =
        invoice.status === "sent"
        && Boolean(invoice.stripe_checkout_session_id)
        && Boolean(invoice.payment_url)
        && /^https:\/\/(checkout|pay)\.stripe\.com\//i.test(invoice.payment_url || "");

      if (
        !args.force_new_session
        && hasReusableStripeLink
        && !destinationOverride
        && await isReusableConnectedSession({
          stripeSecretKey,
          stripeAccountId,
          sessionId: invoice.stripe_checkout_session_id,
          amountCents,
        })
      ) {
        return {
          success: true,
          payment_url: invoice.payment_url,
          stripe_checkout_session_id: invoice.stripe_checkout_session_id,
          reused: true,
        };
      }

      const session = await createStripeCheckoutSession({
        stripeSecretKey,
        stripeAccountId,
        amountCents,
        applicationFeeCents: platformFeeCentsFromEnv(amountCents),
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

    const { secretKey: stripeSecretKey } = requireStripeConfig();

    // The account is resolved from the caller's business, never from the client.
    const paymentAccount = await ctx.runQuery(internal.stripeConnect.getPaymentAccountForUser, {
      user_email: identity.email!,
    });
    const session = await retrieveCheckoutSessionForBusiness({
      stripeSecretKey,
      sessionId: args.session_id,
      stripeAccountId: paymentAccount?.stripe_account_id,
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

      const { invoice }: any = await ctx.runQuery(internal.invoices.getForPayment, {
        id: invoiceId as any,
        user_email: identity.email!,
      });
      const match = checkoutPaymentMatches(session, toUsdCents(invoice.total));
      if (!match.ok) {
        return { success: false, synced: false, payment_type: "invoice", message: "Paid amount does not match the invoice" };
      }
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

      const { quote }: any = await ctx.runQuery(internal.quotes.getForDepositPayment, {
        id: quoteId as any,
        user_email: identity.email!,
      });
      const match = checkoutPaymentMatches(session, toUsdCents(quote.deposit_required ?? 0));
      if (!match.ok) {
        return { success: false, synced: false, payment_type: "quote_deposit", message: "Paid amount does not match the deposit" };
      }
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

    const amountCents = toUsdCents(quote.deposit_required);
    if (amountCents <= 0) {
      throw new Error("Deposit amount must be greater than zero");
    }

    // Deposits go to the pool company's connected account, never the platform.
    const stripeAccountId = requireChargeableAccount(
      await ctx.runQuery(internal.stripeConnect.getPaymentAccountForUser, {
        user_email: quote.created_by,
      }),
    );
    const { secretKey: stripeSecretKey } = requireStripeConfig();

    if (
      quote.deposit_payment_url
      && quote.deposit_checkout_session_id
      && quote.deposit_status === "pending"
      && !destinationOverride
      && await isReusableConnectedSession({
        stripeSecretKey,
        stripeAccountId,
        sessionId: quote.deposit_checkout_session_id,
        amountCents,
      })
    ) {
      return {
        success: true,
        payment_url: quote.deposit_payment_url,
        stripe_checkout_session_id: quote.deposit_checkout_session_id,
        reused: true,
      };
    }

    const baseUrl = normalizeBaseUrl(args.base_url);
    const session = await createStripeCheckoutSession({
      stripeSecretKey,
      stripeAccountId,
      amountCents,
      applicationFeeCents: platformFeeCentsFromEnv(amountCents),
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
