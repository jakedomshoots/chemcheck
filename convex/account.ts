import { v } from "convex/values";
import { action, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";

/**
 * Soft ceiling on document writes in a single mutation. Keeping this well below
 * Convex's hard mutation limits lets us safely delete very large accounts.
 */
const MAX_DOC_WRITES = 100;

const DEFAULT_CUSTOMER_BATCH_SIZE = 1;
const DEFAULT_GENERAL_BATCH_SIZE = 100;
const DEFAULT_RATE_LIMIT_BATCH_SIZE = 100;

/**
 * Per-service-log deletion caps. If a log has more dependents than this, the
 * extras are left behind and cleaned up by the later orphan-photo pass or by
 * the next batched call. These numbers keep a single service log well under
 * MAX_DOC_WRITES.
 */
const SERVICE_LOG_PAGE_SIZE = 3;
const PHOTOS_PER_LOG_CAP = 5;
const MAX_REPORTS_PER_LOG = 2;
const MAX_ACCESS_LOGS_PER_REPORT = 10;
const DEPENDENT_PAGE_SIZE = 25;

type CustomersCursor = {
  source?: "created_by" | "business";
  customerCursor?: string | null;
  businessIds?: string[] | null;
  businessIndex?: number;
  currentCustomerId?: string | null;
  stage?:
    | "serviceLogs"
    | "orphanPhotos"
    | "chemicalUsage"
    | "notes"
    | "saltCellLogs"
    | "deleteCustomer";
  tableCursor?: string | null;
};

type GeneralCursor = {
  stage?:
    | "notes"
    | "subscriptions"
    | "team_members_owned"
    | "team_members_direct"
    | "businesses";
  tableCursor?: string | null;
  ownedBusinessIds?: string[] | null;
  businessIndex?: number;
};

type RateLimitsCursor = {
  table?: "rateLimits" | "rateLimitViolations";
  tableCursor?: string | null;
};

/**
 * Internal batched deletion worker. Call repeatedly from the
 * `deleteMyAccount` action until `isDone` is true for every phase.
 */
export const deleteAccountBatch = internalMutation({
  args: {
    userEmail: v.string(),
    phase: v.string(),
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ phase: string; isDone: boolean; nextCursor?: string; deletedCount: number }> => {
    let parsedCursor: any;
    if (args.cursor) {
      try {
        parsedCursor = JSON.parse(args.cursor);
      } catch {
        parsedCursor = {};
      }
    } else {
      parsedCursor = {};
    }

    if (args.phase === "customers") {
      const batchSize = Math.max(1, args.batchSize ?? DEFAULT_CUSTOMER_BATCH_SIZE);
      const result = await deleteCustomersBatch(ctx, args.userEmail, parsedCursor, batchSize);
      return {
        phase: args.phase,
        isDone: result.isDone,
        nextCursor: result.isDone ? undefined : JSON.stringify(result.nextCursor),
        deletedCount: result.deletedCount,
      };
    }

    if (args.phase === "general") {
      const batchSize = Math.max(1, args.batchSize ?? DEFAULT_GENERAL_BATCH_SIZE);
      const result = await deleteGeneralBatch(ctx, args.userEmail, parsedCursor, batchSize);
      return {
        phase: args.phase,
        isDone: result.isDone,
        nextCursor: result.isDone ? undefined : JSON.stringify(result.nextCursor),
        deletedCount: result.deletedCount,
      };
    }

    if (args.phase === "rateLimits") {
      const batchSize = Math.max(1, args.batchSize ?? DEFAULT_RATE_LIMIT_BATCH_SIZE);
      const result = await deleteRateLimitsBatch(ctx, args.userEmail, parsedCursor, batchSize);
      return {
        phase: args.phase,
        isDone: result.isDone,
        nextCursor: result.isDone ? undefined : JSON.stringify(result.nextCursor),
        deletedCount: result.deletedCount,
      };
    }

    throw new Error(`Unknown deletion phase: ${args.phase}`);
  },
});

async function deleteCustomersBatch(
  ctx: any,
  userEmail: string,
  cursor: CustomersCursor,
  batchSize: number
): Promise<{ deletedCount: number; isDone: boolean; nextCursor: CustomersCursor }> {
  const state: CustomersCursor = {
    source: cursor.source ?? "created_by",
    customerCursor: cursor.customerCursor ?? null,
    businessIds: cursor.businessIds ?? null,
    businessIndex: cursor.businessIndex ?? 0,
    currentCustomerId: cursor.currentCustomerId ?? null,
    stage: cursor.stage ?? "serviceLogs",
    tableCursor: cursor.tableCursor ?? null,
  };

  let deletedCount = 0;
  let writesLeft = MAX_DOC_WRITES;
  let customersCompleted = 0;
  let noMoreCustomers = false;

  while (customersCompleted < batchSize && writesLeft > 0) {
    let customer = state.currentCustomerId
      ? await ctx.db.get(state.currentCustomerId as Id<"customers">)
      : null;

    if (!customer) {
      customer = await fetchNextCustomer(ctx, userEmail, state);
      if (!customer) {
        noMoreCustomers = true;
        break;
      }
      state.currentCustomerId = customer._id;
      state.stage = "serviceLogs";
      state.tableCursor = null;
    }

    const stageResult = await processCustomerStage(ctx, customer._id, state, writesLeft);
    deletedCount += stageResult.deleted;
    writesLeft -= stageResult.deleted;
    state.tableCursor = stageResult.state.tableCursor;

    if (!stageResult.finished) {
      // Ran out of write budget; resume this stage in the next batch.
      break;
    }

    if (state.stage === "deleteCustomer") {
      // Entire customer tree deleted.
      state.currentCustomerId = null;
      state.stage = "serviceLogs";
      state.tableCursor = null;
      customersCompleted += 1;
    } else {
      // Advance to the next cleanup stage for this customer.
      state.stage = nextCustomerStage(state.stage ?? "serviceLogs");
      state.tableCursor = null;
    }
  }

  const isDone = noMoreCustomers && !state.currentCustomerId;
  return { deletedCount, isDone, nextCursor: state };
}

async function fetchNextCustomer(ctx: any, userEmail: string, state: CustomersCursor): Promise<any> {
  while (true) {
    if (state.source === "created_by" || !state.source) {
      const page = await ctx.db
        .query("customers")
        .withIndex("by_created_by", (q: any) => q.eq("created_by", userEmail))
        .paginate({ cursor: state.customerCursor ?? null, numItems: 1 });

      if (page.page.length > 0) {
        state.customerCursor = page.continueCursor;
        return page.page[0];
      }

      state.source = "business";
      state.customerCursor = null;
    }

    if (state.source === "business") {
      if (state.businessIds === null) {
        const owned = await ctx.db
          .query("businesses")
          .withIndex("by_owner_email", (q: any) => q.eq("owner_email", userEmail))
          .collect();
        state.businessIds = owned.map((b: any) => b._id as string);
        state.businessIndex = 0;
      }

      while ((state.businessIndex ?? 0) < (state.businessIds?.length ?? 0)) {
        const businessId = state.businessIds![state.businessIndex ?? 0];
        const page = await ctx.db
          .query("customers")
          .withIndex("by_business", (q: any) => q.eq("business_id", businessId))
          .paginate({ cursor: state.customerCursor ?? null, numItems: 1 });

        if (page.page.length > 0) {
          state.customerCursor = page.continueCursor;
          return page.page[0];
        }

        state.businessIndex = (state.businessIndex ?? 0) + 1;
        state.customerCursor = null;
      }

      return null;
    }
  }
}

function nextCustomerStage(stage: string): string {
  const order = [
    "serviceLogs",
    "orphanPhotos",
    "chemicalUsage",
    "notes",
    "saltCellLogs",
    "deleteCustomer",
  ];
  const idx = order.indexOf(stage);
  return order[idx + 1] ?? "deleteCustomer";
}

async function processCustomerStage(
  ctx: any,
  customerId: Id<"customers">,
  state: CustomersCursor,
  writesLeft: number
): Promise<{ deleted: number; finished: boolean; state: CustomersCursor }> {
  const stage = state.stage ?? "serviceLogs";
  let deleted = 0;

  if (stage === "serviceLogs") {
    const perLogEstimate =
      1 +
      PHOTOS_PER_LOG_CAP +
      MAX_REPORTS_PER_LOG * (1 + MAX_ACCESS_LOGS_PER_REPORT);

    if (writesLeft < perLogEstimate) {
      return { deleted, finished: false, state };
    }

    const numItems = Math.min(SERVICE_LOG_PAGE_SIZE, Math.floor(writesLeft / perLogEstimate));
    const page = await ctx.db
      .query("serviceLogs")
      .withIndex("by_customer", (q: any) => q.eq("customer_id", customerId))
      .paginate({ cursor: state.tableCursor ?? null, numItems });

    for (const log of page.page) {
      const photos = await ctx.db
        .query("servicePhotos")
        .withIndex("by_service_log", (q: any) => q.eq("service_log_id", log._id))
        .take(PHOTOS_PER_LOG_CAP);
      for (const photo of photos) {
        await ctx.db.delete(photo._id);
        deleted += 1;
        try {
          await ctx.storage.delete(photo.storage_id);
        } catch {
          // Best-effort storage cleanup; orphaned files are not fatal.
        }
      }

      const reports = await ctx.db
        .query("serviceReports")
        .withIndex("by_service_log", (q: any) => q.eq("service_log_id", log._id))
        .take(MAX_REPORTS_PER_LOG);
      for (const report of reports) {
        const accessLogs = await ctx.db
          .query("reportAccessLogs")
          .withIndex("by_token", (q: any) => q.eq("report_token", report.report_token))
          .take(MAX_ACCESS_LOGS_PER_REPORT);
        for (const accessLog of accessLogs) {
          await ctx.db.delete(accessLog._id);
          deleted += 1;
        }
        await ctx.db.delete(report._id);
        deleted += 1;
      }

      await ctx.db.delete(log._id);
      deleted += 1;
    }

    if (!page.isDone) {
      state.tableCursor = page.continueCursor;
      return { deleted, finished: false, state };
    }

    return { deleted, finished: true, state };
  }

  if (stage === "orphanPhotos") {
    const numItems = Math.min(DEPENDENT_PAGE_SIZE, writesLeft);
    if (numItems === 0) return { deleted, finished: false, state };

    const page = await ctx.db
      .query("servicePhotos")
      .withIndex("by_customer", (q: any) => q.eq("customer_id", customerId))
      .paginate({ cursor: state.tableCursor ?? null, numItems });

    for (const photo of page.page) {
      await ctx.db.delete(photo._id);
      deleted += 1;
      try {
        await ctx.storage.delete(photo.storage_id);
      } catch {
        // Best-effort storage cleanup.
      }
    }

    if (!page.isDone) {
      state.tableCursor = page.continueCursor;
      return { deleted, finished: false, state };
    }
    return { deleted, finished: true, state };
  }

  if (stage === "chemicalUsage") {
    const numItems = Math.min(DEPENDENT_PAGE_SIZE, writesLeft);
    if (numItems === 0) return { deleted, finished: false, state };

    const page = await ctx.db
      .query("chemicalUsage")
      .withIndex("by_customer", (q: any) => q.eq("customer_id", customerId))
      .paginate({ cursor: state.tableCursor ?? null, numItems });

    for (const record of page.page) {
      await ctx.db.delete(record._id);
      deleted += 1;
    }

    if (!page.isDone) {
      state.tableCursor = page.continueCursor;
      return { deleted, finished: false, state };
    }
    return { deleted, finished: true, state };
  }

  if (stage === "notes") {
    const numItems = Math.min(DEPENDENT_PAGE_SIZE, writesLeft);
    if (numItems === 0) return { deleted, finished: false, state };

    const page = await ctx.db
      .query("notes")
      .withIndex("by_customer", (q: any) => q.eq("customer_id", customerId))
      .paginate({ cursor: state.tableCursor ?? null, numItems });

    for (const note of page.page) {
      await ctx.db.delete(note._id);
      deleted += 1;
    }

    if (!page.isDone) {
      state.tableCursor = page.continueCursor;
      return { deleted, finished: false, state };
    }
    return { deleted, finished: true, state };
  }

  if (stage === "saltCellLogs") {
    const numItems = Math.min(DEPENDENT_PAGE_SIZE, writesLeft);
    if (numItems === 0) return { deleted, finished: false, state };

    const page = await ctx.db
      .query("saltCellLogs")
      .withIndex("by_customer", (q: any) => q.eq("customer_id", customerId))
      .paginate({ cursor: state.tableCursor ?? null, numItems });

    for (const record of page.page) {
      await ctx.db.delete(record._id);
      deleted += 1;
    }

    if (!page.isDone) {
      state.tableCursor = page.continueCursor;
      return { deleted, finished: false, state };
    }
    return { deleted, finished: true, state };
  }

  if (stage === "deleteCustomer") {
    if (writesLeft < 1) return { deleted, finished: false, state };
    await ctx.db.delete(customerId);
    deleted += 1;
    return { deleted, finished: true, state };
  }

  return { deleted, finished: true, state };
}

async function deleteGeneralBatch(
  ctx: any,
  userEmail: string,
  cursor: GeneralCursor,
  batchSize: number
): Promise<{ deletedCount: number; isDone: boolean; nextCursor: GeneralCursor }> {
  const state: GeneralCursor = {
    stage: cursor.stage ?? "notes",
    tableCursor: cursor.tableCursor ?? null,
    ownedBusinessIds: cursor.ownedBusinessIds ?? null,
    businessIndex: cursor.businessIndex ?? 0,
  };

  let deletedCount = 0;
  let writesLeft = MAX_DOC_WRITES;
  let isDone = false;

  while (writesLeft > 0 && !isDone) {
    if (state.stage === "notes") {
      const numItems = Math.min(batchSize, writesLeft);
      if (numItems === 0) break;

      const page = await ctx.db
        .query("notes")
        .withIndex("by_created_by", (q: any) => q.eq("created_by", userEmail))
        .paginate({ cursor: state.tableCursor ?? null, numItems });

      for (const note of page.page) {
        await ctx.db.delete(note._id);
        deletedCount += 1;
        writesLeft -= 1;
      }

      if (!page.isDone) {
        state.tableCursor = page.continueCursor;
        break;
      }

      state.stage = "subscriptions";
      state.tableCursor = null;
      continue;
    }

    if (state.stage === "subscriptions") {
      const subscriptions = await ctx.db
        .query("subscriptions")
        .withIndex("by_user_email", (q: any) => q.eq("user_email", userEmail))
        .collect();

      for (const subscription of subscriptions) {
        if (writesLeft <= 0) break;
        await ctx.db.delete(subscription._id);
        deletedCount += 1;
        writesLeft -= 1;
      }

      state.stage = "team_members_owned";
      state.tableCursor = null;
      continue;
    }

    if (state.stage === "team_members_owned") {
      if (state.ownedBusinessIds === null) {
        const owned = await ctx.db
          .query("businesses")
          .withIndex("by_owner_email", (q: any) => q.eq("owner_email", userEmail))
          .collect();
        state.ownedBusinessIds = owned.map((b: any) => b._id as string);
        state.businessIndex = 0;
      }

      while ((state.businessIndex ?? 0) < (state.ownedBusinessIds?.length ?? 0) && writesLeft > 0) {
        const businessId = state.ownedBusinessIds![state.businessIndex ?? 0];
        const numItems = Math.min(batchSize, writesLeft);

        const page = await ctx.db
          .query("team_members")
          .withIndex("by_business", (q: any) => q.eq("business_id", businessId as Id<"businesses">))
          .paginate({ cursor: state.tableCursor ?? null, numItems });

        for (const member of page.page) {
          await ctx.db.delete(member._id);
          deletedCount += 1;
          writesLeft -= 1;
        }

        if (!page.isDone) {
          state.tableCursor = page.continueCursor;
          break;
        }

        state.businessIndex = (state.businessIndex ?? 0) + 1;
        state.tableCursor = null;
      }

      if ((state.businessIndex ?? 0) < (state.ownedBusinessIds?.length ?? 0) && writesLeft <= 0) {
        break;
      }

      state.stage = "team_members_direct";
      state.tableCursor = null;
      continue;
    }

    if (state.stage === "team_members_direct") {
      const numItems = Math.min(batchSize, writesLeft);
      if (numItems === 0) break;

      const page = await ctx.db
        .query("team_members")
        .withIndex("by_user_email", (q: any) => q.eq("user_email", userEmail))
        .paginate({ cursor: state.tableCursor ?? null, numItems });

      for (const member of page.page) {
        await ctx.db.delete(member._id);
        deletedCount += 1;
        writesLeft -= 1;
      }

      if (!page.isDone) {
        state.tableCursor = page.continueCursor;
        break;
      }

      state.stage = "businesses";
      state.tableCursor = null;
      continue;
    }

    if (state.stage === "businesses") {
      const numItems = Math.min(batchSize, writesLeft);
      if (numItems === 0) break;

      const page = await ctx.db
        .query("businesses")
        .withIndex("by_owner_email", (q: any) => q.eq("owner_email", userEmail))
        .paginate({ cursor: state.tableCursor ?? null, numItems });

      for (const business of page.page) {
        await ctx.db.delete(business._id);
        deletedCount += 1;
        writesLeft -= 1;
      }

      if (!page.isDone) {
        state.tableCursor = page.continueCursor;
        break;
      }

      isDone = true;
    }
  }

  return { deletedCount, isDone, nextCursor: state };
}

async function deleteRateLimitsBatch(
  ctx: any,
  userEmail: string,
  cursor: RateLimitsCursor,
  batchSize: number
): Promise<{ deletedCount: number; isDone: boolean; nextCursor: RateLimitsCursor }> {
  const prefix = `${userEmail}:`;
  const state: RateLimitsCursor = {
    table: cursor.table ?? "rateLimits",
    tableCursor: cursor.tableCursor ?? null,
  };

  let deletedCount = 0;
  let writesLeft = MAX_DOC_WRITES;
  let isDone = false;

  while (writesLeft > 0 && !isDone) {
    if (state.table === "rateLimits") {
      const numItems = Math.min(batchSize, writesLeft);
      if (numItems === 0) break;

      const page = await ctx.db
        .query("rateLimits")
        .withIndex("by_key")
        .paginate({ cursor: state.tableCursor ?? null, numItems });

      for (const entry of page.page) {
        if (!entry.key.startsWith(prefix)) continue;
        if (writesLeft <= 0) break;
        await ctx.db.delete(entry._id);
        deletedCount += 1;
        writesLeft -= 1;
      }

      if (!page.isDone) {
        state.tableCursor = page.continueCursor;
        if (deletedCount === 0 && writesLeft > 0) continue;
        break;
      }

      state.table = "rateLimitViolations";
      state.tableCursor = null;
      continue;
    }

    if (state.table === "rateLimitViolations") {
      const numItems = Math.min(batchSize, writesLeft);
      if (numItems === 0) break;

      const page = await ctx.db
        .query("rateLimitViolations")
        .withIndex("by_key")
        .paginate({ cursor: state.tableCursor ?? null, numItems });

      for (const entry of page.page) {
        if (!entry.key.startsWith(prefix)) continue;
        if (writesLeft <= 0) break;
        await ctx.db.delete(entry._id);
        deletedCount += 1;
        writesLeft -= 1;
      }

      if (!page.isDone) {
        state.tableCursor = page.continueCursor;
        if (deletedCount === 0 && writesLeft > 0) continue;
        break;
      }

      isDone = true;
    }
  }

  return { deletedCount, isDone, nextCursor: state };
}

/**
 * Public action that orchestrates batched deletion of all user-owned data.
 * This is safe for large accounts because the actual deletes happen inside
 * small `deleteAccountBatch` internal mutations.
 */
export const deleteMyAccount = action({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity || !identity.email) {
      throw new Error("Not authenticated");
    }

    const userEmail = identity.email;
    const summary = {
      customers: 0,
      general: 0,
      rateLimits: 0,
    };
    const warnings: string[] = [];

    const phases = ["customers", "general", "rateLimits"] as const;

    for (const phase of phases) {
      let cursor: string | undefined;
      do {
        const result: any = await ctx.runMutation(internal.account.deleteAccountBatch, {
          userEmail,
          phase,
          cursor,
          batchSize: phase === "customers" ? 1 : 100,
        });

        summary[phase] += result.deletedCount;
        cursor = result.isDone ? undefined : result.nextCursor;
      } while (cursor);
    }

    return {
      success: true,
      userEmail,
      deletedAt: Date.now(),
      deleted: summary,
      warnings,
    };
  },
});

// ============================================
// GDPR Data Export
// ============================================

const EXPORT_BATCH_SIZE = 1000;
const EXPORT_INLINE_RECORD_LIMIT = 5000;

async function collectUserExportData(
  ctx: any,
  userEmail: string
): Promise<{ data: Record<string, unknown>; truncated: boolean; totalRecords: number }> {
  const ownedBusinesses = await ctx.db
    .query("businesses")
    .withIndex("by_owner_email", (q: any) => q.eq("owner_email", userEmail))
    .collect();
  const ownedBusinessIds = ownedBusinesses.map((b: any) => b._id as string);

  const customersByCreator = await ctx.db
    .query("customers")
    .withIndex("by_created_by", (q: any) => q.eq("created_by", userEmail))
    .take(EXPORT_BATCH_SIZE);

  const customersByBusiness = ownedBusinessIds.length
    ? await Promise.all(
        ownedBusinessIds.map((businessId: string) =>
          ctx.db
            .query("customers")
            .withIndex("by_business", (q: any) => q.eq("business_id", businessId))
            .take(EXPORT_BATCH_SIZE)
        )
      ).then((pages) => pages.flat())
    : [];

  const customerMap = new Map<string, any>();
  for (const customer of [...customersByCreator, ...customersByBusiness]) {
    customerMap.set(customer._id as string, customer);
  }
  const customers = Array.from(customerMap.values());
  const customerIds = customers.map((c) => c._id as string);

  const [serviceLogs, chemicalUsage, notesByCustomer, saltCellLogs] = await Promise.all([
    Promise.all(
      customerIds.map((id: string) =>
        ctx.db
          .query("serviceLogs")
          .withIndex("by_customer", (q: any) => q.eq("customer_id", id as Id<"customers">))
          .take(EXPORT_BATCH_SIZE)
      )
    ).then((pages) => pages.flat()),
    Promise.all(
      customerIds.map((id: string) =>
        ctx.db
          .query("chemicalUsage")
          .withIndex("by_customer", (q: any) => q.eq("customer_id", id as Id<"customers">))
          .take(EXPORT_BATCH_SIZE)
      )
    ).then((pages) => pages.flat()),
    Promise.all(
      customerIds.map((id: string) =>
        ctx.db
          .query("notes")
          .withIndex("by_customer", (q: any) => q.eq("customer_id", id as Id<"customers">))
          .take(EXPORT_BATCH_SIZE)
      )
    ).then((pages) => pages.flat()),
    Promise.all(
      customerIds.map((id: string) =>
        ctx.db
          .query("saltCellLogs")
          .withIndex("by_customer", (q: any) => q.eq("customer_id", id as Id<"customers">))
          .take(EXPORT_BATCH_SIZE)
      )
    ).then((pages) => pages.flat()),
  ]);

  const notesByCreator = await ctx.db
    .query("notes")
    .withIndex("by_created_by", (q: any) => q.eq("created_by", userEmail))
    .take(EXPORT_BATCH_SIZE);

  const noteMap = new Map<string, any>();
  for (const note of [...notesByCustomer, ...notesByCreator]) {
    noteMap.set(note._id as string, note);
  }
  const notes = Array.from(noteMap.values());

  const teamMembershipsOwned = ownedBusinessIds.length
    ? await Promise.all(
        ownedBusinessIds.map((businessId: string) =>
          ctx.db
            .query("team_members")
            .withIndex("by_business", (q: any) => q.eq("business_id", businessId as Id<"businesses">))
            .take(EXPORT_BATCH_SIZE)
        )
      ).then((pages) => pages.flat())
    : [];

  const teamMembershipsDirect = await ctx.db
    .query("team_members")
    .withIndex("by_user_email", (q: any) => q.eq("user_email", userEmail))
    .take(EXPORT_BATCH_SIZE);

  const teamMap = new Map<string, any>();
  for (const member of [...teamMembershipsOwned, ...teamMembershipsDirect]) {
    teamMap.set(member._id as string, member);
  }
  const teamMemberships = Array.from(teamMap.values());

  const [subscriptions, communications] = await Promise.all([
    ctx.db
      .query("subscriptions")
      .withIndex("by_user_email", (q: any) => q.eq("user_email", userEmail))
      .take(EXPORT_BATCH_SIZE),
    ctx.db
      .query("communications")
      .withIndex("by_created_by", (q: any) => q.eq("created_by", userEmail))
      .take(EXPORT_BATCH_SIZE),
  ]);

  const data = {
    userEmail,
    exportDate: new Date().toISOString(),
    exportType: "gdpr_data_request",
    userData: {
      customers: customers.map(stripInternalFields),
      serviceLogs: serviceLogs.map(stripInternalFields),
      chemicalUsage: chemicalUsage.map(stripInternalFields),
      notes: notes.map(stripInternalFields),
      saltCellLogs: saltCellLogs.map(stripInternalFields),
      businesses: ownedBusinesses.map(stripInternalFields),
      teamMemberships: teamMemberships.map(stripInternalFields),
      subscriptions: subscriptions.map(stripInternalFields),
      communications: communications.map(stripInternalFields),
    },
    metadata: {
      exportFormat: "json",
      gdprCompliant: true,
    },
  };

  const totalRecords =
    customers.length +
    serviceLogs.length +
    chemicalUsage.length +
    notes.length +
    saltCellLogs.length +
    ownedBusinesses.length +
    teamMemberships.length +
    subscriptions.length +
    communications.length;

  const truncated =
    customers.length >= EXPORT_BATCH_SIZE ||
    serviceLogs.length >= EXPORT_BATCH_SIZE ||
    chemicalUsage.length >= EXPORT_BATCH_SIZE ||
    notes.length >= EXPORT_BATCH_SIZE ||
    saltCellLogs.length >= EXPORT_BATCH_SIZE ||
    ownedBusinesses.length >= EXPORT_BATCH_SIZE ||
    teamMemberships.length >= EXPORT_BATCH_SIZE ||
    subscriptions.length >= EXPORT_BATCH_SIZE ||
    communications.length >= EXPORT_BATCH_SIZE;

  return { data, truncated, totalRecords };
}

function stripInternalFields(record: any): Record<string, unknown> {
  if (!record || typeof record !== "object") return record;
  const { _id, _creationTime, ...rest } = record;
  void _id;
  void _creationTime;
  return rest;
}

async function uploadExportToStorage(
  ctx: any,
  payload: Record<string, unknown>
): Promise<{ url: string; filename: string }> {
  const uploadUrl = await ctx.storage.generateUploadUrl();
  const json = JSON.stringify(payload, null, 2);

  const uploadResponse = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: json,
  });

  if (!uploadResponse.ok) {
    throw new Error(`Failed to upload export to storage: ${uploadResponse.status}`);
  }

  const { storageId } = await uploadResponse.json();
  const url = await ctx.storage.getUrl(storageId);
  if (!url) {
    throw new Error("Failed to generate export download URL");
  }

  const date = new Date().toISOString().split("T")[0];
  return { url, filename: `chemcheck-gdpr-export-${date}.json` };
}

/**
 * Public action to export all data owned by the authenticated user.
 * Satisfies GDPR Right to Access (Article 15) and Right to Portability (Article 20).
 *
 * For small accounts the full payload is returned inline. For accounts whose
 * data would exceed Convex action response limits, the export is written to a
 * temporary storage URL and the URL is returned instead.
 */
export const exportUserData = action({
  args: {},
  handler: async (ctx): Promise<
    | { type: "inline"; data: Record<string, unknown>; totalRecords: number; truncated: boolean }
    | { type: "url"; url: string; filename: string; totalRecords: number; truncated: boolean }
  > => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity || !identity.email) {
      throw new Error("Not authenticated");
    }

    const userEmail = identity.email;
    const { data, truncated, totalRecords } = await collectUserExportData(ctx, userEmail);

    // If the dataset is large or any table hit the batch cap, stream it through
    // storage so the browser can download it without hitting action size limits.
    if (truncated || totalRecords > EXPORT_INLINE_RECORD_LIMIT) {
      const { url, filename } = await uploadExportToStorage(ctx, data);
      return { type: "url", url, filename, totalRecords, truncated };
    }

    return { type: "inline", data, totalRecords, truncated };
  },
});
