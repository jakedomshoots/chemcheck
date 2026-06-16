#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
IOS_DIR="$ROOT_DIR/ios/App"
SCHEME="App"
PROJECT="App.xcodeproj"
ARCHIVE_PATH="$IOS_DIR/build/ChemCheck.xcarchive"

echo "Building production web assets and syncing Capacitor..."
cd "$ROOT_DIR"
npm run build
npx cap sync ios

echo "Archiving iOS project..."
cd "$IOS_DIR"
xcodebuild archive \
  -project "$PROJECT" \
  -scheme "$SCHEME" \
  -destination "generic/platform=iOS" \
  -archivePath "$ARCHIVE_PATH"

echo ""
echo "Archive created at:"
echo "  $ARCHIVE_PATH"
echo ""
echo "Next steps for TestFlight / App Store:"
echo "1. Open Xcode manually: npx cap open ios"
echo "2. Choose Window -> Organizer."
echo "3. Select the archive and click Distribute App."
