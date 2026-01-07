import { ClerkProvider, useAuth, useUser } from '@clerk/clerk-react';
import { ConvexProviderWithClerk } from 'convex/react-clerk';
import { ConvexReactClient } from 'convex/react';
import { createContext, useContext, useEffect, useState } from 'react';
import { userManager } from '@/lib/userManager';
import { logLogin, logLogout } from '@/lib/auditLog';
import { setUserContext, clearUserContext } from '@/lib/sentry';
import { useSyncInitialization } from '@/hooks/useSyncInitialization';

// Initialize Convex client
const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);

// Get Clerk publishable key from environment
const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

// Auth context for app-wide auth state
const AuthContext = createContext(null);

export function useAuthContext() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuthContext must be used within AuthProvider');
  }
  return context;
}

// Function to trigger auth state refresh
let globalRefreshAuthState = () => {};

// Inner provider that has access to Clerk hooks
function AuthContextProvider({ children }) {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const { user } = useUser();
  const [localUser, setLocalUser] = useState(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Initialize sync service when user is signed in
  useSyncInitialization(isSignedIn && isInitialized, false);

  // Set up refresh function
  useEffect(() => {
    globalRefreshAuthState = () => {
      setRefreshTrigger(prev => prev + 1);
    };
  }, []);

  useEffect(() => {
    if (!isLoaded) return;

    const syncUser = async () => {
      if (isSignedIn && user) {
        // Sync Clerk user with local user manager
        const email = user.primaryEmailAddress?.emailAddress || '';
        const name = user.fullName || user.firstName || 'User';
        
        // Check if user exists locally
        let existingUser = userManager.getCurrentUser();
        
        if (!existingUser || existingUser.email !== email) {
          // Try to login existing user or create new one
          existingUser = await userManager.loginUser(email);
          
          if (!existingUser) {
            // First time user - they need to go through setup
            console.log('New user detected, needs setup');
          }
        }
        
        setLocalUser(existingUser);
        logLogin(true);
        
        // Set Sentry user context
        setUserContext({
          id: userId,
          email: email,
          username: name
        });
      } else {
        setLocalUser(null);
      }
      setIsInitialized(true);
    };

    syncUser();
  }, [isLoaded, isSignedIn, user, refreshTrigger]); // Add refreshTrigger as dependency

  const logout = async () => {
    logLogout();
    userManager.logoutUser();
    setLocalUser(null);
    
    // Clear Sentry user context
    clearUserContext();
  };

  const value = {
    isLoaded,
    isSignedIn,
    isInitialized,
    clerkUser: user,
    localUser,
    userId,
    logout,
    hasCompletedSetup: !!localUser?.businessId,
    refreshAuthState: () => setRefreshTrigger(prev => prev + 1)
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

// Main AuthProvider component
export function AuthProvider({ children }) {
  // Check if we're in offline/demo mode (no Clerk key)
  const isOfflineMode = !clerkPubKey || clerkPubKey === 'pk_test_placeholder';

  if (isOfflineMode) {
    // Offline mode - use local auth only
    return (
      <OfflineAuthProvider>
        {children}
      </OfflineAuthProvider>
    );
  }

  // Online mode - use Clerk + Convex
  return (
    <ClerkProvider publishableKey={clerkPubKey}>
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        <AuthContextProvider>
          {children}
        </AuthContextProvider>
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}

// Offline auth provider for local-only mode
function OfflineAuthProvider({ children }) {
  const [isInitialized, setIsInitialized] = useState(false);
  const [localUser, setLocalUser] = useState(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  useEffect(() => {
    const currentUser = userManager.getCurrentUser();
    setLocalUser(currentUser);
    setIsInitialized(true);
  }, [refreshTrigger]); // Add refreshTrigger as dependency

  const logout = () => {
    logLogout();
    userManager.logoutUser();
    setLocalUser(null);
    window.location.reload();
  };

  const value = {
    isLoaded: true,
    isSignedIn: !!localUser,
    isInitialized,
    clerkUser: null,
    localUser,
    userId: localUser?.id || null,
    logout,
    hasCompletedSetup: !!localUser?.businessId,
    isOfflineMode: true,
    refreshAuthState: () => setRefreshTrigger(prev => prev + 1)
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export default AuthProvider;

// Export refresh function for external use
export const refreshAuthState = () => {
  globalRefreshAuthState();
};
