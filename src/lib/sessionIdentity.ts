type LocalUser = { email?: string | null } | null | undefined;

/**
 * Marker for the last account that signed in on this device. It is written on
 * login and deliberately NOT removed on logout, so that a later login by a
 * different account is still recognised as an account change even when the
 * current-user marker was already cleared.
 */
export const LAST_SIGNED_IN_USER_KEY = 'chemcheck_last_signed_in_user';

export function normalizeIdentityEmail(email: unknown): string {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

/**
 * Deterministic, non-reversible short hash of an email used to scope
 * per-account browser storage keys (report queue, emergency backup) and to
 * identify the user in telemetry without sending the address itself.
 */
export function hashIdentity(email: unknown): string {
  const normalized = normalizeIdentityEmail(email);
  if (!normalized) return 'anonymous';
  // FNV-1a 32-bit, run twice with different seeds for a 16-hex-char digest.
  const fnv = (seed: number): string => {
    let hash = seed >>> 0;
    for (let index = 0; index < normalized.length; index++) {
      hash ^= normalized.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  };
  return `${fnv(0x811c9dc5)}${fnv(0x9747b28c)}`;
}

function safeStorage(kind: 'localStorage' | 'sessionStorage'): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window[kind] ?? null;
  } catch {
    return null;
  }
}

/** Email of the user currently stored by userManager, or '' when signed out. */
export function getStoredCurrentUserEmail(): string {
  for (const kind of ['sessionStorage', 'localStorage'] as const) {
    const storage = safeStorage(kind);
    if (!storage) continue;
    try {
      const raw = storage.getItem('chemcheck_current_user');
      if (!raw) continue;
      const parsed = JSON.parse(raw) as { email?: unknown };
      const email = normalizeIdentityEmail(parsed?.email);
      if (email) return email;
    } catch {
      // Malformed user marker; treat as signed out.
    }
  }
  return '';
}

export function getLastSignedInUser(): string {
  const storage = safeStorage('localStorage');
  if (!storage) return '';
  try {
    return normalizeIdentityEmail(storage.getItem(LAST_SIGNED_IN_USER_KEY));
  } catch {
    return '';
  }
}

export function recordSignedInUser(email: string): void {
  const storage = safeStorage('localStorage');
  const normalized = normalizeIdentityEmail(email);
  if (!storage || !normalized) return;
  try {
    storage.setItem(LAST_SIGNED_IN_USER_KEY, normalized);
  } catch {
    // Storage unavailable (private mode); the in-memory user marker still applies.
  }
}

/**
 * True when the account that just authenticated differs from the account whose
 * offline data may still be on this device. Both the current local user and the
 * persistent last-signed-in marker are consulted so that a logout that only
 * cleared the current-user marker cannot hand user A's IndexedDB to user B.
 */
export function isAccountChange(
  localUser: LocalUser,
  authenticatedEmail: string,
  lastSignedInEmail: string | null | undefined = getLastSignedInUser()
): boolean {
  const authenticated = normalizeIdentityEmail(authenticatedEmail);
  if (!authenticated) return false;

  const local = normalizeIdentityEmail(localUser?.email);
  if (local && local !== authenticated) return true;

  const last = normalizeIdentityEmail(lastSignedInEmail);
  if (last && last !== authenticated) return true;

  return false;
}
