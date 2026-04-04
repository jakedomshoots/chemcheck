import { useAuth } from '@clerk/clerk-react';
import { ConvexProvider, ConvexReactClient } from 'convex/react';
import { ConvexProviderWithClerk } from 'convex/react-clerk';
import { warnAuthBypassOnce } from '@/lib/authBypassWarning';
import { normalizeConvexUrl } from '@/lib/convexUrl';
import {
  getAuthBypassReason,
  shouldUseIosSimulatorAuthBypass,
  shouldUseLocalhostAuthBypass,
} from '@/lib/platformPolicy';

const convex = new ConvexReactClient(normalizeConvexUrl(import.meta.env.VITE_CONVEX_URL));

const isIosSimulatorBypass = shouldUseIosSimulatorAuthBypass();
const isDevBypass = shouldUseLocalhostAuthBypass();
const authBypassReason = getAuthBypassReason();

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
    warnAuthBypassOnce('Convex', authBypassReason);

    return <ConvexAuthProviderBypass>{children}</ConvexAuthProviderBypass>;
  }

  return <ConvexAuthProviderClerk>{children}</ConvexAuthProviderClerk>;
}

export default ConvexAuthProvider;
