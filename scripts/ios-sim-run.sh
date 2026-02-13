#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
IOS_DIR="$ROOT_DIR/ios/App"
SIM_NAME="${IOS_SIM_NAME:-iPhone 17 Pro}"
SCHEME="App"
PROJECT="App.xcodeproj"
BUNDLE_ID="com.chemcheck.app"

find_sim_udid() {
  xcrun simctl list devices available \
    | grep "$SIM_NAME" \
    | head -n 1 \
    | sed -E 's/.*\(([0-9A-F-]+)\).*/\1/'
}

SIM_UDID="$(find_sim_udid)"
if [[ -z "${SIM_UDID}" ]]; then
  echo "No available simulator found for '$SIM_NAME'."
  echo "Set IOS_SIM_NAME to an available simulator name and retry."
  exit 1
fi

cd "$ROOT_DIR"
npm run build
npx cap sync ios

build_with_mode() {
  local mode="$1"
  local derived_data="$2"

  if [[ "$mode" == "signed" ]]; then
    xcodebuild \
      -project "$PROJECT" \
      -scheme "$SCHEME" \
      -configuration Debug \
      -destination "platform=iOS Simulator,id=$SIM_UDID" \
      -derivedDataPath "$derived_data" \
      build
  else
    xcodebuild \
      -project "$PROJECT" \
      -scheme "$SCHEME" \
      -configuration Debug \
      -destination "platform=iOS Simulator,id=$SIM_UDID" \
      -derivedDataPath "$derived_data" \
      CODE_SIGNING_ALLOWED=NO \
      CODE_SIGNING_REQUIRED=NO \
      build
  fi
}

cd "$IOS_DIR"
SIGNED_DERIVED="build/codex-sim-signed"
NOSIGN_DERIVED="build/codex-sim-nosign"
APP_PATH=""

if build_with_mode "signed" "$SIGNED_DERIVED"; then
  APP_PATH="$IOS_DIR/$SIGNED_DERIVED/Build/Products/Debug-iphonesimulator/App.app"
else
  echo "Signed simulator build failed. Falling back to no-sign simulator build."
  build_with_mode "nosign" "$NOSIGN_DERIVED"
  APP_PATH="$IOS_DIR/$NOSIGN_DERIVED/Build/Products/Debug-iphonesimulator/App.app"
fi

xcrun simctl boot "$SIM_UDID" || true
xcrun simctl bootstatus "$SIM_UDID" -b
xcrun simctl install "$SIM_UDID" "$APP_PATH"
LAUNCH_OUTPUT="$(xcrun simctl launch "$SIM_UDID" "$BUNDLE_ID")"

echo "Launched $BUNDLE_ID on $SIM_NAME ($SIM_UDID)"
echo "$LAUNCH_OUTPUT"
