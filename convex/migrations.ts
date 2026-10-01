import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

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

// ============================================================================
// Legacy ownership / tombstone backfills
// ----------------------------------------------------------------------------
// These are deliberately NOT scheduled (see convex/crons.ts). Run them by hand
// from the Convex dashboard ("Functions" > migrations > run) or the CLI, with
// dry_run first, then page through until isDone is true:
//
//   npx convex run migrations:backfillCreatedByBatch '{"table":"notes","dry_run":true}'
//   npx convex run migrations:backfillCreatedByBatch '{"table":"notes"}'
//   npx convex run migrations:backfillCreatedByBatch '{"table":"notes","cursor":"<continueCursor>"}'
//   ... repeat for chemicalUsage, saltCellLogs, pools, equipment ...
//   npx convex run migrations:backfillDeletedAtBatch '{"dry_run":true}'
//   npx convex run migrations:backfillDeletedAtBatch '{}'
//   npx convex run migrations:countMissingCreatedBy '{}'
//
// Both mutations are idempotent: re-running them never changes a row that is
// already consistent, so a partial run can simply be restarted from the top.
// ============================================================================

const CREATED_BY_BACKFILL_TABLES = ["chemicalUsage", "saltCellLogs", "notes", "pools", "equipment"] as const;
type CreatedByBackfillTable = (typeof CREATED_BY_BACKFILL_TABLES)[number];

const CUSTOMER_CHILD_TABLES = ["pools", "equipment", "serviceLogs", "chemicalUsage", "notes", "saltCellLogs"] as const;
type CustomerChildTable = (typeof CUSTOMER_CHILD_TABLES)[number];

function boundedBatch(batchSize: number | undefined): number {
  return Math.max(1, Math.min(batchSize ?? DEFAULT_BATCH_SIZE, MAX_BATCH_SIZE));
}

/**
 * Backfill `created_by` on a child table from the owning customer. Rows that
 * already carry an owner are left alone; rows whose customer is missing or
 * ownerless are counted and skipped. Customer-less notes (general notes)
 * cannot be attributed and are skipped as well.
 */
export const backfillCreatedByBatch = internalMutation({
  args: {
    table: v.union(
      v.literal("chemicalUsage"),
      v.literal("saltCellLogs"),
      v.literal("notes"),
      v.literal("pools"),
      v.literal("equipment"),
    ),
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
    dry_run: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const table: CreatedByBackfillTable = args.table;
    const dryRun = args.dry_run === true;
    const page = await ctx.db.query(table).paginate({
      cursor: args.cursor ?? null,
      numItems: boundedBatch(args.batchSize),
    });

    let updated = 0;
    let alreadyOwned = 0;
    let noCustomer = 0;
    let customerMissing = 0;
    let customerUnowned = 0;
    const customerCache = new Map<string, { created_by?: string } | null>();

    for (const row of page.page as Array<{ _id: any; created_by?: string; customer_id?: Id<"customers"> }>) {
      if (row.created_by) {
        alreadyOwned += 1;
        continue;
      }
      if (!row.customer_id) {
        noCustomer += 1;
        continue;
      }
      const key = String(row.customer_id);
      if (!customerCache.has(key)) {
        customerCache.set(key, await ctx.db.get(row.customer_id));
      }
      const customer = customerCache.get(key);
      if (!customer) {
        customerMissing += 1;
        continue;
      }
      if (!customer.created_by) {
        customerUnowned += 1;
        continue;
      }
      if (!dryRun) {
        await ctx.db.patch(row._id, { created_by: customer.created_by });
      }
      updated += 1;
    }

    return {
      table,
      dry_run: dryRun,
      processed: page.page.length,
      updated,
      skipped: { alreadyOwned, noCustomer, customerMissing, customerUnowned },
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

/**
 * Tombstone consistency: every child of a soft-deleted customer must carry a
 * `deleted_at` so offline devices drop it on pull. Children that already have
 * a tombstone (even an older one) are left untouched.
 */
export const backfillDeletedAtBatch = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
    dry_run: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dry_run === true;
    const page = await ctx.db.query("customers").paginate({
      cursor: args.cursor ?? null,
      numItems: boundedBatch(args.batchSize),
    });

    const updated: Record<CustomerChildTable, number> = {
      pools: 0,
      equipment: 0,
      serviceLogs: 0,
      chemicalUsage: 0,
      notes: 0,
      saltCellLogs: 0,
    };
    let deletedCustomers = 0;

    for (const customer of page.page) {
      const deletedAt = customer.deleted_at;
      if (typeof deletedAt !== "number") continue;
      deletedCustomers += 1;

      for (const table of CUSTOMER_CHILD_TABLES) {
        const children = await ctx.db
          .query(table)
          .withIndex("by_customer", (q: any) => q.eq("customer_id", customer._id))
          .filter((q: any) => q.eq(q.field("deleted_at"), undefined))
          .collect();
        for (const child of children as Array<{ _id: any; updated_at?: number }>) {
          if (!dryRun) {
            await ctx.db.patch(child._id, {
              deleted_at: deletedAt,
              // Bump updated_at so the incremental pull notices the tombstone.
              updated_at: Math.max(Number(child.updated_at) || 0, deletedAt),
            });
          }
          updated[table] += 1;
        }
      }
    }

    return {
      dry_run: dryRun,
      processed: page.page.length,
      deletedCustomers,
      updated,
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

/**
 * Visibility helper for the ownership backfill: how many rows per table still
 * lack `created_by`. Full scans; dashboard use only.
 */
export const countMissingCreatedBy = internalQuery({
  args: {},
  handler: async (ctx) => {
    const result: Record<string, { total: number; missingCreatedBy: number }> = {};
    for (const table of CREATED_BY_BACKFILL_TABLES) {
      const rows = await ctx.db.query(table).collect();
      let missing = 0;
      for (const row of rows as Array<{ created_by?: string }>) {
        if (!row.created_by) missing += 1;
      }
      result[table] = { total: rows.length, missingCreatedBy: missing };
    }
    return result;
  },
});
