/**
 * Compatibility wrapper for legacy imports.
 *
 * The app now uses ClerkAuthProvider as the single source of truth for auth.
 * Keep this file so older imports keep working without creating a second auth stack.
 */

import { ClerkAuthProvider, useAuthContext as useClerkAuthContext } from './ClerkAuthProvider';

export function AuthProvider({ children }) {
  return <ClerkAuthProvider>{children}</ClerkAuthProvider>;
}

export function useAuthContext() {
  return useClerkAuthContext();
}

// Legacy helper kept for backward compatibility.
export const refreshAuthState = async () => null;

export default AuthProvider;
