# Dead Code Proposed Changes

Date: 2026-06-06

Scope: repository-wide static dead-code audit for `/Users/jakedom/Documents/chemcheck-main`.

No source code was changed for this audit. This file is a proposal only.

## Method

Commands used:

```bash
npx --yes knip --reporter markdown --no-progress
npx --yes knip --reporter json
npx --yes depcheck --json
rg --files -g '!node_modules' -g '!dist' -g '!coverage'
rg -n --fixed-strings '<candidate import/package names>' .
```

I also built a local import graph for the files Knip marked as unused. In that graph, no normal source file imported the proposed unused-file candidates. Some candidates import each other, so they should be removed as clusters.

Important caveat: Convex public functions, public assets, generated files, dynamic browser imports, and future-facing mobile tooling can look unused to static analyzers. I excluded or downgraded those where evidence showed runtime/tooling use.

## Executive Summary

Knip reported:

- 59 unused files
- 32 unused dependencies
- 4 unused dev dependencies
- 360 unused exports
- 98 unused exported types
- 24 duplicate exports
- 1 unresolved dynamic import

After manual review:

- `public/sw.js` is a false positive and should be kept because `src/lib/serviceWorker.ts` registers `/sw.js`.
- 58 files look like behavior-preserving removal candidates.
- Those 58 files are about 8,263 lines before dependency cleanup.
- Most dependency cleanup is tied to unused shadcn-style UI wrapper files.
- Some package findings should be treated as "confirm first" because they are mobile tooling or patch-script related.

## Do Not Remove

| Item | Why it should stay |
| --- | --- |
| `public/sw.js` | Registered at runtime through `SW_SCRIPT_PATH = '/sw.js'` in `src/lib/serviceWorker.ts`. Knip cannot infer this string-based public asset reference. |
| `postcss` | Used by `postcss.config.js`. Depcheck flagged it incorrectly because config parsing is imperfect here. |
| `autoprefixer` | Used by `postcss.config.js`. Same depcheck false positive as above. |
| `@capacitor/cli` | Not imported by source code, but `scripts/ios-sim-run.sh` runs `npx cap sync ios`. Keep unless iOS packaging is being retired. |
| `@capacitor/ios` | Same as above: platform package for Capacitor iOS workflow, even though no `ios/` directory exists in this checkout. |
| `@clerk/clerk-js` | `patch_clerk.js` targets `node_modules/@clerk/clerk-js/dist/clerk.mjs`, and `npm run patch-clerk` exists. Remove only if that patch workflow is deleted. |

## High-Confidence File Removal Candidates

These files had no incoming imports from used source files. The import graph found either no inbound references or references only from other unused files.

### Orphan Feature Surfaces

| File | Lines | Notes |
| --- | ---: | --- |
| `src/components/AdminDashboard.jsx` | 579 | No route/import references. Uses service-worker/admin concepts, but not wired into the app. |
| `src/components/FleetDashboard.jsx` | 525 | No route/import references. |
| `src/components/NotificationSettings.jsx` | 220 | No imports. App uses direct `sonner` toasts elsewhere. |
| `src/components/OptimizedCustomerList.jsx` | 266 | No imports. Only unused file importing `src/lib/performance.ts`. |
| `src/components/SetupWizard.jsx` | 448 | Legacy setup component. Current route uses `src/components/auth/SetupWizardPage.jsx`. |
| `src/hooks/useDataIntegrity.ts` | 117 | No imports. |
| `src/hooks/useTimeTracker.ts` | 190 | No real source imports. A test mocks the path, but production code does not use it. |
| `src/lib/abTesting.ts` | 195 | No imports. |
| `src/lib/cloudBackup.ts` | 423 | No imports. |
| `src/lib/pdfReport.ts` | 388 | No imports. |
| `src/lib/performance.ts` | 387 | Only imported by unused `OptimizedCustomerList.jsx`. |
| `src/lib/secureStorage.ts` | 303 | No imports. |
| `src/utils/migrateFromConvex.ts` | 242 | No imports. |

### Legacy Auth Aliases And Dead Barrel

Current app routing uses `RobustAuthGuard`, `RobustLoginPage`, `RobustSignUpPage`, `ConvexAuthProvider`, and `ClerkAuthProvider` directly. These compatibility wrappers/barrels are not imported by used source.

| File | Lines | Notes |
| --- | ---: | --- |
| `src/components/auth/index.js` | 14 | Dead barrel. No imports from `@/components/auth`. |
| `src/components/auth/AuthGuard.jsx` | 14 | Wrapper around `RobustAuthGuard`; only exported by dead barrel. |
| `src/components/auth/AuthProvider.jsx` | 22 | Wrapper around `ClerkAuthProvider`; only exported by dead barrel. |
| `src/components/auth/LoginPage.jsx` | 14 | Wrapper around `RobustLoginPage`; only exported by dead barrel. |
| `src/components/auth/SignUpPage.jsx` | 14 | Wrapper around `RobustSignUpPage`; only exported by dead barrel. |
| `src/components/auth/UserMenu.jsx` | 56 | Only exported by dead barrel. |

### Migration UI Island

The migration UI is not mounted anywhere in the current app. These files reference each other only.

| File | Lines | Notes |
| --- | ---: | --- |
| `src/components/sync/MigrationPrompt.tsx` | 59 | No incoming imports from used source. |
| `src/components/sync/MigrationDialog.tsx` | 328 | Only imported by `MigrationPrompt.tsx`. |
| `src/hooks/useMigration.ts` | 141 | Only imported by the unused migration UI files. |
| `src/components/ui/progress.jsx` | 24 | Only imported by unused `MigrationDialog.tsx`. |

### Legacy Service Log Input Island

Current service log form imports `SimplifiedChemicalInput`, not `ChemicalInput`.

| File | Lines | Notes |
| --- | ---: | --- |
| `src/components/servicelog/ChemicalInput.jsx` | 87 | Replaced by `SimplifiedChemicalInput`. |
| `src/components/ui/slider.jsx` | 22 | Only imported by unused `ChemicalInput.jsx`. |

### Sidebar Island

The app has its own layout/sidebar behavior in `src/pages/Layout.jsx`; the shadcn-style sidebar wrapper is not imported.

| File | Lines | Notes |
| --- | ---: | --- |
| `src/components/ui/sidebar.jsx` | 620 | No incoming imports from used source. |
| `src/hooks/use-mobile.jsx` | 20 | Only imported by unused `sidebar.jsx`. |
| `src/components/ui/sheet.jsx` | 110 | Only imported by unused `sidebar.jsx`. |
| `src/components/ui/separator.jsx` | 24 | Only imported by unused `sidebar.jsx`. |
| `src/components/ui/tooltip.jsx` | 29 | Only imported by unused `sidebar.jsx`. |

### Unused UI Wrapper Files

These appear to be generated shadcn-style wrappers that are not currently imported by the app.

| File | Lines | Package cleanup likely tied to it |
| --- | ---: | --- |
| `src/components/ui/accordion.jsx` | 42 | `@radix-ui/react-accordion` |
| `src/components/ui/aspect-ratio.jsx` | 6 | `@radix-ui/react-aspect-ratio` |
| `src/components/ui/avatar.jsx` | 36 | `@radix-ui/react-avatar` |
| `src/components/ui/breadcrumb.jsx` | 93 | none, depends on shared `@radix-ui/react-slot` which is still used |
| `src/components/ui/calendar.jsx` | 72 | `react-day-picker` |
| `src/components/ui/carousel.jsx` | 194 | `embla-carousel-react` |
| `src/components/ui/chart.jsx` | 309 | `recharts` |
| `src/components/ui/collapsible.jsx` | 12 | `@radix-ui/react-collapsible` |
| `src/components/ui/command.jsx` | 117 | `cmdk` |
| `src/components/ui/context-menu.jsx` | 157 | `@radix-ui/react-context-menu` |
| `src/components/ui/dropdown-menu.jsx` | 157 | `@radix-ui/react-dropdown-menu` |
| `src/components/ui/form.jsx` | 135 | `react-hook-form`, `@hookform/resolvers` |
| `src/components/ui/hover-card.jsx` | 26 | `@radix-ui/react-hover-card` |
| `src/components/ui/input-otp.jsx` | 54 | `input-otp` |
| `src/components/ui/menubar.jsx` | 201 | `@radix-ui/react-menubar` |
| `src/components/ui/navigation-menu.jsx` | 105 | `@radix-ui/react-navigation-menu` |
| `src/components/ui/pagination.jsx` | 101 | none |
| `src/components/ui/radio-group.jsx` | 30 | `@radix-ui/react-radio-group` |
| `src/components/ui/resizable.jsx` | 43 | `react-resizable-panels` |
| `src/components/ui/scroll-area.jsx` | 39 | `@radix-ui/react-scroll-area` |
| `src/components/ui/sonner.jsx` | 27 | Do not remove `sonner` package; app imports `sonner` directly. |
| `src/components/ui/table.jsx` | 87 | none |
| `src/components/ui/toggle-group.jsx` | 45 | `@radix-ui/react-toggle-group`, plus unused `toggle.jsx` |
| `src/components/ui/toggle.jsx` | 39 | `@radix-ui/react-toggle` |

### Native Geolocation Wrapper

| File | Lines | Notes |
| --- | ---: | --- |
| `src/lib/native/geolocation.ts` | 65 | No imports. App currently uses browser geolocation in `src/lib/proof-of-service/photoUtils.ts`; native camera is used separately and should remain. |

### Tiny Dead Barrels

| File | Lines | Notes |
| --- | ---: | --- |
| `src/components/billing/index.js` | 3 | No imports. Billing components are imported directly. |
| `src/components/notes/index.ts` | 2 | No imports. |

## Dependency Cleanup Proposal

### Likely Safe If Corresponding Dead Files Are Removed

These packages are only referenced by unused wrapper/component files or Vite manual chunks that would also need cleanup.

| Package | Why it looks removable |
| --- | --- |
| `@radix-ui/react-accordion` | Only used by unused `ui/accordion.jsx` and Vite manual chunk config. |
| `@radix-ui/react-aspect-ratio` | Only used by unused `ui/aspect-ratio.jsx`. |
| `@radix-ui/react-avatar` | Only used by unused `ui/avatar.jsx`. |
| `@radix-ui/react-collapsible` | Only used by unused `ui/collapsible.jsx`. |
| `@radix-ui/react-context-menu` | Only used by unused `ui/context-menu.jsx`. |
| `@radix-ui/react-dropdown-menu` | Only used by unused `ui/dropdown-menu.jsx` and Vite manual chunk config. |
| `@radix-ui/react-hover-card` | Only used by unused `ui/hover-card.jsx`. |
| `@radix-ui/react-menubar` | Only used by unused `ui/menubar.jsx`. |
| `@radix-ui/react-navigation-menu` | Only used by unused `ui/navigation-menu.jsx`. |
| `@radix-ui/react-progress` | Only used by unused `ui/progress.jsx`. |
| `@radix-ui/react-radio-group` | Only used by unused `ui/radio-group.jsx`. |
| `@radix-ui/react-scroll-area` | Only used by unused `ui/scroll-area.jsx`. |
| `@radix-ui/react-separator` | Only used by unused `ui/separator.jsx`. |
| `@radix-ui/react-slider` | Only used by unused `ui/slider.jsx` and Vite manual chunk config. |
| `@radix-ui/react-toggle` | Only used by unused `ui/toggle.jsx`. |
| `@radix-ui/react-toggle-group` | Only used by unused `ui/toggle-group.jsx`. |
| `@radix-ui/react-tooltip` | Only used by unused `ui/tooltip.jsx` and Vite manual chunk config. |
| `cmdk` | Only used by unused `ui/command.jsx`. |
| `embla-carousel-react` | Only used by unused `ui/carousel.jsx`. |
| `input-otp` | Only used by unused `ui/input-otp.jsx`. |
| `react-day-picker` | Only used by unused `ui/calendar.jsx` and Vite manual chunk config. |
| `react-hook-form` | Only used by unused `ui/form.jsx` and Vite manual chunk config. |
| `@hookform/resolvers` | No source imports; only Vite manual chunk config. Remove with form stack if no form library usage is planned. |
| `react-resizable-panels` | Only used by unused `ui/resizable.jsx`. |
| `recharts` | Only used by unused `ui/chart.jsx` and Vite manual chunk config. |
| `@capacitor/geolocation` | Only used by unused `src/lib/native/geolocation.ts`. |

### Strong Package Removal Candidates

These had no source references in Knip/depcheck scans, and no obvious tooling role in this checkout.

| Package | Notes |
| --- | --- |
| `framer-motion` | No references outside `package.json`. |
| `next-themes` | No references outside `package.json`. |
| `@axe-core/react` | No references outside `package.json`; tests use `jest-axe`, not this package. |
| `@vitest/coverage-v8` | No coverage script/config currently references it. Keep only if coverage reporting is planned. |
| `@flydotio/dockerfile` | No script/config references it. Remove if Fly deployment generation is not used. |
| `axe-core` | No direct imports. Validate that `jest-axe` does not require a direct top-level `axe-core` dependency before removal. |

### Confirm Before Removing

| Package | Why it needs confirmation |
| --- | --- |
| `@stripe/react-stripe-js` | No source imports, but Vite manual chunk includes it. Backend/frontend still use `@stripe/stripe-js`. Remove only if no React Stripe Elements UI is planned. |
| `@clerk/clerk-js` | Direct source does not import it, but `patch_clerk.js` references its installed path. |
| `@capacitor/cli` | Needed by `scripts/ios-sim-run.sh` even though not imported by source. |
| `@capacitor/ios` | Needed by Capacitor iOS workflow even though this checkout has no `ios/` directory. |

## Vite Config Cleanup Tied To Dependency Cleanup

If the package removals above are applied, update `vite.config.js` manual chunks at the same time. The current config still names packages that are otherwise unused:

- `vendor-radix-dropdown`: `@radix-ui/react-dropdown-menu`
- `vendor-radix-ui`: `@radix-ui/react-tooltip`
- `vendor-radix-extra`: `@radix-ui/react-accordion`, `@radix-ui/react-slider`
- `vendor-charts`: `recharts`
- `vendor-forms`: `react-hook-form`, `@hookform/resolvers`
- `vendor-dates`: `react-day-picker`
- `vendor-stripe`: `@stripe/react-stripe-js`

Do not remove package names from manual chunks until the matching packages/files are actually removed.

## Export-Only Cleanup Proposal

Knip reported many unused exports. Most are not dead implementations; they are public exports on functions/types that are used internally, exported through barrels, or intended for tests/future API. The behavior-preserving cleanup is to remove the `export` keyword or remove unused barrel re-exports, not necessarily delete the function.

### Duplicate Exports

These files export both a named component and a default component. Current imports mostly use named exports or explicit lazy import mappings, so the default export is likely redundant.

| File | Duplicate export |
| --- | --- |
| `src/components/proof-of-service/PhotoCaptureSection.tsx` | `PhotoCaptureSection` and `default` |
| `src/components/service-reports/ReportSettingsPanel.jsx` | `ReportSettingsPanel` and `default` |
| `src/components/service-reports/ServicePhotoGallery.tsx` | `ServicePhotoGallery` and `default` |
| `src/components/service-reports/SendReportDialog.tsx` | `SendReportDialog` and `default` |
| `src/components/proof-of-service/PhotoLightbox.tsx` | `PhotoLightbox` and `default` |
| `src/components/proof-of-service/PhotoCapture.tsx` | `PhotoCapture` and `default` |
| `src/components/proof-of-service/PhotoGallery.tsx` | `PhotoGallery` and `default` |
| `src/components/service-reports/EmailPreview.tsx` | `EmailPreview` and `default` |
| `src/components/proof-of-service/ProofStatus.tsx` | `ProofStatus` and `default` |
| `src/components/proof-of-service/PhotoEditor.tsx` | `PhotoEditor` and `default` |
| `src/components/auth/PublicConvexProvider.jsx` | `PublicConvexProvider` and `default` |
| `src/components/billing/BillingDashboard.jsx` | `BillingDashboard` and `default` |
| `src/components/auth/ConvexAuthProvider.jsx` | `ConvexAuthProvider` and `default` |
| `src/components/auth/ClerkAuthProvider.jsx` | `ClerkAuthProvider` and `default` |
| `src/components/auth/RobustSignUpPage.jsx` | `RobustSignUpPage` and `default` |
| `src/components/auth/RobustAuthGuard.jsx` | `RobustAuthGuard` and `default` |
| `src/components/auth/RobustLoginPage.jsx` | `RobustLoginPage` and `default` |
| `src/components/auth/SetupWizardPage.jsx` | `SetupWizardPage` and `default` |
| `src/components/billing/PricingPage.jsx` | `PricingPage` and `default` |
| `src/components/auth/SSOCallback.jsx` | `SSOCallback` and `default` |
| `src/pages/AccessDeniedPage.jsx` | `AccessDeniedPage` and `default` |
| `src/pages/NotFoundPage.jsx` | `NotFoundPage` and `default` |
| `src/pages/ReadyPage.jsx` | `ReadyPage` and `default` |
| `src/lib/proof-of-service/timeUtils.ts` | `isEndAtOrAfterStart` and `isEndAfterStart` alias pair |

### Barrel Export Cleanup

The biggest unused-export clusters are these barrel modules:

- `src/lib/proof-of-service/index.ts`
- `src/components/proof-of-service/index.ts`
- `src/components/service-reports/index.ts`
- `src/lib/ai-summarizer/index.ts`

Proposed approach:

1. Remove the dead files listed earlier first.
2. Rerun Knip.
3. For remaining unused exports, prefer removing barrel re-exports before deleting implementation code.
4. Only delete implementation code when there are no internal references and no tests depending on it.

## Unresolved Import Finding

Knip reported:

| File | Finding |
| --- | --- |
| `e2e/gameday.spec.ts:25` | Dynamic browser import of `/src/db/chemcheck-db.ts`. |

This is not dead code by itself. It is an e2e runtime import that Knip cannot resolve statically. If this test is flaky, consider replacing the browser-side dynamic import with a test-only seeding helper exposed by the app or Playwright fixture. Do not treat it as a deletion candidate.

## Suggested Removal Order

1. Remove legacy feature files and dead barrels that have no dependencies on other candidates.
2. Remove dead UI islands: migration UI, old chemical input, sidebar island.
3. Remove standalone unused shadcn-style UI wrappers.
4. Remove package dependencies tied only to the deleted wrappers.
5. Clean matching Vite manual chunks.
6. Rerun Knip and handle remaining export-only cleanup.

## Verification Plan For A Future Cleanup PR

Run these after each cluster or at least after the full cleanup:

```bash
npm ci --dry-run --ignore-scripts
npm run lint
npm run build
npm test
npx --yes knip --reporter markdown --no-progress
```

For package cleanup, also inspect the built chunks to confirm removed packages no longer appear in `dist/assets`.

