import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

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
    console.error(`Webhook timestamp too old: ${now - timestamp} seconds`);
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
 * Configure this URL in your Stripe dashboard: https://your-convex-url.convex.site/stripe-webhook
 */
export const handleStripeWebhook = httpAction(async (ctx, request) => {
  // Get the raw body for signature verification
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    console.error("Missing stripe-signature header");
    return new Response("Missing stripe-signature header", { status: 400 });
  }

  // Get webhook secret from environment
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("STRIPE_WEBHOOK_SECRET not configured");
    return new Response("Webhook secret not configured", { status: 500 });
  }

  // Verify the webhook signature
  const { verified, timestamp } = await verifyStripeSignature(body, signature, webhookSecret);
  if (!verified) {
    console.error("Invalid webhook signature");
    return new Response("Invalid signature", { status: 401 });
  }

  console.log(`Verified webhook with timestamp: ${timestamp}`);

  // Parse the event after signature verification
  let event;
  try {
    event = JSON.parse(body);
  } catch (err) {
    console.error("Invalid JSON in webhook body");
    return new Response("Invalid JSON", { status: 400 });
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
        break;
      }

      case "invoice.payment_succeeded": {
        // Payment successful - subscription is active
        console.log("Payment succeeded for invoice:", event.data.object.id);
        break;
      }

      case "invoice.payment_failed": {
        // Payment failed - may need to notify user
        console.log("Payment failed for invoice:", event.data.object.id);
        // TODO: Send notification to user about failed payment
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Webhook handler error:", err);
    return new Response("Webhook handler failed", { status: 500 });
  }
});

