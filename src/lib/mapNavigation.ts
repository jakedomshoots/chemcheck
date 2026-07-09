/**
 * Build platform-aware navigation URLs for mobile and desktop.
 *
 * iOS devices open Apple Maps; everything else falls back to Google Maps.
 */

export function encodeMapQuery(value: string): string {
  return encodeURIComponent(value.trim());
}

export interface NavigationDestination {
  address?: string;
  latitude?: number;
  longitude?: number;
}

function destinationQuery(destination: string | NavigationDestination): string {
  if (typeof destination === "string") return destination.trim();
  if (Number.isFinite(destination.latitude) && Number.isFinite(destination.longitude)) {
    return `${destination.latitude},${destination.longitude}`;
  }
  return destination.address?.trim() || "";
}

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const userAgent = navigator.userAgent || "";
  return /iPad|iPhone|iPod/.test(userAgent) && !(window as { MSStream?: unknown }).MSStream;
}

export function buildNavigationUrl(destination: string | NavigationDestination): string {
  const encoded = encodeMapQuery(destinationQuery(destination));
  if (isIOS()) {
    return `https://maps.apple.com/?daddr=${encoded}&dirflg=d`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${encoded}`;
}

export function openNavigation(destination: string | NavigationDestination): void {
  if (!destinationQuery(destination)) return;
  window.open(buildNavigationUrl(destination), "_blank", "noopener,noreferrer");
}
