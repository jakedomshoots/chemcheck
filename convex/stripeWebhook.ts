import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

/**
 * SECURITY: Webhook error types for structured logging
 */
type WebhookErrorType =
  | 'SIGNATURE_MISSING'
  | 'SIGNATURE_INVALID'
  | 'SECRET_NOT_CONFIGURED'
  | 'JSON_PARSE_ERROR'
  | 'HANDLER_ERROR'
  | 'ORIGIN_VALIDATION_FAILED';

/**
 * Structured error logger for webhook events
 * Logs detailed information securely without exposing to clients
 */
function logWebhookError(
  errorType: WebhookErrorType,
  details: Record<string, unknown>,
  error?: unknown
): void {
  const logEntry = {
    timestamp: new Date().toISOString(),
    service: 'stripe-webhook',
    errorType,
    ...details,
    // Include error message but not stack trace for remote errors
    ...(error instanceof Error ? {
      errorMessage: error.message,
      // Only log stack trace in development
      ...(process.env.NODE_ENV === 'development' ? { stack: error.stack } : {})
    } : {}),
  };

  console.error('[Webhook Error]', JSON.stringify(logEntry));
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (char) => map[char]);
}

function formatCurrencyFromCents(cents: unknown): string {
  if (typeof cents !== "number" || !Number.isFinite(cents)) {
    return "an outstanding balance";
  }
  return `$${(cents / 100).toFixed(2)}`;
}

function toIsoDateFromEpochSeconds(epochSeconds: unknown): string {
  if (typeof epochSeconds !== "number" || !Number.isFinite(epochSeconds)) {
    return "as soon as possible";
  }
  return new Date(epochSeconds * 1000).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

async function sendPaymentFailedNotificationEmail(
  args: {
    userEmail: string;
    businessName?: string;
    businessEmail?: string;
    invoice: unknown;
  }
): Promise<void> {
  const { userEmail, businessName, businessEmail, invoice } = args;
  if (!userEmail) return;

  const apiKey = process.env.MAILERSEND_API_KEY;
  const fromEmail = process.env.FROM_EMAIL;
  if (!apiKey || !fromEmail) {
    logWebhookError("HANDLER_ERROR", {
      reason: "mailersend_not_configured",
      hasApiKey: !!apiKey,
      hasFromEmail: !!fromEmail,
      userEmail,
    });
    return;
  }

  const invoiceData = (invoice && typeof invoice === "object" ? invoice : {}) as Record<string, unknown>;
  const resolvedBusinessName = businessName || "ChemCheck";
  const recipientEmail = businessEmail || userEmail;
  const amountDue = formatCurrencyFromCents(invoiceData.amount_due);
  const retryDate = toIsoDateFromEpochSeconds(invoiceData.next_payment_attempt);
  const invoiceUrl =
    (typeof invoiceData.hosted_invoice_url === "string" && invoiceData.hosted_invoice_url) ||
    (typeof invoiceData.invoice_pdf === "string" && invoiceData.invoice_pdf) ||
    "";
  const billingPortalUrl = process.env.BILLING_PORTAL_URL || "";

  const safeBusinessName = escapeHtml(resolvedBusinessName);
  const safeAmountDue = escapeHtml(amountDue);
  const safeRetryDate = escapeHtml(retryDate);
  const safeInvoiceUrl = escapeHtml(invoiceUrl);
  const safeBillingPortalUrl = escapeHtml(billingPortalUrl);

  const subject = `Action needed: payment failed for ${resolvedBusinessName}`;
  const textBody = [
    `Hi ${resolvedBusinessName},`,
    ``,
    `We could not process your latest subscription payment (${amountDue}).`,
    `We'll retry on ${retryDate}.`,
    ``,
    invoiceUrl ? `Invoice: ${invoiceUrl}` : "",
    billingPortalUrl ? `Billing portal: ${billingPortalUrl}` : "",
    ``,
    `To keep access uninterrupted, please update your payment method.`,
  ]
    .filter(Boolean)
    .join("\n");

  const htmlBody = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Payment Failed</title>
    </head>
    <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;line-height:1.6;color:#1e293b;max-width:600px;margin:0 auto;padding:20px;">
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:24px;">
        <h1 style="margin:0 0 12px 0;font-size:22px;color:#991b1b;">Payment Failed</h1>
        <p style="margin:0 0 12px 0;">Hi ${safeBusinessName},</p>
        <p style="margin:0 0 12px 0;">
          We could not process your latest subscription payment (<strong>${safeAmountDue}</strong>).
          We will retry on <strong>${safeRetryDate}</strong>.
        </p>
        <p style="margin:0 0 16px 0;">To keep access uninterrupted, please update your payment method.</p>
        ${invoiceUrl ? `<p style="margin:0 0 8px 0;"><a href="${safeInvoiceUrl}" style="color:#2563eb;">View invoice</a></p>` : ""}
        ${billingPortalUrl ? `<p style="margin:0;"><a href="${safeBillingPortalUrl}" style="color:#2563eb;">Open billing portal</a></p>` : ""}
      </div>
    </body>
    </html>
  `;

  const response = await fetch("https://api.mailersend.com/v1/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: {
        email: fromEmail,
        name: resolvedBusinessName,
      },
      to: [{ email: recipientEmail }],
      subject,
      text: textBody,
      html: htmlBody,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    logWebhookError("HANDLER_ERROR", {
      reason: "payment_failed_notification_send_error",
      status: response.status,
      recipientEmail,
      bodyPreview: body.slice(0, 300),
    });
  }
}

/**
 * SECURITY: Validate origin for defense-in-depth CSRF protection
 * Stripe webhooks should only come from Stripe's infrastructure
 */
function validateStripeOrigin(request: Request): boolean {
  const userAgent = request.headers.get('user-agent');

  // SECURITY: Block requests with browser-like user-agents
  // Legitimate Stripe webhooks never come from browsers
  // Common browser patterns: Mozilla/, Chrome/, Safari/, Firefox/, Edge/
  const browserPatterns = [
    /^Mozilla\//i,
    /Chrome\//i,
    /Safari\//i,
    /Firefox\//i,
    /Edg\//i,
    /Opera\//i,
    /Trident\//i,  // IE
  ];

  if (userAgent) {
    const isBrowserLike = browserPatterns.some(pattern => pattern.test(userAgent));

    if (isBrowserLike && !userAgent.includes('Stripe')) {
      logWebhookError('ORIGIN_VALIDATION_FAILED', {
        reason: 'browser_user_agent',
        userAgent: userAgent.slice(0, 100),
      });
      return false;
    }

    // Log unexpected non-Stripe user agents for monitoring
    if (!userAgent.includes('Stripe')) {
      console.debug('[Webhook Security] Non-Stripe user-agent (allowed):', userAgent.slice(0, 100));
    }
  }

  // Check for suspicious headers that shouldn't be on server-to-server requests
  const referer = request.headers.get('referer');
  const browserHeaders = request.headers.get('sec-ch-ua') ||
    request.headers.get('sec-fetch-mode');

  if (referer || browserHeaders) {
    logWebhookError('ORIGIN_VALIDATION_FAILED', {
      hasReferer: !!referer,
      hasBrowserHeaders: !!browserHeaders,
      userAgent: userAgent?.slice(0, 100),
    });
    return false;
  }

  return true;
}

/**
 * Verify Stripe webhook signature using HMAC-SHA256
 * This is a pure implementation that doesn't require the Stripe SDK
 */
async function verifyStripeSignature(
  payload: string,
  sigHeader: string,
  secret: string
): Promise<{ verified: boolean; timestamp?: number }> {
  // Parse the signature header
  // Format: t=timestamp,v1=signature,v1=signature2,...
  const parts = sigHeader.split(",");
  let timestamp: number | undefined;
  const signatures: string[] = [];

  for (const part of parts) {
    const [key, value] = part.split("=");
    if (key === "t") {
      timestamp = parseInt(value, 10);
    } else if (key === "v1") {
      signatures.push(value);
    }
  }

  if (!timestamp || signatures.length === 0) {
    return { verified: false };
  }

  // Check timestamp tolerance (5 minutes)
  const tolerance = 5 * 60; // 5 minutes in seconds
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > tolerance) {
    logWebhookError('SIGNATURE_INVALID', {
      reason: 'timestamp_expired',
      ageDelta: now - timestamp,
      tolerance,
    });
    return { verified: false };
  }

  // Compute expected signature
  const signedPayload = `${timestamp}.${payload}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(signedPayload)
  );

  // Convert to hex string
  const expectedSignature = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Constant-time comparison
  const verified = signatures.some((sig) => {
    if (sig.length !== expectedSignature.length) return false;
    let result = 0;
    for (let i = 0; i < sig.length; i++) {
      result |= sig.charCodeAt(i) ^ expectedSignature.charCodeAt(i);
    }
    return result === 0;
  });

  return { verified, timestamp };
}

/**
 * Stripe webhook handler with signature verification
 * Configure this URL in your Stripe Dashboard: https://your-deployment.convex.site/stripe-webhook
 * 
 * SECURITY FEATURES:
 * - HMAC-SHA256 signature verification
 * - Timestamp validation (5-minute tolerance)
 * - Origin validation for defense-in-depth
 * - Structured error logging (no secrets in client responses)
 */
export const handleStripeWebhook = httpAction(async (ctx, request) => {
  // SECURITY: Defense-in-depth origin validation
  if (!validateStripeOrigin(request)) {
    return new Response("Invalid request", { status: 403 });
  }

  // Get the raw body for signature verification
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    logWebhookError('SIGNATURE_MISSING', {
      ip: request.headers.get('x-forwarded-for') || 'unknown',
    });
    return new Response("Missing signature", { status: 400 });
  }

  // Get webhook secret from environment
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    logWebhookError('SECRET_NOT_CONFIGURED', {});
    // Don't reveal this is a configuration issue to attackers
    return new Response("Service unavailable", { status: 503 });
  }

  // Verify the webhook signature
  const { verified, timestamp } = await verifyStripeSignature(body, signature, webhookSecret);
  if (!verified) {
    logWebhookError('SIGNATURE_INVALID', {
      signaturePrefix: signature.slice(0, 20) + '...',
    });
    return new Response("Invalid signature", { status: 401 });
  }

  console.log(`[Webhook] Verified request with timestamp: ${timestamp}`);

  // Parse the event after signature verification
  let event;
  try {
    event = JSON.parse(body);
  } catch (err) {
    logWebhookError('JSON_PARSE_ERROR', {}, err);
    return new Response("Invalid payload", { status: 400 });
  }

  // Handle the event
  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object;
        await ctx.runMutation(internal.subscriptions.upsert, {
          user_email: subscription.metadata?.user_email || "",
          stripe_customer_id: subscription.customer,
          stripe_subscription_id: subscription.id,
          plan_id: subscription.metadata?.plan_id || "starter",
          status: subscription.status,
          current_period_start: subscription.current_period_start * 1000,
          current_period_end: subscription.current_period_end * 1000,
          cancel_at_period_end: subscription.cancel_at_period_end,
          trial_end: subscription.trial_end ? subscription.trial_end * 1000 : undefined,
        });
        console.log(`[Webhook] Processed ${event.type} for subscription:`, subscription.id);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        await ctx.runMutation(internal.subscriptions.upsert, {
          user_email: subscription.metadata?.user_email || "",
          stripe_customer_id: subscription.customer,
          stripe_subscription_id: subscription.id,
          plan_id: subscription.metadata?.plan_id || "starter",
          status: "canceled",
          current_period_start: subscription.current_period_start * 1000,
          current_period_end: subscription.current_period_end * 1000,
          cancel_at_period_end: true,
          trial_end: undefined,
        });
        console.log(`[Webhook] Processed subscription deletion:`, subscription.id);
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object;
        const stripeSubscriptionId =
          typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id;
        if (stripeSubscriptionId) {
          const subscription = await ctx.runQuery(internal.subscriptions.getByStripeSubscription, {
            stripe_subscription_id: stripeSubscriptionId,
          });

          if (subscription) {
            await ctx.runMutation(internal.subscriptions.updateStatus, {
              subscription_id: subscription._id,
              status: "active",
            });
          }
        }

        console.log("[Webhook] Payment succeeded for invoice:", invoice.id);
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object;
        const stripeCustomerId =
          typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
        const stripeSubscriptionId =
          typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id;
        let userEmail = invoice.metadata?.user_email || invoice.customer_email || "";

        // Try to resolve from existing subscription records.
        let subscription = null;
        if (stripeSubscriptionId) {
          subscription = await ctx.runQuery(internal.subscriptions.getByStripeSubscription, {
            stripe_subscription_id: stripeSubscriptionId,
          });
        }

        if (!subscription && stripeCustomerId) {
          subscription = await ctx.runQuery(internal.subscriptions.getByStripeCustomer, {
            stripe_customer_id: stripeCustomerId,
          });
        }

        if (subscription) {
          userEmail = userEmail || subscription.user_email;
          await ctx.runMutation(internal.subscriptions.updateStatus, {
            subscription_id: subscription._id,
            status: "past_due",
          });
        }

        if (userEmail) {
          try {
            const business = await ctx.runQuery(internal.businesses.getByOwnerEmailInternal, {
              owner_email: userEmail,
            });
            await sendPaymentFailedNotificationEmail({
              userEmail,
              businessName: business?.name,
              businessEmail: business?.email || undefined,
              invoice,
            });
          } catch (notifyErr) {
            logWebhookError("HANDLER_ERROR", {
              reason: "payment_failed_notification_exception",
              invoiceId: invoice.id,
              userEmail,
            }, notifyErr);
          }
        }

        console.log("[Webhook] Payment failed for invoice:", invoice.id);
        break;
      }

      default:
        console.log(`[Webhook] Unhandled event type: ${event.type}`);
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    // SECURITY: Log detailed error internally, return generic message to client
    logWebhookError('HANDLER_ERROR', {
      eventType: event.type,
      eventId: event.id,
    }, err);

    // Generic error message - don't reveal internal details
    return new Response("Processing error", { status: 500 });
  }
});
