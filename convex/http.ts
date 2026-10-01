import { httpRouter } from "convex/server";
import { handleStripeWebhook } from "./stripeWebhook";
import { quickbooksCallback } from "./quickbooks";

const http = httpRouter();

// Stripe webhook endpoint
// Configure in Stripe Dashboard: https://your-deployment.convex.site/stripe-webhook
http.route({
  path: "/stripe-webhook",
  method: "POST",
  handler: handleStripeWebhook,
});

// QuickBooks Online OAuth2 callback.
// Set QBO_REDIRECT_URI to https://your-deployment.convex.site/quickbooks/callback
// (and register the same URL in the Intuit developer portal). The handler
// validates the signed state, exchanges the code, stores sealed tokens and
// redirects the browser back to the app's Settings > Integrations section.
http.route({
  path: "/quickbooks/callback",
  method: "GET",
  handler: quickbooksCallback,
});

export default http;
