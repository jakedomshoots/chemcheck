import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dbDelete: vi.fn(),
  clearAllPhotos: vi.fn(),
  clearCaches: vi.fn(),
}));

vi.mock('@/db/chemcheck-db', () => ({ db: { delete: mocks.dbDelete } }));
vi.mock('@/lib/proof-of-service/offlinePhotoStorage', () => ({ clearAllPhotos: mocks.clearAllPhotos }));
vi.mock('@/lib/serviceWorker', () => ({ serviceWorkerManager: { clearCaches: mocks.clearCaches } }));

import {
  clearChemCheckBrowserStorage,
  clearChemCheckSessionData,
  isAppOwnedStorageKey,
  isPreservedStorageKey,
} from './sessionCleanup';

describe('clearChemCheckBrowserStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('removes only ChemCheck keys from local and session storage', () => {
    localStorage.setItem('chemcheck_current_user', 'user');
    localStorage.setItem('other_app', 'keep');
    sessionStorage.setItem('chemcheck_draft', 'draft');
    clearChemCheckBrowserStorage();
    expect(localStorage.getItem('chemcheck_current_user')).toBeNull();
    expect(sessionStorage.getItem('chemcheck_draft')).toBeNull();
    expect(localStorage.getItem('other_app')).toBe('keep');
  });

  it('removes every app-owned key that previously survived logout', () => {
    localStorage.setItem('emergencyBackup', '{"customers":[{"gate_code":"1234"}]}');
    localStorage.setItem('emergencyBackup.abc123', '{}');
    localStorage.setItem('chemcheck.reportSendQueue', '[]');
    localStorage.setItem('chemcheck.reportSendQueue.abc123', '[]');
    localStorage.setItem('migration_state', '{}');
    localStorage.setItem('lastAutoBackup', 'now');
    localStorage.setItem('lastAutoBackup.abc123', 'now');
    localStorage.setItem('rateLimit_customers', '3');
    localStorage.setItem('serviceLogDraft_1', '{}');
    localStorage.setItem('optimized_routes', '[]');
    localStorage.setItem('timeTracker_42', '{}');
    localStorage.setItem('photo_error_log', '[]');

    clearChemCheckBrowserStorage();

    for (const key of [
      'emergencyBackup', 'emergencyBackup.abc123', 'chemcheck.reportSendQueue', 'chemcheck.reportSendQueue.abc123',
      'migration_state', 'lastAutoBackup', 'lastAutoBackup.abc123', 'rateLimit_customers', 'serviceLogDraft_1', 'optimized_routes',
      'timeTracker_42', 'photo_error_log',
    ]) {
      expect(localStorage.getItem(key), key).toBeNull();
    }
  });

  it('preserves only analytics opt-out and theme preferences', () => {
    localStorage.setItem('analytics_opt_out', 'true');
    localStorage.setItem('ga-disable-G-123', 'true');
    localStorage.setItem('chemcheck_last_signed_in_user', 'first@example.com');
    localStorage.setItem('chemcheck-theme', 'dark');

    clearChemCheckBrowserStorage();

    expect(localStorage.getItem('analytics_opt_out')).toBe('true');
    expect(localStorage.getItem('ga-disable-G-123')).toBe('true');
    expect(localStorage.getItem('chemcheck_last_signed_in_user')).toBeNull();
    expect(localStorage.getItem('chemcheck-theme')).toBe('dark');
    expect(isPreservedStorageKey('analytics_opt_out')).toBe(true);
    expect(isAppOwnedStorageKey('chemcheck_last_signed_in_user')).toBe(true);
    expect(isAppOwnedStorageKey('chemcheck_users')).toBe(true);
  });
});

describe('clearChemCheckSessionData', () => {
  beforeEach(() => {
    localStorage.clear();
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.clearAllPhotos.mockResolvedValue(undefined);
    mocks.clearCaches.mockResolvedValue(undefined);
  });

  it('deletes the database before clearing browser storage', async () => {
    localStorage.setItem('chemcheck_current_user', '{"email":"a@example.com"}');
    mocks.dbDelete.mockResolvedValue(undefined);
    await clearChemCheckSessionData();
    expect(mocks.dbDelete).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('chemcheck_current_user')).toBeNull();
  });

  it('retries a failed database delete once and then succeeds', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.dbDelete.mockRejectedValueOnce(new Error('blocked')).mockResolvedValueOnce(undefined);
    await clearChemCheckSessionData();
    expect(mocks.dbDelete).toHaveBeenCalledTimes(2);
    consoleError.mockRestore();
  });

  it('throws (and leaves storage untouched) when the database cannot be deleted', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    localStorage.setItem('chemcheck_current_user', '{"email":"a@example.com"}');
    mocks.dbDelete.mockRejectedValue(new Error('blocked'));
    await expect(clearChemCheckSessionData()).rejects.toThrow('blocked');
    expect(mocks.dbDelete).toHaveBeenCalledTimes(2);
    expect(consoleError).toHaveBeenCalled();
    expect(localStorage.getItem('chemcheck_current_user')).not.toBeNull();
    consoleError.mockRestore();
  });
});
