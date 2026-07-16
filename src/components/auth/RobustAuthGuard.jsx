import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthContext } from './ClerkAuthProvider';
import { Droplets, AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { APP_ROUTES, getCanonicalRoute, isPublicRoute } from '@/lib/routeConfig';

// Auth loading timeout in milliseconds
const AUTH_LOADING_TIMEOUT = 15000;
const AUTH_RETURN_TO_SESSION_KEY = 'chemcheck_auth_return_to';

function getStoredReturnTo() {
  try {
    return typeof sessionStorage === 'undefined' ? '' : (sessionStorage.getItem(AUTH_RETURN_TO_SESSION_KEY) || '');
  } catch {
    return '';
  }
}

function setStoredReturnTo(path) {
  try {
    if (path && typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(AUTH_RETURN_TO_SESSION_KEY, path);
    }
  } catch {
    // Best effort only for navigation intent recovery.
  }
}

function clearStoredReturnTo() {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(AUTH_RETURN_TO_SESSION_KEY);
    }
  } catch {
    // Best effort only for navigation intent recovery.
  }
}

function normalizeReturnTo(rawReturnTo) {
  if (typeof rawReturnTo !== 'string' || !rawReturnTo.startsWith('/') || rawReturnTo.startsWith('//')) {
    return '';
  }

  const [pathOnly, search = ''] = rawReturnTo.split('?');
  const canonicalReturnTo = getCanonicalRoute(pathOnly);
  return `${canonicalReturnTo}${search ? `?${search}` : ''}`;
}

export function RobustAuthGuard({ children }) {
  const auth = useAuthContext();
  const navigate = useNavigate();
  const [hasTimedOut, setHasTimedOut] = useState(false);
  const location = useLocation();
  const canonicalPath = getCanonicalRoute(location.pathname);
  const storedReturnTo = getStoredReturnTo();
  const returnTo = normalizeReturnTo(
    typeof location.state?.returnTo === 'string' ? location.state.returnTo : storedReturnTo
  );
  const requestedPath = `${location.pathname}${location.search}`;

  // Check if current path is public
  const isPublicRoutePath = isPublicRoute(canonicalPath);

  // Timeout to prevent infinite loading spinner
  useEffect(() => {
    if (auth.isLoaded && auth.isInitialized) {
      setHasTimedOut(false);
      return;
    }

    const timer = setTimeout(() => {
      if (!auth.isLoaded || !auth.isInitialized) {
        console.warn('[AuthGuard] Auth loading timed out after', AUTH_LOADING_TIMEOUT, 'ms', {
          isLoaded: auth.isLoaded,
          isInitialized: auth.isInitialized,
        });
        setHasTimedOut(true);
      }
    }, AUTH_LOADING_TIMEOUT);

    return () => clearTimeout(timer);
  }, [auth.isLoaded, auth.isInitialized]);

  useEffect(() => {
    // Don't redirect while Clerk is still loading
    if (!auth.isLoaded || !auth.isInitialized) return;

    const currentPath = canonicalPath;
    const nextRoute = returnTo || APP_ROUTES.Home;

    // Handle unauthenticated users
    if (!auth.isSignedIn) {
      if (!isPublicRoutePath) {
        setStoredReturnTo(requestedPath);
        navigate('/login', {
          replace: true,
          state: { returnTo: requestedPath }
        });
      }
      return;
    }

    // Handle authenticated users
    if (auth.isSignedIn) {
      // Don't redirect if we're on an OAuth callback path - let Clerk handle it
      if (currentPath.includes('/sso-callback') ||
        currentPath.includes('/factor') ||
        location.search.includes('__clerk') ||
        location.hash.includes('__clerk')) {
        return;
      }

      // If user is on login page and already signed in, redirect appropriately
      if (currentPath === '/login') {
        clearStoredReturnTo();
        if (auth.hasCompletedSetup) {
          navigate(nextRoute, { replace: true });
        } else {
          navigate('/setup', { replace: true });
        }
        return;
      }

      // If user is on signup page and already signed in, redirect appropriately
      if (currentPath === '/signup') {
        clearStoredReturnTo();
        if (auth.hasCompletedSetup) {
          navigate(APP_ROUTES.Home, { replace: true });
        } else {
          navigate('/setup', { replace: true });
        }
        return;
      }

      // If user hasn't completed setup and not on setup page, redirect to setup
      // But don't redirect from public routes
      if (!auth.hasCompletedSetup && currentPath !== '/setup' && !isPublicRoutePath) {
        clearStoredReturnTo();
        navigate('/setup', { replace: true });
        return;
      }

      // If user has completed setup but is on setup page, redirect to home
      if (auth.hasCompletedSetup && currentPath === '/setup') {
        clearStoredReturnTo();
        navigate(APP_ROUTES.Home, { replace: true });
        return;
      }
    }
  }, [
    auth.isLoaded,
    auth.isInitialized,
    auth.isSignedIn,
    auth.hasCompletedSetup,
    location.pathname,
    location.search,
    location.hash,
    canonicalPath,
    location.state?.returnTo,
    navigate,
    isPublicRoutePath
  ]);

  // Allow public routes immediately, without waiting for auth
  // This ensures report pages load instantly for customers
  if (isPublicRoutePath) {
    return children;
  }

  // Show loading while Clerk is initializing (only for protected routes)
  if (!auth.isLoaded || !auth.isInitialized) {
    if (hasTimedOut) {
      return <AuthTimeoutScreen onRetry={() => { setHasTimedOut(false); window.location.reload(); }} />;
    }
    return <AuthLoadingScreen />;
  }

  // Show error if there's an auth error
  if (auth.authError) {
    return <AuthErrorScreen error={auth.authError} onRetry={auth.clearAuthError} />;
  }

  // Require authentication for protected routes
  if (!auth.isSignedIn) {
    return <AuthLoadingScreen />;
  }

  return children;
}

function AuthLoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-0">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-raised bg-brand shadow-cta">
          <Droplets className="w-8 h-8 text-white" />
        </div>
        <div className="w-8 h-8 border-4 border-brand border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
        <p className="text-ink font-medium">Loading ChemCheck...</p>
        <p className="text-ink-secondary text-sm mt-2">Initializing your workspace</p>
      </div>
    </div>
  );
}

function AuthTimeoutScreen({ onRetry }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-0 p-4">
      <div className="max-w-md rounded-sheet border border-line bg-surface-1 p-6 text-center shadow-card ">
        <div className="w-16 h-16 bg-[var(--status-watch-soft)] rounded-full flex items-center justify-center mx-auto mb-4">
          <AlertCircle className="w-8 h-8 text-watch" />
        </div>

        <h2 className="text-xl font-bold text-watch mb-2">Taking Longer Than Expected</h2>

        <p className="text-ink-secondary mb-6">
          Authentication is having trouble loading. This can happen on first launch or with a slow connection.
        </p>

        <div className="flex gap-3">
          <Button
            onClick={onRetry}
            className="flex-1 rounded-full bg-brand text-white shadow-cta hover:bg-brand-strong"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Retry
          </Button>
        </div>
      </div>
    </div>
  );
}

function AuthErrorScreen({ error, onRetry }) {
  const auth = useAuthContext();

  return (
    <div className="min-h-screen bg-gradient-to-br from-[var(--status-critical-soft)] via-surface-0 to-surface-0 flex items-center justify-center p-4">
      <div className="bg-white p-6 rounded-lg shadow-lg max-w-md text-center">
        <div className="w-16 h-16 bg-[var(--status-critical-soft)] rounded-full flex items-center justify-center mx-auto mb-4">
          <AlertCircle className="w-8 h-8 text-critical" />
        </div>

        <h2 className="text-xl font-bold text-critical mb-4">Authentication Error</h2>

        <p className="text-ink-secondary mb-6">
          {error}
        </p>

        <div className="flex gap-3">
          <Button
            onClick={onRetry}
            variant="outline"
            className="flex-1"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Retry
          </Button>

          <Button
            onClick={auth.logout}
            className="flex-1 bg-destructive hover:bg-destructive text-white"
          >
            Sign Out
          </Button>
        </div>
      </div>
    </div>
  );
}
