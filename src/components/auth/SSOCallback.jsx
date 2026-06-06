import { AuthenticateWithRedirectCallback } from '@clerk/clerk-react';
import { Droplets } from 'lucide-react';

/**
 * SSO Callback page - handles OAuth redirects from providers like Google
 * This component uses Clerk's built-in callback handler to properly
 * establish the session after OAuth authentication completes.
 */
export function SSOCallback() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-cyan-50 flex items-center justify-center p-4">
      <div className="text-center">
        <div className="w-16 h-16 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
          <Droplets className="w-8 h-8 text-white" />
        </div>
        <div className="w-8 h-8 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
        <p className="text-slate-900 font-medium">Completing sign in...</p>
        <p className="text-slate-600 text-sm mt-2">Please wait a moment</p>
      </div>
      
      {/* Clerk's built-in OAuth callback handler */}
      <AuthenticateWithRedirectCallback />
    </div>
  );
}
