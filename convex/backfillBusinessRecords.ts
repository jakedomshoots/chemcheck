import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { assertBusinessRole, requireBusinessContext, requireUserEmail } from "./authorization";

const BACKFILL_TABLES = [
  "customers",
  "serviceLogs",
  "chemicalUsage",
  "notes",
  "servicePhotos",
  "saltCellLogs",
  "serviceReports",
  "workOrders",
  "invoices",
  "quotes",
  "communications",
] as const;

type BackfillTable = (typeof BACKFILL_TABLES)[number];

function isBusinessOwnedRecord(table: BackfillTable, record: any, customer: any, ownerEmail: string): boolean {
  if (table === "customers") return record.created_by === ownerEmail;
  if (customer) return false;
  // Only owner-created, unlinked legacy notes/system records can be safely
  // associated without a customer relationship to verify.
  return record.created_by === ownerEmail;
}

/**
 * Bounded, owner-only migration for records created before business IDs were
 * introduced. Re-run each collection until `isDone` is true. This preserves
 * deny-by-default team access while allowing an explicit migration path.
 */
export const run = mutation({
  args: {
    table: v.union(...BACKFILL_TABLES.map((table) => v.literal(table))),
    business_id: v.optional(v.id("businesses")),
    cursor: v.optional(v.string()),
    batch_size: v.optional(v.number()),
    dry_run: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const email = await requireUserEmail(ctx);
    const business = await requireBusinessContext(ctx, email, args.business_id ? String(args.business_id) : undefined);
    assertBusinessRole(business.role, ["owner"]);

    const batchSize = Math.max(1, Math.min(200, Math.floor(args.batch_size ?? 100)));
    const db: any = ctx.db;
    const page = await db
      .query(args.table)
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

    let patched = 0;
    let skipped = 0;
    for (const rawRecord of page.page as any[]) {
      const record: any = rawRecord;
      if (record.business_id) {
        skipped += 1;
        continue;
      }

      const customerId = args.table === "customers" ? record._id : record.customer_id;
      const customer = customerId ? await ctx.db.get(customerId) : null;
      const belongsToBusiness = args.table === "customers"
        ? record.created_by === business.ownerEmail
        : customer && String(customer.business_id || "") === String(business.businessId);

      if (!belongsToBusiness && !isBusinessOwnedRecord(args.table, record, customer, business.ownerEmail)) {
        skipped += 1;
        continue;
      }

      if (!args.dry_run) {
        await db.patch(record._id, { business_id: business.businessId });
      }
      patched += 1;
    }

    return {
      table: args.table,
      patched,
      skipped,
      dry_run: args.dry_run ?? false,
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});
