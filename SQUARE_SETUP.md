# Square setup (payments and subscriptions)

ChemCheck uses **Square** for both money flows. Stripe is no longer used.

| Flow | Whose Square account | How |
| --- | --- | --- |
| Platform subscriptions (Starter $29, Professional $79, Business $149 per month; 20% off annual) | The ChemCheck owner's (platform) account | Square subscription checkout (payment link with a subscription plan variation) |
| Customer payments (invoices and quote deposits) | Each pool company's **own** Square seller account | Square OAuth, then payment links created with the seller's token. Money goes straight to the pool company. Optional platform fee via `PLATFORM_FEE_BPS`. |

All credentials live in Convex environment variables (`npx convex env set ...`).
Never put them in `VITE_*` variables, Vercel, the mobile bundle or source control.

## 1. Create the Square Developer application

1. Sign in at <https://developer.squareup.com/apps> with the ChemCheck owner's
   Square account and create an application (for example, "ChemCheck").
2. Use the **Sandbox** tab while testing and the **Production** tab for live.
   Every value below exists separately for sandbox and production.
3. **Credentials** page:
   - Application ID → `SQUARE_APPLICATION_ID`
   - Access token (the platform account's own token) → `SQUARE_ACCESS_TOKEN`
4. **OAuth** page:
   - Application secret → `SQUARE_APPLICATION_SECRET`
   - Redirect URL: `https://<deployment>.convex.site/square/oauth/callback`
     (`<deployment>` is your Convex deployment name; the `.convex.site`
     domain serves HTTP actions). If you set the redirect URL here, also set
     the same value in `SQUARE_OAUTH_REDIRECT_URL`.
5. **Locations**: in the Square Dashboard, find the platform location that
   will take subscription payments → `SQUARE_LOCATION_ID`.
6. Your platform merchant id (shown in the Developer Console under the
   account, or returned by `GET /v2/merchants/me`) → `SQUARE_PLATFORM_MERCHANT_ID`.

## 2. Webhook subscription

In the Developer Console → **Webhooks** → **Subscriptions** → Add subscription:

- URL: `https://<deployment>.convex.site/square/webhook`
- API version: `2025-10-16` (the version ChemCheck pins in `Square-Version`)
- Events:
  - `payment.created`, `payment.updated` (customer payments on connected sellers, and platform checkout payments)
  - `subscription.created`, `subscription.updated`
  - `invoice.payment_made`, `invoice.scheduled_charge_failed`
  - `oauth.authorization.revoked`

Copy the subscription's **Signature key** → `SQUARE_WEBHOOK_SIGNATURE_KEY`, and set
`SQUARE_WEBHOOK_URL` to the **exact** URL above (same scheme, host, path, no
trailing slash). Square signs `URL + raw body`, so any difference breaks
verification and every event returns 401.

Because the app is OAuth-authorized by pool companies, Square delivers their
payment events to this same subscription.

## 3. Subscription plans

Create **one** subscription plan (for example "ChemCheck") in the Square
Dashboard (Items → Subscription plans) or with the Catalog API, with **six
variations**. Keeping all variations under one plan lets owners switch between
them with Square's swap-plan action.

| Variation | Cadence | Price | Env var (variation id) |
| --- | --- | --- | --- |
| Starter monthly | Monthly | $29 | `SQUARE_PLAN_VARIATION_STARTER_MONTHLY` |
| Starter annual | Annual | $278 | `SQUARE_PLAN_VARIATION_STARTER_ANNUAL` |
| Professional monthly | Monthly | $79 | `SQUARE_PLAN_VARIATION_PROFESSIONAL_MONTHLY` |
| Professional annual | Annual | $758 | `SQUARE_PLAN_VARIATION_PROFESSIONAL_ANNUAL` |
| Business monthly | Monthly | $149 | `SQUARE_PLAN_VARIATION_BUSINESS_MONTHLY` |
| Business annual | Annual | $1,430 | `SQUARE_PLAN_VARIATION_BUSINESS_ANNUAL` |

Notes:
- Use the **variation** ids (not the plan id). Square subscribes customers to variations.
- The Checkout API supports variations with one paid phase, or one free phase
  plus one paid phase. To honour the "14-day free trial" copy on the pricing
  page, give each variation a 14-day free phase followed by the paid phase.
- Prices above must match the app (`convex/squareSubscriptionState.ts`,
  `src/lib/billingPlans.ts`). The checkout charges the same amount.
- The plan a business gets is derived **only** from these env ids, never from
  client input.

## 4. Environment variables

```bash
npx convex env set SQUARE_ENVIRONMENT production          # or sandbox (default)
npx convex env set SQUARE_APPLICATION_ID sq0idp-...
npx convex env set SQUARE_APPLICATION_SECRET sq0csp-...
npx convex env set SQUARE_ACCESS_TOKEN EAAA...             # platform account token
npx convex env set SQUARE_LOCATION_ID L...                 # platform location for subscriptions
npx convex env set SQUARE_PLATFORM_MERCHANT_ID ML...
npx convex env set SQUARE_WEBHOOK_SIGNATURE_KEY ...
npx convex env set SQUARE_WEBHOOK_URL https://<deployment>.convex.site/square/webhook
npx convex env set SQUARE_TOKEN_ENCRYPTION_KEY "$(openssl rand -base64 32)"
npx convex env set SQUARE_PLAN_VARIATION_STARTER_MONTHLY ...
npx convex env set SQUARE_PLAN_VARIATION_STARTER_ANNUAL ...
npx convex env set SQUARE_PLAN_VARIATION_PROFESSIONAL_MONTHLY ...
npx convex env set SQUARE_PLAN_VARIATION_PROFESSIONAL_ANNUAL ...
npx convex env set SQUARE_PLAN_VARIATION_BUSINESS_MONTHLY ...
npx convex env set SQUARE_PLAN_VARIATION_BUSINESS_ANNUAL ...
npx convex env set APP_URL https://app.chemcheck.app
# Optional
npx convex env set SQUARE_OAUTH_REDIRECT_URL https://<deployment>.convex.site/square/oauth/callback
npx convex env set PLATFORM_FEE_BPS 0                      # basis points, 100 = 1%
```

- `SQUARE_TOKEN_ENCRYPTION_KEY` encrypts sellers' OAuth tokens at rest
  (AES-256-GCM). Keep it secret and stable: changing it makes stored seller
  tokens unreadable and every pool company must reconnect.
- Sandbox is refused in the production deployment
  (`CONVEX_DEPLOYMENT_ENV=production`) unless `SQUARE_ALLOW_SANDBOX=true`.
- `PLATFORM_FEE_BPS` > 0 adds `app_fee_money` to customer payment links and
  requests the extra `PAYMENTS_WRITE_ADDITIONAL_RECIPIENTS` OAuth scope. Sellers
  that connected while the fee was 0 must reconnect before a fee can be taken.

Settings → Integrations → **Square payments** shows which variables are
missing and has a **Test** button (lists the platform account's locations and
checks `SQUARE_LOCATION_ID`).

## 5. Pool companies connect Square

An owner or admin opens **Settings → Integrations → Customer card payments →
Connect Square**, signs in to Square and approves. ChemCheck stores the
merchant id, the encrypted tokens and the first active US location with card
processing. Until a business connects, sending an invoice or deposit link
returns "Connect your Square account in Settings to accept card payments".

- Access tokens last about 30 days. A daily cron refreshes tokens that expire
  within 7 days, and tokens are refreshed on demand before use.
- **Disconnect** revokes ChemCheck's access in Square and deletes the tokens.
  If a seller revokes access from Square, the `oauth.authorization.revoked`
  webhook does the same.

## 6. Sandbox testing

1. Set `SQUARE_ENVIRONMENT=sandbox` and sandbox credentials in a non-production
   Convex deployment. Create a sandbox **test account** in the Developer
   Console to act as a pool company's seller account.
2. Connect Square from Settings with the sandbox test account (open the
   seller test account's dashboard in the same browser first).
3. Send an invoice, open the link and pay with Square's sandbox test card
   `4111 1111 1111 1111` (any future expiry, any CVV, any ZIP).
4. The invoice turns **paid** after the `payment.updated` webhook, or when you
   return to Work Orders (the app checks the order status).
5. Subscribe from **Pricing** with the platform sandbox account; the
   subscription appears on the billing page after `subscription.created`.
6. Use the Developer Console's webhook **Send test event** to confirm the
   signature is accepted (a 401 means `SQUARE_WEBHOOK_URL` does not match).

## Migrating existing Stripe subscribers

Existing Stripe subscriptions are **not** moved automatically.

1. Keep existing rows: legacy `stripe_*` fields stay in the database (now
   optional) and old subscription rows keep granting their plan while their
   status is active/trialing/past_due. Stripe no longer sends updates (the
   `/stripe-webhook` routes return 410), so those rows will not change on their own.
2. Cancel each subscription in the Stripe Dashboard and ask the customer to
   resubscribe from **Pricing** (Square). The new Square subscription replaces
   the legacy row for that business.
3. To grandfather a business by hand instead, set its plan from the CLI:

   ```bash
   npx convex run subscriptions:adminSetPlan \
     '{"business_id":"<id>","plan_id":"professional","status":"active","current_period_end":1767225600000}'
   ```

   Set `"status":"canceled"` to end a legacy Stripe row that should no
   longer grant a plan.
4. Pool companies that used Stripe Connect must **Connect Square** in
   Settings. Invoices sent with old Stripe links are not settled by Square; send
   a new Square link, or mark them paid manually once you confirm the old
   Stripe payment (legacy Stripe-linked invoices can be marked paid manually).
