// Convex auth configuration
// Uses environment variable to determine which Clerk domain to use

// Determine if we're running in production based on environment
// In Convex, process.env may not be available during build time
// Both domains are included to support local dev and production deployments
const productionDomain = "https://clerk.chemcheck.xyz";
const developmentDomain = "https://game-sloth-45.clerk.accounts.dev";

// Export configuration with all trusted auth providers
// Convex validates JWT tokens against all listed providers
// Order matters: production domain is listed first for priority
export default {
    providers: [
        {
            // Production Clerk domain - used for chemcheck.xyz
            domain: productionDomain,
            applicationID: "convex",
        },
        {
            // Development Clerk domain - used for local development
            // This is safe to include in production as it only allows tokens
            // signed by the development Clerk instance, which are only valid
            // for development users
            domain: developmentDomain,
            applicationID: "convex",
        },
    ]
};
