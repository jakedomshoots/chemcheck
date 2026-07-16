import { AuthenticateWithRedirectCallback } from '@clerk/clerk-react';
import { Droplets } from 'lucide-react';

/**
 * SSO Callback page - handles OAuth redirects from providers like Google
 * This component uses Clerk's built-in callback handler to properly
 * establish the session after OAuth authentication completes.
 */
export function SSOCallback() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-surface-0 text-ink">
      <div
        className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_18%_12%,rgba(8,145,178,0.16),transparent_32%),radial-gradient(circle_at_82%_18%,rgba(14,116,144,0.12),transparent_28%),linear-gradient(180deg,#f8fdff_0%,#eef8f9_55%,#f8fbfc_100%)]"
        aria-hidden="true"
      />
      <div className="pointer-events-none fixed inset-0 -z-10 opacity-[0.05] [background-image:linear-gradient(rgba(15,23,42,0.75)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.75)_1px,transparent_1px)] [background-size:44px_44px]" />
      <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
        <div className="text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand text-white shadow-cta">
            <Droplets className="h-8 w-8" aria-hidden="true" />
          </div>
          <div className="mx-auto mb-5 h-9 w-9 rounded-full border-2 border-[var(--status-info-line)] border-t-cyan-600 animate-spin" aria-hidden="true" />
          <p className="text-lg font-semibold tracking-[-0.035em] text-ink">Completing sign in</p>
          <p className="mt-2 text-sm font-medium text-ink-secondary">Please wait a moment</p>
        </div>
      </div>
      
      {/* Clerk's built-in OAuth callback handler */}
      <AuthenticateWithRedirectCallback />
    </div>
  );
}
