import { APP_ROUTES } from '@/lib/routeConfig';

export const BOTTOM_NAV_STORAGE_KEY = 'chemcheck_bottom_navigation_v1';
export const BOTTOM_NAV_CHANGE_EVENT = 'chemcheck:bottom-navigation-change';
export const BOTTOM_NAV_MIN_ITEMS = 2;
export const BOTTOM_NAV_MAX_ITEMS = 4;

export const MOBILE_NAV_ITEMS = [
  { id: 'home', name: 'Home', shortLabel: 'Home', path: APP_ROUTES.Home, icon: 'home' },
  { id: 'clients', name: 'Clients', shortLabel: 'Clients', path: APP_ROUTES.Clients, icon: 'clients' },
  { id: 'workOrders', name: 'Work Orders', shortLabel: 'Work', path: APP_ROUTES.WorkOrders, icon: 'workOrders' },
  { id: 'reports', name: 'Reports', shortLabel: 'Reports', path: APP_ROUTES.WeeklyReport, icon: 'report' },
  { id: 'notes', name: 'Notes', shortLabel: 'Notes', path: APP_ROUTES.Notes, icon: 'notes' },
  { id: 'chemicals', name: 'Chemicals', shortLabel: 'Chemicals', path: APP_ROUTES.ChemicalUsage, icon: 'chemicals' },
  { id: 'route', name: 'Route Plan', shortLabel: 'Route', path: APP_ROUTES.RouteOptimizer, icon: 'route' },
  { id: 'poolSchool', name: 'Pool School', shortLabel: 'School', path: APP_ROUTES.PoolSchool, icon: 'poolSchool' },
  { id: 'settings', name: 'Settings', shortLabel: 'Settings', path: APP_ROUTES.Settings, icon: 'settings' },
] as const;

export type MobileNavId = (typeof MOBILE_NAV_ITEMS)[number]['id'];
export type MobileNavItem = (typeof MOBILE_NAV_ITEMS)[number];

export const DEFAULT_BOTTOM_NAV_IDS: MobileNavId[] = ['home', 'clients', 'chemicals', 'notes'];

const validIds = new Set<MobileNavId>(MOBILE_NAV_ITEMS.map((item) => item.id));
let lastKnownNavigation: MobileNavId[] | null = null;
let usingMemoryFallback = false;

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function getRawItems(value: unknown): unknown[] | null {
  // Setters pass an array; persisted reads pass the versioned { items } payload.
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && Array.isArray((value as { items?: unknown }).items)) {
    return (value as { items: unknown[] }).items;
  }
  return null;
}

export function normalizeBottomNavigation(value: unknown): MobileNavId[] {
  const rawItems = getRawItems(value);
  if (!rawItems) return [...DEFAULT_BOTTOM_NAV_IDS];

  const normalized: MobileNavId[] = [];
  for (const candidate of rawItems) {
    if (
      typeof candidate === 'string'
      && validIds.has(candidate as MobileNavId)
      && !normalized.includes(candidate as MobileNavId)
    ) {
      normalized.push(candidate as MobileNavId);
    }
    if (normalized.length === BOTTOM_NAV_MAX_ITEMS) break;
  }

  if (normalized.length === 0) return [...DEFAULT_BOTTOM_NAV_IDS];

  for (const fallback of DEFAULT_BOTTOM_NAV_IDS) {
    if (normalized.length >= BOTTOM_NAV_MIN_ITEMS) break;
    if (!normalized.includes(fallback)) normalized.push(fallback);
  }

  return normalized.slice(0, BOTTOM_NAV_MAX_ITEMS);
}

export function getBottomNavigation(): MobileNavId[] {
  if (usingMemoryFallback && lastKnownNavigation) return [...lastKnownNavigation];

  const storage = getStorage();
  if (!storage) return lastKnownNavigation ? [...lastKnownNavigation] : [...DEFAULT_BOTTOM_NAV_IDS];

  try {
    const stored = storage.getItem(BOTTOM_NAV_STORAGE_KEY);
    if (!stored) {
      lastKnownNavigation = [...DEFAULT_BOTTOM_NAV_IDS];
      return [...DEFAULT_BOTTOM_NAV_IDS];
    }

    const normalized = normalizeBottomNavigation(JSON.parse(stored));
    lastKnownNavigation = normalized;
    usingMemoryFallback = false;
    return [...normalized];
  } catch {
    lastKnownNavigation = [...DEFAULT_BOTTOM_NAV_IDS];
    return [...DEFAULT_BOTTOM_NAV_IDS];
  }
}

function announceNavigationChange(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(BOTTOM_NAV_CHANGE_EVENT));
}

export function setBottomNavigation(value: unknown): MobileNavId[] {
  const normalized = normalizeBottomNavigation(value);
  lastKnownNavigation = normalized;

  try {
    getStorage()?.setItem(BOTTOM_NAV_STORAGE_KEY, JSON.stringify({
      version: 1,
      items: normalized,
    }));
    usingMemoryFallback = false;
  } catch {
    // Keep the in-memory preference for this session when storage is unavailable.
    usingMemoryFallback = true;
  }

  announceNavigationChange();
  return [...normalized];
}

export function resetBottomNavigation(): MobileNavId[] {
  lastKnownNavigation = [...DEFAULT_BOTTOM_NAV_IDS];
  try {
    getStorage()?.removeItem(BOTTOM_NAV_STORAGE_KEY);
    usingMemoryFallback = false;
  } catch {
    // The default still applies in memory when storage is unavailable.
    usingMemoryFallback = true;
  }
  announceNavigationChange();
  return [...DEFAULT_BOTTOM_NAV_IDS];
}

export function subscribeBottomNavigation(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;

  const handleStorage = (event: StorageEvent) => {
    if (event.key === BOTTOM_NAV_STORAGE_KEY) listener();
  };
  window.addEventListener(BOTTOM_NAV_CHANGE_EVENT, listener);
  window.addEventListener('storage', handleStorage);

  return () => {
    window.removeEventListener(BOTTOM_NAV_CHANGE_EVENT, listener);
    window.removeEventListener('storage', handleStorage);
  };
}

export function getMobileNavItems(ids: readonly MobileNavId[]): MobileNavItem[] {
  return ids
    .map((id) => MOBILE_NAV_ITEMS.find((item) => item.id === id))
    .filter((item): item is MobileNavItem => Boolean(item));
}

export function getOverflowNavItems(ids: readonly MobileNavId[]): MobileNavItem[] {
  const selectedIds = new Set(ids);
  return MOBILE_NAV_ITEMS.filter((item) => !selectedIds.has(item.id));
}
