import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthContext } from './ClerkAuthProvider';
import { Droplets, AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Routes that don't require authentication
const PUBLIC_ROUTES = [
  '/login',
  '/signup',
  '/sso-callback',
  '/pricing',
  '/privacy-policy.html',
  '/terms-of-service.html'
];

// Report routes are public but have specific UUID format
const REPORT_ROUTE_PATTERN = /^\/report\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Check if a path is a public route (including OAuth callback sub-paths)
function isPublicPath(pathname) {
  // Exact matches
  if (PUBLIC_ROUTES.includes(pathname)) return true;

  // Report routes with UUID
  if (REPORT_ROUTE_PATTERN.test(pathname)) return true;

  // OAuth callback paths under /login or /signup (e.g., /login/sso-callback, /login/factor)
  if (pathname.startsWith('/login/') || pathname.startsWith('/signup/')) return true;

  // SSO callback paths
  if (pathname.startsWith('/sso-callback')) return true;

  return false;
}

export function RobustAuthGuard({ children }) {
  const auth = useAuthContext();
  const navigate = useNavigate();
  const location = useLocation();

  // Check if current path is public
  const isPublicRoute = isPublicPath(location.pathname);

  useEffect(() => {
    // Don't redirect while Clerk is still loading
    if (!auth.isLoaded || !auth.isInitialized) return;

    const currentPath = location.pathname;
    const returnTo = location.state?.returnTo;

    // Handle unauthenticated users
    if (!auth.isSignedIn) {
      if (!isPublicRoute) {
        navigate('/login', {
          replace: true,
          state: { returnTo: currentPath }
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
        if (auth.hasCompletedSetup) {
          navigate(returnTo || '/', { replace: true });
        } else {
          navigate('/setup', { replace: true });
        }
        return;
      }

      // If user is on signup page and already signed in, redirect appropriately
      if (currentPath === '/signup') {
        if (auth.hasCompletedSetup) {
          navigate('/', { replace: true });
        } else {
          navigate('/setup', { replace: true });
        }
        return;
      }

      // If user hasn't completed setup and not on setup page, redirect to setup
      // But don't redirect from public routes
      if (!auth.hasCompletedSetup && currentPath !== '/setup' && !isPublicRoute) {
        navigate('/setup', { replace: true });
        return;
      }

      // If user has completed setup but is on setup page, redirect to home
      if (auth.hasCompletedSetup && currentPath === '/setup') {
        navigate('/', { replace: true });
        return;
      }
    }
  }, [
    auth.isLoaded,
    auth.isInitialized,
    auth.isSignedIn,
    auth.hasCompletedSetup,
    location.pathname,
    location.state?.returnTo,
    navigate,
    isPublicRoute
  ]);

  // Allow public routes immediately, without waiting for auth
  // This ensures report pages load instantly for customers
  if (isPublicRoute) {
    return children;
  }

  // Show loading while Clerk is initializing (only for protected routes)
  if (!auth.isLoaded || !auth.isInitialized) {
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
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-cyan-50 flex items-center justify-center">
      <div className="text-center">
        <div className="w-16 h-16 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
          <Droplets className="w-8 h-8 text-white" />
        </div>
        <div className="w-8 h-8 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
        <p className="text-slate-900 font-medium">Loading ChemCheck...</p>
        <p className="text-slate-600 text-sm mt-2">Initializing your workspace</p>
      </div>
    </div>
  );
}

function AuthErrorScreen({ error, onRetry }) {
  const auth = useAuthContext();

  return (
    <div className="min-h-screen bg-gradient-to-br from-red-50 via-white to-orange-50 flex items-center justify-center p-4">
      <div className="bg-white p-6 rounded-lg shadow-lg max-w-md text-center">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <AlertCircle className="w-8 h-8 text-red-600" />
        </div>

        <h2 className="text-xl font-bold text-red-600 mb-4">Authentication Error</h2>

        <p className="text-gray-700 mb-6">
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
            className="flex-1 bg-red-600 hover:bg-red-700 text-white"
          >
            Sign Out
          </Button>
        </div>
      </div>
    </div>
  );
}

export default RobustAuthGuard;