# ChemCheck Architecture

## Purpose

ChemCheck is a mobile-first pool service operations app. It must let a business safely plan work, complete a pool stop offline, prove the work, communicate the result, and keep a durable customer history across devices and technicians.

The complete data inventory is in [docs/data-inventory.md](docs/data-inventory.md). The phased migration plan is in [docs/superpowers/plans/2026-07-09-chemcheck-full-audit-roadmap.md](docs/superpowers/plans/2026-07-09-chemcheck-full-audit-roadmap.md).

## Current runtime

```text
React pages and hooks
        |
        +-- Dexie `chemcheck` database for customers, logs, usage, notes, salt cells
        +-- Dexie `proofOfServicePhotos` database for local photos
        +-- localStorage for identity fallbacks, drafts, queues, backups, settings, billing fallbacks
        |
        +-- Convex mutations/actions for cloud data, reports, payments, and team data
        |
        +-- Clerk authentication
        +-- Convex file storage
        +-- Stripe, Twilio, MailerSend, Google Analytics, Sentry
```

This current layout is transitional. The page layer can call both local and cloud stores directly, which causes inconsistent tenant boundaries, sync behavior, and deletion coverage.

## Target architecture

```text
React screens
        |
        v
Tenant-aware feature repositories
        |
        +-- Local cache + durable outbox (Dexie, scoped by user + business)
        |
        +-- Sync coordinator
        |     push mutations with idempotency/version/tombstone
        |     pull remote changes by business cursor
        |     surface conflicts and retries
        |
        v
Convex domain services
        |
        +-- central authorization: membership and role checks
        +-- business-scoped entities and indexes
        +-- storage lifecycle and retention
        +-- integrations through server-side adapters
```

## Non-negotiable invariants

1. Every business record, local cache row, photo, queue item, draft, backup, and audit event belongs to exactly one user/business scope.
2. The signed-in identity and active business are the only source of scope. No production path may fall back to a shared `local` user.
3. A deletion is represented by a tombstone until the cloud confirms it. A missing local row is never proof of a successful cloud delete.
4. A stop is an explicit dated business event. Readings are numeric or explicitly `not_tested`; status is derived, never assumed `good`.
5. The UI may say `sent`, `paid`, `synced`, or `optimized` only after the relevant provider or solver confirms it.
6. Gate codes, exact locations, photos, notes, and customer identity never enter analytics, crash replay, or unrelated provider payloads.
7. Export, delete, backup, and restore use the same inventory and cover the same scoped data.

## Domain hierarchy

```text
Business
  Membership
  Customer
    Service location
      Water body (pool/spa)
        Equipment
        Schedule
          Route run
            Stop
              Task completion
              Reading / dosage
              Issue
              Photo
              Customer report
              Work order / quote / invoice reference
```

## Deployment and operational boundaries

- Browser and Capacitor app: UI, encrypted platform credentials where available, local cache/outbox.
- Convex: authoritative business data, authorization, delivery state, and integration orchestration.
- Clerk: authentication only; no business data authorization decisions in the client.
- Stripe/Square/QuickBooks: external financial systems of record. ChemCheck retains references and reconciled status, not raw card data.
- Twilio/MailerSend: delivery providers; only send consented recipient/addressed report data.
- Sentry/Google Analytics: disabled or fully redacted until privacy controls are verified.

## Required verification

- Two users and two businesses on one browser/device cannot observe each other’s cache or drafts.
- Two technicians can update one business without losing a record.
- Offline create, update, delete, photo capture, restart, reconnect, and conflict tests converge.
- Export/delete/restore fixture covers every table, file object, queue, draft, backup, and local key.
- Any native release requires archive, TestFlight, permission, privacy-label, deep-link, external-provider, and device-matrix evidence.
