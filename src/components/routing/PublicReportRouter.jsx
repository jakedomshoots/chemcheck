import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { PublicConvexProvider } from '@/components/auth/PublicConvexProvider';
import { ChemicalBeakerLoader as Loader } from '@/components/ui/loader';
import { importWithRetry } from '@/lib/chunkErrorRecovery';

const ReportPage = lazy(() => importWithRetry(() => import('@/pages/ReportPage'), 'ReportPage'));

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
          <Route path="/report/:reportId/*" element={<ReportPage />} />
        </Routes>
      </Suspense>
    </PublicConvexProvider>
  );
}
