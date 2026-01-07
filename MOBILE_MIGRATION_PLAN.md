# Mobile Migration Plan: ChemCheck → App Stores

## 1. Current App Summary
- **Tech Stack**: React 18, Vite, Dexie.js (IndexedDB), Tailwind CSS, Shadcn UI.
- **Architecture**: **Local-First PWA**. Completely offline-capable using Dexie for storage. No backend dependency (Convex removed).
- **Entry Point**: `src/main.jsx` (standard React/Vite pattern).
- **Key Features**: Client management, pool service logging (chemical readings, notes), route optimization, offline sync.
- **Mobile State**: Responsive web app currently optimization for mobile browsers, but running as a pure web or PWA.

## 2. Mobile Strategy: Option A (Capacitor)
**Recommendation**: **Wrap existing PWA with Capacitor**.

### Why Capacitor?
1. **Zero Logic Rewrite**: Your app is already a high-quality React SPA. Capacitor drops into your existing Vite project and wraps the `dist` folder in a native WebView.
2. **Offline-First Alignment**: Your Dexie.js implementation works perfectly inside Capacitor's WebView without any changes.
3. **Speed to Market**: Cheapest path to getting `.ipa` (iOS) and `.apk` (Android) files without rebuilding UI in React Native.
4. **Native Access**: If you later need camera access (e.g., photo logs) or push notifications, Capacitor plugins bridge this easily.

**Trade-offs**:
- **Pros**: reuse 100% of code, fastest deploy, perfect offline persistence.
- **Cons**: UI is still web-based (scroll physics, tap delay handled well but not 100% native feel).
- **Alternative**: React Native would offer better "feel" but requires a complete UI rewrite (weeks/months of work).

## 3. Gap Analysis vs Store Requirements

| Feature | Current Behavior | Needs for Stores | Notes |
|---------|------------------|------------------|-------|
| **Navigation** | Browser history / URLs | Hardware Back Button (Android) | Need to handle Android back button to prevent app exit |
| **Offline** | Works via IndexedDB | Native Offline UI / Handling | Current implementation is perfect; just verify "no network" doesn't crash |
| **Data Safety** | Stored locally in browser | Privacy Policy URL | **Critical**: Stores require a URL to a privacy policy (even if "we collect nothing") |
| **Permissions** | None requested | Explicit usage descriptions | If future features use Camera/Bio, must declare in `Info.plist` / `AndroidManifest` |
| **Assets** | Web favicons | Native App Icons & Splash | Need `1024x1024` icon + splash screen generator |
| **Packaging** | `npm run build` | Xcode / Android Studio builds | Need Capacitor config + build environments |
| **Updates** | Web refresh | App Store Review Process | Code push (Capacitor Live Updates) is optional but recommended heavily |

## 4. Concrete Migration Plan (Step-by-Step)

### Phase 0: Repo Cleanup & Prep (1 day)
- [ ] **Fix Viewport**: Ensure `meta name="viewport"` disables user scaling: `content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"`.
- [ ] **Safe Areas**: Verify padding/margins account for iPhone Notch/Dynamic Island (use `env(safe-area-inset-top)`).
- [ ] **Input Types**: Ensure standard numeric inputs for chemicals use `inputmode="decimal"` for mobile keypads.

### Phase 1: Capacitor Core Setup (1-2 hours)
- [ ] Install Capacitor:
  ```bash
  npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios
  npx cap init ChemCheck com.jakedomshoots.chemcheck --web-dir=dist
  ```
- [ ] Build web assets: `npm run build`
- [ ] Add platforms:
  ```bash
  npx cap add ios
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
- [ ] **Privacy Policy**: Create a simple static page (e.g., GitHub Pages or Vercel) stating "ChemCheck stores data locally on your device. No personal data is transmitted to external servers."
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
  - Airplane mode usage (core feature test).

### Phase 5: Pre-Submission Checklist
- [ ] **Permissons Audit**: Ensure you aren't requesting location/camera if not used (check `AndroidManifest.xml` and `Info.plist`).
- [ ] **Data Safety Form**: For Google Play, declare "No data collected" (since it's offline/local-only).
- [ ] **Screenshots**: Capture 3-4 key screens on iPhone 6.5" and 5.5" simulators + Android Pixel simulator.

## 5. Top Risks & Gotchas

1.  **Apple "Minimum Functionality" Rejection (4.2)**
    *   **Risk**: Apple rejects apps that look like simple websites repackaged.
    *   **Mitigation**: Ensure app feels native. Uses haptic feedback (easy to add), smooth transitions, proper safe-area spacing, and offline capability (which you already have!).
2.  **App Store Reviewer "Login" Block**
    *   **Risk**: Reviewer can't test because they don't know how to use it.
    *   **Mitigation**: Since auth is removed, this is low risk. Provide a "Demo Data" button or clear instructions in Review Notes: "Just click 'Add Client' to test."
3.  **Data Persistence on Update**
    *   **Risk**: OS clears WebView data on rare updates or storage pressure.
    *   **Mitigation**: Minimal risk with Capacitor, but for critical data, consider using `@capacitor-community/sqlite` later. For now, IndexedDB is persistent enough for V1.
4.  **iPad/Tablet Layout**
    *   **Risk**: App looks broken on iPad (Apple requires iPad support if iPhone supported).
    *   **Mitigation**: Ensure your Tailwind classes handle `md:` and `lg:` breakpoints gracefully, or restrict deployment to iPhone-only in Xcode (less recommended).

## 6. Open Questions Needed for Implementation
- Do you have an **Apple Developer Account** ($99/year) and **Google Play Console Account** ($25)? you need these to publish.
- Do you have a Mac? (Required for iOS builds).
