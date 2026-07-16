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
          <div className="flex items-center justify-center min-h-screen bg-surface-0">
            <Loader className="w-12 h-12" />
          </div>
        }
      >
        <App />
      </Suspense>
    </ClerkAuthProvider>
  );
}
