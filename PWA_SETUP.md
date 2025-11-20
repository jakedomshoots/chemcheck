# PWA Icon Setup

## What I Added

✅ **PWA Manifest** (`public/manifest.json`)
- Tells iOS/Android how to run your app in standalone mode
- Sets theme color and app name

✅ **iOS Meta Tags** (in `index.html`)
- `apple-mobile-web-app-capable` - Enables standalone mode
- `apple-mobile-web-app-status-bar-style` - Status bar appearance
- `apple-mobile-web-app-title` - App name on home screen

## Icons Needed

The manifest references these icons (you need to create them):
- `/public/icon-192.png` (192x192 pixels)
- `/public/icon-512.png` (512x512 pixels)

### Quick Icon Generation

**Option 1: Use an online tool**
1. Go to https://realfavicongenerator.net/
2. Upload your logo
3. Download the generated icons
4. Place them in the `/public` folder

**Option 2: Use a simple colored square (temporary)**
- I can generate a basic cyan square icon for you
- Replace with your actual logo later

## Deploy

Once you have icons:

```bash
git add .
git commit -m "Add PWA support for standalone app mode"
git push
```

## Test

After deployment:
1. Open on iPhone Safari
2. Tap Share → "Add to Home Screen"
3. Open from home screen
4. **Should now stay in app** (no Safari UI!) ✅

The key changes:
- `"display": "standalone"` in manifest
- `apple-mobile-web-app-capable` meta tag
- These make iOS open it as a full-screen app, not in Safari!
