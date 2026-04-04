import { useEffect, useState } from 'react';
import { getReadinessReport } from '@/lib/readiness';
import { getServiceWorkerState } from '@/lib/serviceWorker';

export default function HealthPage() {
  const [report, setReport] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    void getReadinessReport().then(setReport).catch((error) => {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to evaluate readiness');
      setReport({
        status: 'down',
        timestamp: new Date().toISOString(),
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
          routingRoot: window.location.pathname,
        }
      });
    });
  }, []);

  const statusColorClass =
    report?.status === 'ok'
      ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
      : report?.status === 'degraded'
        ? 'bg-amber-100 text-amber-700 border-amber-200'
        : 'bg-red-100 text-red-700 border-red-200';

  return (
    <main className="min-h-screen p-4 sm:p-6 md:p-8 bg-slate-50">
      <section className="max-w-4xl mx-auto">
        <h1 className="text-sm font-semibold text-slate-900 mb-3">ChemCheck Health</h1>
        <p className={`inline-flex items-center gap-2 rounded-lg px-3 py-1 border text-xs font-medium mb-4 ${statusColorClass}`}>
          status: {report?.status || 'loading'}
        </p>
        {errorMessage ? (
          <p className="text-xs text-red-600 mb-3">Readiness check failed: {errorMessage}</p>
        ) : null}
        <pre className="text-xs bg-white border border-slate-200 rounded-lg p-4 overflow-x-auto">
          {JSON.stringify(report, null, 2)}
        </pre>
      </section>
    </main>
  );
}
