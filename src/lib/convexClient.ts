import { ConvexReactClient } from 'convex/react';
import { normalizeConvexUrl } from '@/lib/convexUrl';
import {
  shouldUseIosSimulatorAuthBypass,
  shouldUseLocalhostAuthBypass,
} from '@/lib/platformPolicy';

const DEV_BYPASS_CONVEX_PLACEHOLDER = 'https://offline-dev-placeholder.convex.cloud';

export function resolveConvexUrl(): string {
  const configured = normalizeConvexUrl(import.meta.env.VITE_CONVEX_URL);
  if (configured) return configured;

  if (shouldUseLocalhostAuthBypass() || shouldUseIosSimulatorAuthBypass()) {
    return DEV_BYPASS_CONVEX_PLACEHOLDER;
  }

  throw new Error(
    'VITE_CONVEX_URL is not configured. Set it in your environment or run `convex dev`.'
  );
}

let sharedClient: ConvexReactClient | null = null;

export function getSharedConvexClient(): ConvexReactClient {
  if (!sharedClient) {
    sharedClient = new ConvexReactClient(resolveConvexUrl());
  }
  return sharedClient;
}
