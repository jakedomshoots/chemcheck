import { lazy, Suspense } from 'react';
import { BrowserRouter, useLocation } from 'react-router-dom';
import { ChemicalBeakerLoader as Loader } from '@/components/ui/loader';
import { importWithRetry } from '@/lib/chunkErrorRecovery';

const PublicReportRouter = lazy(() =>
  importWithRetry(() => import('@/components/routing/PublicReportRouter.jsx'), 'PublicReportRouter')
);
const AuthenticatedShell = lazy(() =>
  importWithRetry(() => import('@/components/auth/AuthenticatedShell.jsx'), 'AuthenticatedShell')
);

// Support UUID tokens and legacy URL-safe token formats, with optional trailing slash.
const REPORT_ROUTE_PATTERN = /^\/report\/[A-Za-z0-9_-]{8,128}\/?$/;

function isPublicReportRoute(pathname) {
  return REPORT_ROUTE_PATTERN.test(pathname);
}

function PublicPageLoader() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-cyan-50 via-blue-50 to-slate-100">
      <Loader className="w-12 h-12" />
    </div>
  );
}

function InternalRouter() {
  const location = useLocation();

  if (isPublicReportRoute(location.pathname)) {
    return (
      <Suspense fallback={<PublicPageLoader />}>
        <PublicReportRouter />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<PublicPageLoader />}>
      <AuthenticatedShell />
    </Suspense>
  );
}

export default function AppRouterShell() {
  return (
    <BrowserRouter>
      <InternalRouter />
    </BrowserRouter>
  );
}
