# Paid Launch P0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make billing, local-device data, tenant deletion, public reports, and financial payment state safe for a paid ChemCheck launch.

**Architecture:** Convex becomes the server-side authority for business subscriptions and Stripe session creation. Browser persistence is purged before logout and is no longer a writable fallback for financial records. Backend mutations enforce report expiry, complete tenant erasure, and Stripe-only payment transitions.

**Tech Stack:** React 18, Vite, Clerk, Convex, Stripe REST API, Dexie, Vitest, Playwright.

## Global Constraints

- A subscription belongs to a `businesses` record; active team members read the same subscription.
- Use only server-side `STRIPE_SECRET_KEY` for Stripe Checkout and Customer Portal requests.
- Never create a simulated subscription or browser-stored billing state when billing configuration is missing.
- Delete ChemCheck IndexedDB, offline photos, Cache Storage, and `chemcheck_` browser-storage keys before Clerk sign-out completes.
- Service report expiry is exactly 30 days and public access is invalid when `Date.now() >= expires_at` or expiry is missing.
- Stripe-linked invoices can become paid only through internal Stripe-confirmation mutations.
- Financial writes require `businesses.getCurrent` to resolve to a business; local financial records are read-only legacy data.
- Do not commit unless the user explicitly requests a commit.

---

## File Structure

- `convex/schema.ts`: add business ownership/indexes required to retrieve a business subscription.
- `convex/businesses.ts`: internal lookup of the authenticated caller's current business for billing actions.
- `convex/subscriptions.ts`: business-scoped subscription query and webhook upsert.
- `convex/payments.ts`: authenticated subscription Checkout and Customer Portal actions.
- `convex/stripeWebhook.ts`: resolve webhook subscription ownership from business metadata.
- `src/lib/stripe.ts`: plans and display helpers only; remove external billing endpoint configuration.
- `src/hooks/useSubscription.ts`: invoke Convex billing actions and never use local demo state.
- `src/components/billing/PricingPage.jsx`, `src/components/billing/BillingDashboard.jsx`: use the server-owned hook and show fail-closed billing errors.
- `src/lib/sessionCleanup.ts`: single retryable client cleanup boundary for logout/account switches.
- `src/db/chemcheck-db.ts`, `src/lib/proof-of-service/offlinePhotoStorage.ts`, `src/lib/serviceWorker.ts`: expose focused storage-clearing primitives used by session cleanup.
- `src/components/auth/ClerkAuthProvider.jsx`: run cleanup before Clerk sign-out and on authenticated-user changes.
- `convex/account.ts`: delete every tenant record/storage object and verify completion.
- `convex/serviceReports.ts`, `convex/schema.ts`, `convex/migrations.ts`: mandatory expiry, legacy rejection, and token rotation.
- `convex/invoices.ts`: separate non-payment updates from payment transitions.
- `src/pages/WorkOrders.jsx`: make local financial data read-only and block all financial writes without a resolved business.

### Task 1: Business-Owned Stripe Billing

**Files:**
- Modify: `convex/schema.ts:153-168`
- Modify: `convex/subscriptions.ts`
- Modify: `convex/businesses.ts`
- Modify: `convex/payments.ts`
- Modify: `convex/stripeWebhook.ts:391-424`
- Modify: `src/lib/stripe.ts`
- Modify: `src/hooks/useSubscription.ts`
- Modify: `src/components/billing/PricingPage.jsx`
- Modify: `src/components/billing/BillingDashboard.jsx`
- Test: `src/lib/stripeWebhook.test.ts`
- Create: `src/hooks/useSubscription.test.tsx`
- Test: `src/components/billing/PricingPage.test.jsx`

**Interfaces:**
- Produces `api.payments.createSubscriptionCheckout({ plan_id: "starter" | "professional" | "business", interval: "month" | "year" }): Promise<{ url: string }>`.
- Produces `api.payments.createBillingPortalSession({}): Promise<{ url: string }>`.
- Produces `api.subscriptions.get(): Subscription | null`, resolved by the caller's current business.
- Requires subscriptions to store `business_id: v.id("businesses")` and index `by_business`.

- [ ] **Step 1: Write failing billing action and hook tests**

```ts
it("creates Checkout with the caller business and selected Stripe price", async () => {
  await expect(createSubscriptionCheckout({ plan_id: "professional", interval: "month" }))
    .resolves.toEqual({ url: "https://checkout.stripe.com/c/pay/cs_test" });
  expect(fetchProvider).toHaveBeenCalledWith(
    "https://api.stripe.com/v1/checkout/sessions",
    expect.objectContaining({ body: expect.stringContaining("metadata%5Bbusiness_id%5D=business_1") })
  );
});

it("does not create a local demo subscription when checkout is unavailable", async () => {
  renderHook(() => useSubscription());
  await expect(result.current.createCheckoutSession("starter")).rejects.toThrow("Billing is unavailable");
  expect(localStorage.getItem("chemcheck_subscription")).toBeNull();
});
```

- [ ] **Step 2: Run targeted tests and verify failure**

Run: `npm test -- src/lib/stripeWebhook.test.ts src/hooks/useSubscription.test.tsx src/components/billing/PricingPage.test.jsx`

Expected: FAIL because subscription checkout/portal actions and the fail-closed hook behavior do not exist.

- [ ] **Step 3: Add business ownership and server Stripe actions**

```ts
// convex/schema.ts subscriptions table
business_id: v.id("businesses"),
// add .index("by_business", ["business_id"])

// convex/payments.ts
export const createSubscriptionCheckout = action({
  args: { plan_id: v.union(v.literal("starter"), v.literal("professional"), v.literal("business")), interval: v.union(v.literal("month"), v.literal("year")) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) throw new Error("Not authenticated");
    const business = await ctx.runQuery(internal.businesses.getCurrentForEmail, { email: identity.email });
    if (!business || business.owner_email !== identity.email) throw new Error("Only the business owner can manage billing");
    const { secretKey } = requireStripeConfig();
    const priceId = subscriptionPriceId(args.plan_id, args.interval);
    const session = await createStripeSubscriptionCheckoutSession({ secretKey, priceId, business, ownerEmail: identity.email });
    return { url: session.url };
  },
});
```

Implement `createStripeSubscriptionCheckoutSession` with `mode=subscription`, a configured recurring price ID, `success_url`, `cancel_url`, and `metadata[business_id]`, `metadata[owner_email]`, and `metadata[plan_id]`. Implement `createBillingPortalSession` using the stored Stripe customer ID for the caller's business and return the Stripe portal URL. Reject a missing business, non-owner caller, missing Stripe configuration, unknown plan, and missing Stripe customer.

- [ ] **Step 4: Change webhook and read paths to be business scoped**

```ts
// convex/subscriptions.ts
export const get = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) return null;
    const business = await getCurrentBusinessForEmail(ctx, identity.email);
    return business
      ? await ctx.db.query("subscriptions").withIndex("by_business", q => q.eq("business_id", business._id)).first()
      : null;
  },
});
```

Pass `business_id` into `internal.subscriptions.upsert`. In each subscription webhook event, read `subscription.metadata.business_id` and `subscription.metadata.owner_email`, reject the event when either is missing, and use these values instead of untrusted empty-string fallbacks. Update payment-failure notifications to resolve the business from the stored subscription.

- [ ] **Step 5: Replace client external-endpoint and demo flows**

Remove `VITE_STRIPE_CHECKOUT_URL`, `VITE_STRIPE_PORTAL_URL`, `VITE_STRIPE_CANCEL_URL`, `getBillingApiConfig`, `isBillingBackendConfigured`, `getStripe`, and `chemcheck_subscription` fallback logic. In `useSubscription`, call Convex `useAction(api.payments.createSubscriptionCheckout)` and `useAction(api.payments.createBillingPortalSession)`, then use `window.location.assign(result.url)`. Make cancellation open the portal rather than locally changing state. Pricing and billing dashboard must render the returned error and keep billing buttons disabled only while their action is running or on iOS.

- [ ] **Step 6: Run targeted tests and verify success**

Run: `npm test -- src/lib/stripeWebhook.test.ts src/hooks/useSubscription.test.tsx src/components/billing/PricingPage.test.jsx src/components/billing/BillingDashboard.test.jsx`

Expected: PASS with Checkout metadata, portal authorization, business-scoped webhook upsert, and no demo fallback covered.

### Task 2: Secure Session Cleanup

**Files:**
- Create: `src/lib/sessionCleanup.ts`
- Modify: `src/db/chemcheck-db.ts:552`
- Modify: `src/lib/proof-of-service/offlinePhotoStorage.ts:431-435`
- Modify: `src/lib/serviceWorker.ts:276-289`
- Modify: `src/components/auth/ClerkAuthProvider.jsx:140-182`
- Test: `src/lib/sessionCleanup.test.ts`
- Test: `src/components/auth/ClerkAuthProvider.test.jsx`

**Interfaces:**
- Produces `clearChemCheckSessionData(): Promise<void>`.
- Produces `db.delete(): Promise<void>` and `clearAllPhotos(): Promise<void>` as the Dexie cleanup operations.

- [ ] **Step 1: Write failing cleanup tests**

```ts
it("removes both ChemCheck IndexedDB databases, caches, and ChemCheck storage keys", async () => {
  localStorage.setItem("chemcheck_current_user", "value");
  localStorage.setItem("unrelated_key", "value");
  await clearChemCheckSessionData();
  expect(deleteChemCheckDb).toHaveBeenCalledOnce();
  expect(clearAllPhotos).toHaveBeenCalledOnce();
  expect(serviceWorkerManager.clearCaches).toHaveBeenCalledOnce();
  expect(localStorage.getItem("chemcheck_current_user")).toBeNull();
  expect(localStorage.getItem("unrelated_key")).toBe("value");
});

it("does not call Clerk signOut when secure cleanup fails", async () => {
  clearChemCheckSessionData.mockRejectedValueOnce(new Error("indexeddb unavailable"));
  await auth.logout();
  expect(signOut).not.toHaveBeenCalled();
  expect(screen.getByText(/could not clear local data/i)).toBeVisible();
});
```

- [ ] **Step 2: Run targeted tests and verify failure**

Run: `npm test -- src/lib/sessionCleanup.test.ts src/components/auth/ClerkAuthProvider.test.jsx`

Expected: FAIL because no shared cleanup function exists and logout signs out despite storage failures.

- [ ] **Step 3: Implement one cleanup boundary and enforce it in auth**

```ts
// src/lib/sessionCleanup.ts
export async function clearChemCheckSessionData(): Promise<void> {
  await Promise.all([
    db.delete(),
    clearAllPhotos(),
    serviceWorkerManager.clearCaches(),
  ]);
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith("chemcheck_")) localStorage.removeItem(key);
  }
  for (const key of Object.keys(sessionStorage)) {
    if (key.startsWith("chemcheck_")) sessionStorage.removeItem(key);
  }
}
```

In `logout`, call `await clearChemCheckSessionData()` before `userManager.logoutUser()` and `signOut()`. Re-throw cleanup failures after setting an auth error. Track the prior signed-in `userId` in the provider effect and run the same cleanup before accepting a different authenticated user. Do not call `signOut()` on cleanup failure.

- [ ] **Step 4: Run targeted tests and verify success**

Run: `npm test -- src/lib/sessionCleanup.test.ts src/components/auth/ClerkAuthProvider.test.jsx src/lib/serviceWorker.test.ts`

Expected: PASS, including retry-safe cleanup and preserved non-ChemCheck browser storage.

### Task 3: Complete Tenant Deletion

**Files:**
- Modify: `convex/account.ts:28-690`
- Test: `convex/account.test.ts`
- Test: `e2e/accountDeletion.spec.ts`

**Interfaces:**
- `deleteMyAccount()` returns `success: true` only after every tenant-owned table and storage object has been removed.
- Deletion cursor stages include customer children, business-level operational records, subscriptions, membership, and business rows.

- [ ] **Step 1: Write failing deletion graph tests**

```ts
it("deletes every business record and storage object before reporting success", async () => {
  await deleteMyAccountAs(owner);
  expect(remainingTenantDocuments()).toEqual([]);
  expect(storage.delete).toHaveBeenCalledWith(photoStorageId);
});

it("returns a failure instead of success when storage deletion fails", async () => {
  storage.delete.mockRejectedValueOnce(new Error("storage unavailable"));
  await expect(deleteMyAccountAs(owner)).rejects.toThrow("Account deletion incomplete");
});
```

- [ ] **Step 2: Run targeted tests and verify failure**

Run: `npm test -- convex/account.test.ts`

Expected: FAIL because pools, equipment, work orders, invoices, quotes, communications, and storage failures are not handled as required.

- [ ] **Step 3: Extend the resumable graph and verification**

Add customer stages for `pools` and `equipment` and delete them before the customer. Add business-level cursor stages for `workOrders`, `invoices`, `quotes`, `communications`, subscriptions by `business_id`, team members, and businesses. For service photos, call `ctx.storage.delete(photo.storage_id)` before `ctx.db.delete(photo._id)` and let failures stop the current batch. After all phases, call an internal verification query that checks every tenant-owned index and returns nonzero counts; throw `new Error("Account deletion incomplete")` if any remain.

- [ ] **Step 4: Run unit and authenticated E2E tests**

Run: `npm test -- convex/account.test.ts && npm run test:e2e -- e2e/accountDeletion.spec.ts`

Expected: PASS. The E2E must run with real authenticated staging credentials; do not accept a skipped deletion test as release evidence.

### Task 4: Expiring and Rotatable Public Reports

**Files:**
- Modify: `convex/serviceReports.ts:121-179,475-522,1490-1617`
- Modify: `convex/schema.ts:271-286`
- Modify: `convex/migrations.ts`
- Test: `convex/serviceReports.expiration.test.ts`
- Test: `src/lib/smsReport.test.ts`

**Interfaces:**
- Produces `REPORT_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000`.
- `getOrCreateReportInternal` returns `{ report, rotated: boolean }`.

- [ ] **Step 1: Write failing expiry and rotation tests**

```ts
it("rejects a public token at its exact expiration and when expiry is absent", async () => {
  expect(await getReportByToken(expiredAtNow)).toMatchObject({ found: false });
  expect(await getReportByToken(legacyWithoutExpiry)).toMatchObject({ found: false });
});

it("rotates an expired report before resend and invalidates its prior token", async () => {
  const result = await sendReport(expiredReport);
  expect(result.report_token).not.toBe(expiredReport.report_token);
  expect(result.expires_at).toBe(Date.now() + REPORT_TOKEN_TTL_MS);
});
```

- [ ] **Step 2: Run targeted tests and verify failure**

Run: `npm test -- convex/serviceReports.expiration.test.ts src/lib/smsReport.test.ts`

Expected: FAIL because direct creation omits expiry, public lookup permits legacy documents, and resend retains expired tokens.

- [ ] **Step 3: Implement expiry, legacy migration, and resend delivery**

Set `expires_at: createdAt + REPORT_TOKEN_TTL_MS` on both creators. Treat a report as reusable only when `expires_at !== undefined && expires_at > Date.now()`. Otherwise generate a new token and patch `{ report_token, expires_at }`, returning `rotated: true`. Do not apply the 60-second duplicate-send shortcut when `rotated` is true. Reject `!report.expires_at || Date.now() >= report.expires_at` in public lookup. Add an internal paginated migration that sets missing legacy expirations to `0`; run it before changing the schema field from `v.optional(v.number())` to `v.number()`.

- [ ] **Step 4: Run targeted tests and verify success**

Run: `npm test -- convex/serviceReports.expiration.test.ts convex/serviceReports.property.test.ts src/lib/smsReport.test.ts`

Expected: PASS with exact-boundary rejection, legacy denial, fresh-token resend, and unexpired resend behavior.

### Task 5: Restrict Invoice Payment State

**Files:**
- Modify: `convex/invoices.ts:595-622,766-788`
- Test: `convex/invoices.test.ts`

**Interfaces:**
- `updateStatus` accepts only `draft`, `sent`, or `cancelled`.
- `markPaid` throws for every invoice containing `stripe_checkout_session_id`.

- [ ] **Step 1: Write failing payment-invariant tests**

```ts
it("rejects a paid status through the general update mutation", async () => {
  await expect(updateStatus({ id: stripeInvoiceId, status: "paid" })).rejects.toThrow("Payment status cannot be updated here");
});

it("rejects manual payment for every Stripe-linked invoice", async () => {
  await expect(markPaid({ id: stripeInvoiceId })).rejects.toThrow("Stripe confirms payment");
});
```

- [ ] **Step 2: Run targeted tests and verify failure**

Run: `npm test -- convex/invoices.test.ts src/lib/stripeWebhook.test.ts`

Expected: FAIL because `updateStatus` currently accepts `paid`.

- [ ] **Step 3: Implement restricted transitions**

```ts
if (args.status === "paid") throw new Error("Payment status cannot be updated here");
if (invoice.stripe_checkout_session_id) {
  throw new Error("This invoice is linked to Stripe. Stripe confirms payment automatically.");
}
```

Remove `payment_url` from the public `updateStatus` arguments. Preserve `markPaidFromStripe` as an `internalMutation` and ensure its callers remain only webhook and verified Checkout-session synchronization paths.

- [ ] **Step 4: Run targeted tests and verify success**

Run: `npm test -- convex/invoices.test.ts src/lib/stripeWebhook.test.ts`

Expected: PASS with manual cash/check invoices supported and Stripe-linked payment state immutable to clients.

### Task 6: Fail Closed for Financial Workflows

**Files:**
- Modify: `src/pages/WorkOrders.jsx:496-702,1010-2682,2784-4263`
- Create: `src/pages/WorkOrders.test.jsx`

**Interfaces:**
- `isBusinessLoading = currentBusiness === undefined`.
- `canWriteWorkOrders = currentBusiness !== undefined && currentBusiness !== null`.
- `requireWritableBusiness(): boolean` emits an actionable toast and returns false unless `canWriteWorkOrders` is true.

- [ ] **Step 1: Write failing Work Orders state tests**

```jsx
it("does not load or persist local financial data while business resolution is pending", () => {
  mockGetCurrentBusiness(undefined);
  render(<WorkOrders />);
  expect(screen.getByText(/resolving business/i)).toBeVisible();
  expect(localStorage.setItem).not.toHaveBeenCalledWith("chemcheck_local_invoices", expect.any(String));
});

it("renders legacy local financial records read-only when no business exists", () => {
  mockGetCurrentBusiness(null);
  render(<WorkOrders />);
  expect(screen.getByText(/read-only legacy data/i)).toBeVisible();
  expect(screen.getByRole("button", { name: /create invoice/i })).toBeDisabled();
});
```

- [ ] **Step 2: Run targeted tests and verify failure**

Run: `npm test -- src/pages/WorkOrders.test.jsx`

Expected: FAIL because `Boolean(currentBusiness)` activates mutable local fallback during query loading.

- [ ] **Step 3: Implement explicit resolution and guards**

Replace `cloudEnabled = Boolean(currentBusiness)` with the three explicit states above. Return empty collections while loading, cloud collections when a business exists, and legacy local collections only when the resolved value is `null`. Remove local migration/persistence effects for work orders, invoices, quotes, and communications. Gate the Stripe-return effect and reminder autopilot on `canWriteWorkOrders`. Put this first line in every create, update, delete, send, retry, and mark-paid handler:

```js
if (!requireWritableBusiness()) return;
```

Disable each mutation control with `disabled={!canWriteWorkOrders || existingDisabledCondition}`. Keep filtering, PDF downloads, and navigation readable. Present a resolving screen while loading and a read-only explanatory banner when no business exists.

- [ ] **Step 4: Run targeted tests and verify success**

Run: `npm test -- src/pages/WorkOrders.test.jsx src/lib/workOrderLifecycle.test.ts`

Expected: PASS for loading, absent-business read-only state, cloud write path, and query-error boundary behavior.

### Task 7: Full Regression and Staging Evidence

**Files:**
- Modify: `STRIPE_SETUP.md`
- Modify: `STAGING_SETUP.md`

- [ ] **Step 1: Document exact production configuration**

Document Convex `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `APP_URL`, each monthly/annual Stripe price ID, Stripe webhook events, Customer Portal configuration, and the mandatory staged report-expiry migration command. Remove all documented `VITE_STRIPE_CHECKOUT_URL`, `VITE_STRIPE_PORTAL_URL`, and `VITE_STRIPE_CANCEL_URL` variables.

- [ ] **Step 2: Run local verification**

Run: `npm run lint && npm run test:gates && npm test && npm run build && npm audit --omit=dev`

Expected: all commands exit `0`; full unit suite has no failures.

- [ ] **Step 3: Run staging release checks**

Run the following against authenticated staging, recording results in the release ticket:

```text
1. Owner starts Stripe test Checkout; webhook creates the business subscription.
2. Team member sees the same subscription but cannot open owner billing management.
3. Owner opens the Stripe Customer Portal and cancels there; webhook updates the business status.
4. Two accounts use one device; account A logout removes Dexie, photo storage, Cache Storage, and ChemCheck storage before account B signs in.
5. Create a report, confirm it expires at 30 days, and confirm an expired resend emits a new URL while the old URL is denied.
6. Pay an invoice through Stripe, then prove direct client calls cannot set a Stripe-linked invoice to paid.
7. Delete a seeded account containing every tenant entity and a service photo; verify no records or storage files remain.
```
