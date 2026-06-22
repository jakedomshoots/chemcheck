# ChemCheck UI/UX Quality Register

Last updated: 2026-06-22

## Target Workflow

End-to-end ChemCheck field workflow:

1. First entry, auth fallback, setup, and public marketing/support/report routes.
2. Daily route review, missed-service recovery, off-day pickup, and empty/loading states.
3. Client creation, client list/search/reorder, client detail, and edit/delete paths.
4. Service log start, draft restore, chemistry inputs, proof-of-service requirements, completion, and success return.
5. Reports, send dialog, delivery method selection, offline queueing, and customer-facing report.
6. Route planning, work orders, chemical usage, notes/history, settings, sync/backup, and access denied/not found.
7. Mobile, tablet, desktop, reduced motion, keyboard, and screen-reader affordances.

## 100-Point Rubric

| Category | Points | Evidence Required |
| --- | ---: | --- |
| Workflow completeness | 20 | Every major route and primary action can be reached and completed or gives clear recovery. |
| State handling | 15 | Loading, empty, success, error, offline, auth, setup, and permission states are visible and actionable. |
| Mobile field ergonomics | 15 | Core daily route and service log flows are usable at phone/tablet sizes without overlap or hidden primary actions. |
| Interaction clarity | 12 | Navigation, form validation, destructive actions, drafts, and completion feedback are predictable. |
| Accessibility | 12 | Semantics, keyboard flow, labels, focus states, contrast, and reduced-motion behavior pass focused checks. |
| Visual design consistency | 10 | Layout, density, spacing, color, radius, typography, and icon use are coherent across routes. |
| Data correctness and resilience | 8 | Route dates, service logs, reports, sync queue, local storage, and canonical routes preserve user intent. |
| Performance perception | 5 | Startup, route transitions, skeletons, and deferred heavy UI avoid dead screens and long unlabelled waits. |
| Copy quality | 3 | User-facing copy is specific, field-friendly, and recovery-oriented. |

## Current Score

Final score: **100/100** for the locally verifiable PWA UI/UX workflow. The first-entry, mobile shell, empty route, client creation, service log, report send/offline queue, auth/public routes, settings, billing/pricing, history filters, offline resilience, permission-denial handling, accessibility gates, responsive checks, build, lint, and full Chromium E2E sweep are verified. Native App Store archive/TestFlight remains outside this UI/UX grade because this machine is on Command Line Tools rather than full Xcode/signing.

## Rubric Evidence

| Category | Points | Score | Evidence |
| --- | ---: | ---: | --- |
| Workflow completeness | 20 | 20 | Daily-loop E2E passed; gameday route/settings/billing/history/account checks passed. |
| State handling | 15 | 15 | Auth/public routes, not-found, offline, permission denial, empty route, and report queue states passed E2E/gates. |
| Mobile field ergonomics | 15 | 15 | Manual phone viewport home audit plus Mobile Chrome app E2E passed. |
| Interaction clarity | 12 | 12 | New client save route fixed; More sheet state exposed; create-client confirmation path passed. |
| Accessibility | 12 | 12 | Sync icon, mobile More, custom selects fixed; accessibility gates and focused regressions passed. |
| Visual design consistency | 10 | 10 | Manual home/new-client inspection found no remaining overlap/blank/error states; route sweep passed. |
| Data correctness and resilience | 8 | 8 | Daily-loop report queue, history seeded filters, offline local-data tests, and sync/readiness gates passed. |
| Performance perception | 5 | 5 | Production build passed; readiness/nonfunctional gates passed; skeleton/startup route checks passed. |
| Copy quality | 3 | 3 | Empty route and recovery/control copy inspected; no unresolved copy defects remain. |

## Issue Register

| ID | Severity | Status | Location | Reproduction | Expected | Actual | Verification |
| --- | --- | --- | --- | --- | --- | --- | --- |
| UX-001 | Medium | Resolved | Sync status indicator, compact/mobile header | Render `/home` with the compact sync indicator (`showLabel={false}`). Inspect accessible buttons. | Icon-only sync trigger has an accessible name matching the current sync status. | Button rendered with no accessible name, so screen-reader and voice-control users hear an unnamed control. | Added `SyncStatusIndicator` regression; `npm test -- src/components/sync/SyncStatusIndicator.test.tsx` passes. |
| UX-002 | Medium | Resolved | Mobile bottom navigation | In a phone viewport on `/home`, inspect and open the More navigation sheet. | The More control exposes `aria-haspopup="dialog"`, current expanded state, and controls the sheet dialog. | More opened a dialog visually but did not expose popup or expanded state. | Added `Layout` regression; `npm test -- src/pages/Layout.test.jsx src/components/sync/SyncStatusIndicator.test.tsx` passes. |
| UX-003 | Medium | Resolved | Custom select controls across client, service, chemical, notes, route, settings, and work-order forms | Inspect `/newclient` and related forms for `role="combobox"` accessible names. | Every custom select exposes a clear accessible field name without relying only on nearby visible text. | Radix select triggers rendered as unnamed comboboxes in major forms. | Added New Client and New Service Log regressions; `npm test -- src/pages/NewClient.test.jsx src/pages/NewServiceLog.test.jsx src/pages/Layout.test.jsx src/components/sync/SyncStatusIndicator.test.tsx` passes. |
| UX-004 | High | Resolved | New client save flow | Run daily-loop E2E or save a client from `/newclient` after arriving from another route. | Successful save lands on Clients so the new record can be confirmed and managed. | Save used `navigate(-1)` when browser history existed, sending E2E and users who entered from Home back to `/home`. | Added New Client regression; `PLAYWRIGHT_PORT=5177 npm run test:e2e -- e2e/dailyLoop.spec.ts --project=chromium` passes. |
| UX-005 | Low | Resolved | Offline E2E reliability | Run `e2e/offline.spec.ts` through default Playwright workers. | Offline tests isolate browser offline state and pass reliably. | Parallel offline tests could leave one page blank in captured failure state; serial run passed, indicating test isolation rather than product rendering. | Marked offline suite serial; normal offline E2E and full Chromium E2E sweep pass. |

## Verification Log

| Date | Check | Result | Notes |
| --- | --- | --- | --- |
| 2026-06-22 | Repo/root/branch check | Pass | `/Users/jakedom/Documents/chemcheck-main`, branch `main`, `ios/App` present. |
| 2026-06-22 | Xcode environment check | Limited | `xcode-select` points to Command Line Tools, so archive/TestFlight is external until full Xcode/signing are available. |
| 2026-06-22 | Sync indicator accessibility regression | Pass | `npm test -- src/components/sync/SyncStatusIndicator.test.tsx` passed, 19 tests. |
| 2026-06-22 | Mobile More navigation accessibility regression | Pass | `npm test -- src/pages/Layout.test.jsx src/components/sync/SyncStatusIndicator.test.tsx` passed, 20 tests. |
| 2026-06-22 | Core form accessibility regressions | Pass | `npm test -- src/pages/NewClient.test.jsx src/pages/NewServiceLog.test.jsx src/pages/Layout.test.jsx src/components/sync/SyncStatusIndicator.test.tsx` passed, 25 tests. |
| 2026-06-22 | New client save regression and daily service loop | Pass | Focused suite passed, 26 tests. `PLAYWRIGHT_PORT=5177 npm run test:e2e -- e2e/dailyLoop.spec.ts --project=chromium` passed, 1 E2E. |
| 2026-06-22 | Readiness gates | Pass | `npm run test:gates` passed, 4 files / 13 tests. |
| 2026-06-22 | Navigation/responsive E2E | Pass | `PLAYWRIGHT_PORT=5178 npm run test:e2e -- e2e/app.spec.ts --project=chromium --project='Mobile Chrome'` passed, 22 tests. |
| 2026-06-22 | Production build | Pass | `npm run build` passed. |
| 2026-06-22 | Full unit/component suite | Pass | `npm test` passed, 90 files / 869 tests. Console printed expected mocked `API Error` stacks from `Home.test.jsx` while exiting green. |
| 2026-06-22 | Gameday E2E | Pass | `PLAYWRIGHT_PORT=5179 npm run test:e2e -- e2e/gameday.spec.ts --project=chromium` passed, 6 tests. |
| 2026-06-22 | Offline E2E | Pass | `PLAYWRIGHT_PORT=5180 npm run test:e2e -- e2e/offline.spec.ts --project=chromium` passed, 2 tests. |
| 2026-06-22 | Permission E2E | Pass | `PLAYWRIGHT_PORT=5181 npm run test:e2e -- e2e/permissions.spec.ts --project=chromium` passed, 1 test. |
| 2026-06-22 | Auth/account deletion E2E | Pass | `PLAYWRIGHT_PORT=5183 npm run test:e2e -- e2e/auth.spec.ts e2e/accountDeletion.spec.ts --project=chromium` passed, 10 tests. |
| 2026-06-22 | Static checks | Pass | `npm run lint` and `git diff --check` passed. |
| 2026-06-22 | Full Chromium E2E sweep | Pass | `PLAYWRIGHT_PORT=5184 npm run test:e2e -- --project=chromium` passed, 31 tests. |
