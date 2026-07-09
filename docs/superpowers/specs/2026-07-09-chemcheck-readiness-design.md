# ChemCheck Readiness Design

## Decision

Implement the approved audit roadmap incrementally. ChemCheck will keep React, Vite, Convex, Clerk, Dexie, Capacitor, and Stripe. It will not receive a framework rewrite or a global client-state library.

The first release target is a secure single-owner field pilot. Multi-technician dispatch, accounting integrations, customer portal, and AI follow only after tenant safety, stop integrity, and durable offline behavior are proven.

## Design

### Data and tenancy

All operational data is scoped by authenticated user and active business. Convex authorization is centralized around business membership and role. Dexie is a cache/outbox, not a second competing source of truth. Each local row and stored blob carries the same scope as its cloud record.

### Sync

The client stores durable mutation intents in a tenant-scoped Dexie outbox. Each intent includes an idempotency key, entity UUID, operation, base version, retry state, and tombstone when deleted. The synchronizer pushes intents, then pulls business changes by cursor. It never discards a mutation merely because a local record is gone.

### Service stops

Service work is represented by a dated stop with outcome and reason. Readings are entered as numeric values or explicitly not tested. Status is derived by a deterministic target profile. Actual chemical dosage, photos, issues, and task completion are attached to the stop before a report is sent.

### Privacy and trust

Gate codes and location are minimized, role-gated, and excluded from analytics/replay. Export, delete, backups, and restore are driven by one published inventory. UI copy only claims state that is confirmed by the local database, cloud, payment provider, or route solver.

### Testing

Every behavior change starts with a failing focused test. Critical acceptance tests cover tenant isolation, delete propagation, offline restart/reconnect, explicit reading entry, photo lifecycle, RBAC, and accounting state transitions.

## Scope boundaries

- Real road routing requires a selected geocoding/travel-time provider and credentials; until configured, the UI will retain manual order and state that it is not optimized.
- App Store archive/TestFlight needs full Xcode, signing, App Store Connect, and a payment model decision. Those are tracked external blockers, not silently bypassed.
- AI cannot recommend final chemical dosage or execute business actions autonomously.

## Approval

The audit roadmap was approved for implementation by the user on 2026-07-09. This document records that approved design so implementation tasks have a stable architectural contract.
