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

crons.daily(
  "cleanup-sync-receipts",
  { hourUTC: 3, minuteUTC: 15 },
  internal.sync.cleanupSyncOperations,
  {}
);

// Generate recurring-billing invoices every morning (7 AM ET).
crons.daily(
  "generate-recurring-invoices",
  { hourUTC: 11, minuteUTC: 0 },
  internal.servicePlans.runDueBilling,
  {}
);

export default crons;
