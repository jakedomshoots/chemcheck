import { useEffect, useState } from 'react';
import { getReadinessReport } from '@/lib/readiness';
import { getServiceWorkerState } from '@/lib/serviceWorker';

const DEFAULT_REPORT = {
  appVersion: 'unknown',
  dataVersion: 1,
  checks: {
    routingReady: { status: 'down', details: { available: false } },
    storageReady: { status: 'down', details: { available: false } },
    migrationReady: { status: 'down', details: { error: 'Unable to evaluate readiness' } },
    serviceWorkerReady: { status: 'down', details: { available: false } },
    monitoringReady: { status: 'down', details: { available: false } },
  },
  metadata: {
    environment: 'browser',
    isOnline: true,
    swRegistrationSource: getServiceWorkerState().isRegistered ? 'registered' : 'none',
    routingRoot: '/',
  },
  status: 'loading',
  timestamp: new Date().toISOString(),
};

export function ReadyPage() {
  const [ready, setReady] = useState(DEFAULT_REPORT);

  useEffect(() => {
    void getReadinessReport().then(setReady);
  }, []);

  const isReady = ready?.status === 'ok';
  const statusText = ready?.status || 'loading';
  const statusClass = statusText === 'ok'
    ? 'text-emerald-700'
    : statusText === 'degraded'
      ? 'text-amber-700'
      : 'text-red-700';

  return (
    <main className="min-h-screen bg-white">
      <section className="max-w-xl mx-auto px-4 py-8 text-center">
        <p className="text-xs uppercase tracking-wide font-semibold text-slate-500">ChemCheck Readiness</p>
        <h1 className="text-lg font-semibold text-slate-900 mt-2">
          {isReady ? 'Ready' : statusText === 'loading' ? 'Checking...' : 'Degraded'}
        </h1>
        <p className="text-sm text-slate-600 mt-2">
          App startup checks are currently {statusText}.
        </p>
        <p className={`text-sm font-medium mt-2 ${statusClass}`}>
          Service Worker: {ready?.metadata?.swRegistrationSource || 'unknown'}
        </p>
        <p className="text-[11px] text-slate-500 mt-4 break-all">
          Checked at: {ready?.timestamp || 'N/A'}
        </p>
      </section>
    </main>
  );
}
