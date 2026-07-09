# Production provider setup

ChemCheck has no provider secrets in source control. Do not place real values in `.env`, the mobile bundle, logs, screenshots, or tickets.

## Stripe customer payments

Set these in the Convex production deployment:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `APP_URL` — the production ChemCheck origin, for example `https://app.example.com`

In Stripe, add the Convex HTTP endpoint:

`https://<deployment>.convex.site/stripe-webhook`

Subscribe it to checkout completion and invoice/payment events already handled by `convex/stripeWebhook.ts`. Use Stripe test keys and test webhooks first; payment state is only final after the signed webhook or a verified checkout-session lookup marks the invoice paid.

## Customer delivery

ChemCheck uses Twilio for SMS and MailerSend for email. Set these in Convex production:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_NUMBER` — an approved E.164 sender
- `MAILERSEND_API_KEY`
- `FROM_EMAIL` — a verified sender domain/address

The invoice/deposit flow creates a communication record, then sends it through `convex/communications.ts`. A message marked `sent` means the provider accepted it; it is not a confirmed handset or inbox delivery receipt. Use the communications panel to retry failed sends after correcting provider configuration.

## Mapbox route optimization

Set only this browser-safe, origin-restricted public token in the web deployment:

- `VITE_MAPBOX_ACCESS_TOKEN`

Restrict the token to the ChemCheck production origin and only the Geocoding and Optimization APIs. The Route Planner requires an explicit per-run checkbox before customer addresses are sent to Mapbox. Do not enable it for technicians or businesses that have not approved that disclosure.

## Deployment proof

Before enabling a provider for real customers:

1. Run one Stripe test invoice through payment and signed webhook confirmation.
2. Send one test SMS and one test email to controlled recipients.
3. Run one two-stop Mapbox route with non-customer test addresses.
4. Record only provider message IDs and test results in release evidence; never record recipient values, access codes, payment URLs, or secrets.
