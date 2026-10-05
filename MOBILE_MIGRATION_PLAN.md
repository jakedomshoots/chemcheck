# Mobile Migration Plan: ChemCheck → App Stores

## 1. Current App Summary
- **Tech Stack**: React 18, Vite, Dexie.js (IndexedDB), Tailwind CSS, Shadcn UI.
- **Architecture**: **Offline-first PWA**. Dexie/IndexedDB keeps the downloaded route and queued field work on the phone; Convex remains the shared cloud source of truth when connectivity returns.
- **Entry Point**: `src/main.jsx` (standard React/Vite pattern).
- **Key Features**: Client management, pool service logging (chemical readings, notes), route optimization, offline sync.
- **Mobile State**: Responsive web app with a Capacitor iOS shell already checked into `ios/`. The remaining release work is physical-device verification, signing, and App Store/TestFlight preparation.

## 2. Mobile Strategy: Option A (Capacitor)
**Recommendation**: **Continue with the existing Capacitor wrapper**.

### Why Capacitor?
1. **Zero Logic Rewrite**: ChemCheck is already a React SPA. The checked-in Capacitor shell wraps the production `dist` folder in a native WebView.
2. **Offline-First Alignment**: Dexie/IndexedDB and the queued sync service carry the downloaded route and newly saved field work while the device has no coverage. Cloud-only actions resume after reconnection.
3. **Speed to Market**: Cheapest path to getting `.ipa` (iOS) and `.apk` (Android) files without rebuilding UI in React Native.
4. **Native Access**: If you later need camera access (e.g., photo logs) or push notifications, Capacitor plugins bridge this easily.

**Trade-offs**:
- **Pros**: reuse the existing product UI, fast iteration, and durable on-device storage for downloaded data and queued field work.
- **Cons**: UI is still web-based (scroll physics, tap delay handled well but not 100% native feel).
- **Alternative**: React Native would offer better "feel" but requires a complete UI rewrite (weeks/months of work).

## 3. Gap Analysis vs Store Requirements

| Feature | Current Behavior | Needs for Stores | Notes |
|---------|------------------|------------------|-------|
| **Navigation** | Browser history / URLs | Hardware Back Button (Android) | Need to handle Android back button to prevent app exit |
| **Offline** | Cached route + queued local changes in IndexedDB | Physical-device Airplane Mode verification | Service work must save, survive relaunch, and later synchronize; report delivery, payments, and cloud-only actions wait for coverage |
| **Data Safety** | Stored on-device and synchronized with ChemCheck cloud services | Accurate Privacy Policy URL | **Critical**: store disclosures must describe local storage, account authentication, and cloud synchronization truthfully |
| **Permissions** | None requested | Explicit usage descriptions | If future features use Camera/Bio, must declare in `Info.plist` / `AndroidManifest` |
| **Assets** | Web favicons | Native App Icons & Splash | Need `1024x1024` icon + splash screen generator |
| **Packaging** | `npm run build` | Xcode / Android Studio builds | Need Capacitor config + build environments |
| **Updates** | Web refresh | App Store Review Process | Code push (Capacitor Live Updates) is optional but recommended heavily |

## 4. Concrete Migration Plan (Step-by-Step)

### Phase 0: Repo Cleanup & Prep (1 day)
- [ ] **Fix Viewport**: Ensure `meta name="viewport"` disables user scaling: `content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"`.
- [ ] **Safe Areas**: Verify padding/margins account for iPhone Notch/Dynamic Island (use `env(safe-area-inset-top)`).
- [ ] **Input Types**: Ensure standard numeric inputs for chemicals use `inputmode="decimal"` for mobile keypads.

### Phase 1: Capacitor Core Verification
- [x] Capacitor iOS shell is present under `ios/`.
- [x] Build and copy the current web bundle into iOS: `npm run ios:sync`.
- [ ] Add Android only when Android distribution is in scope:
  ```bash
  npm install @capacitor/android
  npx cap add android
  ```
- [ ] Disable text selection globally in CSS (feels more native):
  ```css
  * { -webkit-user-select: none; user-select: none; }
  input, textarea { -webkit-user-select: text; user-select: text; }
  ```

### Phase 2: Mobile UX Polish (1-2 days)
- [ ] **Android Back Button**: Install `@capacitor/app` and handle `App.addListener('backButton')` in `App.jsx` to navigate React Router back instead of closing app.
- [ ] **Status Bar**: Install `@capacitor/status-bar` to make the top bar transparent/colored to match your app theme.
- [ ] **Splash Screen**: Install `@capacitor/splash-screen` to prevent white flash on load.
- [ ] **Keyboard Handling**: Verify form inputs don't get hidden behind the keyboard (Capacitor usually handles this, but verify `KeyboardResize` mode).

### Phase 3: Assets & Privacy (1 day)
- [ ] **Generate Assets**: Install `@capacitor/assets`:
  ```bash
  npm install @capacitor/assets --save-dev
  npx capacitor-assets generate
  ```
  (Requires source `assets/icon.png` and `assets/splash.png`).
- [ ] **Privacy Policy**: Publish a static policy that accurately covers local device storage, authenticated accounts, cloud sync, and any enabled reports, notifications, or analytics.
- [ ] **Support URL**: You need a URL where users can contact you (GitHub Issues page works fine).

### Phase 4: Build & Test (2-3 days)
- [ ] **iOS Build**:
  - Open Xcode: `npx cap open ios`
  - Set Signing Team (requires Apple Developer Account - $99/year).
  - Select destination (Generic iOS Device) and Archive.
- [ ] **Android Build**:
  - Open Android Studio: `npx cap open android`
  - Generate Signed Bundle (requires Google Play Account - $25 one-time).
- [ ] **Smoke Test**: Install on physical devices. Test:
  - Cold launch (splash screen).
  - Backgrounding/Foregrounding app (ensure state persists).
  - Sync until the app says **Ready for offline work**, then enable Airplane Mode.
  - Open the cached route, save a service visit, confirm it is pending, force-quit/relaunch, then reconnect and confirm it synchronizes.

### Phase 5: Pre-Submission Checklist
- [ ] **Permissons Audit**: Ensure you aren't requesting location/camera if not used (check `AndroidManifest.xml` and `Info.plist`).
- [ ] **Data Safety Form**: Complete Google Play disclosures from the actual data flows; do not use a blanket "No data collected" statement.
- [ ] **Screenshots**: Capture 3-4 key screens on iPhone 6.5" and 5.5" simulators + Android Pixel simulator.

## 5. Top Risks & Gotchas

1.  **Apple "Minimum Functionality" Rejection (4.2)**
    *   **Risk**: Apple rejects apps that look like simple websites repackaged.
    *   **Mitigation**: Ensure app feels native. Uses haptic feedback (easy to add), smooth transitions, proper safe-area spacing, and offline capability (which you already have!).
2.  **App Store Reviewer "Login" Block**
    *   **Risk**: Reviewer cannot test because ChemCheck uses authenticated accounts.
    *   **Mitigation**: Provide a functioning review account and precise testing steps in App Store Connect.
3.  **Data Persistence on Update**
    *   **Risk**: OS clears WebView data on rare updates or storage pressure.
    *   **Mitigation**: Minimal risk with Capacitor, but for critical data, consider using `@capacitor-community/sqlite` later. For now, IndexedDB is persistent enough for V1.
4.  **iPad/Tablet Layout**
    *   **Risk**: App looks broken on iPad (Apple requires iPad support if iPhone supported).
    *   **Mitigation**: Ensure your Tailwind classes handle `md:` and `lg:` breakpoints gracefully, or restrict deployment to iPhone-only in Xcode (less recommended).

## 6. Open Questions Needed for Implementation
- Do you have an **Apple Developer Account** ($99/year) and **Google Play Console Account** ($25)? you need these to publish.
- Do you have a Mac? (Required for iOS builds).
