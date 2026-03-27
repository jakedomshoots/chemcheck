/* eslint-disable react/prop-types */
import { ClerkProvider, useAuth, useUser } from '@clerk/clerk-react';
import { createContext, useContext, useEffect, useState } from 'react';
import { logLogin, logLogout } from '@/lib/auditLog';
import { setUserContext, clearUserContext } from '@/lib/sentry';
import { warnAuthBypassOnce } from '@/lib/authBypassWarning';
import {
  getAuthBypassReason,
  shouldUseIosSimulatorAuthBypass,
  shouldUseLocalhostAuthBypass,
} from '@/lib/platformPolicy';

// Get Clerk publishable key from environment
const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const clerkDomain = import.meta.env.VITE_CLERK_DOMAIN;
const AUTH_STATES = {
  loading: 'loading',
  signedOut: 'signed_out',
  bootstrapping: 'bootstrapping',
  setupMissing: 'setup_missing',
  ready: 'ready',
  error: 'error',
};
const isIosSimulatorBypass = shouldUseIosSimulatorAuthBypass();
const isDevBypass = shouldUseLocalhostAuthBypass();
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

let apiModulePromise = null;
async function getApi() {
  if (!apiModulePromise) {
    apiModulePromise = import('../../../convex/_generated/api');
  }
  const { api } = await apiModulePromise;
  return api;
}

let convexClientPromise = null;
async function getConvexClient() {
  if (!convexClientPromise) {
    convexClientPromise = import('convex/react').then(({ ConvexReactClient }) => {
      const convexUrl = import.meta.env.VITE_CONVEX_URL;
      if (!convexUrl) {
        throw new Error('VITE_CONVEX_URL is not configured');
      }
      return new ConvexReactClient(convexUrl);
    });
  }
  return convexClientPromise;
}

// Inner provider that has access to Clerk hooks
function AuthContextProvider({ children }) {
  const { isLoaded, isSignedIn, userId, signOut } = useAuth();
  const { user } = useUser();
  const [localUser, setLocalUser] = useState(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [authState, setAuthState] = useState(AUTH_STATES.loading);
  const [refreshNonce, setRefreshNonce] = useState(0);

  async function loadCanonicalAuthState() {
    if (!user) {
      return {
        authState: AUTH_STATES.signedOut,
        localUser: null,
      };
    }

    const email = user.primaryEmailAddress?.emailAddress || '';
    if (!email) {
      setAuthError('No email address found. Please ensure your account has a verified email.');
      setAuthState(AUTH_STATES.error);
      setLocalUser(null);
      return {
        authState: AUTH_STATES.error,
        localUser: null,
      };
    }

    const userManager = await getUserManager();
    const name = user.fullName || user.firstName || 'User';
    let existingUser = userManager.getCurrentUser();
    if (!existingUser || existingUser.email !== email) {
      existingUser = await userManager.loginUser(email);
    }

    try {
      const convexClient = await getConvexClient();
      const api = await getApi();
      const convexBusiness = await convexClient.query(api.businesses.getCurrent);

      if (!convexBusiness) {
        setLocalUser(null);
        setAuthError(null);
        setAuthState(AUTH_STATES.setupMissing);
        return {
          authState: AUTH_STATES.setupMissing,
          localUser: null,
        };
      }

      if (!existingUser || existingUser.businessId !== convexBusiness._id) {
        const { user: bootstrappedUser } = await userManager.bootstrapFromConvex(convexBusiness, email);
        existingUser = bootstrappedUser;
      }

      setLocalUser(existingUser);
      logLogin(true);
      setUserContext({
        id: userId,
        email,
        username: name,
      });
      setAuthError(null);
      setAuthState(AUTH_STATES.ready);
      return {
        authState: AUTH_STATES.ready,
        localUser: existingUser,
      };
    } catch (error) {
      console.error('Failed to sync canonical auth state:', error);
      setLocalUser(existingUser || null);
      setAuthError('Authentication sync failed. Please try signing out and back in.');
      setAuthState(AUTH_STATES.error);
      return {
        authState: AUTH_STATES.error,
        localUser: existingUser || null,
      };
    }
  }

  const refreshAuthState = async () => {
    if (!user) {
      return {
        authState: AUTH_STATES.signedOut,
        localUser: null,
      };
    }

    setIsInitialized(false);
    setAuthState(AUTH_STATES.bootstrapping);

    try {
      return await loadCanonicalAuthState();
    } finally {
      setIsInitialized(true);
    }
  };

  // Backwards-compatible alias for untouched consumers.
  const refreshUser = async () => {
    const refreshResult = await refreshAuthState();
    return refreshResult.localUser;
  };

  useEffect(() => {
    if (!isLoaded) return;

    const syncUser = async () => {
      try {
        if (isSignedIn && user) {
          setIsInitialized(false);
          setAuthState(AUTH_STATES.bootstrapping);
          await loadCanonicalAuthState();
        } else {
          setLocalUser(null);
          setAuthError(null);
          setAuthState(AUTH_STATES.signedOut);
          clearUserContext();
        }
      } catch (error) {
        console.error('Auth sync error:', error);
        setAuthError('Authentication sync failed. Please try signing out and back in.');
        setAuthState(AUTH_STATES.error);
      } finally {
        setIsInitialized(true);
      }
    };

    syncUser();
  }, [isLoaded, isSignedIn, user, userId, refreshNonce]);

  const logout = async () => {
    try {
      logLogout();
      const userManager = await getUserManager();
      userManager.logoutUser();
      setLocalUser(null);
      clearUserContext();
      await signOut();
    } catch (error) {
      console.error('Logout error:', error);
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
    hasCompletedSetup: authState === AUTH_STATES.ready,
    authError,
    authState,

    // Actions
    logout,
    refreshAuthState,
    refreshUser,
    clearAuthError: () => {
      setAuthError(null);
      setIsInitialized(false);
      setRefreshNonce((value) => value + 1);
    }
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

// Main ClerkAuthProvider component
export function ClerkAuthProvider({ children }) {
  if (isIosSimulatorBypass || isDevBypass) {
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
      authState: AUTH_STATES.ready,
      logout: async () => { },
      refreshAuthState: async () => ({
        authState: AUTH_STATES.ready,
        localUser: null,
      }),
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
      <div className="min-h-screen bg-red-50 flex items-center justify-center p-4">
        <div className="bg-white p-6 rounded-lg shadow-lg max-w-md text-center">
          <h2 className="text-xl font-bold text-red-600 mb-4">Configuration Error</h2>
          <p className="text-gray-700 mb-4">
            Clerk authentication is not properly configured. Please set the VITE_CLERK_PUBLISHABLE_KEY environment variable.
          </p>
          <p className="text-sm text-gray-500">
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
            'bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white font-medium',
          card: 'shadow-xl border-0',
          headerTitle: 'text-xl font-bold text-slate-900',
          headerSubtitle: 'text-slate-600',
          socialButtonsBlockButton: 'border-2 hover:bg-slate-50 transition-colors',
          footerActionLink: 'text-cyan-600 hover:text-cyan-700 font-medium'
        }
      }}
    >
      <AuthContextProvider>
        {children}
      </AuthContextProvider>
    </ClerkProvider>
  );
}

export default ClerkAuthProvider;
