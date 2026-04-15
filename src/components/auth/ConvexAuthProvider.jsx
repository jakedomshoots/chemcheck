import { useAuth } from '@clerk/clerk-react';
import { ConvexProvider, ConvexReactClient } from 'convex/react';
import { ConvexProviderWithClerk } from 'convex/react-clerk';

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);

const isIosSimulatorBypass = import.meta.env.VITE_IOS_SIM_AUTH_BYPASS === 'true'
  && typeof window !== 'undefined'
  && window.Capacitor
  && window.Capacitor.getPlatform?.() === 'ios';

const isDevBypass = import.meta.env.DEV
  && typeof window !== 'undefined'
  && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

function ConvexAuthProviderBypass({ children }) {
  return (
    <ConvexProvider client={convex}>
      {children}
    </ConvexProvider>
  );
}

function ConvexAuthProviderClerk({ children }) {
  return (
    <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
      {children}
    </ConvexProviderWithClerk>
  );
}

export function ConvexAuthProvider({ children }) {
  if (isIosSimulatorBypass || isDevBypass) {
    return <ConvexAuthProviderBypass>{children}</ConvexAuthProviderBypass>;
  }

  return <ConvexAuthProviderClerk>{children}</ConvexAuthProviderClerk>;
}

export default ConvexAuthProvider;
