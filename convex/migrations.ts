import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 500;

/**
 * Backfill serviceLogs.created_by from the owning customer in batches.
 * Run repeatedly until isDone is true.
 */
export const backfillServiceLogCreatedByBatch = internalMutation({
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
export const countServiceLogsWithCreatedBy = internalQuery({
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

/**
 * Create one canonical pool for legacy customers that still store pool
 * attributes directly on customers. The operation is idempotent and can be
 * resumed with the returned cursor from the Convex dashboard.
 */
export const backfillPoolsBatch = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = Math.max(1, Math.min(args.batchSize ?? DEFAULT_BATCH_SIZE, MAX_BATCH_SIZE));
    const page = await ctx.db.query("customers").paginate({
      cursor: args.cursor ?? null,
      numItems: batchSize,
    });
    let created = 0;
    let skipped = 0;

    for (const customer of page.page) {
      const existing = await ctx.db.query("pools")
        .withIndex("by_customer", (q: any) => q.eq("customer_id", customer._id))
        .first();
      if (existing) {
        skipped += 1;
        continue;
      }

      const now = Date.now();
      await ctx.db.insert("pools", {
        customer_id: customer._id,
        business_id: customer.business_id,
        name: "Primary Pool",
        address: customer.address,
        service_day: customer.service_day,
        pool_gallons: customer.pool_gallons,
        pool_type: customer.pool_type,
        surface_type: customer.surface_type,
        sort_order: customer.sort_order,
        active: true,
        created_at: customer.created_at || now,
        updated_at: customer.updated_at || now,
      });
      created += 1;
    }

    return {
      processed: page.page.length,
      created,
      skipped,
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});
