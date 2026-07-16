import { Droplets, CheckCircle, Users, Shield, Zap } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useState, lazy, Suspense } from 'react';
import { useAuthContext } from './ClerkAuthProvider';
import { importWithRetry } from '@/lib/chunkErrorRecovery';

const ClerkSignUp = lazy(() =>
  importWithRetry(() => import('@/components/auth/ClerkSignUpBridge.jsx'), 'ClerkSignUpBridge')
);

export function RobustSignUpPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuthContext();
  const isLoaded = auth.isLoaded;
  const isSignedIn = auth.isSignedIn;
  const [isProcessingAuth, setIsProcessingAuth] = useState(true);
  
  // Check if URL contains Clerk OAuth callback indicators
  const isOAuthCallback = location.pathname.includes('/sso-callback') ||
                          location.hash.includes('__clerk') ||
                          location.search.includes('__clerk') ||
                          location.pathname.includes('/signup/sso-callback') ||
                          location.pathname.includes('/signup/factor');

  // Wait a moment after Clerk loads to let OAuth state settle
  useEffect(() => {
    if (isLoaded) {
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
        navigate('/', { replace: true });
      } else {
        navigate('/setup', { replace: true });
      }
    }
  }, [isLoaded, isSignedIn, auth.isInitialized, auth.hasCompletedSetup, navigate]);

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
            <p className="text-base font-semibold tracking-[-0.035em] text-ink">Welcome to ChemCheck</p>
            <p className="mt-2 text-sm font-medium text-ink-secondary">Setting up your workspace</p>
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
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-8 px-4 py-12 lg:flex-row lg:items-center lg:gap-10">
        {/* Left Side - Benefits */}
        <div className="hidden flex-1 lg:block">
          <div className="mb-8 flex items-center gap-3" aria-label="ChemCheck Logo">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand text-white shadow-cta">
              <Droplets className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="text-base font-semibold tracking-tight text-ink">ChemCheck</span>
          </div>
          <h2 className="max-w-xl text-balance text-3xl font-semibold tracking-[-0.045em] text-ink sm:text-4xl">
            Pool service management for working crews.
          </h2>
          <p className="mt-4 max-w-xl text-sm font-medium leading-7 text-ink-secondary">
            Plan daily routes, capture visit proof in the field, and turn that record into reports and billing.
          </p>

          <ul className="mt-8 space-y-5">
            {[
              {
                icon: CheckCircle,
                title: 'Complete service tracking',
                body: 'Chemicals, equipment, photos, and customer notes in one record per visit.',
                accent: 'bg-brand-softer text-brand-ink',
              },
              {
                icon: Users,
                title: 'Customer communication',
                body: 'Send visit reports with photos and details so customers know what you did.',
                accent: 'bg-surface-2 text-ink-secondary',
              },
              {
                icon: Zap,
                title: 'Route optimization',
                body: 'Plan the day, skip stops that already moved, and keep crews moving.',
                accent: 'bg-brand-softer text-brand-ink',
              },
              {
                icon: Shield,
                title: 'Secure and reliable',
                body: 'Data is encrypted at rest, synced through Convex, and ready when you are.',
                accent: 'bg-surface-2 text-ink-secondary',
              },
            ].map(({ icon: Icon, title, body, accent }) => (
              <li key={title} className="flex items-start gap-4">
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${accent}`}>
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm font-semibold tracking-[-0.02em] text-ink">{title}</p>
                  <p className="mt-1 text-sm font-medium leading-6 text-ink-secondary">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Right Side - Sign Up Form */}
        <div className="w-full lg:w-[26rem] lg:shrink-0">
          {/* Mobile Logo Header */}
          <div className="mb-6 text-center lg:hidden">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand text-white shadow-cta" aria-label="ChemCheck Logo">
              <Droplets className="h-8 w-8" aria-hidden="true" />
            </div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-brand-ink">
              Pool service workspace
            </p>
            <h1 className="text-2xl font-semibold tracking-[-0.04em] text-ink">Join ChemCheck</h1>
            <p className="mt-2 text-sm font-medium text-ink-secondary">Start your free trial today</p>
          </div>

          {/* Desktop Header */}
          <div className="mb-6 hidden text-center lg:block">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-brand-ink">
              Pool service workspace
            </p>
            <h1 className="text-2xl font-semibold tracking-[-0.04em] text-ink">Create your account</h1>
            <p className="mt-2 text-sm font-medium text-ink-secondary">
              Start managing your pool service business today
            </p>
          </div>

          {/* Clerk SignUp Component */}
          <div className="rounded-sheet border border-line bg-surface-1 p-5 shadow-card sm:p-6">
            <Suspense
              fallback={
                <div className="flex items-center justify-center py-10">
                  <div className="h-8 w-8 rounded-full border-2 border-[var(--status-info-line)] border-t-cyan-600 animate-spin" aria-hidden="true" />
                </div>
              }
            >
              <ClerkSignUp
                routing="path"
                path="/signup"
                signInUrl="/login"
                fallbackRedirectUrl="/setup"
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

          {/* Terms Notice */}
          <p className="mt-4 text-center text-xs font-medium text-ink-muted">
            By creating an account, you agree to our Terms of Service and Privacy Policy.
            Your data is encrypted and secure.
          </p>
        </div>
      </div>
    </div>
  );
}
