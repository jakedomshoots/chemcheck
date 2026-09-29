import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { handleSquareWebhook } from "./squareWebhook";
import { handleSquareOAuthCallback } from "./squareConnect";

const http = httpRouter();

// Square webhook (platform subscription events + connected sellers' payments).
// Configure in the Square Developer Dashboard > Webhooks with the EXACT URL in
// SQUARE_WEBHOOK_URL: https://<deployment>.convex.site/square/webhook
http.route({
  path: "/square/webhook",
  method: "POST",
  handler: handleSquareWebhook,
});

// Square OAuth redirect URL for pool companies connecting their seller account.
// Configure in the Square Developer Dashboard > OAuth:
// https://<deployment>.convex.site/square/oauth/callback
http.route({
  path: "/square/oauth/callback",
  method: "GET",
  handler: handleSquareOAuthCallback,
});

// Legacy Stripe endpoints (pre-Square). Stripe is no longer used; answer 410 so
// any remaining Stripe webhook endpoint is disabled instead of retried forever.
const gone = httpAction(async () => new Response("Stripe integration removed", { status: 410 }));
for (const path of ["/stripe-webhook", "/stripe-connect-webhook"]) {
  http.route({ path, method: "POST", handler: gone });
}

export default http;
