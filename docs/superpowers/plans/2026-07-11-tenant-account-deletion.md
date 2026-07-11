# Tenant Account Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reliably delete all data owned by an account's businesses without leaving report, storage, billing, or membership records behind.

**Architecture:** Extend `convex/account.ts` with a resumable tenant phase that walks each customer tree and an expanded general phase for business-scoped subscriptions and memberships. Storage-backed service photos are deleted before their database metadata; a storage failure is allowed to abort the mutation so Convex rolls back its document writes.

**Tech Stack:** Convex internal mutations, TypeScript, Vitest.

## Global Constraints

- Work only in `/Users/jakedom/Documents/chemcheck-p0-worktree`.
- Delete data for every business whose `owner_email` is the authenticated account owner.
- Do not commit changes.
- Keep each mutation below `MAX_DOC_WRITES` document writes.

---

### Task 1: Specify the Privacy Boundary

**Files:**
- Create: `convex/accountDeletion.test.ts`

- [ ] Add a regression test requiring the account deletion action to execute a resumable tenant phase.
- [ ] Require the tenant phase to process pools, equipment, work orders, invoices, quotes, communications, service reports, report access logs, and storage-backed photos.
- [ ] Require subscriptions and memberships to be removed before owned businesses.
- [ ] Run `npm test -- convex/accountDeletion.test.ts` and confirm it fails because the tenant phase does not exist.

### Task 2: Delete Tenant Customer Trees

**Files:**
- Modify: `convex/account.ts`
- Modify: `convex/schema.ts`

- [ ] Add a `tenant` phase and cursor state for the active customer, service log, report, and pagination cursors.
- [ ] Delete service-photo storage objects before their `servicePhotos` records, with no error suppression.
- [ ] Delete each report's access logs before its `serviceReports` record, then delete service logs, equipment, pools, chemical usage, notes, salt-cell logs, work orders, invoices, quotes, communications, and customers.
- [ ] Add a `workOrders.by_customer` index so work orders can be deleted within a customer tree.
- [ ] Run `npm test -- convex/accountDeletion.test.ts` and confirm it passes.

### Task 3: Delete Business-Level Records

**Files:**
- Modify: `convex/account.ts`

- [ ] Expand the general deletion cursor to page through subscriptions associated with every owned business.
- [ ] Keep owned-business memberships ahead of business deletion and preserve direct membership cleanup for the deleting account.
- [ ] Run `npm test -- convex/accountDeletion.test.ts convex/securityFixes.test.ts` and confirm both files pass.

### Task 4: Verify

**Files:**
- Modify: `convex/account.ts`
- Modify: `convex/schema.ts`
- Create: `convex/accountDeletion.test.ts`

- [ ] Run `npm test -- convex/accountDeletion.test.ts convex/securityFixes.test.ts`.
- [ ] Run `npm run lint`.
