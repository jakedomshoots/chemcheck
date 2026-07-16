import { Droplets } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState, lazy, Suspense } from 'react';
import { useAuthContext } from './ClerkAuthProvider';
import { importWithRetry } from '@/lib/chunkErrorRecovery';
import { getCanonicalRoute } from '@/lib/routeConfig';

const ClerkSignIn = lazy(() =>
  importWithRetry(() => import('@/components/auth/ClerkSignInBridge.jsx'), 'ClerkSignInBridge')
);
const AUTH_RETURN_TO_SESSION_KEY = 'chemcheck_auth_return_to';

function getStoredReturnTo() {
  try {
    return typeof sessionStorage === 'undefined' ? '' : (sessionStorage.getItem(AUTH_RETURN_TO_SESSION_KEY) || '');
  } catch {
    return '';
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

function normalizeReturnTo(rawReturnTo = '/') {
  if (typeof rawReturnTo !== 'string' || rawReturnTo.startsWith('//') || !rawReturnTo.startsWith('/')) {
    return '/';
  }

  const [pathOnly, search = ''] = rawReturnTo.split('?');
  const canonicalPath = getCanonicalRoute(pathOnly);
  return `${canonicalPath}${search ? `?${search}` : ''}`;
}

export function RobustLoginPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const auth = useAuthContext();
  const isLoaded = auth.isLoaded;
  const isSignedIn = auth.isSignedIn;
  const [isProcessingAuth, setIsProcessingAuth] = useState(true);
  
  // Check if URL contains Clerk OAuth callback indicators
  // These indicate we're in the middle of an OAuth flow
  const isOAuthCallback = location.pathname.includes('/sso-callback') ||
                          location.hash.includes('__clerk') ||
                          location.search.includes('__clerk') ||
                          location.pathname.includes('/login/sso-callback') ||
                          location.pathname.includes('/login/factor');
  
  const storedReturnTo = getStoredReturnTo();
  const returnTo = normalizeReturnTo(location.state?.returnTo || storedReturnTo || '/');

  // Wait a moment after Clerk loads to let OAuth state settle
  useEffect(() => {
    if (isLoaded) {
      // Give Clerk a moment to process any pending OAuth state
      const timer = setTimeout(() => {
        setIsProcessingAuth(false);
      }, isOAuthCallback ? 1000 : 100);
      return () => clearTimeout(timer);
    }
  }, [isLoaded, isOAuthCallback]);

  // Redirect if user is already signed in
  useEffect(() => {
    if (isLoaded && isSignedIn && auth.isInitialized) {
      clearStoredReturnTo();
      if (auth.hasCompletedSetup) {
        navigate(returnTo, { replace: true });
      } else {
        navigate('/setup', { replace: true });
      }
    }
  }, [isLoaded, isSignedIn, auth.isInitialized, auth.hasCompletedSetup, navigate, returnTo]);

  // Show loading while Clerk is loading, processing OAuth, or user is signed in but context not ready
  if (!isLoaded || isProcessingAuth || (isSignedIn && !auth.isInitialized)) {
    return (
      <div className="relative min-h-screen overflow-hidden bg-surface-0 text-ink">
        <div
          className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_18%_12%,rgba(8,145,178,0.16),transparent_32%),radial-gradient(circle_at_82%_18%,rgba(14,116,144,0.12),transparent_28%),linear-gradient(180deg,#f8fdff_0%,#eef8f9_55%,#f8fbfc_100%)]"
          aria-hidden="true"
        />
        <div className="flex min-h-screen items-center justify-center p-4">
          <div className="text-center">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand text-white shadow-cta">
              <Droplets className="h-8 w-8" aria-hidden="true" />
            </div>
            <div className="mx-auto mb-4 h-9 w-9 rounded-full border-2 border-[var(--status-info-line)] border-t-cyan-600 animate-spin" aria-hidden="true" />
            <p className="text-base font-semibold tracking-[-0.035em] text-ink">Loading workspace</p>
          </div>
        </div>
      </div>
    );
  }

  // If already signed in and initialized, show loading while redirecting
  if (isSignedIn) {
    return (
      <div className="relative min-h-screen overflow-hidden bg-surface-0 text-ink">
        <div
          className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_18%_12%,rgba(8,145,178,0.16),transparent_32%),radial-gradient(circle_at_82%_18%,rgba(14,116,144,0.12),transparent_28%),linear-gradient(180deg,#f8fdff_0%,#eef8f9_55%,#f8fbfc_100%)]"
          aria-hidden="true"
        />
        <div className="flex min-h-screen items-center justify-center p-4">
          <div className="text-center">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand text-white shadow-cta">
              <Droplets className="h-8 w-8" aria-hidden="true" />
            </div>
            <div className="mx-auto mb-4 h-9 w-9 rounded-full border-2 border-[var(--status-info-line)] border-t-cyan-600 animate-spin" aria-hidden="true" />
            <p className="text-base font-semibold tracking-[-0.035em] text-ink">Welcome back</p>
            <p className="mt-2 text-sm font-medium text-ink-secondary">Redirecting to your workspace</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-surface-0 text-ink">
      <div
        className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_18%_12%,rgba(8,145,178,0.16),transparent_32%),radial-gradient(circle_at_82%_18%,rgba(14,116,144,0.12),transparent_28%),linear-gradient(180deg,#f8fdff_0%,#eef8f9_55%,#f8fbfc_100%)]"
        aria-hidden="true"
      />
      <div className="pointer-events-none fixed inset-0 -z-10 opacity-[0.05] [background-image:linear-gradient(rgba(15,23,42,0.75)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.75)_1px,transparent_1px)] [background-size:44px_44px]" />
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center px-4 py-12">
        {/* Logo Header */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand text-white shadow-cta">
            <Droplets className="h-8 w-8" aria-hidden="true" />
          </div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-brand-ink">
            ChemCheck workspace
          </p>
          <h1 className="text-balance text-3xl font-semibold tracking-[-0.045em] text-ink sm:text-4xl">
            Welcome back
          </h1>
          <p className="mt-2 text-sm font-medium leading-6 text-ink-secondary">
            Sign in to continue your pool service workspace.
          </p>
        </div>

        {/* Clerk SignIn Component */}
        <div className="w-full rounded-sheet border border-line bg-surface-1 p-5 shadow-card sm:p-6">
          <Suspense
            fallback={
              <div className="flex items-center justify-center py-10">
                <div className="h-8 w-8 rounded-full border-2 border-[var(--status-info-line)] border-t-cyan-600 animate-spin" aria-hidden="true" />
              </div>
            }
          >
            <ClerkSignIn
              routing="path"
              path="/login"
              signUpUrl="/signup"
              fallbackRedirectUrl={returnTo}
              appearance={{
                elements: {
                  rootBox: 'w-full',
                  card: 'shadow-none border-0 bg-transparent p-0',
                  headerTitle: 'hidden',
                  headerSubtitle: 'hidden',
                  socialButtonsBlockButton: 'border border-line bg-white text-ink-secondary hover:bg-brand-softer hover:border-[var(--status-info-line)] transition-colors duration-200',
                  formButtonPrimary: 'bg-brand hover:bg-brand-strong text-white font-semibold transition-colors shadow-cta',
                  footerActionLink: 'text-brand-ink hover:text-brand-ink font-medium transition-colors',
                  formFieldInput: 'border-line focus:border-ring focus:ring-ring',
                  identityPreviewText: 'text-ink-secondary',
                  identityPreviewEditButton: 'text-brand-ink hover:text-brand-ink'
                }
              }}
            />
          </Suspense>
        </div>

        {/* Footer Links */}
        <div className="mt-6 flex items-center justify-center gap-3 text-sm text-ink-muted">
          <a
            href="/privacy-policy.html"
            className="transition-colors hover:text-brand-ink"
            target="_blank"
            rel="noopener noreferrer"
          >
            Privacy Policy
          </a>
          <span className="h-1 w-1 rounded-full bg-line" aria-hidden="true" />
          <a
            href="/terms-of-service.html"
            className="transition-colors hover:text-brand-ink"
            target="_blank"
            rel="noopener noreferrer"
          >
            Terms of Service
          </a>
        </div>

        {/* Help Text */}
        <div className="mt-4 w-full rounded-2xl border border-[var(--status-info-line)] bg-brand-softer p-3 text-center shadow-sm ">
          <p className="text-sm font-medium text-brand-ink">
            New to ChemCheck?{' '}
            <a href="/signup" className="font-semibold text-brand-ink underline-offset-4 hover:underline">
              Create an account
            </a>{' '}
            to start managing pool service visits.
          </p>
        </div>
      </div>
    </div>
  );
}
