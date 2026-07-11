# Paid Launch P0 Remediation Design

## Goal

Make ChemCheck safe to sell to pool-service businesses by closing the P0 gaps in SaaS billing, shared-device data isolation, account erasure, financial-record durability, public report access, and invoice payment integrity.

## Scope

- Business-owned SaaS subscriptions through Stripe.
- Secure cleanup of browser-resident customer data on logout and account changes.
- Complete, resumable tenant deletion.
- Cloud-required work-order, quote, invoice, and communication workflows.
- Expiring, rotatable public service-report links.
- Stripe-owned payment status for Stripe-linked invoices.

This work does not implement plan entitlements, general rate-limit hardening, export completeness, or background invoice reminders. Those are follow-up release work.

## Billing

- A subscription belongs to a business. The business owner starts checkout; active team members inherit its subscription.
- Convex actions create Stripe Checkout and Customer Portal sessions with server-side `STRIPE_SECRET_KEY`. The frontend no longer uses externally configured checkout, portal, or cancellation URLs.
- Checkout metadata contains the authenticated business ID and owner email. Stripe webhook handlers use this metadata to upsert the business subscription record.
- The production app fails closed if Stripe configuration is unavailable. It must show an unavailable/retry state and must not create a simulated trial or claim a successful billing action.
- Stripe webhook verification and event idempotency remain mandatory.

## Local Data Isolation

- Before Clerk sign-out completes, the app removes ChemCheck IndexedDB data, offline-photo data, Cache Storage entries, and ChemCheck browser storage keys.
- The same cleanup runs when the authenticated user changes, before data from the new account is made available.
- Logout cleanup is retryable. If it fails, the app does not complete sign-out or permit a user switch until the user retries successfully.
- This removes offline customer data, gate codes, photos, service history, and drafts from the device at logout. A subsequent sign-in synchronizes fresh cloud data.

## Account Deletion

- Deletion is tenant scoped and resumable. It deletes all customer data and all business-owned entities: customers, pools, equipment, service logs, service photos, chemical usage, notes, salt-cell logs, service reports, report access logs, work orders, invoices, quotes, communications, subscriptions, team members, and the business record.
- Referenced Convex storage objects are deleted before their database records.
- Completion is reported only after the final deletion pass confirms that no tenant records or referenced files remain. A partial run persists progress and returns a recoverable failure.

## Financial Workflow Durability

- Work orders, quotes, invoices, and communications require a resolved authenticated business. The UI renders a loading state while resolution is pending and a blocking retry state if it fails.
- The app no longer creates, updates, or presents local browser-only financial records as operational data.
- Existing local financial keys are left intact but inactive; this change does not silently delete or sync historical local-only records.

## Public Reports

- Every service report has a required expiration timestamp set to 30 days from creation.
- Public access rejects reports without an expiration timestamp or whose timestamp has passed.
- When an old or legacy report is sent again, its token is replaced with a newly generated token and a fresh 30-day expiration. Earlier links are invalidated.

## Invoice Payments

- General invoice status updates cannot set `paid` and cannot modify a Stripe-linked payment URL or payment state.
- A manual paid transition is allowed only for invoices without a Stripe Checkout session and remains authenticated and tenant-scoped.
- Stripe webhook/internal actions are the sole way a Stripe-linked invoice becomes paid.

## Testing And Release Evidence

- Unit tests cover checkout and portal authorization, metadata, unavailable Stripe configuration, webhook subscription updates, and no simulated-billing fallback.
- Browser tests verify logout and account changes purge IndexedDB, offline-photo storage, Cache Storage, and app storage keys.
- Account-deletion tests verify each tenant table and storage object is removed and that partial deletion never reports completion.
- Report tests cover mandatory expiry, legacy-token rejection, and resend token rotation.
- Invoice tests prove Stripe-linked invoices cannot be marked paid through general or manual authenticated mutations.
- Work-order tests prove no financial mutation executes before business resolution and that cloud failures do not fall back to browser storage.
- Release validation requires a live Stripe test checkout, portal session, webhook delivery, two-user shared-device logout check, and a staging deletion run before production rollout.
