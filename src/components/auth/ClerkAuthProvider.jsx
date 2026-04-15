import { ClerkProvider, useAuth, useUser } from '@clerk/clerk-react';
import { createContext, useContext, useEffect, useState } from 'react';
import { logLogin, logLogout } from '@/lib/auditLog';
import { setUserContext, clearUserContext } from '@/lib/sentry';

// Get Clerk publishable key from environment
const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const clerkDomain = import.meta.env.VITE_CLERK_DOMAIN;
const bypassFlagEnabled = import.meta.env.VITE_IOS_SIM_AUTH_BYPASS === 'true';
const bypassFlagEnabledInNonDev = bypassFlagEnabled && !import.meta.env.DEV;

if (bypassFlagEnabledInNonDev) {
  console.error('SECURITY WARNING: VITE_IOS_SIM_AUTH_BYPASS is enabled outside development. Bypass disabled.');
}

const isIosSimulatorBypass = bypassFlagEnabled
  && import.meta.env.DEV
  && typeof window !== 'undefined'
  && window.Capacitor
  && window.Capacitor.getPlatform?.() === 'ios';

// Dev mode bypass for localhost development
const isDevBypass = import.meta.env.DEV
  && typeof window !== 'undefined'
  && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

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
          const name = user.fullName || user.firstName || 'User';

          if (!email) {
            setAuthError('No email address found. Please ensure your account has a verified email.');
            setIsInitialized(true);
            return;
          }

          // Try to find existing user in localStorage
          let existingUser = userManager.getCurrentUser();

          // If no current user or email doesn't match, try to login
          if (!existingUser || existingUser.email !== email) {
            existingUser = await userManager.loginUser(email);
          }

          // If still no user, check Convex for existing business
          if (!existingUser) {
            try {
              const convexClient = await getConvexClient();
              const api = await getApi();
              const convexBusiness = await convexClient.query(api.businesses.getCurrent);

              if (convexBusiness) {
                const { user: bootstrappedUser } = await userManager.bootstrapFromConvex(convexBusiness, email);
                setLocalUser(bootstrappedUser);
                existingUser = bootstrappedUser;
              } else {
                setLocalUser(null);
              }
            } catch (convexError) {
              console.error('Failed to check Convex for existing business:', convexError);
              setLocalUser(null);
            }
          } else {
            setLocalUser(existingUser);
          }

          // Only log successful login and set context if we have a valid user
          if (existingUser) {
            logLogin(true);

            // Set Sentry user context
            setUserContext({
              id: userId,
              email: email,
              username: name
            });
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
  }, [isLoaded, isSignedIn, user, userId]);

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
  if (isIosSimulatorBypass || isDevBypass) {
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
