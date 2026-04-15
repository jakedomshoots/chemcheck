import { lazy, Suspense } from 'react';
import { ClerkAuthProvider } from '@/components/auth/ClerkAuthProvider';
import { ChemicalBeakerLoader as Loader } from '@/components/ui/loader';
import { importWithRetry } from '@/lib/chunkErrorRecovery';

const App = lazy(() => importWithRetry(() => import('@/App.jsx'), 'App'));

export default function AuthenticatedShell() {
  return (
    <ClerkAuthProvider>
      <Suspense
        fallback={
          <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-cyan-50 via-blue-50 to-slate-100">
            <Loader className="w-12 h-12" />
          </div>
        }
      >
        <App />
      </Suspense>
    </ClerkAuthProvider>
  );
}
