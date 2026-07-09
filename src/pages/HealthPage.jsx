import { useEffect, useState } from 'react';
import { getReadinessReport } from '@/lib/readiness';
import { getServiceWorkerState } from '@/lib/serviceWorker';
import { Activity, CheckCircle2, AlertTriangle, ShieldCheck, RefreshCw } from 'lucide-react';

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

function CheckRow({ name, check }) {
  if (!check) return null;
  const status = check?.status || 'unknown';
  const tone =
    status === 'ok'
      ? 'border-cyan-200/70 bg-cyan-50/60 text-cyan-900'
      : status === 'degraded'
        ? 'border-amber-200/70 bg-amber-50/60 text-amber-900'
        : 'border-rose-200/70 bg-rose-50/60 text-rose-900';
  return (
    <div className={`flex items-start justify-between gap-3 rounded-2xl border px-3 py-2.5 ${tone}`}>
      <span className="text-xs font-semibold tracking-wide">{name}</span>
      <StatusBadge status={status} />
    </div>
  );
}

export default function HealthPage() {
  const [report, setReport] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const loadReport = async () => {
    setRefreshing(true);
    try {
      const next = await getReadinessReport();
      setReport(next);
      setErrorMessage('');
    } catch (error) {
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
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void loadReport();
  }, []);

  const checks = report?.checks ?? {};

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#f6fbfc] text-slate-950">
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_18%_12%,rgba(8,145,178,0.16),transparent_32%),radial-gradient(circle_at_82%_18%,rgba(14,116,144,0.12),transparent_28%),linear-gradient(180deg,#f8fdff_0%,#eef8f9_55%,#f8fbfc_100%)]"
        aria-hidden="true"
      />

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-cyan-800 shadow-sm">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              System health
            </span>
            <h1 className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-slate-950 sm:text-3xl">
              ChemCheck Health
            </h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
              Live readiness signals from the browser. Status reflects routing, storage, migrations, the service worker, and monitoring.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadReport()}
            disabled={refreshing}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-60"
            aria-label="Refresh health report"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
            Refresh
          </button>
        </header>

        <section
          className="mb-5 rounded-[1.75rem] border border-white/80 bg-white/85 p-5 shadow-[0_24px_70px_-50px_rgba(8,47,73,0.75)] backdrop-blur sm:p-6"
          aria-label="Overall status"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-cyan-50 text-cyan-700">
                <Activity className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Status</p>
                <p className="text-lg font-semibold tracking-[-0.02em] text-slate-950">
                  {report?.status || 'loading'}
                </p>
              </div>
            </div>
            <StatusBadge status={report?.status} />
          </div>

          {errorMessage ? (
            <p
              role="alert"
              className="mt-4 rounded-2xl border border-rose-200 bg-rose-50/80 px-3 py-2 text-xs font-medium text-rose-800"
            >
              Readiness check failed: {errorMessage}
            </p>
          ) : null}

          <dl className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <div className="rounded-xl border border-slate-200/70 bg-white/70 px-3 py-2">
              <dt className="font-semibold text-slate-500">App version</dt>
              <dd className="break-all font-medium text-slate-800">{report?.appVersion ?? 'Not reported'}</dd>
            </div>
            <div className="rounded-xl border border-slate-200/70 bg-white/70 px-3 py-2">
              <dt className="font-semibold text-slate-500">Data version</dt>
              <dd className="font-medium text-slate-800">{report?.dataVersion ?? 'Not reported'}</dd>
            </div>
            <div className="rounded-xl border border-slate-200/70 bg-white/70 px-3 py-2">
              <dt className="font-semibold text-slate-500">Environment</dt>
              <dd className="font-medium text-slate-800">{report?.metadata?.environment ?? 'Not reported'}</dd>
            </div>
            <div className="rounded-xl border border-slate-200/70 bg-white/70 px-3 py-2">
              <dt className="font-semibold text-slate-500">Checked at</dt>
              <dd className="break-all font-medium text-slate-800">{report?.timestamp ?? 'Not reported'}</dd>
            </div>
          </dl>
        </section>

        <section
          className="mb-5 rounded-[1.75rem] border border-white/80 bg-white/85 p-5 shadow-[0_24px_70px_-50px_rgba(8,47,73,0.75)] backdrop-blur sm:p-6"
          aria-label="Readiness checks"
        >
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">
            Readiness checks
          </h2>
          <div className="grid gap-2 sm:grid-cols-2">
            <CheckRow name="Routing" check={checks.routingReady} />
            <CheckRow name="Storage" check={checks.storageReady} />
            <CheckRow name="Migrations" check={checks.migrationReady} />
            <CheckRow name="Service worker" check={checks.serviceWorkerReady} />
            <CheckRow name="Monitoring" check={checks.monitoringReady} />
          </div>
        </section>

        <section
          className="rounded-[1.75rem] border border-white/80 bg-white/85 p-5 shadow-[0_24px_70px_-50px_rgba(8,47,73,0.75)] backdrop-blur sm:p-6"
          aria-label="Raw report"
        >
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">
            Raw report
          </h2>
          <pre className="overflow-x-auto rounded-2xl border border-slate-200/70 bg-slate-950 p-4 text-[11px] leading-5 text-cyan-50">
            {JSON.stringify(report, null, 2)}
          </pre>
        </section>
      </main>
    </div>
  );
}