import { Link } from 'react-router-dom';
import { ArrowLeft, Home, ShieldOff } from 'lucide-react';
import { APP_ROUTES } from '@/lib/routeConfig';

export function AccessDeniedPage() {
  return (
    <div className="relative min-h-[calc(100vh-4rem)] overflow-hidden bg-surface-0 text-ink">
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_18%_12%,rgba(8,145,178,0.16),transparent_32%),radial-gradient(circle_at_82%_18%,rgba(14,116,144,0.12),transparent_28%),linear-gradient(180deg,#f8fdff_0%,#eef8f9_55%,#f8fbfc_100%)]"
        aria-hidden="true"
      />

      <section className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-xl items-center justify-center px-4 py-10 sm:px-6">
        <div className="w-full">
          <div className="mb-4 flex justify-center">
            <span
              className="inline-flex items-center gap-2 rounded-full border border-[var(--status-watch-line)] bg-[var(--status-watch-soft)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-watch shadow-sm"
              role="status"
              aria-live="polite"
            >
              <ShieldOff className="h-3.5 w-3.5" aria-hidden="true" />
              Access denied
            </span>
          </div>

          <div className="rounded-sheet border border-line bg-surface-1 p-6 text-center shadow-card sm:p-8">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--status-watch-soft)] text-watch">
              <ShieldOff className="h-7 w-7" aria-hidden="true" />
            </div>
            <h1 className="text-balance text-2xl font-semibold tracking-[-0.03em] text-ink sm:text-3xl">
              You do not have access to this page
            </h1>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-ink-secondary">
              This area is restricted to accounts with the right permissions. Sign in with an authorized account or head back to a safe starting point.
            </p>

            <div className="mt-6 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-center">
              <Link
                to={APP_ROUTES.Home}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-brand px-5 text-sm font-semibold text-white shadow-cta transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-white"
              >
                <Home className="h-4 w-4" aria-hidden="true" />
                Go to Home
              </Link>
              <button
                type="button"
                onClick={() => window.history.back()}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-line bg-white px-5 text-sm font-semibold text-ink-secondary transition-colors hover:border-[var(--status-info-line)] hover:bg-brand-softer hover:text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-white"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Go Back
              </button>
            </div>
          </div>

          <p className="mt-4 text-center text-xs text-ink-muted">
            Still stuck? Visit{' '}
            <Link to={APP_ROUTES.Support} className="font-semibold text-brand-ink underline-offset-2 hover:underline">
              Support
            </Link>
            .
          </p>
        </div>
      </section>
    </div>
  );
}

export default AccessDeniedPage;