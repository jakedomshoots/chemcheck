# ChemCheck Full Audit and Readiness Implementation Plan

> **For TERRA:** Execute this plan in order. Use test-driven changes, keep migrations reversible, and do not claim a gate is complete without the listed acceptance evidence.

**Goal:** Make ChemCheck safe for real customer data, reliable in weak-signal field work, honest about routing/billing/privacy behavior, and ready for an iOS App Store submission.

**Architecture direction:** Keep React, Vite, Convex, Clerk, Dexie, Capacitor, and Stripe. Do not rewrite the app. Incrementally place one tenant-aware data layer between pages and storage, make Convex the shared source of truth, use Dexie as the scoped offline cache/outbox, and migrate one vertical workflow at a time.

**Tech stack:** React 18, Vite 8, TypeScript/JavaScript, Convex, Clerk, Dexie, Stripe, Sentry, Capacitor 8, Vitest, Playwright, Xcode/App Store Connect.

**Audit date and source:** 2026-07-09, detached `HEAD` `1fa41cd` at `origin/main` in this worktree. Existing user changes were not modified. No product code was implemented during this audit.

## Audit evidence

- `npm run lint`: PASS.
- `npm run build`: PASS.
- `npm audit --audit-level=high`: PASS, 0 vulnerabilities.
- `npm run test:gates`: PASS, 13/13.
- `npm test -- --reporter=dot`: PASS, 93 files / 882 tests; React test warnings remain.
- Chromium E2E: FAIL, 2 failed / 29 passed. In both, the new customer is scheduled on Thursday but the Clients screen remains on Monday after redirect, so the expected customer is not visible.
- `plutil -lint ios/App/App/Info.plist ios/App/App/PrivacyInfo.xcprivacy`: PASS syntax only.
- Native Xcode build/archive: BLOCKED. `xcode-select` points to `/Library/Developer/CommandLineTools`; full Xcode is not selected.
- Secret scan: no obvious committed secret value or tracked `.env`, `.p8`, or provisioning profile found in the current tree. Git history and hosted environment variables were not audited.
- Fresh UI evidence: `artifacts/chemcheck-audit-2026-07-09/01-home-route.png` through `10-generated-route.png`.
- Verified live preview: `http://localhost:5173/home` (IPv6 listener) is ChemCheck. `http://127.0.0.1:5173` is a different Axis Health preview and must not be used for ChemCheck QA. E2E used its isolated configured port `5174`.

## A. Executive summary

ChemCheck is not ready for App Store submission or multi-technician business use. It has a broad feature shell and a healthy unit-test count, but several core claims are not true end to end:

1. Local data is not isolated by signed-in user or business.
2. Offline sync is outbound-only and silently loses remote deletes.
3. Account deletion/export omits important cloud and device data.
4. Route optimization fabricates coordinates and drive estimates.
5. Work orders, quotes, invoices, and communications can silently fall into local-only mode.
6. A new stop starts all chemistry fields as `good`, allowing false records.
7. Privacy disclosures do not match GPS, analytics, Sentry replay, customer content, or local retention.
8. Multi-technician permissions are inconsistent and often reject valid team access.

The safest product strategy is a focused pool-service field tool: today's route, a fast and explicit stop record, durable offline sync, proof of service, customer/pool/equipment history, and accounting integration. Do not chase enterprise FSM breadth until those foundations work.

## B. Critical blockers

| Priority | Blocker | Evidence | Required outcome |
|---|---|---|---|
| P0 | Cross-user local data exposure | `src/api/dexieHooks.ts`, `src/db/chemcheck-db.ts`, `src/lib/userManager.ts` | Every device cache and query is scoped to authenticated user + business; logout removes or locks that scope. |
| P0 | Deletes do not sync | `src/api/dexieHooks.ts`, `src/lib/sync/SyncService.ts` | Tombstoned deletes reach Convex and are acknowledged before purge. |
| P0 | Incomplete erasure/export | `src/lib/gdpr.ts`, `convex/account.ts`, separate photo DB and local billing keys | One verified inventory drives export, delete, retention, and logout. |
| P0 | False chemistry records | `src/pages/NewServiceLog.jsx` defaults all readings to `good` | Each reading is explicit, numeric, or explicitly `not tested`; status is derived. |
| P0 | Fake route math | `src/pages/RouteOptimizer.jsx`, `src/lib/routeOptimizer.ts` | Use real validated coordinates and road-time data, or label the route manual/unoptimized. |
| P0 | Local-only billing/work-order split | `src/pages/WorkOrders.jsx` | No fake sent/paid URLs; one server-backed record lifecycle with an explicit offline-draft state. |
| P0 | Privacy disclosure mismatch | `ios/App/App/PrivacyInfo.xcprivacy`, `src/lib/analytics.ts`, `src/lib/sentry.ts`, public privacy policy | Manifest, App Store answers, consent, retention, and policy match actual behavior. |
| P0 | Broken team authorization | `convex/serviceLogs.ts`, `notes.ts`, `chemicalUsage.ts`, `servicePhotos.ts`, `invoices.ts`, `quotes.ts` | Central business membership and role checks cover every operation. |
| P0 | Native release unverified | Xcode unavailable; current E2E red | Archive, TestFlight, permissions, deep links, external payment links, offline, and device matrix pass. |
| P0 | Digital subscription payment decision | Stripe pricing/subscription UI vs Apple purchase rules | Choose StoreKit, enterprise-only companion access, or no in-app purchase/CTA; document App Review rationale. Customer pool-service invoices remain external physical-service payments. |

## C. High-priority architecture fixes

### 1. Create one tenant-aware data boundary

- Add `src/data/` repositories for customers, stops, readings/dosages, photos, routes, and billing.
- Keep the existing hooks as adapters while pages migrate. Do not add Redux just to hide persistence problems.
- Replace `src/api/convexHooks.js` naming and behavior gradually; it currently sounds cloud-backed but re-exports Dexie hooks.
- Require `{userId, businessId}` for every local read/write and every Convex query/mutation.
- Add `business_id` to all business-owned Convex tables and compound indexes. Backfill before making it required.
- Make local IDs UUIDs that remain stable across offline/online transitions; keep Convex IDs as server references.

### 2. Replace the sync queue, not the whole app

- Move full queue payloads out of `localStorage` into a tenant-scoped Dexie outbox.
- Store mutation ID, entity type, entity ID, operation, base version, payload, attempts, and state.
- Add server idempotency keys, version numbers, tombstones, per-business pull cursors, and retry state that never silently discards work.
- Pull remote changes on sign-in, foreground, reconnect, manual refresh, and after successful pushes.
- Add a conflict screen for business-important conflicts; use deterministic merges only for safe non-overlapping fields.
- Keep photos in a separate upload queue, but tie them to the same tenant, stop, and deletion lifecycle.

### 3. Normalize the core model

Use this hierarchy:

`Business -> User/Membership -> Customer -> Service Location -> Water Body -> Equipment -> Schedule -> Route Run -> Stop -> Tasks/Readings/Dosages/Photos/Issues -> Report -> Work Order -> Quote -> Invoice/Payment Reference`

Practical schema changes:

- Split customer identity from address/site and pool/spa/water-body details.
- Add first-class recurring schedule, dated stop, stop outcome, reason code, assigned tech, check-in/out, and reschedule linkage.
- Replace chemistry status strings as the source with typed numeric readings, units, test method, target profile, and derived status.
- Store chemical applications as quantity + unit + product + unit cost + inventory lot where needed.
- Add equipment assets, install/service dates, filter-clean intervals, salt-cell cleaning, repair issues, warranties, and photos.
- Treat invoices/payments as external accounting/payment references unless ChemCheck is intentionally becoming an accounting ledger.

### 4. Split oversized modules as they are touched

- `src/pages/WorkOrders.jsx` (4,330 lines): split queries/controllers from Work Orders, Quotes, Invoices, Communications, and Billing Health views.
- `src/pages/Settings.jsx` (1,562 lines): split each tab into a route/section and isolate destructive privacy actions.
- `src/pages/NewServiceLog.jsx` (698 lines): make it a stop-workflow orchestrator; move chemistry, proof, tasks, outcome, and submit logic into tested modules.
- `convex/serviceReports.ts` (1,645 lines) and `convex/account.ts` (924 lines): split authorization, rendering, delivery, export, deletion, and retention services.
- Rewrite `ARCHITECTURE.md`; it currently documents service reports rather than the whole running system.

## D. Security and privacy risks

| Severity | Risk | Why it matters | Fix |
|---|---|---|---|
| Critical | Local tenant isolation uses `DEFAULT_USER='local'` | A second login on the same browser/device can see cached names, addresses, gate codes, and history. | Per-user/business DB scope, tenant keys on every row, fail closed without auth, cache purge/lock on logout, two-user device tests. |
| Critical | Physical local delete is treated as synced when the row is gone | Cloud customer/service data survives deletion and can reappear. | Tombstones + remote delete mutation + acknowledgement before purge. |
| High | Sync queue stores full records in plaintext `localStorage` | Gate codes, notes, and customer details can be exposed to scripts and persist unexpectedly. | IndexedDB outbox with minimal payload; never queue secrets unnecessarily; clear by tenant. |
| High | Account deletion/export is incomplete | Current UI can promise deletion while invoices, quotes, work orders, communications, photos, backups, drafts, and export files remain. | Central data inventory; cascade every table/storage object/local key; post-delete zero-record verification and receipt. |
| High | Role checks are inconsistent | Team technicians cannot reliably access owner-created stops, while some operations lack uniform role gates. | `convex/authorization.ts` membership/role helpers; business-scoped indexes; deny-by-default contract tests for owner/admin/tech/viewer. |
| High | Privacy manifest/policy under-disclose collection | GPS, physical addresses, names, notes, analytics interaction data, and linked crash/replay data are not accurately represented. | Generate an actual data map; update manifest, App Store labels, policy, and consent together. |
| High | Analytics opt-out is ignored during initialization | A person who opted out can be tracked again after reload. | Check consent before loading GA; default off where required; make withdrawal immediate and tested. |
| High | Sentry replay and user email context are enabled | Screens may contain customer addresses, gate codes, notes, and photos. | Disable replay until scrubbed; mask text/media, block sensitive routes, strip email/name, add `beforeSend` redaction and retention limits. |
| High | Photo DB is unscoped and excluded from erasure | Base64 photos and precise GPS can remain on-device after logout/delete. | Tenant scope, file-backed storage, deletion integration, upload acknowledgement, configurable retention, location opt-in. |
| High/Unknown | Backup and restore are not a verified disaster-recovery system | Local emergency backups are plaintext and incomplete; no tested cloud restore/RPO/RTO evidence was found. | Encrypt scoped backups, define retention/RPO/RTO, run restore drills, and document provider backup/export ownership. |
| Medium | Gate codes display directly on route cards | Shoulder surfing or screenshots expose property access credentials. | Mask by default, tap-to-reveal, short auto-hide, role gate, optional audit event, no analytics/replay. |
| Medium | Server inputs use broad strings | Unbounded notes/messages and free-form statuses increase abuse, cost, and integrity risk. | Server-side length limits, enums, normalization, ownership checks, rate limits, and attachment limits. |
| Pass/Unknown | No obvious current-tree secrets or insecure HTTP calls | Good current signal, but not a full history/hosting audit. | Add CI secret scanning and review Git history, Convex, Stripe, Clerk, Twilio, MailerSend, Sentry, and App Store credentials. |

## E. App Store readiness checklist

| Item | Status | Audit result |
|---|---|---|
| Capacitor iOS shell, bundle ID, version fields | Pass | Present: `com.chemcheck.app`, version 1.0/build 1. |
| Web build, lint, dependency high-severity audit | Pass | Current checks passed. |
| Camera/photo usage descriptions | Pass/Risk | Present; verify real native behavior and limited-library flow. |
| Location purpose string | Risk | Says check-ins/directions, while photo capture requests precise GPS; rewrite to exact use and explain before prompt. |
| Face ID permission | Risk | Declared but no verified LocalAuthentication feature; remove it unless implemented. |
| Privacy manifest | Risk | Valid plist but missing data types and linked Sentry/analytics reality. |
| Privacy policy and terms surfaces | Pass/Risk | Links/support exist; policy claims do not fully match implementation. |
| Account deletion in app | Risk | Surface exists, but erasure is incomplete. |
| Data export | Risk | Omits entities; large exports have no verified expiry/deletion lifecycle. |
| Backup and restore | Missing/Unknown | No current restore drill, recovery objectives, or verified full-data backup evidence. |
| Login and onboarding | Risk | Screens exist; production-native Clerk flow and reviewer account are unverified. |
| Native push notifications | Missing | Packages/config exist, but registration, permission timing, token lifecycle, and delivery were not found. |
| Offline core workflow | Risk | Read cache exists; full offline create/edit/delete/photo/reconnect behavior is not proven. |
| Empty/loading/error states | Risk | Several exist, but Home and Clients show contradictory empty/count states; billing can show misleading health. |
| Accessibility | Risk | Some labels exist, but clickable `div`s, small icon targets, VoiceOver, focus, Dynamic Type, reduced motion, and switch control need device tests. |
| Light/dark mode | Missing | Light only. Not an App Store rule, but a product-polish gap. |
| iPhone responsiveness | Risk | 390px flow captured; service form is long and dense. |
| iPad/landscape | Unknown | Declared supported; not visually or functionally verified. |
| Performance/cold start | Risk/Unknown | Web build passes and chunks are moderate, but native cold start, low-memory behavior, large photo history, sync backlog, and route-scale tests are missing. |
| Subscription/payment compliance | Risk | Stripe is fine for customer physical-service invoices; ChemCheck SaaS plan access needs a documented Apple-compliant model. |
| App-Bound Domains/external links | Risk | Only Clerk/Cloudflare domains are listed; Stripe, reports, maps, support, and policy navigation need real-device verification. |
| Signing/archive/TestFlight | Unknown/Blocked | Full Xcode not selected on this Mac. |
| App Store Connect metadata, screenshots, labels, support URL, review notes | Missing/Unknown | Not present in the repo as completed submission evidence. |
| Crash-free field/device matrix | Unknown | No TestFlight or native-device session evidence. |

Apple requires in-app account deletion for apps that create accounts, accurate privacy disclosures including third-party SDK practices, and clear permission purposes. Physical services consumed outside the app use non-IAP payment methods, while digital app functionality has separate purchase rules. Confirm the final subscription model against the current App Review Guidelines before submission.

## F. Competitive analysis

| Product group | Strong pattern | Apply to ChemCheck |
|---|---|---|
| Skimmer | Pool-native route stops, configurable checklists, readings/dosages, offline work, skipped-stop reports, issue escalation, profit/chemical/labor reports | Make the stop the product center. Put last values, tasks, readings, dosages, issues, proof, and completion in one guided flow. |
| Pool Service Software | Multiple properties, equipment, dosage cost controls, alerts, route exceptions, reports, shopping list, QuickBooks/Stripe | Add service-location/water-body/equipment structure and chemical/inventory cost reporting before broad CRM features. |
| POOL360 PoolService | Real route optimization, water-test prescriptions, quotes, contracts, automated billing, product/pricing links | Use real routing and deterministic chemistry. Later add supplier/pricing integrations without locking core logging to one vendor. |
| Jobber / Housecall Pro | Quote -> approval -> schedule -> job -> invoice -> payment lifecycle; customer portal; reminders and on-my-way texts | Use one visible status pipeline and a no-password customer report/portal. Keep pool-specific data richer than generic FSM tools. |
| ServiceTitan | Role-specific dispatch, pricebook, reporting, job costing | Borrow reporting/controls, not enterprise UI density. ChemCheck should stay usable by a solo operator. |
| Workiz / FieldPulse | Drag/drop dispatch, live job status, guided mobile workflows, automated communication, office/field role separation | Add owner dispatch board only after tech stop reliability and permissions are correct. |
| Route4Me / Badger Maps | Valid geocoding, road constraints, start/end points, check-ins, territories, route KPIs | Replace hash-based coordinates; support depot/home start, service duration, time windows, skills, and explainable reordering. |
| QuickBooks | Recurring invoices/autopay and accounting source of truth | Prefer two-way customer/invoice/payment sync over building a general ledger. |
| Square / Stripe | Hosted invoices, recurring payments, reminders, secure receipts, event-driven payment status | Use provider-hosted pages, verified webhooks, idempotency, immutable status history, and no simulated links. |

ChemCheck's opportunity is not “more features than ServiceTitan.” It is: finish a pool stop in under a minute, with trustworthy readings, proof, offline reliability, and a clean customer history—at small-business complexity and pricing.

Research sources:

- Skimmer: https://www.getskimmer.com/ and https://www.getskimmer.com/product/clients
- Pool Service Software: https://www.poolservice.software/
- POOL360 PoolService: https://portal.pool360.com/poolservice
- Jobber: https://www.getjobber.com/features/ and https://www.getjobber.com/features/client-hub/
- Housecall Pro: https://www.housecallpro.com/features/
- ServiceTitan: https://www.servicetitan.com/get-pricing
- Workiz: https://www.workiz.com/features/
- FieldPulse: https://www.fieldpulse.com/features/dispatching-app
- Route4Me: https://support.route4me.com/faq/route-optimization/
- Badger Maps: https://www.badgermapping.com/field-service/
- QuickBooks recurring invoices: https://quickbooks.intuit.com/r/invoicing/how-to-schedule-recurring-invoices/
- Square Invoices: https://squareup.com/help/us/en/article/8387-create-and-send-invoices
- Stripe Invoicing/webhooks: https://docs.stripe.com/invoicing and https://docs.stripe.com/billing/subscriptions/webhooks

## G. Feature recommendations

Scale: 5 = highest impact or complexity/risk.

| Rank | Feature | Field | Business | Build | Privacy/security | Phase |
|---|---|---:|---:|---:|---:|---|
| 1 | Durable two-way offline sync with conflict/delete handling | 5 | 5 | 5 | 5 | 30-60 |
| 2 | Dated stop/outcome model: complete, skipped, no access, weather, green pool, equipment issue, reschedule | 5 | 5 | 3 | 2 | 30 |
| 3 | Explicit readings + integrated dosages/tasks in one stop | 5 | 5 | 3 | 2 | 30 |
| 4 | Real route planning and one-tap next-stop navigation | 5 | 4 | 4 | 3 | 60 |
| 5 | Customer -> site -> pool/spa -> equipment model | 4 | 5 | 4 | 3 | 30-60 |
| 6 | Background proof-photo upload and branded completion report | 5 | 5 | 4 | 5 | 30-60 |
| 7 | Business/team RBAC, assignment, and dispatch status | 4 | 5 | 4 | 5 | 60 |
| 8 | Chemical inventory, shortage flag, dosage/unit cost | 4 | 5 | 3 | 2 | 60 |
| 9 | Maintenance intervals: filter, salt cell, equipment, repairs | 4 | 4 | 3 | 2 | 60 |
| 10 | QuickBooks sync plus Stripe/Square hosted service invoices | 3 | 5 | 4 | 5 | 60-90 |
| 11 | Customer portal: reports, history, quote approval, invoice status | 2 | 5 | 4 | 5 | 90 |
| 12 | Profitability, route efficiency, missed stops, chemistry trends | 3 | 5 | 3 | 3 | 60-90 |
| 13 | Automated on-my-way, complete, exception, overdue reminders | 3 | 4 | 3 | 4 | 60 |
| 14 | AI summaries/anomaly suggestions with approval | 2 | 3 | 3 | 5 | 90 |

## H. UX polish recommendations

Fresh captured flow:

1. **Home route — Risk:** a missed-stop card appears beside “No Customers Scheduled,” and the pending-stops action is disabled.
2. **Service log — Blocker:** the timer restored at hundreds of hours; all chemistry is pre-labeled good; the form requires heavy scrolling.
3. **Clients day view — Risk:** the header count and selected day empty state can disagree; it defaults to Monday instead of the useful day.
4. **Client card — Risk:** gate code is immediately visible; compact icon buttons lack clear labels/large targets.
5. **Customer detail — Missing:** only basic identity/pool type/report settings/history appear; no strong contact, access, equipment, next-stop, issue, or balance summary.
6. **Settings overview — Risk:** nine tabs are in a horizontal strip with weak discoverability; a global Save button appears even for immediate actions.
7. **Settings privacy — Blocker:** “GDPR compliant” and deletion wording overstate actual behavior.
8. **Work Orders — Blocker:** local mode can look operational while records and payment behavior are device-only.
9. **Route Optimizer setup — Blocker:** the screen asks users to trust optimization built from synthetic coordinates.
10. **Generated route — Blocker:** polished ETAs/distances make fabricated estimates look authoritative.

Screen-level changes:

- **Home:** show one truth: Today, remaining/complete/exception counts, next stop, sync state, and a large `Start next stop` action. Do not combine a missed stop with a “nothing scheduled” empty state.
- **Service stop:** sticky customer/access strip, large segmented workflow (`Arrive -> Test -> Treat -> Proof -> Complete`), big numeric keypad fields, last reading shortcut, one-tap `Not tested`, integrated chemical-added rows, persistent `Complete` button, and explicit exception outcome.
- **Clients:** default to Today or first populated day; show all-day picker affordance; fix singular/plural; add search and map/call/text actions.
- **Customer card/detail:** mask gate code, show pool/site context, call/text/map buttons, next visit, equipment/issue badges, last readings, recent report, and billing status.
- **Work Orders:** remove generic “healthy” status unless backed by live provider checks. Disable send/pay actions in offline draft mode and say what will sync later.
- **Route Planner:** display validation failures per address, manual pin correction, real optimization source, assumptions, and “unoptimized” fallback.
- **Settings:** use grouped navigation or separate routes, show unsaved state only where relevant, and separate Account/Privacy destructive actions from preference saving.
- **Accessibility:** replace clickable `div`s with buttons, use 44pt targets, visible focus, semantic headings, high-contrast sunlight mode, VoiceOver labels, reduced motion, and Dynamic Type testing.

## I. Field workflow recommendations

Target workflow for a normal stop:

1. Tap `Start next stop`.
2. See name, address, masked gate note, last issue, and one-tap Maps/Call.
3. Tap `Arrived`; timer starts only now.
4. Enter readings with a numeric keypad; show last value and target beside each field.
5. Suggested deterministic dosage appears; tech confirms actual product/amount used.
6. Complete a short site-specific checklist; photo button stays visible.
7. Choose `Complete` or an exception (`No access`, `Weather`, `Customer request`, `Unsafe`, `Green pool`, `Equipment failure`, `Chemical shortage`).
8. Review a one-screen summary and send the customer report automatically when online; otherwise show `Saved offline — report pending`.
9. Advance to the next stop.

Field rules:

- Normal stop: under 60 seconds of data entry after physical work.
- One hand: primary actions in the lower thumb zone, no precision drag requirement.
- Wet hands/sun: large targets, no low-contrast gray text, numbers before sliders, haptic/sound confirmation where appropriate.
- Weak signal: every action immediately shows `Saved on device`, then `Synced`; never show fake success.
- Gate codes: one-tap reveal, short auto-hide, never in lock-screen notifications or telemetry.
- Photos: camera launches in one tap, compresses once, uploads in background, and shows pending/failed/retry per photo.
- Interrupted stop: scoped draft with customer, business, route run, start time, and expiry. Prompt to resume or abandon; never silently restore a 386-hour timer.

## J. AI integration recommendations

Add AI only after the underlying records are structured and permissioned.

Good uses:

- Summarize long service history with links back to the exact visits used.
- Draft a customer-facing completion summary from structured readings, work, notes, and photos; tech approves before send.
- Flag repeated issues or unusual trends after deterministic thresholds run first.
- Suggest follow-up tasks such as filter clean, leak check, salt cell inspection, or quote creation.
- Classify equipment/photo issues only as a suggestion with confidence and human confirmation.
- Suggest route/schedule changes from real road and stop data; the route solver remains deterministic.

Avoid:

- LLM-only chemical dosing, safety limits, route calculation, invoice totals, payment status, permission decisions, or account deletion.
- Sending gate codes, full addresses, customer identity, precise GPS, or unnecessary photos to a model.
- Auto-sending generated customer messages without review during the first release.

AI safety requirements:

- Opt-in per business; provider contract forbids training on customer data.
- Minimize/redact payloads and log model, prompt version, source record IDs, output, reviewer, and final action.
- Show “suggestion, verify before use”; store feedback and allow disable/delete.
- Budget, rate, timeout, and offline fallbacks must never block core logging.

## K. 30/60/90 day roadmap

### First 30 days: safety and truth

- Tenant-scope every device/cloud record and centralize authorization.
- Fix delete/export/logout/retention across all tables, photos, backups, drafts, and local billing keys.
- Replace default-good chemistry with explicit values/not-tested and add stop outcome/reason codes.
- Remove or clearly disable fake route optimization and fake local payment/send behavior.
- Repair analytics opt-out and Sentry privacy; update privacy manifest/policy/permission copy.
- Make the current Chromium E2E suite green and add two-user isolation, delete, and stop-integrity gates.
- Decide Apple subscription model; install/select Xcode and prove archive + TestFlight launch.

Exit gate: safe for a single owner to pilot with real data on one iPhone, with backups and rollback, but not yet multi-tech general release.

### Days 31-60: field reliability

- Ship tenant-aware two-way sync with tombstones, pull cursor, conflict handling, and photo outbox.
- Build real dated stops/routes/schedules and integrate real geocoding/road times.
- Redesign the stop flow for one-hand use and add exception handling, integrated dosages, tasks, and inventory shortage.
- Expand customer/site/pool/equipment history and recurring maintenance.
- Add background proof reports, on-my-way/complete notifications, and owner dispatch status.
- Complete iPhone/iPad/landscape/VoiceOver/Dynamic Type/offline device matrix.

Exit gate: two technicians can work the same business across devices, offline and online, without data leakage, duplication, or silent loss.

### Days 61-90: business value and differentiation

- Add QuickBooks sync and provider-hosted physical-service invoices/payment status.
- Add profit/chemical/route/missed-stop/equipment reports and an owner dashboard.
- Add customer report portal and quote approval/issue follow-up.
- Add opt-in AI history summaries, report drafts, and repeated-issue suggestions.
- Finish App Store metadata, nutrition labels, review notes/account, screenshots, release monitoring, incident/rollback runbook, and staged TestFlight rollout.

Exit gate: App Store submission candidate with 30-day pilot evidence, zero P0 issues, stable sync telemetry, and documented data/privacy/payment behavior.

## L. Ordered implementation tasks for TERRA

### Task 1: Lock the baseline and data inventory

**Files:** create `docs/data-inventory.md`, update `ARCHITECTURE.md`, create `docs/release-evidence/`; verify all storage keys/tables/providers.

- [ ] Record current dirty files and preserve user work.
- [ ] Inventory each localStorage key, IndexedDB table, Convex table, storage object, third-party recipient, retention rule, export path, deletion path, and owner.
- [ ] Define P0 acceptance tests before implementation.

**Pass:** every data type in the app maps to tenant, sensitivity, storage, sync, export, deletion, and disclosure.

### Task 2: Centralize tenant identity and authorization

**Files:** create `src/data/tenantContext.ts`, `convex/authorization.ts`; modify `convex/schema.ts`, all Convex entity modules, `src/api/dexieHooks.ts`, `src/db/chemcheck-db.ts`.

- [ ] Add required business ownership/membership to every business record.
- [ ] Backfill safely, then fail closed when business context is absent.
- [ ] Replace owner-email comparisons with shared membership/role checks.

**Pass:** owner/admin/tech/viewer authorization matrix tests; User A cannot list/read/update/delete User B data in cloud or local cache.

### Task 3: Scope and sanitize device storage

**Files:** `src/db/chemcheck-db.ts`, `src/lib/userManager.ts`, `src/lib/backup.ts`, `src/lib/gdpr.ts`, photo storage, drafts/timers/work-order storage.

- [ ] Use per-user/business namespaces or DBs.
- [ ] Remove sensitive full records from localStorage.
- [ ] Mask gate codes and exclude them from logs, analytics, reports, and replay.
- [ ] Purge/lock tenant cache, photos, queue, backups, drafts, timers, and credentials on logout/delete.

**Pass:** a second user on the same device sees zero first-user data; a storage inspection after delete finds no first-user payload.

### Task 4: Build the durable sync protocol

**Files:** `src/lib/sync/*`, `convex/sync.ts`, entity repositories, schema sync metadata.

- [ ] IndexedDB outbox, stable UUIDs, idempotency keys, versions, tombstones, pull cursor, retry/dead-letter states.
- [ ] Push then pull on reconnect; conflict UI for unsafe merges.
- [ ] Never drop overflow or max-retry work silently.

**Pass:** automated offline create/edit/delete/photo tests across two devices; reconnect converges; app restart does not lose pending work; forced conflict is visible and recoverable.

### Task 5: Make export, erasure, and retention complete

**Files:** `src/lib/gdpr.ts`, `convex/account.ts`, every entity/storage service, privacy UI.

- [ ] Drive export/delete from the Task 1 inventory.
- [ ] Include work orders, quotes, invoices, communications, photos/GPS, reports, audit data, settings, memberships, backups, drafts, and payment references.
- [ ] Add expiring export access and scheduled export-file deletion.
- [ ] Show truthful pending/completed/failed deletion status.

**Pass:** seeded full-account fixture exports every record, deletes every record/object on cloud and device, and a re-login proves zero recovery.

### Task 6: Fix stop data integrity and workflow model

**Files:** `convex/schema.ts`, `src/pages/NewServiceLog.jsx`, validation modules, new stop/reading/dosage repositories.

- [ ] Add dated stop, assignment, outcome/reason, tasks, readings, dosages, issues, and version fields.
- [ ] Remove default `good`; support numeric or `not tested`; derive status.
- [ ] Scope drafts/timers and add expiry/resume/abandon.
- [ ] Integrate actual chemicals used into the stop.

**Pass:** no stop can be completed with untouched fake readings; exception stops require reason; stale timers cannot exceed policy without a resume prompt.

### Task 7: Replace fake routing

**Files:** `src/pages/RouteOptimizer.jsx`, `src/lib/routeOptimizer.ts`, route repositories/schema.

- [ ] Use validated geocoding and a road travel-time matrix.
- [ ] Add address correction, start/end, service times, time windows, tech assignment, and solver source/assumptions.
- [ ] If the provider is unavailable, preserve manual order and label it unoptimized.

**Pass:** known-address fixture matches provider coordinates/road time tolerance; invalid addresses block optimization; no LA fallback or hash coordinate remains.

### Task 8: Make proof photos reliable and private

**Files:** `src/components/proof-of-service/*`, `src/lib/proof-of-service/*`, `convex/servicePhotos.ts`, account deletion/export.

- [ ] Ask for location only after an in-app explanation and only when business policy requires it.
- [ ] Tenant-scope photos, background upload, retries, checksum, thumbnails, retention, and deletion.
- [ ] Make report sending wait for required photos or clearly show pending attachment delivery.

**Pass:** capture offline, kill app, relaunch, reconnect, upload once, report includes correct photos; logout/delete removes local and cloud copies.

### Task 9: Unify work orders, quotes, invoices, and communications

**Files:** split `src/pages/WorkOrders.jsx`; modify `convex/workOrders.ts`, `quotes.ts`, `invoices.ts`, `communications.ts`, `payments.ts`.

- [ ] Remove silent local mode and simulated links/statuses.
- [ ] Use explicit offline drafts that sync into one cloud lifecycle.
- [ ] Enforce legal state transitions and immutable event history.
- [ ] Use provider-hosted payment pages and verified/idempotent webhooks.

**Pass:** quote approval -> work order -> completion -> invoice -> payment reconciliation works once under retries; offline cannot claim sent/paid.

### Task 10: Build the fast field UI

**Files:** Home, Clients, Customer detail/cards, New Service Log, shared mobile components.

- [ ] Implement Today/next-stop truth, large controls, guided stop steps, sticky completion, sunlight contrast, gate reveal, and exception actions.
- [ ] Fix count/empty contradictions and day selection.
- [ ] Replace non-semantic click targets and test keyboard/VoiceOver/focus.

**Pass:** five-tech usability run: median normal-stop entry under 60 seconds, no critical task requires two hands, no ambiguous save/sync state.

### Task 11: Normalize customer, pool, equipment, schedule, and route data

**Files:** `convex/schema.ts`, migrations, customer/site/pool/equipment/schedule UI and repositories.

- [ ] Dual-read/backfill existing customer rows into service location and water body.
- [ ] Add multiple pools/spas, equipment, maintenance intervals, and recurring schedules.
- [ ] Preserve existing reports and history during migration.

**Pass:** one customer can have multiple sites/water bodies; history and reports attach to the correct one; rollback is documented.

### Task 12: Finish team operations

**Files:** business/team settings, route/stop assignment, authorization, audit events.

- [ ] Invite, accept, deactivate, role change, assignment, reassignment, and technician-limited views.
- [ ] Owner sees route progress and exceptions without exposing unrelated sensitive customer fields.

**Pass:** two-tech concurrent route test and complete RBAC matrix pass.

### Task 13: Reporting and integrations

**Files:** reporting modules, QuickBooks connector, payment provider integration.

- [ ] Ship missed/exception stops, service compliance, chemical usage/cost, pool trends, route time/miles, technician workload, AR status, and customer profitability.
- [ ] Reconcile external accounting IDs/statuses and expose sync errors.

**Pass:** each KPI has a written formula, source fields, date/timezone rules, fixture result, and drill-down to source records.

### Task 14: App Store privacy, payments, and native verification

**Files:** `Info.plist`, `PrivacyInfo.xcprivacy`, Capacitor config, policies, support/review docs, StoreKit or companion-access implementation.

- [ ] Select full Xcode; sync/build/run/archive/upload/TestFlight.
- [ ] Correct permissions/privacy manifest/App Store labels and third-party SDK disclosures.
- [ ] Decide and implement Apple-compliant SaaS subscription access.
- [ ] Verify Clerk, Stripe/service invoices, reports, maps, support/policy links, push, camera, photo picker, and location on device.

**Pass:** clean archive, App Store validation, TestFlight launch, account create/delete, reviewer account, complete metadata/privacy questionnaire, and no unexplained permission prompt.

### Task 15: Add limited AI after foundations pass

**Files:** new server-side AI boundary, consent/settings, audit records, eval fixtures.

- [ ] Start with history summary and customer-report draft only.
- [ ] Redact/minimize, cite source visits, require approval, and provide deterministic fallback.
- [ ] Add evaluation for hallucination, unsafe chemistry, PII leakage, latency, and cost.

**Pass:** zero autonomous dosing/payment/permission actions; every output is attributable, reviewable, deletable, and non-blocking.

### Task 16: Final release gate

- [ ] Unit, integration, E2E, WebKit, native-device, offline, two-user, two-tech, deletion/export, payment webhook, accessibility, performance, and security gates all pass.
- [ ] Run a 30-day staged pilot with backups, sync/error dashboards, incident response, and rollback.
- [ ] Submit only with zero open P0s and signed owner acceptance of every `Unknown` item.

**Final evidence required:** exact commit/tag, test logs, App Store archive/upload result, TestFlight build, device matrix, privacy data map, account-delete proof, pilot metrics, known-risk register, and rollback instructions.
