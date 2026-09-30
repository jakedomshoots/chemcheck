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

// Refresh connected sellers' Square OAuth tokens that expire within 7 days
// (Square access tokens last ~30 days) and drop expired OAuth states.
crons.daily(
  "refresh-square-seller-tokens",
  { hourUTC: 4, minuteUTC: 40 },
  internal.squareConnect.refreshExpiringTokens,
  {}
);

// Work tickets: bill due recurring billing schedules (weekly on Mondays,
// monthly on the 1st, 06:00 business time; failures retry every hour).
crons.hourly(
  "run-billing-schedules",
  { minuteUTC: 7 },
  internal.billingSchedules.runDueSchedules,
  {}
);

export default crons;
