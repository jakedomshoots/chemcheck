import { httpRouter } from "convex/server";
import { handleStripeWebhook } from "./stripeWebhook";
import { handleStripeConnectWebhook } from "./stripeConnect";

const http = httpRouter();

// Stripe webhook endpoint
// Configure in Stripe Dashboard: https://your-deployment.convex.site/stripe-webhook
http.route({
  path: "/stripe-webhook",
  method: "POST",
  handler: handleStripeWebhook,
});

// Stripe Connect webhook endpoint (events from connected accounts:
// account.updated, checkout.session.completed, checkout.session.async_payment_succeeded).
// Configure in Stripe Dashboard as a "Connected accounts" endpoint:
// https://your-deployment.convex.site/stripe-connect-webhook
http.route({
  path: "/stripe-connect-webhook",
  method: "POST",
  handler: handleStripeConnectWebhook,
});

export default http;
