# ChemCheck Production Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove verified dead weight, bound live data reads, repair scale-sensitive Work Orders behavior, and return a warning-free, audited production build.

**Architecture:** Preserve ChemCheck's offline-first Dexie sync path, which is already cursor-paginated. Harden only the live Convex queries used by Work Orders and billing, represent truncated data windows explicitly, and delete modules proven to have no production importers. Dependency changes stay within patch/minor ranges except where a security advisory requires a compatible direct update.

**Tech Stack:** React 18, Vite 8, Vitest 4, Convex, Dexie, Capacitor 8, npm audit, Knip.

---

### Task 1: Add load-safety regression gates

**Files:**
- Create: `src/lib/loadSafety.test.ts`
- Modify: `src/pages/WorkOrders.test.jsx`

- [ ] **Step 1: Write a failing backend load-safety test**

Read the active `customers.list` and `quotes.list` source blocks and assert that they use bounded reads (`take` or `paginate`) instead of an unbounded `collect`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run src/lib/loadSafety.test.ts --maxWorkers=1 --maxConcurrency=1`

Expected: FAIL because `customers.list` calls `listAccessibleCustomers`, which collects all rows, and `quotes.list` calls `.collect()`.

- [ ] **Step 3: Add a failing Work Orders truncation test**

Mock paginated query results with `isDone: false` and assert that the dashboard presents a data-window warning instead of silently treating the first page as complete.

- [ ] **Step 4: Run the Work Orders test and verify RED**

Run: `npx vitest run src/pages/WorkOrders.test.jsx --maxWorkers=1 --maxConcurrency=1`

Expected: FAIL because the current UI has no truncation disclosure and treats every query result as complete.

### Task 2: Bound active Convex reads and make partial windows honest

**Files:**
- Modify: `convex/customers.ts`
- Modify: `convex/quotes.ts`
- Modify: `src/pages/WorkOrders.jsx`
- Test: `src/lib/loadSafety.test.ts`
- Test: `src/pages/WorkOrders.test.jsx`

- [ ] **Step 1: Bound `customers.list` at the query**

Resolve the tenant business context, build the indexed customer query, and call `.take(DEFAULT_LIST_LIMIT)` directly. Do not collect the tenant and slice afterward.

- [ ] **Step 2: Paginate `quotes.list`**

Accept optional `cursor` and `numItems`, clamp the page size to 200, select the best existing index for `created_by` or `created_by + status`, and return `{ page, continueCursor, isDone }`.

- [ ] **Step 3: Align Work Orders with server limits**

Request at most 200 rows from work orders, invoices, quotes, and communications. Consume `quotes.list.page`, and display a concise warning whenever any returned collection reports `isDone: false` so billing totals are never presented as complete.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npx vitest run src/lib/loadSafety.test.ts src/pages/WorkOrders.test.jsx --maxWorkers=1 --maxConcurrency=1`

Expected: PASS.

### Task 3: Delete production-unreachable code and dependency declarations

**Files:**
- Delete: `src/lib/poolAnalysis.ts`
- Delete: `src/lib/poolAnalysis.test.ts`
- Delete: `src/lib/sync/MigrationService.ts`
- Delete: `src/lib/sync/MigrationService.test.ts`
- Delete: `src/lib/sync/MigrationService.property.test.ts`
- Delete: `src/lib/sync/DataIntegrityService.ts`
- Modify: `src/lib/sync/integration.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `vite.config.js`

- [ ] **Step 1: Re-prove production reachability**

Run targeted `rg` searches for the legacy pool engine, migration service, data-integrity service, and `@stripe/stripe-js`. Preserve anything imported from production code or iOS Swift Package Manager files.

- [ ] **Step 2: Remove the legacy pool-analysis engine**

Delete the unused engine and its self-contained tests. Preserve `src/lib/ai-summarizer`, which is the live Pool Analysis path.

- [ ] **Step 3: Remove the abandoned sync migration stack**

Delete `MigrationService` and `DataIntegrityService`, their dedicated tests, and only the migration-service describe block from `integration.test.ts`. Preserve the active `src/lib/migrations.ts` application bootstrap and all SyncService integration coverage.

- [ ] **Step 4: Remove the unused Stripe browser SDK**

Remove `@stripe/stripe-js` and its manual Vite chunk. Preserve server-side Stripe actions and tests; they do not import the browser SDK.

- [ ] **Step 5: Verify the focused and full tests**

Run: `npm test`

Expected: every remaining test passes with no missing-import failures.

### Task 4: Patch dependency advisories and build warnings

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: exact source file containing the ambiguous Tailwind easing class, if present

- [ ] **Step 1: Apply targeted compatible dependency updates**

Update React Router, PostCSS, Capacitor CLI, ESLint, and vulnerable transitive packages only within compatible ranges. Do not run a forced major-version audit fix.

- [ ] **Step 2: Re-run the security audit**

Run: `npm audit --json`

Expected: zero fixable high/critical advisories. If a remaining advisory only affects an unused SSR/RSC mode, document it rather than forcing React Router 8 into this SPA.

- [ ] **Step 3: Remove the Tailwind ambiguity warning**

Locate the emitted class or configuration source and express the easing token unambiguously. If the warning comes from generated third-party code and no project source matches, document it instead of patching dependencies in place.

### Task 5: Production verification and review

**Files:**
- Modify: this plan checklist as tasks complete

- [ ] **Step 1: Type-check**

Run: `npx tsc --noEmit`

Expected: exit 0.

- [ ] **Step 2: Run lint and readiness gates**

Run: `npm run lint && npm run test:gates`

Expected: exit 0 with no lint warnings or gate failures.

- [ ] **Step 3: Run the complete unit suite**

Run: `npm test`

Expected: all test files pass.

- [ ] **Step 4: Build and inspect bundle output**

Run: `npm run build`

Expected: exit 0; no new chunk-size regression and no project-owned build warnings.

- [ ] **Step 5: Re-run Knip and audit**

Run: `npx --yes knip --reporter compact --no-progress` and `npm audit --json`.

Expected: known string-referenced/native false positives only; no fixable high/critical runtime advisory.

- [ ] **Step 6: Review the diff**

Run: `git diff --check`, `git status --short`, and inspect every changed file. Confirm the original dirty `main` checkout is unchanged.
