# ChemCheck iOS Gameday Launch Checklist

This checklist is tailored to the current codebase and release path for App Store review.

## 1) Blockers (must pass before submission)

- [ ] **Disable auth bypass for production builds**
  - Current bypass flags are read in `/Users/jakedominick/Documents/CODING PROJECTS/chemcheck-main/src/components/auth/ClerkAuthProvider.jsx`.
  - Ensure `VITE_IOS_SIM_AUTH_BYPASS=false` in production.
  - Confirm localhost bypass logic is not reachable in production hosts.

- [ ] **Clerk domain/origin configuration is valid for production app origin**
  - The app currently uses `VITE_CLERK_PROXY_URL` and `VITE_CLERK_DOMAIN`.
  - In Clerk dashboard, set:
    - Allowed Origins (web and any embedded web origin used by iOS WebView)
    - Allowed Redirect URLs
    - Frontend API / proxy domain values matching production config.
  - Verify no `Invalid HTTP Origin header` errors on production URL.

- [ ] **Account deletion is fully functional and user-visible**
  - UI entrypoint: `/Users/jakedominick/Documents/CODING PROJECTS/chemcheck-main/src/pages/Settings.jsx` -> Account -> Delete Account.
  - Backend deletion mutation: `/Users/jakedominick/Documents/CODING PROJECTS/chemcheck-main/convex/account.ts`.
  - Identity deletion: Clerk `user.delete()` in Settings account flow.
  - Validate deletion end-to-end with a real account (not bypass mode).

- [ ] **Privacy links and policy content are live and accurate**
  - Verify `/privacy-policy.html` and `/terms-of-service.html` are accessible and reflect:
    - account deletion behavior
    - data retention
    - cloud + local storage behavior.

## 2) High Priority (strongly recommended pre-submit)

- [ ] **Proof-of-service history filters regression tested**
  - E2E coverage added in `/Users/jakedominick/Documents/CODING PROJECTS/chemcheck-main/e2e/gameday.spec.ts`.
  - Unit regression coverage:
    - `/Users/jakedominick/Documents/CODING PROJECTS/chemcheck-main/src/pages/History.test.jsx`
    - `/Users/jakedominick/Documents/CODING PROJECTS/chemcheck-main/src/components/history/CustomerHistoryCard.test.jsx`

- [ ] **Settings page is production-clean (no placeholder copy)**
  - Placeholder text now hidden unless `VITE_SHOW_PLACEHOLDERS=true` or dev mode.
  - File: `/Users/jakedominick/Documents/CODING PROJECTS/chemcheck-main/src/pages/Settings.jsx`.

- [ ] **Convex data deletion integrity validation**
  - Run manual validation for each deleted domain:
    - customers, serviceLogs, servicePhotos/storage, chemicalUsage, notes, saltCellLogs, serviceReports, reportAccessLogs, team_members, businesses, subscriptions.
  - Confirm no orphaned storage files remain for deleted photos.

- [ ] **iOS permissions and denial paths**
  - Validate camera/location deny flows for proof-of-service and photo capture.
  - Ensure user-facing error messaging is clear and non-blocking.

## 3) iOS Review Readiness Checks

- [ ] **Reviewer account available**
  - Provide App Review notes with test credentials and exact steps to:
    - log in
    - create data
    - delete account.

- [ ] **In-app purchase/subscription consistency**
  - If subscriptions are active, ensure pricing/entitlements match App Store metadata.
  - Validate access gating and cancellation messaging.

- [ ] **Offline and reconnect behavior**
  - Verify that settings save, logs, and sync status behave correctly in airplane mode and after reconnect.

- [ ] **No dead-end screens**
  - Validate all top-level nav destinations from sidebar on iPhone viewport.

## 4) Pre-Submission Command Gate

Run these from `/Users/jakedominick/Documents/CODING PROJECTS/chemcheck-main`:

```bash
npx vitest run src/pages/History.test.jsx src/components/history/CustomerHistoryCard.test.jsx
npx playwright test e2e/gameday.spec.ts --project=chromium
npm run build
```

## 5) Release Day Rollback Plan

- [ ] Tag release candidate commit.
- [ ] Keep previous TestFlight build active until smoke tests pass.
- [ ] Monitor:
  - auth failures
  - account deletion failures
  - history page runtime errors
  - sync errors.

## 6) Ownership Matrix

- Product: final go/no-go and App Review notes.
- Engineering: checklist execution + evidence capture.
- Support: prepared macro for account deletion and privacy requests.

## 7) Audit Findings (February 10, 2026)

- [x] **History filter crash fixed and verified**
  - `Has Photos` and `Complete Proof` no longer route users into error boundary.
  - Verified with `e2e/gameday.spec.ts` on Chromium and Mobile Safari.

- [x] **iOS runtime crash on Settings fixed**
  - Root cause: direct `Notification` global access on WebKit environments where it is unavailable.
  - Fixed in `/Users/jakedominick/Documents/CODING PROJECTS/chemcheck-main/src/lib/notifications.ts`.

- [x] **iOS permission strings added**
  - Added camera/photo/location usage descriptions to `/Users/jakedominick/Documents/CODING PROJECTS/chemcheck-main/ios/App/App/Info.plist`.
  - Confirmed plist validity with `plutil -lint`.

- [ ] **Email preview parity still needs final cleanup**
  - Frontend preview logic and backend send logic are now much closer, but parity tests still fail.
  - Files:
    - `/Users/jakedominick/Documents/CODING PROJECTS/chemcheck-main/src/lib/emailPreview.ts`
    - `/Users/jakedominick/Documents/CODING PROJECTS/chemcheck-main/convex/serviceReports.ts`

- [ ] **Known unfinished/placeholder product behavior**
  - Route optimizer is still manual fallback and explicitly says AI optimization is not implemented:
    - `/Users/jakedominick/Documents/CODING PROJECTS/chemcheck-main/src/pages/RouteOptimizer.jsx`
  - Customer report/SMS preview still uses hardcoded business name and a preview token in one path:
    - `/Users/jakedominick/Documents/CODING PROJECTS/chemcheck-main/src/pages/CustomerDetail.jsx`
  - Stripe payment-failed webhook path logs only (no user notification action):
    - `/Users/jakedominick/Documents/CODING PROJECTS/chemcheck-main/convex/stripeWebhook.ts`

- [ ] **Automation quality gate still red**
  - Lint now ignores generated iOS build artifacts, but there are still many real lint errors across app/test/config files.
  - Ignore improvements added in `/Users/jakedominick/Documents/CODING PROJECTS/chemcheck-main/eslint.config.js`.
