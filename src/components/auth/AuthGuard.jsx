import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthContext } from './AuthProvider';
import { Droplets } from 'lucide-react';

// Routes that don't require authentication
// Note: /report routes are intentionally public for customer convenience
// Security relies on unguessable UUID tokens (122-bit entropy)
// Only non-sensitive data is exposed (service details, no PII)
const PUBLIC_ROUTES = ['/login', '/signup', '/pricing', '/privacy-policy.html', '/terms-of-service.html', '/report'];

export function AuthGuard({ children }) {
  const auth = useAuthContext();
  const navigate = useNavigate();
  const location = useLocation();

  // Check if current path matches a public route
  // For /report, we allow /report/:token pattern but not other sub-routes
  const isPublicRoute = PUBLIC_ROUTES.some(route => {
    if (route === '/report') {
      // Allow /report/:token (UUID format) but not other sub-routes
      // UUID format: 8-4-4-4-12 (e.g., 123e4567-e89b-12d3-a456-426614174000)
      return /^\/report\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(location.pathname);
    }
    return location.pathname === route || location.pathname.startsWith(route);
  });

  useEffect(() => {
    if (!auth?.isLoaded || !auth?.isInitialized) return;

    // If not signed in and trying to access protected route
    if (!auth.isSignedIn && !isPublicRoute) {
      navigate('/login', { replace: true, state: { from: location.pathname } });
      return;
    }

    // If signed in but hasn't completed setup, redirect to setup
    if (auth.isSignedIn && !auth.hasCompletedSetup && !isPublicRoute && location.pathname !== '/setup') {
      navigate('/setup', { replace: true });
      return;
    }

    // If signed in and has completed setup but on setup page, redirect to home
    if (auth.isSignedIn && auth.hasCompletedSetup && location.pathname === '/setup') {
      navigate('/', { replace: true });
      return;
    }

    // If signed in and on login/signup page, redirect to home
    if (auth.isSignedIn && auth.hasCompletedSetup && (location.pathname === '/login' || location.pathname === '/signup')) {
      navigate('/', { replace: true });
      return;
    }
  }, [auth?.isLoaded, auth?.isInitialized, auth?.isSignedIn, auth?.hasCompletedSetup, location.pathname, navigate, isPublicRoute]);

  // Show loading while auth is initializing
  if (!auth?.isLoaded || !auth?.isInitialized) {
    return <AuthLoadingScreen />;
  }

  // Allow public routes without auth
  if (isPublicRoute) {
    return children;
  }

  // Require auth for protected routes
  if (!auth.isSignedIn) {
    return <AuthLoadingScreen />;
  }

  return children;
}

function AuthLoadingScreen() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-cyan-50 flex items-center justify-center">
      <div className="text-center">
        <div className="w-16 h-16 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg animate-pulse">
          <Droplets className="w-8 h-8 text-white" />
        </div>
        <div className="w-8 h-8 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
        <p className="text-slate-900">Loading ChemCheck...</p>
      </div>
    </div>
  );
}

export default AuthGuard;
