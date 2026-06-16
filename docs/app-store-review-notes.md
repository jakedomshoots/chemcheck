# ChemCheck App Review Notes

Use this as the source draft for the App Review Information section in App Store Connect. Do not commit reviewer passwords or private account recovery details.

## Reviewer Account

- Email: create a dedicated reviewer account before submission.
- Password: store only in App Store Connect review notes.
- Business/workspace: seed with sample pool service data, or allow the reviewer to create a client during review.

## Suggested Review Steps

1. Launch ChemCheck.
2. Sign in with the reviewer account.
3. Open Clients and create a customer.
4. Open the customer and create a service log.
5. Enter pool readings and save the log.
6. Attach or capture a service photo if camera/photo permissions are requested.
7. Open History and confirm the completed service appears.
8. Open Settings and locate account deletion under the account section.
9. Log out.

## Product Description For Review

ChemCheck is a field-service operations app for pool service businesses. It helps technicians manage clients, service stops, chemical readings, service history, proof-of-service photos, and customer reports.

## Privacy And Support URLs

- Privacy policy: confirm production URL for `public/privacy-policy.html`.
- Terms of service: confirm production URL for `public/terms-of-service.html`.
- Support: confirm production support page or support email.
- Account deletion: available in app under Settings -> Account.

## Native Permissions

- Camera: used to capture before/after service photos.
- Photo Library: used to attach existing service photos and save photos when requested.
- Location: used for service stop check-ins and directions when enabled.
- Face ID: reserved for account security if biometric auth is enabled.

## Offline Behavior

ChemCheck stores operational data locally for offline field use and syncs queued work when the device reconnects. Reviewers can test offline behavior by creating service work, toggling network connectivity, and confirming the app remains usable.

## Billing Notes

Before submission, decide and document one of these positions in App Store Connect:

- Existing-account app: iOS users sign in to an account managed outside the app. This is the current parked-shell behavior because native iOS pricing and billing screens do not expose Stripe checkout or portal actions.
- Real-world services: billing relates to pool service operations, not digital app access.
- Digital subscription: implement Apple In-App Purchase before review.

The PWA/web app can keep its Stripe pricing path. If native iOS later sells digital ChemCheck access, implement Apple In-App Purchase before review.

## Sign-In Notes

If Google, Facebook, or another third-party/social sign-in provider is exposed in the iOS build, enable Sign in with Apple or remove social sign-in from the App Store review build.
