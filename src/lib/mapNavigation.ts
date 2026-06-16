/**
 * Build platform-aware navigation URLs for mobile and desktop.
 *
 * iOS devices open Apple Maps; everything else falls back to Google Maps.
 */

export function encodeMapQuery(value: string): string {
  return encodeURIComponent(value.trim());
}

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const userAgent = navigator.userAgent || "";
  return /iPad|iPhone|iPod/.test(userAgent) && !(window as { MSStream?: unknown }).MSStream;
}

export function buildNavigationUrl(address: string): string {
  const encoded = encodeMapQuery(address);
  if (isIOS()) {
    return `https://maps.apple.com/?daddr=${encoded}&dirflg=d`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${encoded}`;
}

export function openNavigation(address: string): void {
  if (!address) return;
  window.open(buildNavigationUrl(address), "_blank", "noopener,noreferrer");
}
