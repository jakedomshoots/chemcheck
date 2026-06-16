# ChemCheck App Store Release Runbook

This runbook preserves the current PWA setup and gives the future iOS release a repeatable path from parked branch to TestFlight/App Store submission.

## Release Track

- Active product: PWA.
- Parked iOS branch: `app-store-ios-shell`.
- Native shell: Capacitor iOS project in `ios/App`.
- Bundle ID: `com.chemcheck.app`.
- Web build output: `dist`, synced into `ios/App/App/public`.

## Resume The iOS Track

```bash
cd /Users/jakedom/Documents/chemcheck-main
git switch app-store-ios-shell
npm ci
```

If a release candidate tag exists, inspect it before continuing:

```bash
git tag --list "ios-rc-*"
git show --stat ios-rc-0.1.0
```

## PWA Verification Gate

Run this before touching Xcode:

```bash
scripts/app-store-preflight.sh --pre-xcode
```

Expected current baseline:

- readiness gates pass
- lint passes
- build passes
- high-threshold npm audit reports 0 vulnerabilities
- unit/integration suite passes
- Chromium E2E passes on the isolated `127.0.0.1:5174` server

## Native Sync Gate

```bash
npm run ios:sync
plutil -lint ios/App/App/Info.plist ios/App/App/PrivacyInfo.xcprivacy
```

`plutil` only validates plist syntax. It does not prove App Store Connect will accept the privacy manifest values.

## Xcode Prerequisites

Install full Xcode and select it:

```bash
sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
scripts/app-store-preflight.sh --full
```

The current local machine is blocked here because `xcode-select` points at `/Library/Developer/CommandLineTools`.

## Xcode Project Setup

Open the project:

```bash
npm run ios:open
```

In Xcode:

- Select target `App`.
- Set Team to the Apple Developer account that owns the App Store Connect app.
- Confirm Bundle Identifier is `com.chemcheck.app`.
- Set `MARKETING_VERSION` for the public release.
- Increment `CURRENT_PROJECT_VERSION` for each TestFlight upload.
- Confirm camera, photo library, location, and Face ID purpose strings match product copy.
- Confirm iPhone/iPad orientation support is intentional.

## Production Domain Lockdown

Before App Store submission, replace broad WebView domain allowances with exact production domains:

- Clerk frontend or proxy domain: currently `clerk.chemcheck.xyz`.
- Cloudflare challenge host only if still required: currently `challenges.cloudflare.com`.
- Any support/privacy host that opens inside the WebView.

Check both:

- `capacitor.config.json`
- `ios/App/App/Info.plist` `WKAppBoundDomains`

`VITE_CONVEX_URL` must still be set to the exact production Convex deployment host in the release environment. Do not add broad `convex.cloud` navigation allowances unless the app actually navigates the WebView there.

## Simulator Smoke Test

```bash
npm run ios:sim
```

Validate:

- launch screen hides
- login and signup render
- auth works with production Clerk settings
- core tabs/routes load
- create client
- create service log
- attach or capture service photo
- offline queue behavior works
- account deletion entrypoint is visible
- logout clears local state

## TestFlight Archive

```bash
npm run ios:archive
```

Then open Xcode Organizer and distribute the archive to App Store Connect/TestFlight.

Smoke test the TestFlight build on a physical iPhone before App Review.

## App Store Connect Checklist

- App record exists for `com.chemcheck.app`.
- App category, age rating, copyright, support URL, marketing URL, privacy policy URL, and terms URL are filled.
- App Privacy answers match the privacy policy and native privacy manifest.
- Reviewer account is active and documented in App Review notes.
- Billing decision is settled for iOS. The current parked shell blocks Stripe checkout, Stripe portal, and subscription cancellation actions in native iOS while keeping PWA pricing/billing unchanged.
- Sign in with Apple is enabled if social/third-party sign-in is exposed.
- Screenshots match the iOS build.
- No placeholder content is visible.

Use `docs/app-store-env.example` for release environment values and `docs/app-store-connect-metadata.md` for App Store Connect metadata.

## Parking A Release Candidate

After the PWA gate, native sync, simulator smoke test, and TestFlight smoke test pass:

```bash
git status --short
git add capacitor.config.json package.json package-lock.json assets docs ios scripts
git commit -m "chore: park App Store iOS shell"
git tag ios-rc-0.1.0
```

Use a different tag if the version has moved. Do not tag before full Xcode/TestFlight validation unless the tag name clearly marks it as a preflight snapshot.
