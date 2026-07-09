import { useEffect, useState } from 'react';
import { getReadinessReport } from '@/lib/readiness';
import { getServiceWorkerState } from '@/lib/serviceWorker';
import { Activity, CheckCircle2, AlertTriangle, ShieldCheck } from 'lucide-react';

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

function StatusBadge({ status }) {
  if (status === 'ok') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-800">
        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
        ok
      </span>
    );
  }
  if (status === 'degraded') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-800">
        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
        degraded
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-rose-800">
      <AlertTriangle className="h-3 w-3" aria-hidden="true" />
      {status || 'loading'}
    </span>
  );
}

export function ReadyPage() {
  const [ready, setReady] = useState(DEFAULT_REPORT);

  useEffect(() => {
    void getReadinessReport().then(setReady);
  }, []);

  const isReady = ready?.status === 'ok';
  const statusText = ready?.status || 'loading';
  const headline = isReady
    ? 'Ready'
    : statusText === 'loading'
      ? 'Checking...'
      : 'Degraded';

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#f6fbfc] text-slate-950">
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_18%_12%,rgba(8,145,178,0.16),transparent_32%),radial-gradient(circle_at_82%_18%,rgba(14,116,144,0.12),transparent_28%),linear-gradient(180deg,#f8fdff_0%,#eef8f9_55%,#f8fbfc_100%)]"
        aria-hidden="true"
      />

      <section className="mx-auto flex min-h-screen max-w-xl items-center justify-center px-4 py-10 sm:px-6">
        <div className="w-full">
          <div className="mb-4 flex justify-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-cyan-800 shadow-sm">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              ChemCheck Readiness
            </span>
          </div>

          <div className="rounded-[1.75rem] border border-white/80 bg-white/85 p-6 text-center shadow-[0_24px_70px_-50px_rgba(8,47,73,0.75)] backdrop-blur sm:p-8">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-50 text-cyan-700">
              <Activity className="h-7 w-7" aria-hidden="true" />
            </div>
            <div className="flex items-center justify-center gap-2">
              <h1 className="text-2xl font-semibold tracking-[-0.03em] text-slate-950 sm:text-3xl">
                {headline}
              </h1>
              <StatusBadge status={statusText} />
            </div>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">
              App startup checks are currently {statusText}.
            </p>

            <dl className="mt-6 grid gap-2 text-left text-xs">
              <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/70 bg-white/70 px-3 py-2">
                <dt className="font-semibold text-slate-500">Service Worker</dt>
                <dd className="font-medium text-slate-800">
                  {ready?.metadata?.swRegistrationSource || 'unknown'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/70 bg-white/70 px-3 py-2">
                <dt className="font-semibold text-slate-500">Checked at</dt>
                <dd className="break-all font-medium text-slate-800">
                  {ready?.timestamp || 'N/A'}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </section>
    </div>
  );
}

export default ReadyPage;