# Business-Owned Stripe Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver authenticated, business-owned Stripe subscription billing while preserving invoice and deposit payments.

**Architecture:** Add an optional business foreign key to subscriptions and resolve subscriptions through the caller's current business. Convex actions create Stripe-hosted subscription Checkout and Customer Portal sessions with server-only configuration. Webhooks trust subscription metadata for new rows and use legacy email fallback only when needed.

**Tech Stack:** Convex, Stripe REST API, React, Vitest.

## Global Constraints

- `business_id` remains optional during migration.
- Backfill never creates businesses and reports unlinked legacy subscriptions.
- Only a business owner can start or manage subscription billing.
- Stripe secret and price IDs are read only from Convex environment variables.
- Invoice and quote-deposit payment actions and webhook processing remain unchanged.
- Do not commit changes.

---

### Task 1: Subscription ownership and migration

**Files:**
- Modify: `convex/schema.ts`, `convex/subscriptions.ts`

- [ ] Add optional `business_id` and an index to subscriptions.
- [ ] Resolve queries, feature access, limits, and cancellation through the authenticated user's current business.
- [ ] Add a bounded owner-only migration with dry-run support that links rows by `user_email` to the currently owned business and reports unlinked rows.

### Task 2: Server-owned Stripe billing actions

**Files:**
- Modify: `convex/subscriptions.ts`, `convex/stripeWebhook.ts`

- [ ] Add owner-only Checkout and Portal actions using `STRIPE_SECRET_KEY` and server price IDs.
- [ ] Send `business_id`, `user_email`, and `plan_id` in Checkout and subscription metadata.
- [ ] Upsert webhook subscription state against metadata business ownership and keep legacy email fallback.

### Task 3: Remove frontend billing configuration and demo state

**Files:**
- Modify: `src/lib/stripe.ts`, `src/hooks/useSubscription.ts`, `src/components/billing/PricingPage.jsx`, `src/components/billing/BillingDashboard.jsx`

- [ ] Replace external HTTP endpoint calls and local demo subscriptions with Convex actions.
- [ ] Remove frontend Stripe pricing/configuration requirements and setup warnings.
- [ ] Keep Stripe-hosted URL navigation and native iOS action restrictions.

### Task 4: Tests, documentation, and verification

**Files:**
- Modify: `src/lib/stripe.test.ts`, `src/components/billing/PricingPage.test.jsx`, `STRIPE_SETUP.md`

- [ ] Update tests to prove price selection is server configuration and web billing remains actionable without demo/backend URL configuration.
- [ ] Document required Convex secrets and migration operation.
- [ ] Run targeted Vitest, lint, and Convex type generation.
