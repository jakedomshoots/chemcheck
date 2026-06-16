# ChemCheck App Store Launch Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the current ChemCheck PWA as the active shipping product while preparing a parked iOS/App Store-ready version that can be resumed, built, and submitted later.

**Architecture:** ChemCheck remains a Vite/React PWA backed by Convex and Clerk. The App Store track uses the existing Capacitor iOS shell under `ios/App`, with native-only configuration isolated in Capacitor/Xcode files and release docs. The parked iOS track should live on a dedicated branch/tag until the business decision to submit is made.

**Tech Stack:** Vite, React, Convex, Clerk, Capacitor 8, Xcode/iOS, Playwright, Vitest, App Store Connect.

---

## Current Audit Snapshot

Audit date: 2026-06-15.

Audited source checkout: `/Users/jakedom/Documents/chemcheck-main`.

The Codex-provided cwd `/Users/jakedom/.codex/worktrees/cbe4/chemcheck-main` is not the real source checkout at the moment. It was empty before this audit and is not a Git repository. Do not use it for App Store implementation work.

Current source state:

- Branch: `app-store-ios-shell`.
- Remote: `https://github.com/jakedomshoots/chemcheck.git`.
- Worktree: dirty, with staged and unstaged changes across app, Convex, tests, package files, docs, and native iOS shell files.
- `ios/`, `docs/IOS_SHELL_SETUP.md`, `assets/`, `scripts/ios-archive.sh`, and several E2E files are still untracked until the parked iOS branch is committed.
- `capacitor.config.json`, `package.json`, `package-lock.json`, `playwright.config.ts`, `vite.config.js`, and E2E tests are tracked and modified for the iOS/PWA readiness pass.

Latest verification run during implementation:

- `npm run test:gates`: passed, 13/13 tests.
- `npm run lint`: passed.
- `npm run build`: passed on Vite 8.0.16 without the stale Browserslist warning.
- `plutil -lint ios/App/App/Info.plist ios/App/App/PrivacyInfo.xcprivacy`: passed.
- `npm audit --audit-level=high`: passed with 0 vulnerabilities after dependency updates and targeted overrides for transitive `esbuild` and `ws`.
- `npm test -- --reporter=dot`: passed, 87 test files and 860 tests.
- `PLAYWRIGHT_PORT=5174 npm run test:e2e -- --project=chromium`: passed, 31/31 tests, isolated from stale servers on port 5173.
- `npm run ios:sync`: passed and copied the web build into `ios/App/App/public`.
- `xcodebuild -list -project ios/App/App.xcodeproj`: blocked because `xcode-select` points at `/Library/Developer/CommandLineTools`, not full Xcode.

Current App Store blockers:

- Full Xcode is not installed/selected locally, so simulator/archive/TestFlight validation cannot be completed on this machine yet.
- The exact production Convex API URL is not present in local `.env*` files and must be set in the release environment.
- `PrivacyInfo.xcprivacy` now uses Apple required-reason API category names, but final Xcode/App Store Connect upload validation is still required.
- Native iOS Stripe checkout and billing portal actions are gated off while the PWA pricing/billing path remains unchanged.
- App Store Connect metadata, reviewer account, production environment values, Sign in with Apple decision, and App Privacy answers are still product/account setup tasks.

Apple rules checked against official current docs:

- App Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
- App Review preparation requirements: https://developer.apple.com/distribute/app-review/
- Account deletion requirement: https://developer.apple.com/support/offering-account-deletion-in-your-app/
- App privacy details: https://developer.apple.com/app-store/app-privacy-details/
- Privacy manifests: https://developer.apple.com/documentation/bundleresources/privacy-manifest-files
- Required reason APIs: https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api
- App-Bound Domains: https://developer.apple.com/documentation/webkit/wkwebviewconfiguration/limitsnavigationstoappbounddomains

## File Structure

Files to create:

- `docs/app-store-release-runbook.md`: short operational checklist for build, archive, upload, TestFlight, and parked-release restore.
- `docs/app-store-review-notes.md`: App Review notes, reviewer account instructions, privacy/support/account deletion evidence.
- `docs/superpowers/plans/2026-06-15-app-store-launch-readiness.md`: this implementation plan.

Files to modify:

- `playwright.config.ts`: move E2E to an isolated port and stop reusing unrelated local servers.
- `src/lib/routeConfig.test.ts`: update `/history` expectation now that History is a canonical route.
- `docs/IOS_GAMEDAY_LAUNCH_CHECKLIST.md`: refresh stale absolute paths, stale date, and current blocker list.
- `docs/IOS_SHELL_SETUP.md`: keep as the native-shell setup doc, then track it in Git.
- `package.json`: keep iOS scripts, add deterministic E2E script if needed, and update vulnerable dependencies.
- `package-lock.json`: update after dependency remediation.
- `capacitor.config.json`: verify App-Bound Domains and native plugin settings.
- `ios/App/App/Info.plist`: finalize permission strings, exact App-Bound Domains, supported orientation/device policy, and review-facing usage reasons.
- `ios/App/App/PrivacyInfo.xcprivacy`: align privacy manifest with Apple required reason API and App Privacy answers.
- `ios/App/App.xcodeproj/project.pbxproj`: set signing team, version/build, deployment target, bundle identifier, and release configuration.
- `scripts/ios-sim-run.sh`: keep simulator build path stable after Xcode setup.
- `scripts/ios-archive.sh`: make archive/upload instructions accurate once signing is configured.

Files to verify but not necessarily modify:

- `public/manifest.json`
- `public/privacy-policy.html`
- `public/terms-of-service.html`
- `src/components/auth/RobustAuthGuard.jsx`
- `src/components/auth/RobustLoginPage.jsx`
- `src/components/auth/RobustSignUpPage.jsx`
- `src/components/auth/ConvexAuthProvider.jsx`
- `src/components/auth/PublicConvexProvider.jsx`
- `src/pages/Settings.jsx`
- `src/pages/LandingPage.jsx`
- `src/pages/SupportPage.jsx`
- `src/pages/ProtectedAppRoutes.jsx`
- `e2e/*.spec.ts`
- `e2e/helpers.ts`

## Task 1: Preserve PWA Mainline And Create Parked iOS Track

**Files:**

- Verify: `git status --short`
- Modify later only after review: branch state and Git commits

- [ ] **Step 1: Capture the dirty worktree before changing code**

Run:

```bash
cd /Users/jakedom/Documents/chemcheck-main
git status --short
git diff --stat
git diff --cached --stat
```

Expected: output shows the current dirty state, including untracked `ios/`, `docs/IOS_SHELL_SETUP.md`, `assets/`, and `scripts/ios-archive.sh`.

- [ ] **Step 2: Separate current PWA/product changes from parked iOS work**

Run:

```bash
cd /Users/jakedom/Documents/chemcheck-main
git switch -c app-store-ios-shell
```

Expected: branch changes from `main` to `app-store-ios-shell` without dropping any working tree changes.

- [ ] **Step 3: Commit or stash unrelated current product work before parking iOS**

Run:

```bash
cd /Users/jakedom/Documents/chemcheck-main
git status --short
```

Expected: review each changed file. Keep PWA feature work in its own commit and iOS shell work in a separate commit. Do not mix broad Convex/page rewrites with native shell scaffolding.

- [ ] **Step 4: Park iOS shell artifacts once verified**

Run after Tasks 2 through 8 are green:

```bash
cd /Users/jakedom/Documents/chemcheck-main
git add capacitor.config.json package.json package-lock.json assets docs/IOS_SHELL_SETUP.md docs/app-store-release-runbook.md docs/app-store-review-notes.md ios scripts/ios-archive.sh scripts/ios-sim-run.sh
git commit -m "chore: park App Store iOS shell"
git tag ios-rc-0.1.0
```

Expected: the iOS shell is stored in Git on `app-store-ios-shell` and recoverable by tag. The PWA can continue shipping from `main`.

## Task 2: Make E2E Verification Deterministic

**Files:**

- Modify: `playwright.config.ts`
- Verify: `e2e/*.spec.ts`

- [ ] **Step 1: Replace hardcoded shared port config**

Modify `playwright.config.ts` so Playwright owns an isolated server instead of reusing whatever is already on `localhost:5173`:

```ts
import { defineConfig, devices } from '@playwright/test';

const host = process.env.PLAYWRIGHT_HOST || '127.0.0.1';
const port = Number(process.env.PLAYWRIGHT_PORT || 5174);
const baseURL = `http://${host}:${port}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'Mobile Chrome', use: { ...devices['Pixel 5'] } },
    { name: 'Mobile Safari', use: { ...devices['iPhone 12'] } },
    { name: 'iPad', use: { ...devices['iPad (gen 7)'] } },
    { name: 'offline', use: { ...devices['Desktop Chrome'], offline: true } },
  ],
  webServer: {
    command: `npm run dev -- --host ${host} --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120 * 1000,
  },
});
```

- [ ] **Step 2: Verify the server is ChemCheck, not Janus**

Run:

```bash
cd /Users/jakedom/Documents/chemcheck-main
PLAYWRIGHT_PORT=5174 npm run test:e2e -- --project=chromium e2e/app.spec.ts
```

Expected: failures, if any, reference ChemCheck UI or ChemCheck code. No failure snapshot should show `<title>janus</title>` or Janus HUD/session text.

- [ ] **Step 3: Keep the stale server isolated**

Run:

```bash
lsof -nP -iTCP:5173 -sTCP:LISTEN
curl -s http://localhost:5173/ | sed -n '1,30p'
```

Expected: if port `5173` still serves Janus, leave it alone. ChemCheck E2E should no longer depend on that port.

## Task 3: Restore Unit Test Green

**Files:**

- Modify: `src/lib/routeConfig.test.ts`

- [ ] **Step 1: Update the History route expectation**

Change the compatibility test from:

```ts
expect(getCanonicalRoute('/history')).toBe(APP_ROUTES.Clients);
expect(getCanonicalPageName('/history')).toBe('Clients');
```

to:

```ts
expect(getCanonicalRoute('/history')).toBe(APP_ROUTES.History);
expect(getCanonicalPageName('/history')).toBe('History');
```

- [ ] **Step 2: Run the exact failing test**

Run:

```bash
cd /Users/jakedom/Documents/chemcheck-main
npx vitest run src/lib/routeConfig.test.ts --maxWorkers=1 --maxConcurrency=1
```

Expected: `src/lib/routeConfig.test.ts` passes.

- [ ] **Step 3: Run the full unit suite**

Run:

```bash
cd /Users/jakedom/Documents/chemcheck-main
npm test -- --reporter=dot
```

Expected: all 860 tests pass, or a new failure is documented before moving on.

## Task 4: Re-Baseline PWA Launch Gates

**Files:**

- Verify: `package.json`
- Verify: `public/manifest.json`
- Verify: `public/sw.js`
- Verify: `public/privacy-policy.html`
- Verify: `public/terms-of-service.html`

- [ ] **Step 1: Run the normal PWA gate sequence**

Run:

```bash
cd /Users/jakedom/Documents/chemcheck-main
npm run test:gates
npm run lint
npm run build
npm test -- --reporter=dot
PLAYWRIGHT_PORT=5174 npm run test:e2e -- --project=chromium
```

Expected:

- readiness gates pass
- lint passes
- production build passes
- unit tests pass
- Chromium E2E is testing ChemCheck and has no unrelated stale-server contamination

- [ ] **Step 2: Verify PWA static assets**

Run:

```bash
cd /Users/jakedom/Documents/chemcheck-main
npm run build
python3 -m http.server 5175 -d dist
```

In another terminal:

```bash
curl -i http://127.0.0.1:5175/manifest.json | sed -n '1,20p'
curl -i http://127.0.0.1:5175/sw.js | sed -n '1,20p'
```

Expected: `/manifest.json` returns JSON and `/sw.js` returns JavaScript from ChemCheck's built app.

- [ ] **Step 3: Refresh Browserslist data**

Run:

```bash
cd /Users/jakedom/Documents/chemcheck-main
npx update-browserslist-db@latest
npm run build
```

Expected: build still passes and the stale `caniuse-lite` warning is gone.

## Task 5: Clear Security And Dependency Blockers

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Capture the current audit tree**

Run:

```bash
cd /Users/jakedom/Documents/chemcheck-main
npm audit --audit-level=high
npm ls @clerk/clerk-js @clerk/clerk-react @clerk/shared react-router react-router-dom vite vitest rollup @capacitor/cli @capacitor/assets
```

Expected: audit currently fails. Use the dependency tree to distinguish direct app dependencies from dev-only tool dependencies.

- [ ] **Step 2: Apply safe updates first**

Run:

```bash
cd /Users/jakedom/Documents/chemcheck-main
npm audit fix
npm update @clerk/clerk-js @clerk/clerk-react react-router react-router-dom vite vitest rollup postcss picomatch ws flatted shell-quote @babel/core @xmldom/xmldom lodash
```

Expected: lockfile updates. If npm refuses a package name that is transitive-only, continue and inspect the remaining audit output.

- [ ] **Step 3: Re-run gates after dependency updates**

Run:

```bash
cd /Users/jakedom/Documents/chemcheck-main
npm audit --audit-level=high
npm run test:gates
npm run lint
npm run build
npm test -- --reporter=dot
```

Expected: no high/critical runtime vulnerabilities remain. Any unavoidable dev-tool vulnerability must be documented with package path, runtime exposure, and replacement plan before App Store parking.

- [ ] **Step 4: Decide whether direct `@clerk/clerk-js` is needed**

Run:

```bash
cd /Users/jakedom/Documents/chemcheck-main
rg -n "@clerk/clerk-js|from '(@clerk/clerk-js)'|from \\\"@clerk/clerk-js\\\"" src package.json
npm ls @clerk/clerk-js
```

Expected: if app source only imports `@clerk/clerk-react`, remove unused direct `@clerk/clerk-js` or update it to a non-vulnerable version required by the actual auth flow.

## Task 6: Track And Validate The Native iOS Shell

**Files:**

- Modify: `ios/`
- Modify: `capacitor.config.json`
- Modify: `scripts/ios-sim-run.sh`
- Modify: `scripts/ios-archive.sh`
- Modify: `docs/IOS_SHELL_SETUP.md`

- [ ] **Step 1: Ensure native shell files are tracked**

Run:

```bash
cd /Users/jakedom/Documents/chemcheck-main
git status --short ios docs/IOS_SHELL_SETUP.md assets scripts/ios-archive.sh scripts/ios-sim-run.sh
```

Expected: these files are intentionally added to the `app-store-ios-shell` branch after they pass verification.

- [ ] **Step 2: Sync web assets into Capacitor**

Run:

```bash
cd /Users/jakedom/Documents/chemcheck-main
npm run ios:sync
```

Expected: Vite build passes and Capacitor sync completes without errors.

- [ ] **Step 3: Switch to full Xcode toolchain**

Run on the Mac that will build the archive:

```bash
sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
xcodebuild -version
xcodebuild -list -project ios/App/App.xcodeproj
```

Expected: `xcodebuild` reports full Xcode and lists the `App` scheme.

- [ ] **Step 4: Configure signing**

Open:

```bash
cd /Users/jakedom/Documents/chemcheck-main
npm run ios:open
```

In Xcode:

- Select target `App`.
- Set Bundle Identifier to `com.chemcheck.app`.
- Set Team to the Apple Developer account that owns the App Store Connect app.
- Keep `MARKETING_VERSION = 1.0` only if that is the first public release version.
- Increment `CURRENT_PROJECT_VERSION` for every TestFlight upload.

Expected: simulator builds can run without signing failures, and archive builds can sign for distribution.

## Task 7: Validate WKWebView, Auth, And App-Bound Domains

**Files:**

- Modify: `capacitor.config.json`
- Modify: `ios/App/App/Info.plist`
- Verify: `src/components/auth/RobustLoginPage.jsx`
- Verify: `src/components/auth/RobustSignUpPage.jsx`
- Verify: `src/components/auth/ConvexAuthProvider.jsx`
- Verify: `src/components/auth/PublicConvexProvider.jsx`

- [ ] **Step 1: Confirm real production domains**

Run:

```bash
cd /Users/jakedom/Documents/chemcheck-main
rg -n "VITE_CLERK|VITE_CONVEX|CLERK|CONVEX|chemcheck.xyz|convex.cloud" .env* capacitor.config.json ios/App/App/Info.plist src convex 2>/dev/null
```

Expected: list the exact Clerk frontend/proxy domain, exact Convex deployment host, support/privacy host, and any Cloudflare challenge domain used in production.

- [ ] **Step 2: Replace broad App-Bound Domains with exact production domains**

In `ios/App/App/Info.plist`, keep `WKAppBoundDomains` to exact domains used by the shipped app. Example shape:

```xml
<key>WKAppBoundDomains</key>
<array>
  <string>clerk.chemcheck.xyz</string>
  <string>your-production-convex-host.convex.cloud</string>
  <string>challenges.cloudflare.com</string>
</array>
```

Expected: no wildcard-style assumptions. `capacitor.config.json` `allowNavigation` can be broader for Capacitor routing, but WKAppBoundDomains must match the real production WebView navigation needs.

- [ ] **Step 3: Validate auth in the native shell**

Run after Xcode is active:

```bash
cd /Users/jakedom/Documents/chemcheck-main
npm run ios:sim
```

Expected on simulator:

- launch screen hides
- unauthenticated user reaches login or intended landing route
- signup route renders
- Clerk login completes or fails with a clear configured-domain error
- app resume preserves auth state
- logout clears local authenticated state

- [ ] **Step 4: Decide Sign in with Apple requirement**

Check Clerk configuration and login UI. If the app offers Google, Facebook, or another third-party/social login on iOS, add Sign in with Apple or remove social login from the iOS review build. This maps to App Review Guideline 4.8 in Apple's current App Review Guidelines.

Expected: App Review cannot reject the app for missing Sign in with Apple when third-party sign-in is offered.

## Task 8: Complete Privacy, Account, And Review Compliance

**Files:**

- Modify: `ios/App/App/PrivacyInfo.xcprivacy`
- Modify: `public/privacy-policy.html`
- Modify: `public/terms-of-service.html`
- Modify: `src/pages/Settings.jsx`
- Create: `docs/app-store-review-notes.md`

- [ ] **Step 1: Validate account deletion from inside the app**

Run after deterministic E2E is fixed:

```bash
cd /Users/jakedom/Documents/chemcheck-main
PLAYWRIGHT_PORT=5174 npm run test:e2e -- --project=chromium e2e/accountDeletion.spec.ts
```

Expected: account deletion starts inside the app, deletes the Clerk account or initiates a compliant deletion flow, clears local data, and makes retention exceptions clear.

- [ ] **Step 2: Align privacy policy, privacy manifest, and App Store answers**

Review data categories across:

- account identifiers
- email and phone
- pool/customer data
- service photos
- location/directions
- diagnostics/crash data
- analytics
- billing/subscription data
- Convex server logs
- Clerk authentication data
- Stripe payment data

Expected: `public/privacy-policy.html`, `ios/App/App/PrivacyInfo.xcprivacy`, and App Store Connect App Privacy answers all tell the same story.

- [ ] **Step 3: Audit privacy manifest values against Apple schemas**

Run:

```bash
cd /Users/jakedom/Documents/chemcheck-main
plutil -lint ios/App/App/PrivacyInfo.xcprivacy
plutil -p ios/App/App/PrivacyInfo.xcprivacy
```

Then compare the declared `NSPrivacyAccessedAPITypes` against Apple's required reason API list.

Expected: the manifest contains only valid required-reason API declarations and accurate collected-data declarations. Camera/photo/location permission copy belongs in `Info.plist`; required reason API entries should match Apple's allowed categories.

- [ ] **Step 4: Write App Review notes**

Create `docs/app-store-review-notes.md`:

```markdown
# ChemCheck App Review Notes

## Reviewer Account

- Login URL in app: `/login`
- Test account email: create in Clerk before submission
- Test account password: store outside Git and paste only into App Store Connect review notes

## Review Steps

1. Sign in with the reviewer account.
2. Open Clients and create a customer.
3. Create a service log with chemical readings.
4. Attach or capture a service photo.
5. Open History and confirm the completed service log appears.
6. Open Settings -> Account and start account deletion.

## Privacy And Support

- Privacy policy: production URL for `public/privacy-policy.html`
- Terms: production URL for `public/terms-of-service.html`
- Support: production URL for Support page or support email

## Notes

ChemCheck is a field-service operations app for pool service businesses. It stores customer/service records, optional photos, and account data needed to provide the service.
```

Expected: App Store Connect review notes can be completed without searching the codebase.

## Task 9: Resolve Billing And App Store Business Model Risk

**Files:**

- Verify: `src/components/billing/BillingDashboard.jsx`
- Verify: `src/components/billing/PricingPage.jsx`
- Verify: `STRIPE_SETUP.md`
- Verify: `convex/stripeWebhook.ts`

- [ ] **Step 1: Classify what ChemCheck sells inside iOS**

Run:

```bash
cd /Users/jakedom/Documents/chemcheck-main
rg -n "Stripe|subscription|billing|checkout|pricing|Start Free Trial|Subscribe|payment|invoice" src convex STRIPE_SETUP.md
```

Expected: produce a short decision: ChemCheck either sells digital app access/subscriptions in iOS, sells real-world services, or only lets already-subscribed business users log in.

- [ ] **Step 2: Decide iOS billing behavior**

If the iOS app sells digital subscription access, plan for Apple In-App Purchase before submission. If it only supports existing business accounts or real-world service invoicing, remove or gate any Stripe checkout path that looks like buying app access inside iOS.

Expected: App Review does not reject the build for using Stripe to sell digital app functionality in the iOS app.

- [ ] **Step 3: Test cancellation and entitlement copy**

Run after billing decision:

```bash
cd /Users/jakedom/Documents/chemcheck-main
PLAYWRIGHT_PORT=5174 npm run test:e2e -- --project=chromium e2e/gameday.spec.ts --grep "billing|pricing"
```

Expected: pricing/billing screens match the chosen App Store policy and do not present unsupported purchase flows.

## Task 10: Refresh Launch Docs

**Files:**

- Modify: `docs/IOS_GAMEDAY_LAUNCH_CHECKLIST.md`
- Modify: `docs/IOS_SHELL_SETUP.md`
- Create: `docs/app-store-release-runbook.md`
- Create: `docs/app-store-review-notes.md`

- [ ] **Step 1: Remove stale absolute paths and stale audit date**

In `docs/IOS_GAMEDAY_LAUNCH_CHECKLIST.md`, remove stale absolute paths from prior machines and use repo-relative paths like `src/pages/Settings.jsx` where file references are needed.

Expected: the checklist is portable and dated with the current 2026-06-15 audit status.

- [ ] **Step 2: Update blocker list to match current state**

Required remaining blockers after the readiness fixes:

- full Xcode not selected
- signing team not configured
- iOS shell untracked
- privacy manifest requires schema/content review
- App-Bound Domains require exact production domains
- App Store Connect metadata, reviewer account, production environment values, and Sign in with Apple decision not finalized
- TestFlight build not uploaded
- physical-device QA not complete

Expected: the checklist no longer says `ios/App` is missing, because it now exists locally.

- [ ] **Step 3: Create release runbook**

Create `docs/app-store-release-runbook.md`:

````markdown
# ChemCheck App Store Release Runbook

## Branch

Use `app-store-ios-shell` for parked iOS release work. Keep PWA shipping on `main`.

## Preflight

```bash
npm ci
npm run test:gates
npm run lint
npm run build
npm audit --audit-level=high
npm test -- --reporter=dot
PLAYWRIGHT_PORT=5174 npm run test:e2e -- --project=chromium
npm run ios:sync
plutil -lint ios/App/App/Info.plist ios/App/App/PrivacyInfo.xcprivacy
xcodebuild -list -project ios/App/App.xcodeproj
```

## Simulator

```bash
npm run ios:sim
```

## Archive

```bash
npm run ios:archive
```

## Store

Upload through Xcode Organizer, complete App Store Connect metadata, use manual release, and keep the previous TestFlight build available until smoke testing passes.
````

Expected: any future worker can resume the App Store track without reconstructing commands from chat history.

## Task 11: Native QA Matrix

**Files:**

- Verify: app behavior on simulator and physical iPhone
- Update: `docs/IOS_GAMEDAY_LAUNCH_CHECKLIST.md`

- [ ] **Step 1: Run simulator smoke**

Run:

```bash
cd /Users/jakedom/Documents/chemcheck-main
npm run ios:sim
```

Expected: app launches on the configured simulator, splash hides, and login/landing route is usable.

- [ ] **Step 2: Run physical device smoke**

Use Xcode to install on a physical iPhone.

Expected:

- camera permission prompt appears only when photo capture is used
- photo-library permission prompt copy matches actual behavior
- location permission prompt appears only when directions/check-in needs it
- keyboard does not cover form actions
- safe areas are respected
- back navigation and deep links do not strand the user
- offline/reconnect behavior is understandable

- [ ] **Step 3: Run review-critical workflows**

Manual checklist:

- fresh install
- login
- signup
- create client
- create service log
- attach/capture photos
- send or preview service report
- history filters
- settings
- support link
- privacy policy link
- terms link
- account deletion
- logout
- app background/resume
- airplane mode/reconnect

Expected: no crashes, no dead-end screens, and no App Review-required link is broken.

## Task 12: TestFlight And Parked Release Candidate

**Files:**

- Modify: `ios/App/App.xcodeproj/project.pbxproj`
- Verify: App Store Connect app record

- [ ] **Step 1: Create App Store Connect record**

Use App Store Connect:

- App name: ChemCheck
- Bundle ID: `com.chemcheck.app`
- SKU: `chemcheck-ios`
- Platform: iOS
- Category: Business or Productivity

Expected: bundle ID in Xcode and App Store Connect match.

- [ ] **Step 2: Archive and upload**

Run:

```bash
cd /Users/jakedom/Documents/chemcheck-main
npm run ios:archive
```

Then upload from Xcode Organizer.

Expected: build appears in TestFlight processing without privacy/signing errors.

- [ ] **Step 3: Park the release candidate**

Run after internal TestFlight smoke passes:

```bash
cd /Users/jakedom/Documents/chemcheck-main
git status --short
git tag -f ios-rc-0.1.0
git push origin app-store-ios-shell
git push origin ios-rc-0.1.0
```

Expected: the App Store-ready version is stored away as a branch and tag. The app is not released publicly until App Store Connect manual release is triggered.

## Final Launch Bar

ChemCheck is App Store-ready when all of these are true:

- PWA build, lint, unit, gates, audit, and E2E are green from an isolated server.
- iOS shell is tracked in Git on a parked branch.
- Simulator and physical-device native smoke tests pass.
- Xcode signing and archive work with full Xcode selected.
- TestFlight build installs and passes reviewer-path smoke.
- Account deletion works from inside the app.
- Support URL and privacy policy URL are live.
- App Privacy answers match `PrivacyInfo.xcprivacy`, public policy, Clerk, Convex, Stripe, and Sentry behavior.
- Auth domains and redirects work in WKWebView.
- Billing model is compliant with App Store payment rules.
- App Store screenshots, description, category, age rating, review notes, and release notes are ready.
- The parked release candidate is tagged and recoverable without relying on local-only state.
