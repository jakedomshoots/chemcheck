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

export default crons;
