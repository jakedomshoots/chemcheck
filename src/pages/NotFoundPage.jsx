import { Link } from 'react-router-dom';
import { ArrowLeft, Home, Search } from 'lucide-react';
import { APP_ROUTES } from '@/lib/routeConfig';

export function NotFoundPage() {
  return (
    <div className="relative min-h-[calc(100vh-4rem)] overflow-hidden bg-[#f6fbfc] text-slate-950">
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_18%_12%,rgba(8,145,178,0.16),transparent_32%),radial-gradient(circle_at_82%_18%,rgba(14,116,144,0.12),transparent_28%),linear-gradient(180deg,#f8fdff_0%,#eef8f9_55%,#f8fbfc_100%)]"
        aria-hidden="true"
      />

      <section className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-xl items-center justify-center px-4 py-10 sm:px-6">
        <div className="w-full">
          <div className="mb-4 flex justify-center">
            <span
              className="inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-cyan-800 shadow-sm"
              role="status"
              aria-live="polite"
            >
              <Search className="h-3.5 w-3.5" aria-hidden="true" />
              404
            </span>
          </div>

          <div className="rounded-[1.75rem] border border-white/80 bg-white/85 p-6 text-center shadow-[0_24px_70px_-50px_rgba(8,47,73,0.75)] backdrop-blur sm:p-8">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-50 text-cyan-700">
              <Search className="h-7 w-7" aria-hidden="true" />
            </div>
            <h1 className="text-balance text-2xl font-semibold tracking-[-0.03em] text-slate-950 sm:text-3xl">
              Page not found
            </h1>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">
              The page you are looking for does not exist or may have been moved. Check the URL or head back to a safe starting point.
            </p>

            <div className="mt-6 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-center">
              <Link
                to={APP_ROUTES.Home}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-cyan-600 px-5 text-sm font-semibold text-white shadow-[0_18px_38px_-24px_rgba(8,145,178,0.95)] transition-colors hover:bg-cyan-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
              >
                <Home className="h-4 w-4" aria-hidden="true" />
                Back to Home
              </Link>
              <button
                type="button"
                onClick={() => window.history.back()}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 transition-colors hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Go Back
              </button>
            </div>
          </div>

          <p className="mt-4 text-center text-xs text-slate-500">
            Need help? Visit{' '}
            <Link to={APP_ROUTES.Support} className="font-semibold text-cyan-700 underline-offset-2 hover:underline">
              Support
            </Link>
            .
          </p>
        </div>
      </section>
    </div>
  );
}

export default NotFoundPage;