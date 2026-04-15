import { Droplets } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState, lazy, Suspense } from 'react';
import { useAuthContext } from './ClerkAuthProvider';
import { importWithRetry } from '@/lib/chunkErrorRecovery';

const ClerkSignIn = lazy(() =>
  importWithRetry(() => import('@/components/auth/ClerkSignInBridge.jsx'), 'ClerkSignInBridge')
);

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
  
  // Validate returnTo is a relative path to prevent open redirect
  const rawReturnTo = location.state?.returnTo || '/';
  const returnTo = (() => {
    try {
      // Only allow relative URLs (starting with /) 
      if (typeof rawReturnTo === 'string' && rawReturnTo.startsWith('/') && !rawReturnTo.startsWith('//')) {
        return rawReturnTo;
      }
    } catch (e) {
      // Invalid URL, use default
    }
    return '/';
  })();

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
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-cyan-50 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="w-16 h-16 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <Droplets className="w-8 h-8 text-white" />
          </div>
          <div className="w-8 h-8 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-900 font-medium">Loading...</p>
        </div>
      </div>
    );
  }

  // If already signed in and initialized, show loading while redirecting
  if (isSignedIn) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-cyan-50 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="w-16 h-16 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <Droplets className="w-8 h-8 text-white" />
          </div>
          <div className="w-8 h-8 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-900 font-medium">Welcome back!</p>
          <p className="text-slate-600 text-sm mt-2">Redirecting to your workspace...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-cyan-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <Droplets className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Welcome back</h1>
          <p className="text-slate-600">Sign in to your ChemCheck workspace</p>
        </div>

        {/* Clerk SignIn Component */}
        <Suspense
          fallback={
            <div className="flex items-center justify-center py-10">
              <div className="w-8 h-8 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin" />
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
                card: 'shadow-xl border-0 bg-white',
                headerTitle: 'hidden',
                headerSubtitle: 'hidden',
                socialButtonsBlockButton: 'border-2 hover:bg-slate-50 transition-colors duration-200',
                formButtonPrimary: 'bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white font-medium transition-all duration-200',
                footerActionLink: 'text-cyan-600 hover:text-cyan-700 font-medium transition-colors',
                formFieldInput: 'border-slate-300 focus:border-cyan-500 focus:ring-cyan-500',
                identityPreviewText: 'text-slate-700',
                identityPreviewEditButton: 'text-cyan-600 hover:text-cyan-700'
              }
            }}
          />
        </Suspense>

        {/* Footer Links */}
        <div className="mt-6 text-center text-sm text-slate-500">
          <a 
            href="/privacy-policy.html" 
            className="hover:text-slate-700 transition-colors"
            target="_blank"
            rel="noopener noreferrer"
          >
            Privacy Policy
          </a>
          <span className="mx-2">•</span>
          <a 
            href="/terms-of-service.html" 
            className="hover:text-slate-700 transition-colors"
            target="_blank"
            rel="noopener noreferrer"
          >
            Terms of Service
          </a>
        </div>

        {/* Help Text */}
        <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-sm text-blue-800 text-center">
            <strong>New to ChemCheck?</strong> Create an account to get started with professional pool service management.
          </p>
        </div>
      </div>
    </div>
  );
}

export default RobustLoginPage;
