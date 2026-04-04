import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { PublicConvexProvider } from '@/components/auth/PublicConvexProvider';
import { ChemicalBeakerLoader as Loader } from '@/components/ui/loader';
import { importWithRetry } from '@/lib/chunkErrorRecovery';
import { HEALTH_ROUTE, PUBLIC_REPORT_PATH, READY_ROUTE } from '@/lib/routeConfig';
import NotFoundPage from '@/pages/NotFoundPage';

const ReportPage = lazy(() => importWithRetry(() => import('@/pages/ReportPage'), 'ReportPage'));
const HealthPage = lazy(() => importWithRetry(() => import('@/pages/HealthPage'), 'HealthPage'));
const ReadyPage = lazy(() => importWithRetry(() => import('@/pages/ReadyPage'), 'ReadyPage'));

function PublicPageLoader() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-cyan-50 via-blue-50 to-slate-100">
      <Loader className="w-12 h-12" />
    </div>
  );
}

export default function PublicReportRouter() {
  return (
    <PublicConvexProvider>
      <Suspense fallback={<PublicPageLoader />}>
        <Routes>
          <Route path={PUBLIC_REPORT_PATH} element={<ReportPage />} />
          <Route path={HEALTH_ROUTE} element={<HealthPage />} />
          <Route path={READY_ROUTE} element={<ReadyPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </PublicConvexProvider>
  );
}
