import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalQuery } from "./_generated/server";

const serviceStatusValidator = v.union(v.literal("ok"), v.literal("error"));
const backlogValidator = v.object({
  expiredReports: v.number(),
  oldAccessLogs: v.number(),
  expiredRateLimits: v.number(),
  cappedAt: v.number(),
});

type Backlog = {
  expiredReports: number;
  oldAccessLogs: number;
  expiredRateLimits: number;
  cappedAt: number;
};

type HealthCheckResult = {
  status: "healthy" | "unhealthy";
  timestamp: number;
  version: string;
  services: {
    database: "ok" | "error";
    auth: "ok" | "error";
    storage: "ok" | "error";
  };
  backlog?: Backlog;
  error?: string;
};

// Actions do not expose ctx.db. Keep the database work in a private query and
// call it from the public health action so the probe checks real production
// data without exposing any records.
export const inspectDatabase = internalQuery({
  args: {},
  returns: v.object({ backlog: backlogValidator }),
  handler: async (ctx): Promise<{ backlog: Backlog }> => {
    await ctx.db.query("customers").first();

    const now = Date.now();
    const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
    const BACKLOG_LIMIT = 100;

    const [expiredReports, oldAccessLogs, expiredRateLimits] = await Promise.all([
      ctx.db
        .query("serviceReports")
        .withIndex("by_expires_at", (q) => q.lt("expires_at", now))
        .take(BACKLOG_LIMIT),
      ctx.db
        .query("reportAccessLogs")
        .withIndex("by_accessed_at", (q) => q.lt("accessed_at", now - NINETY_DAYS_MS))
        .take(BACKLOG_LIMIT),
      ctx.db
        .query("rateLimits")
        .withIndex("by_reset_time", (q) => q.lt("reset_time", now))
        .take(BACKLOG_LIMIT),
    ]);

    return {
      backlog: {
        expiredReports: expiredReports.length,
        oldAccessLogs: oldAccessLogs.length,
        expiredRateLimits: expiredRateLimits.length,
        cappedAt: BACKLOG_LIMIT,
      },
    };
  },
});

// Health check endpoint for monitoring.
// Implemented as an action so it can verify storage accessibility by generating
// a temporary upload URL without actually writing user data.
export const check = action({
  args: {},
  returns: v.object({
    status: v.union(v.literal("healthy"), v.literal("unhealthy")),
    timestamp: v.number(),
    version: v.string(),
    services: v.object({
      database: serviceStatusValidator,
      auth: serviceStatusValidator,
      storage: serviceStatusValidator,
    }),
    backlog: v.optional(backlogValidator),
    error: v.optional(v.string()),
  }),
  handler: async (ctx): Promise<HealthCheckResult> => {
    const now = Date.now();
    const services: HealthCheckResult["services"] = {
      database: "ok",
      auth: "ok",
      storage: "ok",
    };

    let backlog: Backlog | undefined;
    let databaseError: string | undefined;

    // Verify database access and collect bounded cleanup backlog counts.
    try {
      ({ backlog } = await ctx.runQuery(internal.health.inspectDatabase, {}));
    } catch (error) {
      services.database = "error";
      databaseError = error instanceof Error ? error.message : "Unknown error";
    }

    // Verify storage subsystem is reachable by generating an upload URL.
    try {
      await ctx.storage.generateUploadUrl();
    } catch {
      services.storage = "error";
    }

    const healthy = services.database === "ok" && services.storage === "ok";

    return {
      status: healthy ? "healthy" : "unhealthy",
      timestamp: now,
      version: "1.0.0",
      services,
      ...(backlog ? { backlog } : {}),
      ...(databaseError ? { error: databaseError } : {}),
    };
  },
});
