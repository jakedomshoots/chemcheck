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

// Intentionally NOT scheduled: the legacy backfills in convex/migrations.ts
// (backfillCreatedByBatch, backfillDeletedAtBatch, countMissingCreatedBy).
// They touch every tenant's rows and must be run by hand, dry_run first, from
// the Convex dashboard or `npx convex run migrations:<name> '<json args>'`.
// See the comment block above those functions for the exact sequence.

export default crons;
