import { action } from "./_generated/server";

// Health check endpoint for monitoring.
// Implemented as an action so it can verify storage accessibility by generating
// a temporary upload URL without actually writing user data.
export const check = action({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const services: Record<string, "ok" | "error"> = {
      database: "ok",
      auth: "ok",
      storage: "ok",
    };

    // Basic health check - verify database is accessible
    try {
      await ctx.db.query("customers").first();
    } catch (error) {
      services.database = "error";
      return {
        status: "unhealthy",
        timestamp: now,
        version: "1.0.0",
        services,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }

    // Verify storage subsystem is reachable by generating an upload URL.
    try {
      await ctx.storage.generateUploadUrl();
    } catch (error) {
      services.storage = "error";
    }

    // Bounded backlog counts for cleanup monitoring.
    const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
    const BACKLOG_LIMIT = 100;

    const expiredReports = await ctx.db
      .query("serviceReports")
      .withIndex("by_expires_at", (q) => q.lt(q.field("expires_at"), now))
      .take(BACKLOG_LIMIT);

    const oldAccessLogs = await ctx.db
      .query("reportAccessLogs")
      .withIndex("by_accessed_at", (q) => q.lt(q.field("accessed_at"), now - NINETY_DAYS_MS))
      .take(BACKLOG_LIMIT);

    const expiredRateLimits = await ctx.db
      .query("rateLimits")
      .withIndex("by_reset_time", (q) => q.lt(q.field("reset_time"), now))
      .take(BACKLOG_LIMIT);

    const backlog = {
      expiredReports: expiredReports.length,
      oldAccessLogs: oldAccessLogs.length,
      expiredRateLimits: expiredRateLimits.length,
      cappedAt: BACKLOG_LIMIT,
    };

    const healthy = services.database === "ok" && services.storage === "ok";

    return {
      status: healthy ? "healthy" : "unhealthy",
      timestamp: now,
      version: "1.0.0",
      services,
      backlog,
    };
  },
});
