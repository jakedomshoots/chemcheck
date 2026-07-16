import { useEffect, useState } from 'react';
import { getReadinessReport } from '@/lib/readiness';
import { getServiceWorkerState } from '@/lib/serviceWorker';
import { Activity, CheckCircle2, AlertTriangle, ShieldCheck, RefreshCw } from 'lucide-react';

function StatusBadge({ status }) {
  if (status === 'ok') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--status-info-line)] bg-brand-softer px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-brand-ink">
        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
        ok
      </span>
    );
  }
  if (status === 'degraded') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--status-watch-line)] bg-[var(--status-watch-soft)] px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-watch">
        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
        degraded
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--status-critical-line)] bg-[var(--status-critical-soft)] px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-critical">
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
      ? 'border-[var(--status-info-line)] bg-brand-softer text-brand-ink'
      : status === 'degraded'
        ? 'border-[var(--status-watch-line)] bg-[var(--status-watch-soft)] text-watch'
        : 'border-[var(--status-critical-line)] bg-[var(--status-critical-soft)]/60 text-critical';
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
    <div className="relative min-h-screen overflow-hidden bg-surface-0 text-ink">
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_18%_12%,rgba(8,145,178,0.16),transparent_32%),radial-gradient(circle_at_82%_18%,rgba(14,116,144,0.12),transparent_28%),linear-gradient(180deg,#f8fdff_0%,#eef8f9_55%,#f8fbfc_100%)]"
        aria-hidden="true"
      />

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-[var(--status-info-line)] bg-surface-1 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-brand-ink shadow-sm">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              System health
            </span>
            <h1 className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-ink sm:text-3xl">
              ChemCheck Health
            </h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-ink-secondary">
              Live readiness signals from the browser. Status reflects routing, storage, migrations, the service worker, and monitoring.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadReport()}
            disabled={refreshing}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-line bg-white px-4 text-sm font-semibold text-ink-secondary transition-colors hover:border-[var(--status-info-line)] hover:bg-brand-softer hover:text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-60"
            aria-label="Refresh health report"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
            Refresh
          </button>
        </header>

        <section
          className="mb-5 rounded-sheet border border-line bg-surface-1 p-5 shadow-card sm:p-6"
          aria-label="Overall status"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-softer text-brand-ink">
                <Activity className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-muted">Status</p>
                <p className="text-lg font-semibold tracking-[-0.02em] text-ink">
                  {report?.status || 'loading'}
                </p>
              </div>
            </div>
            <StatusBadge status={report?.status} />
          </div>

          {errorMessage ? (
            <p
              role="alert"
              className="mt-4 rounded-2xl border border-[var(--status-critical-line)] bg-[var(--status-critical-soft)]/80 px-3 py-2 text-xs font-medium text-critical"
            >
              Readiness check failed: {errorMessage}
            </p>
          ) : null}

          <dl className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <div className="rounded-xl border border-line bg-surface-1 px-3 py-2">
              <dt className="font-semibold text-ink-muted">App version</dt>
              <dd className="break-all font-medium text-ink">{report?.appVersion ?? 'Not reported'}</dd>
            </div>
            <div className="rounded-xl border border-line bg-surface-1 px-3 py-2">
              <dt className="font-semibold text-ink-muted">Data version</dt>
              <dd className="font-medium text-ink">{report?.dataVersion ?? 'Not reported'}</dd>
            </div>
            <div className="rounded-xl border border-line bg-surface-1 px-3 py-2">
              <dt className="font-semibold text-ink-muted">Environment</dt>
              <dd className="font-medium text-ink">{report?.metadata?.environment ?? 'Not reported'}</dd>
            </div>
            <div className="rounded-xl border border-line bg-surface-1 px-3 py-2">
              <dt className="font-semibold text-ink-muted">Checked at</dt>
              <dd className="break-all font-medium text-ink">{report?.timestamp ?? 'Not reported'}</dd>
            </div>
          </dl>
        </section>

        <section
          className="mb-5 rounded-sheet border border-line bg-surface-1 p-5 shadow-card sm:p-6"
          aria-label="Readiness checks"
        >
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.16em] text-ink-muted">
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
          className="rounded-sheet border border-line bg-surface-1 p-5 shadow-card sm:p-6"
          aria-label="Raw report"
        >
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.16em] text-ink-muted">
            Raw report
          </h2>
          <pre className="overflow-x-auto rounded-2xl border border-line bg-ink p-4 text-xs leading-5 text-cyan-50">
            {JSON.stringify(report, null, 2)}
          </pre>
        </section>
      </main>
    </div>
  );
}