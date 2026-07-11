# Business-Owned Stripe Billing Design

## Scope

Subscriptions are owned by a business, not an individual user. Existing rows retain `user_email` while a staged optional `business_id` migration attaches rows to the business currently owned by that email. Rows without such a business remain unlinked and are counted by the migration; the migration never creates a business.

## Backend

Convex actions authenticate the caller, resolve the caller's owned business, and require that ownership for subscription Checkout and Customer Portal sessions. Price IDs and the Stripe secret key stay in Convex environment variables. Checkout sends the business ID and plan ID in both Checkout and subscription metadata. Webhooks use that metadata, update the business-owned subscription, and retain customer-email fallback only for legacy rows.

## Frontend

The subscription hook invokes Convex actions directly and navigates to the returned Stripe-hosted URL. It does not read frontend Checkout, Portal, Cancel, Price ID, or Stripe publishable-key configuration, and it no longer writes simulated subscriptions to local storage. The native iOS billing restrictions remain unchanged.

## Safety and Verification

The backfill is owner-only, bounded, resumable, idempotent, and reports linked, already-linked, and unlinked rows. Invoice and deposit Checkout actions and their existing webhook branches are left intact. Tests cover pure pricing configuration and web billing UI behavior; targeted lint, tests, and TypeScript/Convex generation validation are run after changes.
