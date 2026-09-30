import { db } from '@/db/chemcheck-db';
import { clearAllPhotos } from '@/lib/proof-of-service/offlinePhotoStorage';
import { serviceWorkerManager } from '@/lib/serviceWorker';

/**
 * Explicit registry of every localStorage / sessionStorage key or key prefix
 * the app owns and that may hold account-specific data. Everything listed here
 * is removed on logout and on account change.
 *
 * Add new account-scoped keys here when introducing them; a key that is not
 * listed survives logout and can leak to the next account on a shared device.
 */
export const APP_STORAGE_KEY_PREFIXES: readonly string[] = [
  'chemcheck_',
  'chemcheck.',
  'chemcheck-sync',
  'rateLimit_',
  'business_',
  'user_',
  'serviceLogDraft_',
  'skipped_services_',
  'emergencyBackup',
  'lastAutoBackup',
  'monitoring_',
];

export const APP_STORAGE_KEYS: readonly string[] = [
  'emergencyBackup',
  'lastAutoBackup',
  'migration_state',
  'optimized_routes',
  'scheduled_notifications',
  'notification_config',
];

/**
 * Device-level preferences that must survive logout. Analytics opt-out in
 * particular must never be reset by signing out.
 */
export const PRESERVED_STORAGE_KEYS: readonly string[] = [
  'analytics_opt_out',
  'chemcheck-theme',
  'chemcheck_last_signed_in_user',
];

export const PRESERVED_STORAGE_KEY_PREFIXES: readonly string[] = ['ga-disable-'];

export function isPreservedStorageKey(key: string): boolean {
  if (PRESERVED_STORAGE_KEYS.includes(key)) return true;
  return PRESERVED_STORAGE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export function isAppOwnedStorageKey(key: string): boolean {
  if (isPreservedStorageKey(key)) return false;
  if (APP_STORAGE_KEYS.includes(key)) return true;
  return APP_STORAGE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function clearChemCheckKeys(storage: Storage): void {
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
    .filter((key): key is string => key !== null);
  for (const key of keys) {
    if (isAppOwnedStorageKey(key)) storage.removeItem(key);
  }
}

export function clearChemCheckBrowserStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    clearChemCheckKeys(window.localStorage);
  } catch (error) {
    console.warn('[SessionCleanup] localStorage cleanup failed:', error);
  }
  try {
    clearChemCheckKeys(window.sessionStorage);
  } catch (error) {
    console.warn('[SessionCleanup] sessionStorage cleanup failed:', error);
  }
}

async function runWithRetry(label: string, operation: () => Promise<unknown>): Promise<void> {
  try {
    await operation();
  } catch (firstError) {
    console.error(`[SessionCleanup] ${label} failed, retrying once:`, firstError);
    try {
      await operation();
    } catch (secondError) {
      console.error(`[SessionCleanup] ${label} failed after retry:`, secondError);
      throw secondError instanceof Error
        ? secondError
        : new Error(`${label} failed: ${String(secondError)}`);
    }
  }
}

/**
 * Wipe every account-scoped artifact on this device: IndexedDB, offline
 * photos, service-worker caches, and app-owned browser storage. A failure to
 * delete the local database is retried once and then re-thrown so callers
 * never continue as if the device were clean.
 */
export async function clearChemCheckSessionData(): Promise<void> {
  await runWithRetry('IndexedDB delete', () => db.delete());
  await Promise.all([
    runWithRetry('offline photo cleanup', () => clearAllPhotos()),
    runWithRetry('service worker cache cleanup', () => serviceWorkerManager.clearCaches()),
  ]);
  clearChemCheckBrowserStorage();
}
