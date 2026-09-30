import { beforeEach, describe, expect, it } from 'vitest';
import {
  LAST_SIGNED_IN_USER_KEY,
  getLastSignedInUser,
  getStoredCurrentUserEmail,
  hashIdentity,
  isAccountChange,
  recordSignedInUser,
} from './sessionIdentity';

describe('isAccountChange', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('detects a signed-in account that differs from locally restored data', () => {
    expect(isAccountChange({ email: 'first@example.com' }, 'second@example.com')).toBe(true);
  });

  it('does not clear data when the same account refreshes', () => {
    expect(isAccountChange({ email: 'first@example.com' }, 'first@example.com')).toBe(false);
  });

  it('treats a login by a different email than the last-signed-in marker as an account change', () => {
    recordSignedInUser('First@Example.com');
    expect(isAccountChange(null, 'second@example.com')).toBe(true);
    expect(isAccountChange(undefined, 'first@example.com')).toBe(false);
  });

  it('does not treat a first login on a clean device as an account change', () => {
    expect(isAccountChange(null, 'first@example.com')).toBe(false);
  });

  it('accepts an explicit marker value', () => {
    expect(isAccountChange(null, 'second@example.com', 'first@example.com')).toBe(true);
    expect(isAccountChange(null, 'second@example.com', '')).toBe(false);
  });
});

describe('signed-in marker', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('stores the normalized email under the marker key', () => {
    recordSignedInUser('  Tech@Example.com ');
    expect(localStorage.getItem(LAST_SIGNED_IN_USER_KEY)).toBe('tech@example.com');
    expect(getLastSignedInUser()).toBe('tech@example.com');
  });

  it('reads the current user email from the stored user marker', () => {
    expect(getStoredCurrentUserEmail()).toBe('');
    localStorage.setItem('chemcheck_current_user', JSON.stringify({ email: 'Owner@Example.com' }));
    expect(getStoredCurrentUserEmail()).toBe('owner@example.com');
  });
});

describe('hashIdentity', () => {
  it('is deterministic, case-insensitive and does not contain the email', () => {
    const hash = hashIdentity('Tech@Example.com');
    expect(hash).toBe(hashIdentity('tech@example.com'));
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(hash).not.toContain('@');
    expect(hashIdentity('other@example.com')).not.toBe(hash);
    expect(hashIdentity('')).toBe('anonymous');
  });
});
