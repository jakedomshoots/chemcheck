import { useAuth } from '@clerk/clerk-react';
import { ConvexProvider } from 'convex/react';
import { ConvexProviderWithClerk } from 'convex/react-clerk';
import { warnAuthBypassOnce } from '@/lib/authBypassWarning';
import { getSharedConvexClient } from '@/lib/convexClient';
import {
  getAuthBypassReason,
  shouldUseDevelopmentAuthBypass,
} from '@/lib/platformPolicy';

const convex = getSharedConvexClient();

const isDevBypass = shouldUseDevelopmentAuthBypass();
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
  if (isDevBypass) {
    warnAuthBypassOnce('Convex', authBypassReason);

    return <ConvexAuthProviderBypass>{children}</ConvexAuthProviderBypass>;
  }

  return <ConvexAuthProviderClerk>{children}</ConvexAuthProviderClerk>;
}
