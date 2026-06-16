# ChemCheck iOS Gameday Launch Checklist

Audit date: 2026-06-15
Source checkout: `/Users/jakedom/Documents/chemcheck-main`
Parked iOS branch: `app-store-ios-shell`

This checklist keeps the PWA as the active shipping product while preserving the Capacitor iOS shell for a future App Store submission.

## Current Verified State

- [x] PWA readiness gates pass: `npm run test:gates` reported 13/13 passing tests.
- [x] Lint passes: `npm run lint`.
- [x] Production build passes on Vite 8.0.16 with the stale Browserslist warning cleared.
- [x] Security audit is clean at the high threshold: `npm audit --audit-level=high` reported 0 vulnerabilities.
- [x] Unit/integration suite passes: `npm test -- --reporter=dot` reported 87 files and 860 tests passing.
- [x] Chromium E2E passes on an isolated ChemCheck server: `PLAYWRIGHT_PORT=5174 npm run test:e2e -- --project=chromium` reported 31/31 passing tests.
- [x] Capacitor sync passes: `npm run ios:sync`.
- [x] Native plist syntax passes: `plutil -lint ios/App/App/Info.plist ios/App/App/PrivacyInfo.xcprivacy`.
- [x] Native iOS pricing route does not expose Stripe checkout actions.
- [x] Native iOS billing dashboard does not expose Stripe portal or cancellation actions.
- [x] Native App-Bound Domains are restricted to known production WebView navigation hosts.
- [x] Privacy manifest uses Apple required-reason API category names and the app-only UserDefaults reason code.

## Local Native Blockers

- [ ] Install and select full Xcode.
  - Current blocker: `xcode-select` points at `/Library/Developer/CommandLineTools`.
  - `xcodebuild -list -project ios/App/App.xcodeproj` cannot run until full Xcode is installed and selected.
  - Expected fix: `sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer`.

- [ ] Open the project in Xcode and configure signing.
  - Bundle ID: `com.chemcheck.app`.
  - Set the Apple Developer Team that owns the App Store Connect app.
  - Confirm `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION`.
  - Create or select the App Store Connect app record before archiving.

- [ ] Run simulator smoke tests from the native shell.
  - Command after Xcode is active: `npm run ios:sim`.
  - Verify launch, auth, core navigation, service log creation, camera/photo permission prompts, offline queue behavior, logout, and account deletion entrypoint.

- [ ] Create a TestFlight archive.
  - Command after signing is configured: `npm run ios:archive`.
  - Upload through Xcode Organizer.
  - Smoke test the TestFlight build on a physical iPhone.

## App Review Readiness

- [x] Replace broad App-Bound Domains before submission.
  - Current `WKAppBoundDomains`: `clerk.chemcheck.xyz`, `challenges.cloudflare.com`.
  - Keep only domains the iOS WebView must navigate to.
  - `VITE_CONVEX_URL` still needs the exact production Convex API host in the release environment, but Convex API fetches should not require a broad WebView navigation domain.

- [x] Use Apple-valid required-reason API categories in the privacy manifest.
  - Current `NSPrivacyAccessedAPITypes`: `NSPrivacyAccessedAPICategoryUserDefaults` with reason `CA92.1`.
  - Keep `Info.plist` permission strings aligned with camera, photo library, location, and Face ID usage.
  - Final App Store Connect/Xcode upload validation is still required.

- [ ] Complete App Store Connect App Privacy answers.
  - Cover account identifiers, email, phone, customer data, service logs, service photos, location/directions, diagnostics, auth providers, billing providers, and server logs.
  - Make the answers consistent with `public/privacy-policy.html` and `ios/App/App/PrivacyInfo.xcprivacy`.

- [ ] Provide a reviewer account.
  - Create a dedicated Clerk/App account for Apple review.
  - Put the password only in App Store Connect review notes, not in Git.
  - Include steps from `docs/app-store-review-notes.md`.

- [ ] Confirm in-app account deletion with a real account.
  - The user must be able to initiate account deletion inside the iOS app.
  - Validate deletion outside bypass/dev mode.
  - Document any legally required retention exceptions in the privacy policy.

- [x] Gate iOS billing behavior.
  - The native iOS pricing page no longer exposes Stripe checkout actions.
  - The native iOS billing dashboard no longer exposes Stripe portal or cancellation actions.
  - PWA/web pricing and billing behavior remains unchanged.
  - Final App Store Connect notes should classify the iOS app as existing-account/field-operations access unless Apple In-App Purchase is added later.

- [ ] Decide Sign in with Apple.
  - If Clerk exposes Google, Facebook, or another third-party/social sign-in in the iOS build, add Sign in with Apple or remove those providers for iOS review.

- [ ] Confirm all links and support endpoints.
  - Privacy policy URL.
  - Terms URL.
  - Support URL or email.
  - Any contact or delete-account support path referenced from the app.

## Release Command Gate

Run from `/Users/jakedom/Documents/chemcheck-main` before creating a release candidate:

```bash
scripts/app-store-preflight.sh --pre-xcode
```

Then run after full Xcode is installed:

```bash
scripts/app-store-preflight.sh --full
npm run ios:sim
npm run ios:archive
```

## Parking Plan

- [ ] Keep normal PWA work shipping from `main`.
- [ ] Keep App Store shell work isolated on `app-store-ios-shell`.
- [ ] After a clean Xcode/TestFlight pass, commit the iOS shell artifacts and tag the release candidate, for example `ios-rc-0.1.0`.
- [ ] Do not submit to App Review until the native blockers, App Store Connect metadata, reviewer account, production environment values, and privacy answers are complete.

## Monitor On TestFlight

- Auth errors, especially Clerk domain/origin failures.
- Account deletion failures.
- Camera/photo permission denial flows.
- Offline queue and reconnect failures.
- Service report sending failures.
- Crash reports and startup blank-screen reports.
