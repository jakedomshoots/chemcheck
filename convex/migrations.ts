import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 500;

/**
 * Backfill serviceLogs.created_by from the owning customer in batches.
 * Run repeatedly until isDone is true.
 */
export const backfillServiceLogCreatedByBatch = mutation({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = Math.max(1, Math.min(args.batchSize ?? DEFAULT_BATCH_SIZE, MAX_BATCH_SIZE));
    const page = await ctx.db.query("serviceLogs").paginate({
      cursor: args.cursor ?? null,
      numItems: batchSize,
    });

    let updated = 0;

    for (const log of page.page) {
      if (log.created_by) continue;

      const customer = await ctx.db.get(log.customer_id);
      if (!customer?.created_by) continue;

      await ctx.db.patch(log._id, {
        created_by: customer.created_by,
      });
      updated += 1;
    }

    return {
      processed: page.page.length,
      updated,
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

/**
 * Migration visibility helper.
 */
export const countServiceLogsWithCreatedBy = query({
  args: {},
  handler: async (ctx) => {
    const logs = await ctx.db.query("serviceLogs").collect();
    let withCreatedBy = 0;

    for (const log of logs) {
      if (log.created_by) {
        withCreatedBy += 1;
      }
    }

    return {
      total: logs.length,
      withCreatedBy,
      missingCreatedBy: logs.length - withCreatedBy,
    };
  },
});
