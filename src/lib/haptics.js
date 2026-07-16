/**
 * Tactile feedback for field moments.
 *
 * Native (Capacitor) haptics when running in the iOS/Android shell,
 * navigator.vibrate on the mobile web, silent no-op everywhere else.
 * Never throws — feedback must never break the flow it celebrates.
 */

let nativeHapticsPromise = null;

function getNativeHaptics() {
  if (!nativeHapticsPromise) {
    nativeHapticsPromise = import('@capacitor/haptics')
      .then((mod) => mod.Haptics)
      .catch(() => null);
  }
  return nativeHapticsPromise;
}

function isNativeShell() {
  try {
    return Boolean(window?.Capacitor?.isNativePlatform?.());
  } catch {
    return false;
  }
}

function vibrateFallback(pattern) {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(pattern);
    }
  } catch {
    /* no tactile layer available */
  }
}

/** A reading/commit landed — light, crisp tick. */
export async function hapticTap() {
  if (isNativeShell()) {
    const haptics = await getNativeHaptics();
    try {
      await haptics?.impact({ style: 'light' });
      return;
    } catch {
      /* fall through to vibrate */
    }
  }
  vibrateFallback(8);
}

/** Service completed — the confirmation moment. */
export async function hapticSuccess() {
  if (isNativeShell()) {
    const haptics = await getNativeHaptics();
    try {
      await haptics?.notification({ type: 'success' });
      return;
    } catch {
      /* fall through to vibrate */
    }
  }
  vibrateFallback([12, 40, 18]);
}

/** Route finished for the day — the payoff. */
export async function hapticRouteComplete() {
  if (isNativeShell()) {
    const haptics = await getNativeHaptics();
    try {
      await haptics?.notification({ type: 'success' });
      return;
    } catch {
      /* fall through */
    }
  }
  vibrateFallback([18, 60, 24, 60, 32]);
}
