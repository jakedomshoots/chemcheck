# Live billing and customer-message providers

ChemCheck keeps provider credentials server-side in Convex. Do not put any of these values in `VITE_*` variables, the mobile bundle, local storage, or the database.

## Production Convex environment

```bash
npx convex env set SQUARE_ENVIRONMENT production
npx convex env set SQUARE_APPLICATION_ID sq0idp-...
npx convex env set SQUARE_APPLICATION_SECRET sq0csp-...
npx convex env set SQUARE_ACCESS_TOKEN EAAA...
npx convex env set SQUARE_LOCATION_ID L...
npx convex env set SQUARE_PLATFORM_MERCHANT_ID ML...
npx convex env set SQUARE_WEBHOOK_SIGNATURE_KEY ...
npx convex env set SQUARE_WEBHOOK_URL https://<deployment>.convex.site/square/webhook
npx convex env set SQUARE_TOKEN_ENCRYPTION_KEY "$(openssl rand -base64 32)"
npx convex env set SQUARE_PLAN_VARIATION_STARTER_MONTHLY ...   # plus the other five variation ids
npx convex env set APP_URL https://app.example.com
npx convex env set MAILERSEND_API_KEY mlsn_...
npx convex env set FROM_EMAIL reports@example.com
npx convex env set TWILIO_ACCOUNT_SID AC...
npx convex env set TWILIO_AUTH_TOKEN ...
npx convex env set TWILIO_FROM_NUMBER +15551234567
```

`APP_URL` must be HTTPS outside local development. `FROM_EMAIL` must be a sender on a verified Mailersend domain. `TWILIO_FROM_NUMBER` must be E.164. `SQUARE_WEBHOOK_URL` must be exactly the URL registered on the Square webhook subscription, and `SQUARE_TOKEN_ENCRYPTION_KEY` must be 32 random bytes (base64). See `SQUARE_SETUP.md` for every Square variable.

The Settings → Integrations screen shows redacted readiness status and lets an authenticated user run a server-side credential check. It never returns secret values. The `/square/webhook` route must be registered as a Square webhook subscription (its signature key in `SQUARE_WEBHOOK_SIGNATURE_KEY`), and `/square/oauth/callback` as the application's OAuth redirect URL.

Use Square sandbox credentials only in a non-production Convex deployment (sandbox is refused when `CONVEX_DEPLOYMENT_ENV=production` unless `SQUARE_ALLOW_SANDBOX=true`). Rotate compromised provider credentials in the provider dashboard, then update the Convex environment; no application data migration is required.

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
