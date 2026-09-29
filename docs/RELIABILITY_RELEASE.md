# Reliability release: deploy checklist

This release closes the audit findings (dosing direction, report sending,
SMS abuse, tenant isolation, delete sync, payment routing, cron crashes, and
more). Most changes deploy with no action. The steps below are required.

## Before deploying

1. **Protect your own business from plan limits.** Customer and seat limits
   are now enforced on the server. Accounts without an active, trialing or
   past-due subscription get the free tier (10 customers, 1 user). Exempt
   your own business before deploying:

   ```bash
   npx convex env set PLAN_LIMIT_EXEMPT_EMAILS "owner@yourbusiness.com"
   ```

2. **Square** (replaces Stripe for subscriptions and customer payments).
   Card payments for invoices and deposits go to each pool company's own
   Square account through Square OAuth. Until a business connects, sending a
   payment link returns "Connect your Square account in Settings to accept
   card payments". Platform subscriptions are Square subscriptions on the
   ChemCheck owner's account.
   - Create the Square application, OAuth redirect URL
     (`https://<deployment>.convex.site/square/oauth/callback`) and webhook
     subscription (`https://<deployment>.convex.site/square/webhook`).
   - Create one subscription plan with six variations and set their ids.
   - Set the `SQUARE_*` variables, `SQUARE_TOKEN_ENCRYPTION_KEY` and `APP_URL`.
   - Optional: `npx convex env set PLATFORM_FEE_BPS 0` (basis points).
   - Each business connects from Settings → Integrations.
   - Existing Stripe subscribers are not migrated automatically; see
     "Migrating existing Stripe subscribers" in `SQUARE_SETUP.md`.
   See `SQUARE_SETUP.md` for every step.

3. **Report links** use the configured app origin (`APP_URL`); client-supplied
   base URLs are ignored. Confirm `APP_URL` is set in Convex.

## After deploying

Backfill `created_by` on older child rows so they sync to every device:

```bash
npx convex run sync:backfillChildCreatedBy '{"table":"saltCellLogs"}'
npx convex run sync:backfillChildCreatedBy '{"table":"chemicalUsage"}'
```

The customer business backfill is now internal and scoped to one business:

```bash
npx convex run backfillCustomerBusinessId:run '{"business_id":"<id>","dry_run":true}'
```

## Behavior changes to know

- **Team invites** are pending until the invitee accepts in Settings.
  Existing members are unaffected.
- **Roles:** customer edits and deletes need owner/admin. Field staff can
  still add customers and log service.
- **Deletes sync.** Deleting a customer removes its pools, equipment, logs,
  chemicals, notes and salt-cell logs on every device. Devices offline for
  more than 90 days may miss deletions.
- **Chemistry:** each reading defaults to "Not tested" instead of "good".
  Dosing advice is direction-aware and scales with how far the reading is
  from target. Ideal pH is now 7.2–7.8.
- **Route optimizer** no longer invents drive times. Without
  `VITE_ROUTE_PROVIDER` / `VITE_ROUTE_PROXY_URL` it keeps your stop order and
  lets you reorder by hand. See `docs/ROUTE_PROVIDER_CONFIGURATION.md`.
- **Report visibility** settings are enforced by the server, so hidden
  fields are never sent to the browser.
- **CI** now runs the full test suite and the Convex typecheck, and Convex
  deploys fail on type errors.
