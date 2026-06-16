# ChemCheck App Store Connect Metadata Checklist

Use this when creating or updating the App Store Connect app record for bundle ID `com.chemcheck.app`.

## App Information

- Name: ChemCheck
- Bundle ID: `com.chemcheck.app`
- SKU: choose an internal SKU such as `chemcheck-ios`
- Primary category: Business
- Secondary category: Productivity or Utilities, if desired
- Content rights: no third-party media rights required unless marketing screenshots include customer-owned content

## URLs

- Privacy Policy URL: production URL serving `public/privacy-policy.html`
- Terms of Service URL: production URL serving `public/terms-of-service.html`
- Support URL: production support page or support email page
- Marketing URL: production public landing page, if available

## Review Information

- Reviewer account email: create before submission
- Reviewer account password: enter only in App Store Connect
- Notes source: `docs/app-store-review-notes.md`
- Special instructions: explain that the iOS build is for existing ChemCheck workspaces and does not sell digital app access in-app

## App Privacy Answers

Keep App Store Connect answers aligned with `public/privacy-policy.html` and `ios/App/App/PrivacyInfo.xcprivacy`.

Declare data used for app functionality/account management:

- Email address
- Phone number, if collected from users/customers
- Customer/contact records entered by the business
- Service logs, pool readings, route/service notes
- Photos or videos attached as proof of service
- Diagnostics/crash data if monitoring is enabled
- Payment/subscription metadata only if billing is enabled for the submitted build

Tracking:

- Current native privacy manifest declares `NSPrivacyTracking=false`.
- Do not add advertising/tracking SDKs without updating privacy answers and manifest values.

Required-reason APIs:

- Current app manifest declares `NSPrivacyAccessedAPICategoryUserDefaults` with reason `CA92.1`.
- Camera/photo/location permissions are declared in `Info.plist`, not as required-reason API categories.

## Billing Position

Current parked-shell position:

- Existing-account/field-operations app.
- Native iOS pricing page does not initiate Stripe checkout.
- Native iOS billing dashboard does not open Stripe portal or cancellation actions.
- PWA/web billing remains separate from App Store review.

If this changes and native iOS sells digital ChemCheck access, implement Apple In-App Purchase before submission.

## Sign In With Apple

Code-level review found OAuth callback support, but sign-in provider availability is controlled by Clerk configuration.

- If no social/third-party providers are visible in iOS, no Sign in with Apple change is needed.
- If Google, Facebook, or another third-party/social provider is visible in iOS, enable Sign in with Apple in Clerk before App Review.

## Screenshots

Capture screenshots from the TestFlight/native build after full Xcode validation:

- Login or landing route
- Today route/home
- Clients list/detail
- New service log/readings
- Proof-of-service photo flow
- History
- Settings/account deletion entrypoint

Avoid showing real customer personal data in screenshots.

## Final Submission Gate

```bash
scripts/app-store-preflight.sh --full
npm run ios:sim
npm run ios:archive
```

Upload through Xcode Organizer, then smoke test the TestFlight build on a physical iPhone before submitting for review.
