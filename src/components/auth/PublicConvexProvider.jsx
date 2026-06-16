/**
 * Public Report Provider
 * 
 * A minimal Convex provider for public routes that don't require authentication.
 * This allows the report page to load immediately without waiting for Clerk to initialize.
 */

import { ConvexProvider } from 'convex/react';
import { getSharedConvexClient } from '@/lib/convexClient';

// Initialize a separate Convex client for public routes (no auth)
const publicConvex = getSharedConvexClient();

export function PublicConvexProvider({ children }) {
    return (
        <ConvexProvider client={publicConvex}>
            {children}
        </ConvexProvider>
    );
}
