# P0 Session Isolation And Cloud WorkOrders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent account data leakage across sessions and require cloud availability for every WorkOrders record and action.

**Architecture:** The auth provider clears client-owned state before a different authenticated identity can initialize local state, and propagates cleanup failures from logout. WorkOrders treats `businesses.getCurrent` as a three-state dependency: loading, ready, or unavailable; only ready state enables cloud queries and mutations.

**Tech Stack:** React 18, Clerk, Convex, Vitest, Testing Library, Dexie.

## Global Constraints

- Do not modify `convex/account.ts`, billing files, `convex/invoices.ts`, `convex/serviceReports.ts`, or `convex/schema.ts`.
- Do not commit changes.

---

### Task 1: Isolate Client State Across Accounts

**Files:**
- Modify: `src/components/auth/ClerkAuthProvider.jsx`
- Test: `src/components/auth/ClerkAuthProvider.test.jsx`

- [ ] Write failing tests that assert a changed Clerk user clears session data before `loginUser`, and a rejected cleanup prevents `signOut`.
- [ ] Implement identity-change cleanup before local user lookup/login and rethrow logout cleanup failures after setting `authError`.
- [ ] Run `npm test -- src/components/auth/ClerkAuthProvider.test.jsx`.

### Task 2: Require Cloud WorkOrders

**Files:**
- Modify: `src/pages/WorkOrders.jsx`
- Test: `src/pages/WorkOrders.test.jsx`

- [ ] Write failing tests for loading and unavailable WorkOrders states and mutation guards.
- [ ] Remove local financial-record reads, writes, and mutation fallbacks. Derive loading and unavailable state from `getCurrent`; show an explicit loading or read-only unavailable surface and disable/guard all mutating controls.
- [ ] Run `npm test -- src/pages/WorkOrders.test.jsx`.

### Task 3: Verify P0 Boundaries

**Files:**
- Test: `src/lib/sessionCleanup.test.ts`
- Test: focused tests from Tasks 1 and 2

- [ ] Extend cleanup coverage for every ChemCheck storage namespace used by WorkOrders.
- [ ] Run focused Vitest files and ESLint over modified source files.
