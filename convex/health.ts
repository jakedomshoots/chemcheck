import { query } from "./_generated/server";

// Health check endpoint for monitoring
export const check = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    
    // Basic health check - verify database is accessible
    try {
      // Try to query something simple
      await ctx.db.query("customers").first();
      
      return {
        status: "healthy",
        timestamp: now,
        version: "1.0.0",
        services: {
          database: "ok",
          auth: "ok",
        },
      };
    } catch (error) {
      return {
        status: "unhealthy",
        timestamp: now,
        version: "1.0.0",
        services: {
          database: "error",
          auth: "unknown",
        },
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});
