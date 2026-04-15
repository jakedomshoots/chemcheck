import { httpRouter } from "convex/server";
import { handleStripeWebhook } from "./stripeWebhook";

const http = httpRouter();

// Stripe webhook endpoint
// Configure in Stripe Dashboard: https://your-deployment.convex.site/stripe-webhook
http.route({
  path: "/stripe-webhook",
  method: "POST",
  handler: handleStripeWebhook,
});

export default http;
