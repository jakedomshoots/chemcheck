#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MODE="pre-xcode"
SKIP_E2E="false"
SKIP_UNIT="false"

usage() {
  cat <<'EOF'
Usage: scripts/app-store-preflight.sh [--pre-xcode|--full] [--skip-e2e] [--skip-unit]

Runs the App Store readiness gate for the parked Capacitor iOS shell.

Modes:
  --pre-xcode  Run all local web/native-sync checks and report Xcode status without failing on missing Xcode. Default.
  --full       Require full Xcode and validate the iOS project is listable by xcodebuild.

Options:
  --skip-e2e   Skip Chromium Playwright E2E.
  --skip-unit  Skip the full Vitest suite.
  --help       Show this help.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pre-xcode)
      MODE="pre-xcode"
      ;;
    --full)
      MODE="full"
      ;;
    --skip-e2e)
      SKIP_E2E="true"
      ;;
    --skip-unit)
      SKIP_UNIT="true"
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

run() {
  echo ""
  echo "==> $*"
  "$@"
}

run_env() {
  echo ""
  echo "==> $*"
  env "$@"
}

warn() {
  echo "WARN: $*" >&2
}

cd "$ROOT_DIR"

run npm run test:gates
run npm run lint
run npm run build
run npm audit --audit-level=high

if [[ "$SKIP_UNIT" != "true" ]]; then
  run npm test -- --reporter=dot
else
  warn "Skipping full unit suite by request."
fi

if [[ "$SKIP_E2E" != "true" ]]; then
  run_env PLAYWRIGHT_PORT="${PLAYWRIGHT_PORT:-5174}" npm run test:e2e -- --project=chromium
else
  warn "Skipping Chromium E2E by request."
fi

run npm run ios:sync
run plutil -lint ios/App/App/Info.plist ios/App/App/PrivacyInfo.xcprivacy

if [[ ! -f docs/app-store-env.example ]]; then
  warn "docs/app-store-env.example is missing."
fi

echo ""
echo "==> Checking Xcode toolchain"
if xcodebuild -version; then
  run xcodebuild -list -project ios/App/App.xcodeproj
else
  if [[ "$MODE" == "full" ]]; then
    echo "Full Xcode is required for --full mode." >&2
    exit 1
  fi
  warn "Full Xcode is not active. Install Xcode and run: sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer"
fi

echo ""
echo "Preflight complete for mode: $MODE"
