// Convex auth configuration
// Uses environment-based configuration to exclude development domains in production

// Production Clerk domain - always included
const productionDomain = "https://clerk.chemcheck.xyz";

// Development Clerk domain - only included in non-production environments
const developmentDomain = "https://game-sloth-45.clerk.accounts.dev";

export function isProductionEnvironment(env = process.env) {
    const convexDeployEnv = env.CONVEX_DEPLOYMENT_ENV;
    const convexCloudUrl = env.CONVEX_CLOUD_URL;
    const nodeEnv = env.NODE_ENV;
    const vercelEnv = env.VERCEL_ENV;

    return (
        convexDeployEnv === 'production' ||
        convexCloudUrl?.includes('convex.cloud') ||
        nodeEnv === 'production' ||
        vercelEnv === 'production'
    );
}

/**
 * Build the providers array based on environment
 * - Production: Only the production Clerk domain is allowed
 * - Development: Both domains are allowed for local testing
 * 
 * SECURITY: This prevents tokens from the development Clerk instance
 * from being accepted in production, reducing attack surface.
 */
export function buildProviders(env = process.env) {
    const providers = [
        {
            // Production Clerk domain - used for chemcheck.xyz
            domain: productionDomain,
            applicationID: "convex",
        },
    ];

    // SECURITY: Determine environment for auth provider configuration
    // Check multiple sources in order of reliability for Convex runtime
    // 
    // Priority:
    // 1. CONVEX_DEPLOYMENT_ENV - Most reliable during Convex build/runtime
    // 2. CONVEX_CLOUD_URL - Indicates production Convex deployment
    // 3. NODE_ENV - Standard Node.js environment indicator
    // 4. VERCEL_ENV - Vercel deployment environment
    const convexDeployEnv = env.CONVEX_DEPLOYMENT_ENV;
    const convexCloudUrl = env.CONVEX_CLOUD_URL;
    const nodeEnv = env.NODE_ENV;
    const vercelEnv = env.VERCEL_ENV;

    // Debug logging during Convex build (visible in deployment logs)
    console.debug('[auth.config] Environment detection:', {
        CONVEX_DEPLOYMENT_ENV: convexDeployEnv || 'not set',
        hasConvexCloudUrl: !!convexCloudUrl,
        NODE_ENV: nodeEnv || 'not set',
        VERCEL_ENV: vercelEnv || 'not set',
    });

    const isProduction = isProductionEnvironment(env);

    console.debug('[auth.config] Production mode:', isProduction);

    if (!isProduction) {
        providers.push({
            // Development Clerk domain - only for local development
            domain: developmentDomain,
            applicationID: "convex",
        });
    }

    return providers;
}

// Export configuration with environment-appropriate auth providers
export default {
    providers: buildProviders(),
};
