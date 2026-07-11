import { beforeEach, describe, expect, it } from 'vitest';
import { clearChemCheckBrowserStorage } from './sessionCleanup';

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
});
