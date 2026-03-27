type AuthBypassReason = "disabled" | "localhost" | "ios-simulator" | "none";
type AuthBypassSource = "Clerk" | "Convex";

const emittedWarnings = new Set<string>();

export function warnAuthBypassOnce(source: AuthBypassSource, reason: AuthBypassReason): void {
  if (reason === "none") return;

  const key = `${source}:${reason}`;
  if (emittedWarnings.has(key)) return;

  emittedWarnings.add(key);
  console.warn(`[AuthPolicy] ${source} bypass enabled via ${reason}`);
}

export function resetAuthBypassWarningCacheForTests(): void {
  emittedWarnings.clear();
}
