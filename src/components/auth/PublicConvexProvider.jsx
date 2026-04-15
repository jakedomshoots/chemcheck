/**
 * Public Report Provider
 * 
 * A minimal Convex provider for public routes that don't require authentication.
 * This allows the report page to load immediately without waiting for Clerk to initialize.
 */

import { ConvexProvider, ConvexReactClient } from 'convex/react';

// Initialize a separate Convex client for public routes (no auth)
const publicConvex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);

export function PublicConvexProvider({ children }) {
    return (
        <ConvexProvider client={publicConvex}>
            {children}
        </ConvexProvider>
    );
}

export default PublicConvexProvider;
