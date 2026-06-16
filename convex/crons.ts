import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Run cleanup every hour at minute 0.
crons.hourly(
  "cleanup-rate-limits",
  { minuteUTC: 0 },
  internal.rateLimit.cleanupExpiredRateLimits,
  {}
);

// Run daily cleanup of expired service reports and stale access logs.
crons.daily(
  "cleanup-expired-reports",
  { hourUTC: 6, minuteUTC: 0 },
  internal.serviceReports.cleanupExpiredReportsAndLogs,
  {}
);

export default crons;
