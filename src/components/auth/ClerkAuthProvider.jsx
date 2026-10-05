import { ClerkProvider, useAuth, useUser } from '@clerk/clerk-react';
import { createContext, useContext, useEffect, useState } from 'react';
import { logLogin, logLogout } from '@/lib/auditLog';
import { setUserContext, clearUserContext } from '@/lib/sentry';
import { warnAuthBypassOnce } from '@/lib/authBypassWarning';
import { normalizeConvexUrl } from '@/lib/convexUrl';
import { clearChemCheckSessionData } from '@/lib/sessionCleanup';
import { hashIdentity, isAccountChange, recordSignedInUser } from '@/lib/sessionIdentity';
import {
  getAuthBypassReason,
  shouldUseDevelopmentAuthBypass,
} from '@/lib/platformPolicy';

// Get Clerk publishable key from environment
const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const clerkDomain = import.meta.env.VITE_CLERK_DOMAIN;
const isDevBypass = shouldUseDevelopmentAuthBypass();
const authBypassReason = getAuthBypassReason();

// Auth context for app-wide auth state
const AuthContext = createContext(null);

export function useAuthContext() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuthContext must be used within ClerkAuthProvider');
  }
  return context;
}

let userManagerModulePromise = null;
async function getUserManager() {
  if (!userManagerModulePromise) {
    userManagerModulePromise = import('@/lib/userManager');
  }
  const { userManager } = await userManagerModulePromise;
  return userManager;
}

let syncServiceModulePromise = null;
/**
 * Clear the in-memory sync queue, in-flight state and pull watermark so a
 * different account never inherits another account's pending pushes. The
 * sync module is loaded lazily and the reset is optional-chained because the
 * method may be absent in older builds.
 */
async function resetSyncForAccountChange() {
  try {
    if (!syncServiceModulePromise) {
      syncServiceModulePromise = import('@/lib/sync/SyncService');
    }
    const syncModule = await syncServiceModulePromise;
    await syncModule?.syncService?.resetForAccountChange?.();
  } catch (error) {
    console.warn('Sync reset for account change skipped:', error);
  }
}

/**
 * Wipe every account-scoped artifact on this device. Cleanup failures are
 * re-thrown (after the retry inside clearChemCheckSessionData) so the caller
 * never proceeds with another account's data still on disk.
 */
async function wipeLocalAccountData() {
  await resetSyncForAccountChange();
  await clearChemCheckSessionData();
}

let apiModulePromise = null;
async function getApi() {
  if (!apiModulePromise) {
    apiModulePromise = import('../../../convex/_generated/api');
  }
  const { api } = await apiModulePromise;
  return api;
}

async function getCurrentBusinessFromConvex(getToken, tokenAudience) {
  const convexUrl = normalizeConvexUrl(import.meta.env.VITE_CONVEX_URL);
  if (!convexUrl) {
    throw new Error('VITE_CONVEX_URL is not configured');
  }

  const tokenOptions = tokenAudience === 'convex'
    ? { skipCache: true }
    : { template: 'convex', skipCache: true };
  const token = await getToken(tokenOptions);
  if (!token) {
    throw new Error('Unable to authenticate the Convex business lookup');
  }

  // Use a one-shot authenticated client here. The app-wide React client is
  // owned by ConvexProviderWithClerk and should not be reconfigured during
  // local account bootstrap.
  const [{ ConvexHttpClient }, api] = await Promise.all([
    import('convex/browser'),
    getApi(),
  ]);
  const convexClient = new ConvexHttpClient(convexUrl);
  convexClient.setAuth(token);
  return convexClient.query(api.businesses.getCurrent);
}

// Inner provider that has access to Clerk hooks
function AuthContextProvider({ children }) {
  const { isLoaded, isSignedIn, userId, signOut, getToken, sessionClaims } = useAuth();
  const { user } = useUser();
  const tokenAudience = sessionClaims?.aud;
  const [localUser, setLocalUser] = useState(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [authError, setAuthError] = useState(null);

  // Function to sync/refresh user state from userManager
  const refreshUser = async () => {
    if (!user) return null;

    const email = user.primaryEmailAddress?.emailAddress || '';
    if (!email) return null;

    const userManager = await getUserManager();

    // Get the current user from userManager (checks localStorage)
    let existingUser = userManager.getCurrentUser();

    // If no current user or email doesn't match, try to login
    if (!existingUser || existingUser.email !== email) {
      existingUser = await userManager.loginUser(email);
    }

    try {
      const convexBusiness = await getCurrentBusinessFromConvex(getToken, tokenAudience);
      if (convexBusiness) {
        const { user: bootstrappedUser } = await userManager.bootstrapFromConvex(convexBusiness, email);
        setLocalUser(bootstrappedUser);
        return bootstrappedUser;
      }
    } catch (convexError) {
      console.warn('Failed to refresh cloud business:', convexError);
    }

    setLocalUser(existingUser);
    return existingUser;
  };

  useEffect(() => {
    if (!isLoaded) return;

    const syncUser = async () => {
      try {
        if (isSignedIn && user) {
          const userManager = await getUserManager();
          const email = user.primaryEmailAddress?.emailAddress || '';

          if (!email) {
            setAuthError('No email address found. Please ensure your account has a verified email.');
            setIsInitialized(true);
            return;
          }

          // Try to find existing user in localStorage
          let existingUser = userManager.getCurrentUser();

          // Do not let a newly authenticated account restore another account's
          // offline state. This also covers a device where the previous account
          // was logged out without the cleanup wrapper: the persistent
          // last-signed-in marker still identifies the earlier account.
          if (isAccountChange(existingUser, email)) {
            await wipeLocalAccountData();
            existingUser = null;
          }

          // Replace (never merely clear) the marker before any hydration.
          recordSignedInUser(email);

          if (!existingUser || existingUser.email !== email) {
            existingUser = await userManager.loginUser(email);
          }

          // Reconcile local state with the authenticated cloud tenant on every
          // fresh auth initialization. This also repairs browsers where the
          // earlier unauthenticated lookup created an orphan local business.
          try {
            const convexBusiness = await getCurrentBusinessFromConvex(getToken, tokenAudience);
            const localBusinessId = existingUser?.businessId;
            const cloudBusinessId = convexBusiness?._id;

            if (convexBusiness && String(localBusinessId || '') !== String(cloudBusinessId)) {
              console.log('Business found in Convex, reconciling local state...');
              const { user: bootstrappedUser } = await userManager.bootstrapFromConvex(convexBusiness, email);
              setLocalUser(bootstrappedUser);
              existingUser = bootstrappedUser;
            } else if (existingUser) {
              setLocalUser(existingUser);
            } else {
              console.log('New user detected, will need setup');
              setLocalUser(null);
            }
          } catch (convexError) {
            console.error('Failed to check Convex for existing business:', convexError);
            // Preserve a valid offline account when the cloud is temporarily
            // unreachable. Only a truly uninitialized browser remains in setup.
            setLocalUser(existingUser || null);
          }

          // Only log successful login and set context if we have a valid user
          if (existingUser) {
            logLogin(true);

            // Set Sentry user context with a stable, non-identifying id only.
            setUserContext({ id: hashIdentity(email || userId) });
          }

          setAuthError(null);
        } else {
          // User signed out - clear local state
          setLocalUser(null);
          clearUserContext();
        }
      } catch (error) {
        console.error('Auth sync error:', error);
        setAuthError('Authentication sync failed. Please try signing out and back in.');
      } finally {
        setIsInitialized(true);
      }
    };

    syncUser();
  }, [getToken, isLoaded, isSignedIn, tokenAudience, user, userId]);

  const logout = async () => {
    try {
      // Local data must be gone before the current-user marker is cleared so a
      // failed wipe keeps the session (and the visible error) instead of
      // silently leaving another account's data behind.
      await wipeLocalAccountData();
      const userManager = await getUserManager();
      userManager.logoutUser();
      setLocalUser(null);
      clearUserContext();
      logLogout();
      await signOut();
    } catch (error) {
      console.error('Logout error:', error);
      setAuthError('Could not clear local customer data. Please retry logout.');
      throw error;
    }
  };

  const value = {
    // Clerk state
    isLoaded,
    isSignedIn,
    userId,
    clerkUser: user,

    // Local state
    isInitialized,
    localUser,
    hasCompletedSetup: !!localUser?.businessId,
    authError,

    // Actions
    logout,
    refreshUser,
    clearAuthError: () => setAuthError(null)
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

// Main ClerkAuthProvider component
export function ClerkAuthProvider({ children }) {
  if (isDevBypass) {
    warnAuthBypassOnce('Clerk', authBypassReason);

    const bypassValue = {
      isLoaded: true,
      isSignedIn: true,
      userId: 'simulator-bypass',
      clerkUser: null,
      isInitialized: true,
      localUser: null,
      hasCompletedSetup: true,
      authError: null,
      logout: async () => { },
      refreshUser: async () => null,
      clearAuthError: () => { }
    };

    return (
      <AuthContext.Provider value={bypassValue}>
        {children}
      </AuthContext.Provider>
    );
  }

  // Validate Clerk configuration
  if (!clerkPubKey || clerkPubKey === 'pk_test_placeholder') {
    return (
      <div className="min-h-screen bg-[var(--status-critical-soft)] flex items-center justify-center p-4">
        <div className="bg-white p-6 rounded-lg shadow-lg max-w-md text-center">
          <h2 className="text-xl font-bold text-critical mb-4">Configuration Error</h2>
          <p className="text-ink-secondary mb-4">
            Clerk authentication is not properly configured. Please set the VITE_CLERK_PUBLISHABLE_KEY environment variable.
          </p>
          <p className="text-sm text-ink-muted">
            Check your .env.local file and ensure you have a valid Clerk publishable key.
          </p>
        </div>
      </div>
    );
  }

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      domain={clerkDomain}
      appearance={{
        layout: {
          socialButtonsVariant: 'iconButton',
          shimmer: true
        },
        baseTheme: undefined,
        variables: {
          colorPrimary: '#0891b2', // cyan-600
          colorBackground: '#ffffff',
          colorInputBackground: '#ffffff',
          colorInputText: '#1e293b',
          borderRadius: '0.5rem'
        },
        elements: {
          formButtonPrimary:
            'bg-brand hover:bg-brand-strong text-white font-medium rounded-full shadow-cta',
          card: 'shadow-xl border-0',
          headerTitle: 'text-xl font-bold text-ink',
          headerSubtitle: 'text-ink-secondary',
          socialButtonsBlockButton: 'border-2 hover:bg-surface-2 transition-colors',
          footerActionLink: 'text-brand-ink hover:text-brand-ink font-medium'
        }
      }}
    >
      <AuthContextProvider>
        {children}
      </AuthContextProvider>
    </ClerkProvider>
  );
}
