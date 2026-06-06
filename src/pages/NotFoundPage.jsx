import { Link } from 'react-router-dom';
import { ArrowLeft, AlertTriangle, Home } from 'lucide-react';
import { APP_ROUTES } from '@/lib/routeConfig';

export function NotFoundPage() {
  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gradient-to-br from-slate-50 via-white to-cyan-50 flex items-center justify-center px-4 py-8">
      <div className="max-w-xl w-full">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-lg p-8 text-center space-y-4">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-amber-100 text-amber-600">
            <AlertTriangle className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-semibold text-slate-900">Page not found</h1>
          <p className="text-slate-600">
            The page you&apos;re looking for doesn&apos;t exist or may have been moved.
          </p>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 justify-center pt-2">
            <Link
              to={APP_ROUTES.Home}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white px-4 py-2.5 font-medium"
            >
              <Home className="w-4 h-4" />
              Back to Home
            </Link>
            <button
              type="button"
              onClick={() => window.history.back()}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 font-medium text-slate-700"
            >
              <ArrowLeft className="w-4 h-4" />
              Go Back
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
