import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { RobustAuthGuard } from '@/components/auth/RobustAuthGuard';
import { ChemicalBeakerLoader as Loader } from '@/components/ui/loader';
import { importWithRetry } from '@/lib/chunkErrorRecovery';

const RobustLoginPage = lazy(() =>
  importWithRetry(
    () => import('@/components/auth/RobustLoginPage').then((m) => ({ default: m.RobustLoginPage })),
    'RobustLoginPage'
  )
);
const RobustSignUpPage = lazy(() =>
  importWithRetry(
    () => import('@/components/auth/RobustSignUpPage').then((m) => ({ default: m.RobustSignUpPage })),
    'RobustSignUpPage'
  )
);
const ConvexAuthProvider = lazy(() =>
  importWithRetry(
    () => import('@/components/auth/ConvexAuthProvider').then((m) => ({ default: m.ConvexAuthProvider })),
    'ConvexAuthProvider'
  )
);
const ProtectedAppRoutes = lazy(() => importWithRetry(() => import('./ProtectedAppRoutes'), 'ProtectedAppRoutes'));

// Lazy load billing components (less frequently accessed)
const PricingPage = lazy(() => importWithRetry(() => import('@/components/billing/PricingPage').then(m => ({ default: m.PricingPage })), 'PricingPage'));
const SetupWizardPage = lazy(() => importWithRetry(() => import('@/components/auth/SetupWizardPage').then(m => ({ default: m.SetupWizardPage })), 'SetupWizardPage'));
const SSOCallback = lazy(() => importWithRetry(() => import('@/components/auth/SSOCallback').then(m => ({ default: m.SSOCallback })), 'SSOCallback'));

// Lazy load public report page (no auth required)
const ReportPage = lazy(() => importWithRetry(() => import('./ReportPage'), 'ReportPage'));

// Loading fallback component
function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <Loader className="w-12 h-12" />
    </div>
  );
}

// Setup page wrapper
function SetupPage() {
  return (
    <ConvexAuthProvider>
      <Suspense fallback={<PageLoader />}>
        <SetupWizardPage />
      </Suspense>
    </ConvexAuthProvider>
  );
}

function PricingPageWithProviders() {
  return (
    <ConvexAuthProvider>
      <PricingPage />
    </ConvexAuthProvider>
  );
}

export default function Pages() {
  return (
    <RobustAuthGuard>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          {/* Public auth routes */}
          <Route path="/login" element={<RobustLoginPage />} />
          <Route path="/login/*" element={<RobustLoginPage />} />
          <Route path="/signup" element={<RobustSignUpPage />} />
          <Route path="/signup/*" element={<RobustSignUpPage />} />

          {/* SSO callback route for OAuth providers (Google, etc.) */}
          <Route path="/sso-callback" element={<SSOCallback />} />

          {/* Public pricing page */}
          <Route path="/pricing" element={<PricingPageWithProviders />} />

          {/* Public report page - Requirements: 3.1 (no auth required) */}
          <Route path="/report/:reportId/*" element={<ReportPage />} />

          {/* Setup wizard for new users */}
          <Route path="/setup" element={<SetupPage />} />

          {/* Protected app routes */}
          <Route
            path="/*"
            element={(
              <ConvexAuthProvider>
                <ProtectedAppRoutes />
              </ConvexAuthProvider>
            )}
          />
        </Routes>
      </Suspense>
    </RobustAuthGuard>
  );
}
