import { db } from '@/db/chemcheck-db';
import { clearAllPhotos } from '@/lib/proof-of-service/offlinePhotoStorage';
import { serviceWorkerManager } from '@/lib/serviceWorker';

function clearChemCheckKeys(storage: Storage): void {
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
    .filter((key): key is string => key !== null);
  for (const key of keys) {
    if (key.startsWith('chemcheck_')) storage.removeItem(key);
  }
}

export function clearChemCheckBrowserStorage(): void {
  if (typeof window === 'undefined') return;
  clearChemCheckKeys(window.localStorage);
  clearChemCheckKeys(window.sessionStorage);
}

export async function clearChemCheckSessionData(): Promise<void> {
  await Promise.all([
    db.delete(),
    clearAllPhotos(),
    serviceWorkerManager.clearCaches(),
  ]);
  clearChemCheckBrowserStorage();
}
