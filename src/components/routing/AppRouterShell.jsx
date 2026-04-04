import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, useLocation } from 'react-router-dom';
import { ChemicalBeakerLoader as Loader } from '@/components/ui/loader';
import { importWithRetry } from '@/lib/chunkErrorRecovery';
import { getCanonicalRoute, isReportPath, isStandalonePublicRoute } from '@/lib/routeConfig';

const PublicReportRouter = lazy(() =>
  importWithRetry(() => import('@/components/routing/PublicReportRouter.jsx'), 'PublicReportRouter')
);
const AuthenticatedShell = lazy(() =>
  importWithRetry(() => import('@/components/auth/AuthenticatedShell.jsx'), 'AuthenticatedShell')
);

function PublicPageLoader() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-cyan-50 via-blue-50 to-slate-100">
      <Loader className="w-12 h-12" />
    </div>
  );
}

function InternalRouter() {
  const location = useLocation();
  const normalizedPathname = getCanonicalRoute(location.pathname);
  const normalizedPath = `${normalizedPathname}${location.search}${location.hash}`;
  const currentPath = `${location.pathname}${location.search}${location.hash}`;

  if (normalizedPath !== currentPath) {
    return <Navigate to={normalizedPath} replace />;
  }

  const isPublicRootRoute = isReportPath(location.pathname) || isStandalonePublicRoute(location.pathname);

  if (isPublicRootRoute) {
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
