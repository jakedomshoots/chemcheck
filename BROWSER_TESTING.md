# 🌐 ChemCheck Browser & Mobile Testing Guide

## Browser Support Matrix

| Browser | Version | Support Level | Notes |
|---------|---------|---------------|-------|
| Chrome | 90+ | ✅ Full | Primary development browser |
| Firefox | 88+ | ✅ Full | |
| Safari | 14+ | ✅ Full | Important for iOS users |
| Edge | 90+ | ✅ Full | Chromium-based |
| Samsung Internet | 14+ | ✅ Full | Popular on Android |
| Opera | 76+ | ⚠️ Tested | |
| IE 11 | - | ❌ Not Supported | End of life |

## Mobile Device Testing

### iOS Devices
| Device | iOS Version | Priority |
|--------|-------------|----------|
| iPhone 15/14/13 | iOS 17+ | High |
| iPhone 12/11 | iOS 15+ | High |
| iPhone SE | iOS 15+ | Medium |
| iPad Pro | iPadOS 17+ | Medium |
| iPad Air | iPadOS 15+ | Medium |

### Android Devices
| Device | Android Version | Priority |
|--------|-----------------|----------|
| Samsung Galaxy S23/S22 | Android 13+ | High |
| Google Pixel 7/6 | Android 13+ | High |
| Samsung Galaxy A series | Android 12+ | High |
| OnePlus | Android 12+ | Medium |
| Xiaomi | Android 12+ | Medium |

## Testing Checklist

### Visual Testing
- [ ] Layout renders correctly on all screen sizes
- [ ] Text is readable without zooming
- [ ] Touch targets are at least 44x44px
- [ ] Images scale properly
- [ ] No horizontal scrolling on mobile
- [ ] Modals/dialogs fit on screen
- [ ] Forms are usable on mobile keyboards

### Functional Testing
- [ ] All buttons and links work
- [ ] Forms submit correctly
- [ ] Navigation works as expected
- [ ] PWA installs correctly
- [ ] Offline mode functions
- [ ] Push notifications work
- [ ] Authentication flows complete

### Performance Testing
- [ ] Page loads under 3 seconds on 3G
- [ ] Smooth scrolling (60fps)
- [ ] No janky animations
- [ ] Images lazy load properly
- [ ] Service worker caches assets

## Testing Tools

### Browser DevTools
```
Chrome: F12 → Device Toolbar (Ctrl+Shift+M)
Firefox: F12 → Responsive Design Mode (Ctrl+Shift+M)
Safari: Develop → Enter Responsive Design Mode
```

### Online Testing Services
1. **BrowserStack** - Real device testing
   - URL: https://browserstack.com
   - Free tier available for open source

2. **LambdaTest** - Cross-browser testing
   - URL: https://lambdatest.com
   - Automated screenshot testing

3. **Sauce Labs** - Enterprise testing
   - URL: https://saucelabs.com
   - CI/CD integration

### Local Testing
```bash
# iOS Simulator (macOS only)
open -a Simulator

# Android Emulator
# Install Android Studio, then:
emulator -avd Pixel_4_API_30
```

## Responsive Breakpoints

ChemCheck uses these breakpoints (Tailwind CSS):

| Breakpoint | Width | Target Devices |
|------------|-------|----------------|
| sm | 640px | Large phones |
| md | 768px | Tablets |
| lg | 1024px | Laptops |
| xl | 1280px | Desktops |
| 2xl | 1536px | Large screens |

## Common Issues & Fixes

### iOS Safari
```css
/* Fix 100vh issue */
.full-height {
  height: 100vh;
  height: -webkit-fill-available;
}

/* Fix input zoom */
input, select, textarea {
  font-size: 16px;
}

/* Fix sticky positioning */
.sticky-element {
  position: -webkit-sticky;
  position: sticky;
}
```

### Android Chrome
```css
/* Fix tap highlight */
* {
  -webkit-tap-highlight-color: transparent;
}

/* Fix overflow scrolling */
.scroll-container {
  -webkit-overflow-scrolling: touch;
}
```

### PWA Issues
```javascript
// Check if PWA is installed
const isStandalone = window.matchMedia('(display-mode: standalone)').matches;

// Handle iOS PWA
const isIOSPWA = window.navigator.standalone === true;
```

## Manual Testing Script

### Test Case 1: New User Flow
1. Open app in incognito/private mode
2. Sign up with new account
3. Complete setup wizard
4. Add first customer
5. Create service log
6. View history

### Test Case 2: Returning User
1. Open app (should be logged in)
2. View today's customers
3. Complete a service
4. Add notes
5. Check weekly report

### Test Case 3: Offline Mode
1. Enable airplane mode
2. Open app
3. View cached data
4. Try to add new data
5. Reconnect and sync

### Test Case 4: PWA Installation
1. Open app in mobile browser
2. Look for "Add to Home Screen" prompt
3. Install PWA
4. Open from home screen
5. Verify standalone mode

## Automated Visual Testing

### Percy (Visual Regression)
```javascript
// In your test file
import percySnapshot from '@percy/playwright';

test('homepage visual test', async ({ page }) => {
  await page.goto('/');
  await percySnapshot(page, 'Homepage');
});
```

### Playwright Screenshots
```javascript
// playwright.config.ts
export default {
  use: {
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
};
```

## Bug Report Template

```markdown
## Browser/Device Info
- Browser: Chrome 120
- OS: iOS 17.1
- Device: iPhone 15 Pro

## Steps to Reproduce
1. Navigate to /customers
2. Click "Add Customer"
3. Fill form and submit

## Expected Behavior
Customer should be added and list updated

## Actual Behavior
Form submits but list doesn't update

## Screenshots
[Attach screenshots]

## Console Errors
[Paste any console errors]
```

## Testing Schedule

| Test Type | Frequency | Browsers |
|-----------|-----------|----------|
| Smoke Test | Every deploy | Chrome, Safari |
| Full Regression | Weekly | All supported |
| Mobile Testing | Bi-weekly | iOS Safari, Android Chrome |
| PWA Testing | Monthly | All mobile browsers |

## Sign-off Checklist

Before release, confirm testing on:
- [ ] Chrome (Windows)
- [ ] Chrome (macOS)
- [ ] Safari (macOS)
- [ ] Safari (iOS)
- [ ] Chrome (Android)
- [ ] Firefox (Windows/macOS)
- [ ] Edge (Windows)
- [ ] PWA (iOS)
- [ ] PWA (Android)