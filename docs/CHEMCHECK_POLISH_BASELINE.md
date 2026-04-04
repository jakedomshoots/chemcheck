# ChemCheck Web Baseline + Safety Contracts (Mobile-Ready Readiness)

Last updated: 2026-03-19

This document captures the minimum operating contract for the current web-first rollout so we can later wrap with Capacitor without behavior drift.

## 1) Core Contracts

### 1.1 Auth / Session
- Auth source of truth is the Clerk session exposed by `ClerkAuthProvider` + `RobustAuthGuard`.
- `RobustAuthGuard` remains the canonical gate for protected routes.
- Public routes stay: `/login*`, `/signup*`, `/sso-callback*`, `/pricing`, `/privacy-policy.html`, `/terms-of-service.html`, and report URLs matching `/report/:reportId`.
- `useSyncInitialization` only enables sync when:
  - user session is signed in
  - app is online-capable in current runtime
  - sync client is initialized.
- Safe fallback behavior:
  - If Clerk config missing, app surfaces config error UI and blocks runtime auth flows.
  - Session bypasses remain opt-in and are centralized in `platformPolicy.ts`.

### 1.2 Offline-First + Sync
- Local DB remains source of immediate truth (`Dexie`).
- Sync service is started via `startAutoSync` only when online and initialized.
- Sync lifecycle events:
  - `syncNow()` transitions through `syncing` and returns `{ success, syncedCount, failedCount }`.
  - Connectivity listeners update status to `offline` / `idle`.
  - Queue replay is driven by `syncPendingRecords()` with retry/backoff semantics.
- Queue recovery guarantees:
  - queue state is persisted to `localStorage` with bounded growth.
  - duplicate entries for same table+id are deduplicated before enqueue.

### 1.3 Backup & Migration
- Backup contract fields:
  - `version`
  - `schemaVersion`
  - `timestamp`
  - `appVersion`
  - `metadata`
- Restore contract:
  - validate backup shape before import
  - reject hard-incompatible schema versions
  - allow compatibility warnings for newer app-version producers.
- Restore must never discard schema compatibility metadata; it is preserved and normalised.

### 1.4 Routing
- Canonical route definitions come from `APP_ROUTES` in `src/lib/routeConfig.ts`.
- `ProtectedAppRoutes` should use canonical paths for route elements and redirects for legacy casing/alias routes.
- Unknown routes fallback to home redirect only after auth routing decisions are evaluated.

### 1.5 PWA Startup
- PWA bootstrap runs at app-level initialization (`src/App.jsx`):
  - migrations
  - service worker registration via `platformPolicy.shouldRegisterServiceWorker`
  - auto-backup start/stop based on user preference
  - `sw-backup-request` wire-up.
- Service worker behavior remains deterministic:
  - never registered when explicitly disabled
  - never throws unhandled error on unsupported browsers
  - listeners are cleaned up on unmount.

## 2) Compatibility Matrix (Baseline)

| Axis | Current Web Baseline | Capacitor iOS Path (future) | Capacitor Android Path (future) |
| --- | --- | --- | --- |
| Routing | Browser history + deep links | WKWebView deep-link pass-through, same paths | WebView deep-link pass-through, same paths |
| Auth Session | Clerk session + local policy bypass flags | Plugin wrappers for token/session persistence only | Same |
| Sync | Navigator online/offline + manual sync queue | Same; add offline-capable network transitions for web view | Same |
| Backup | Local backup schema/version fields (`schemaVersion`, `appVersion`) | Same storage contract; export/import payload unchanged | Same |
| SW/Install | Browser service worker registration | Disabled/reviewed for wrapper shells | Disabled/reviewed for wrapper shells |
| Data Model | Dexie + Convex id/sync metadata | Persisted unchanged | Persisted unchanged |

## 3) Risk Register

| Area | Severity | Risk | Mitigation / Rollback |
| --- | --- | --- | --- |
| Auth bypasses in dev | High | Unexpected privilege elevation outside dev intent | Centralized in `platformPolicy`, add hard disable env var, keep default disabled in production |
| Sync queue growth | Medium | Unbounded growth leading to high memory / sync starvation | Queue max size + warning + low-priority eviction + idempotent clear |
| Auth/session expiry during sync | Medium | Repeated failed sync loops | Auth/permission error detection + explicit error status, queue remains stable for retry after re-auth |
| Service worker registration path | Medium | SW side-effects in dev or unsupported browsers | Explicit policy function and safe registration/no-op fallback |
| Route casing/aliases | Low | Deep-link 404 loops | Canonical route map + legacy alias redirects |
| Backup incompatibility | High | Restore blocked or silent corruption | Explicit schema gate + compatibility metadata |

## 4) Env Flag Policy

All runtime feature policy is defined in `src/lib/platformPolicy.ts`:
- `VITE_DISABLE_SERVICE_WORKER` (hard off)
- `VITE_ENABLE_SERVICE_WORKER_DEV` (explicit dev enable)
- `VITE_DISABLE_AUTH_BYPASS` (hard bypass off switch)
- `VITE_ENABLE_LOCALHOST_AUTH_BYPASS` (default true, env opt-in semantics)
- `VITE_IOS_SIM_AUTH_BYPASS` (explicit iOS simulator bypass)
- `VITE_APP_VERSION` (snapshot for backup compatibility warnings)

## 5) Open Items for Next Segments

1. Review mobile shell integration test checklist before native wrapper bootstrap.

## 6) Segment Delivery Log

### Completed in this implementation wave

1. Core sync stability
   - Fixed duplicate `SyncService` registration/listeners and consolidated online/offline handlers.
   - Added bounded sync batch processing using `syncQueue.getBatchSize()`.
   - Reduced queue mutation races by normalizing `enqueueRecord()` through one persistence path.

2. Service worker decision hardening
   - `register()` now short-circuits when policy disables registration and records a `service_worker_not_attempted` metric.
   - Added policy-backed reversible unregistration path for non-production/dev fallback states.
   - Update/listener registration is kept idempotent and guarded.

3. Routing readiness and public entry consistency
   - Public report router now has an explicit route fallback.
   - Report route matching is now case-insensitive by normalization.
   - Permission denied and 404 routes are now first-class pages.
   - Readiness checks now include route/environment/mode metadata in `/health` and `/ready`.
   - Route canonicalization is now test-covered, including legacy aliases and report/public-entry behavior.
   - Public route policy now includes `/pricing`, preventing accidental auth redirects on the marketing page.

4. Sync hardening observability
   - Added sync conflict telemetry (`sync_conflict_detected`, `sync_conflict_retry`, `sync_conflict_exhausted`, `sync_conflict_remote_wins`) and queue-item error telemetry (`sync_queue_item_error`).
   - Added batch-volume telemetry regression coverage in queue-driven sync (`src/lib/sync/SyncService.enhanced.test.ts`).
   - Added canonical deep-link routing regression coverage at `AppRouterShell` (`src/components/routing/AppRouterShell.test.jsx`).
   - Sync queue lifecycle telemetry is now recorded (`sync_queue_depth`) for cycle-level observability.
   - Added sync queue idempotency and persistence regression tests (`SyncQueue.test.ts`).
   - Added service worker policy/register/unregister regression tests (`serviceWorker.test.ts`).
   - Reduced background sync polling when tabs are hidden to reduce CPU and battery wakeups.
  - Added protected-route navigation integration coverage for access denied, not-found, and legacy alias restore targets (`src/pages/ProtectedAppRoutes.test.jsx`).
  - Normalized alias redirect rendering in `ProtectedAppRoutes` to explicit router `<Route>` entries for React Router v6+ compatibility.

5. Non-functional verification gates
   - Added dedicated gate checks for route performance envelopes and readiness drift.
   - Extended gate execution path to include `src/lib/nonfunctional-gates.test.tsx`.

### Remaining open items
1. Review route restore/perf boundaries under real-device conditions during the next test pass.
