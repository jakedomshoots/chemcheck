# Live billing and customer-message providers

ChemCheck keeps provider credentials server-side in Convex. Do not put any of these values in `VITE_*` variables, the mobile bundle, local storage, or the database.

## Production Convex environment

```bash
npx convex env set STRIPE_SECRET_KEY sk_live_...
npx convex env set STRIPE_WEBHOOK_SECRET whsec_...
npx convex env set APP_URL https://app.example.com
npx convex env set MAILERSEND_API_KEY mlsn_...
npx convex env set FROM_EMAIL reports@example.com
npx convex env set TWILIO_ACCOUNT_SID AC...
npx convex env set TWILIO_AUTH_TOKEN ...
npx convex env set TWILIO_FROM_NUMBER +15551234567
```

`APP_URL` must be HTTPS outside local development. `FROM_EMAIL` must be a sender on a verified Mailersend domain. `TWILIO_FROM_NUMBER` must be E.164. Stripe keys and webhook secrets must use their normal `sk_live_`/`sk_test_` and `whsec_` prefixes.

The Settings → Integrations screen shows redacted readiness status and lets an authenticated user run a server-side credential check. It never returns secret values. Stripe’s `/stripe-webhook` HTTP route must also be registered in the Stripe Dashboard and use the same `STRIPE_WEBHOOK_SECRET`.

Use test keys only in a non-production Convex deployment. Rotate compromised provider credentials in the provider dashboard, then update the Convex environment; no application data migration is required.

## Route provider privacy

Route optimization defaults to the offline deterministic fallback so customer
addresses are not sent to a public geocoder. For live routing, configure a
same-origin proxy and opt in explicitly:

```bash
VITE_ROUTE_PROVIDER=proxy
VITE_ROUTE_PROXY_URL=/api/route
```

An OSRM or Mapbox client can be selected explicitly with
`VITE_ROUTE_PROVIDER=osrm` or `VITE_ROUTE_PROVIDER=mapbox`; use a restricted
public token or a server proxy and document the address-processing disclosure
in the privacy policy.
