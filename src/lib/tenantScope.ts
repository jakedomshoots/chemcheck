export interface TenantScope {
  userEmail: string;
  businessId: string;
  key: string;
}

const TENANT_SCOPE_EVENT = 'chemcheck:tenant-scope-changed';
let activeScope: TenantScope | null = null;

function normalize(value: unknown): string {
  return String(value || '').trim();
}

function emitScopeChange(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(TENANT_SCOPE_EVENT));
}

/**
 * This must only be called from the authenticated Clerk boundary. LocalStorage
 * is never used as an authority for a tenant; it is only a cache below this
 * scope once Clerk has supplied both values.
 */
export function setActiveTenantScope(input: { userEmail: string; businessId: string }): TenantScope {
  const userEmail = normalize(input.userEmail).toLowerCase();
  const businessId = normalize(input.businessId);
  if (!userEmail || !businessId) throw new Error('Authenticated user and active business are required');

  activeScope = { userEmail, businessId, key: `${businessId}:${userEmail}` };
  emitScopeChange();
  return activeScope;
}

export function clearActiveTenantScope(): void {
  activeScope = null;
  emitScopeChange();
}

export function getActiveTenantScope(): TenantScope | null {
  return activeScope;
}

export function requireActiveTenantScope(): TenantScope {
  const scope = getActiveTenantScope();
  if (!scope) throw new Error('No authenticated tenant is active');
  return scope;
}

export function subscribeTenantScope(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(TENANT_SCOPE_EVENT, listener);
  return () => window.removeEventListener(TENANT_SCOPE_EVENT, listener);
}
