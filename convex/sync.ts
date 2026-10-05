import { mutation, query, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { enforceRateLimit } from "./rateLimit";
import { assertWriteAllowed } from "./entitlements";
import { validateLsiFields } from "./validation";
import { stripScanAnalysisVersionValidator, stripScanPadConfidenceValidator, stripScanQualityValidator } from "./lsiValidators";

/**
 * Convex mutations for syncing data from Dexie (local IndexedDB) to Convex (cloud)
 * These mutations handle upsert logic and conflict detection for bidirectional sync
 * 
 * SECURITY: All sync mutations require authentication and enforce tenant isolation
 */

function normalizeEmail(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

const SYNC_RECEIPT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PULL_TABLES = [
  "customers",
  "pools",
  "equipment",
  "serviceLogs",
  "chemicalUsage",
  "notes",
  "saltCellLogs",
] as const;
type PullTableName = typeof PULL_TABLES[number];

export const cleanupSyncOperations = internalMutation({
  args: {},
  handler: async (ctx) => {
    const expired = await ctx.db
      .query("syncOperations")
      .withIndex("by_expires_at", (q: any) => q.lt(q.field("expires_at"), Date.now()))
      .take(500);
    for (const receipt of expired) await ctx.db.delete(receipt._id);
    return { deleted: expired.length };
  },
});

/**
 * Return a previously committed mutation result.  The client keeps the same
 * key while retrying a request, so a lost response cannot create a duplicate
 * customer/log/note.  Keys are checked against the authenticated email to
 * prevent cross-tenant replay.
 */
async function getSyncReceipt(ctx: any, key: string | undefined, userEmail: string): Promise<any | null> {
  if (!key) return null;
  const scopedKey = `${normalizeEmail(userEmail)}:${key}`;
  const receipt = await ctx.db
    .query("syncOperations")
    .withIndex("by_key", (q: any) => q.eq("key", scopedKey))
    .first();
  if (!receipt || normalizeEmail(receipt.user_email) !== normalizeEmail(userEmail)) return null;
  if (receipt.expires_at <= Date.now()) return null;
  return receipt.response;
}

async function saveSyncReceipt(
  ctx: any,
  key: string | undefined,
  userEmail: string,
  table: string,
  response: any,
): Promise<any> {
  if (!key) return response;
  const scopedKey = `${normalizeEmail(userEmail)}:${key}`;
  // A retry may race with another request carrying the same key.  Convex
  // retries conflicting transactions; this guard also handles already
  // existing receipts when invoked from tests/mocks.
  const existing = await ctx.db
    .query("syncOperations")
    .withIndex("by_key", (q: any) => q.eq("key", scopedKey))
    .first();
  if (!existing) {
    await ctx.db.insert("syncOperations", {
      key: scopedKey,
      user_email: userEmail,
      table,
      response,
      created_at: Date.now(),
      expires_at: Date.now() + SYNC_RECEIPT_TTL_MS,
    });
  }
  return response;
}

/**
 * A pull "shard" is one indexed query over a single sync table. Convex permits
 * only one paginated database query per function invocation, so the cursor
 * walks through every shard of every table one paginate() at a time.
 *
 * - `paginate` shards page through an indexed query.
 * - `load` shards read a small, already tenant-bounded set in one go (legacy
 *   pools/equipment for solo users, looked up per owned customer by_customer).
 */
type PullShard =
  | { kind: "paginate"; query: any }
  | { kind: "load"; load: () => Promise<any[]> };

/** Query filter that hides tombstoned rows from non-sync list queries. */
export const NOT_DELETED_FILTER = (q: any) => q.eq(q.field("deleted_at"), undefined);

function uniqueEmails(values: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value) continue;
    for (const candidate of [String(value), normalizeEmail(value)]) {
      if (!candidate || seen.has(candidate)) continue;
      seen.add(candidate);
      result.push(candidate);
    }
  }
  return result;
}

/**
 * Cursor-paginated pull for all records owned by the authenticated business.
 * Convex permits only one paginated database query per function invocation,
 * so the opaque cursor advances through one table (and one shard of that
 * table) at a time. `since` is an updated_at watermark; the first pull
 * (since=0) intentionally includes legacy rows that have no timestamp.
 *
 * Tombstones: rows deleted through deleteRecord / customers.remove keep their
 * document with `deleted_at` (ms timestamp) set and `updated_at` bumped, so
 * they flow through the same watermark and are returned here unchanged.
 * Clients must drop any pulled row whose `deleted_at` is a number.
 */
export const pull = query({
  args: {
    cursor: v.optional(v.string()),
    since: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    customers: v.array(v.any()),
    pools: v.array(v.any()),
    equipment: v.array(v.any()),
    serviceLogs: v.array(v.any()),
    chemicalUsage: v.array(v.any()),
    notes: v.array(v.any()),
    saltCellLogs: v.array(v.any()),
    cursor: v.union(v.string(), v.null()),
    hasMore: v.boolean(),
    watermark: v.number(),
  }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const pageLimit = Math.max(1, Math.min(Math.floor(args.limit ?? 50), 200));
    let state: any = {};
    if (args.cursor) {
      try {
        state = JSON.parse(args.cursor);
      } catch {
        throw new Error("Invalid sync cursor");
      }
    }

    const since = Number.isFinite(state.since) ? state.since : Math.max(0, args.since ?? 0);
    // Capture one upper watermark for the entire pull. Changes committed
    // after this point are picked up by the following pull.
    const watermark = Number.isFinite(state.watermark) ? state.watermark : Date.now();
    let activeTableIndex = 0;
    let activeShardIndex = 0;
    let tableCursor: string | null = null;
    if ((state.version === 2 || state.version === 3) && PULL_TABLES.includes(state.table)) {
      activeTableIndex = PULL_TABLES.indexOf(state.table);
      activeShardIndex = Number.isInteger(state.shard) && state.shard >= 0 ? state.shard : 0;
      tableCursor = typeof state.tableCursor === "string" ? state.tableCursor : null;
    } else {
      // Resume cursors written by the earlier per-table cursor format.
      const legacyIndex = PULL_TABLES.findIndex((table) => state[table] !== null);
      activeTableIndex = legacyIndex >= 0 ? legacyIndex : 0;
      const legacyCursor = state[PULL_TABLES[activeTableIndex]];
      tableCursor = typeof legacyCursor === "string" ? legacyCursor : null;
    }
    const activeTable = PULL_TABLES[activeTableIndex];
    const business = await resolveBusinessContext(ctx, identity.email!);

    const filterByWatermark = (q: any): any => {
      // Include every row on initial hydration, including legacy rows without
      // updated_at. Incremental pulls only need rows newer than the cursor.
      if (since <= 0) return q;
      return q.filter((predicate: any) =>
        predicate.and(
          predicate.gt(predicate.field("updated_at"), since),
          predicate.lte(predicate.field("updated_at"), watermark),
        )
      );
    };

    // Every shard is an indexed, tenant-scoped query. Never filter an entire
    // table by created_by: that scans every tenant's rows.
    const byCreatedBy = (table: string, email: string): PullShard => ({
      kind: "paginate",
      query: (ctx.db as any).query(table).withIndex("by_created_by", (q: any) => q.eq("created_by", email)),
    });
    const byBusiness = (table: string): PullShard => ({
      kind: "paginate",
      query: (ctx.db as any).query(table).withIndex("by_business", (q: any) => q.eq("business_id", String(business._id))),
    });

    let accessibleEmails: string[];
    if (business) {
      const members = await ctx.db
        .query("team_members")
        .withIndex("by_business", (q: any) => q.eq("business_id", business._id))
        .filter((q: any) => q.eq(q.field("is_active"), true))
        .collect();
      accessibleEmails = uniqueEmails([
        business.owner_email,
        identity.email!,
        ...members.map((member: any) => member.user_email),
      ]);
    } else {
      accessibleEmails = uniqueEmails([identity.email!]);
    }

    const customerShards: PullShard[] = business
      ? [byBusiness("customers")]
      : accessibleEmails.map((email) => byCreatedBy("customers", email));
    const childShards = (table: string): PullShard[] =>
      accessibleEmails.map((email) => byCreatedBy(table, email));

    let poolShards: PullShard[];
    let equipmentShards: PullShard[];
    if (business) {
      poolShards = [byBusiness("pools")];
      equipmentShards = [byBusiness("equipment")];
    } else {
      // Legacy single-user records may not have business_id. Look pools and
      // equipment up per owned customer through by_customer; each customer has
      // a handful of rows, so this stays bounded without a full-table filter.
      const loadByOwnedCustomers = (table: string): PullShard => ({
        kind: "load",
        load: async () => {
          const rows: any[] = [];
          for (const email of accessibleEmails) {
            const ownedCustomers = await ctx.db
              .query("customers")
              .withIndex("by_created_by", (q: any) => q.eq("created_by", email))
              .collect();
            for (const customer of ownedCustomers) {
              const owned = await filterByWatermark(
                (ctx.db as any).query(table).withIndex("by_customer", (q: any) => q.eq("customer_id", customer._id))
              ).collect();
              rows.push(...owned);
            }
          }
          return rows;
        },
      });
      poolShards = [loadByOwnedCustomers("pools")];
      equipmentShards = [loadByOwnedCustomers("equipment")];
    }

    const shards: Record<PullTableName, PullShard[]> = {
      customers: customerShards,
      pools: poolShards,
      equipment: equipmentShards,
      serviceLogs: childShards("serviceLogs"),
      chemicalUsage: childShards("chemicalUsage"),
      notes: childShards("notes"),
      saltCellLogs: childShards("saltCellLogs"),
    };

    const runShard = async (shard: PullShard | undefined): Promise<{ rows: any[]; next: string | null; done: boolean }> => {
      if (!shard) return { rows: [], next: null, done: true };
      if (shard.kind === "load") {
        return { rows: await shard.load(), next: null, done: true };
      }
      const result = await filterByWatermark(shard.query).paginate({
        cursor: tableCursor,
        numItems: pageLimit,
      });
      return {
        rows: result.page,
        next: result.isDone ? null : result.continueCursor,
        done: result.isDone,
      };
    };

    const tableShards = shards[activeTable];
    const currentPage = await runShard(tableShards[activeShardIndex]);
    const rows: Record<PullTableName, any[]> = {
      customers: [],
      pools: [],
      equipment: [],
      serviceLogs: [],
      chemicalUsage: [],
      notes: [],
      saltCellLogs: [],
    };
    rows[activeTable] = currentPage.rows;

    let nextTableIndex = activeTableIndex;
    let nextShardIndex = activeShardIndex;
    let nextTableCursor = currentPage.next;
    if (currentPage.done) {
      nextShardIndex += 1;
      nextTableCursor = null;
      if (nextShardIndex >= tableShards.length) {
        nextTableIndex += 1;
        nextShardIndex = 0;
      }
    }
    const isDone = nextTableIndex >= PULL_TABLES.length;
    const nextState = isDone ? null : JSON.stringify({
      version: 3,
      since,
      watermark,
      table: PULL_TABLES[nextTableIndex],
      shard: nextShardIndex,
      tableCursor: nextTableCursor,
    });

    return {
      ...rows,
      cursor: nextState,
      hasMore: !isDone,
      watermark,
    };
  },
});

/**
 * Resolve the business a user acts for. Ownership wins over membership, and
 * only active memberships count. Every lookup is indexed: the normalized
 * (trimmed, lower-cased) email is retried through the same indexes for legacy
 * rows instead of scanning the whole table.
 */
async function resolveBusinessContext(ctx: any, userEmail: string) {
  const candidates = uniqueEmails([userEmail]);
  if (!candidates.length) return null;

  for (const email of candidates) {
    const ownedBusiness = await ctx.db
      .query("businesses")
      .withIndex("by_owner_email", (q: any) => q.eq("owner_email", email))
      .first();
    if (ownedBusiness) return ownedBusiness;
  }

  for (const email of candidates) {
    const members = await ctx.db
      .query("team_members")
      .withIndex("by_user_email", (q: any) => q.eq("user_email", email))
      .filter((q: any) => q.eq(q.field("is_active"), true))
      .collect();
    for (const member of members) {
      if (member.is_active !== true) continue;
      const teamBusiness = await ctx.db.get(member.business_id);
      if (teamBusiness) return teamBusiness;
    }
  }

  return null;
}

async function getActiveBusinessMemberEmails(
  ctx: any,
  businessId: any,
  ownerEmail: string
): Promise<Set<string>> {
  const members = await ctx.db
    .query("team_members")
    .withIndex("by_business", (q: any) => q.eq("business_id", businessId))
    .filter((q: any) => q.eq(q.field("is_active"), true))
    .collect();

  const emails = new Set<string>([normalizeEmail(ownerEmail)]);
  for (const member of members) {
    if (member.is_active !== true) continue;
    const email = normalizeEmail(member.user_email);
    if (email) emails.add(email);
  }
  return emails;
}

async function canAccessCustomer(ctx: any, customer: any, userEmail: string): Promise<boolean> {
  if (!customer) return false;

  const normalizedUserEmail = normalizeEmail(userEmail);
  const customerCreatedBy = normalizeEmail(customer.created_by);

  if (customerCreatedBy && customerCreatedBy === normalizedUserEmail) {
    return true;
  }

  const business = await resolveBusinessContext(ctx, userEmail);
  if (!business) return false;

  const businessId = String(business._id);
  const customerBusinessId = customer.business_id ? String(customer.business_id) : "";
  if (customerBusinessId && customerBusinessId === businessId) {
    return true;
  }

  const allowedEmails = await getActiveBusinessMemberEmails(ctx, business._id, business.owner_email);
  return customerCreatedBy ? allowedEmails.has(customerCreatedBy) : false;
}

/**
 * General (customer-less) notes are owned by their creator. The creator, the
 * owner of the caller's business or an ACTIVE member of it may update them.
 * A legacy note that has no owner yet is claimed by whoever syncs it first:
 * the update path stamps `created_by` so the row stops being ownerless.
 */
async function canAccessGeneralNote(ctx: any, note: any, userEmail: string): Promise<boolean> {
  const creator = normalizeEmail(note?.created_by);
  if (!creator) return true;
  const caller = normalizeEmail(userEmail);
  if (creator === caller) return true;

  const business = await resolveBusinessContext(ctx, userEmail);
  if (!business) return false;
  const allowedEmails = await getActiveBusinessMemberEmails(ctx, business._id, business.owner_email);
  return allowedEmails.has(creator);
}

async function ensureCustomerOwnedByUser(ctx: any, customerId: any, userEmail: string): Promise<void> {
  const customer = await ctx.db.get(customerId);
  const allowed = await canAccessCustomer(ctx, customer, userEmail);
  if (!allowed) {
    throw new Error("Access denied: cannot sync data for another user's customer");
  }
}

async function ensurePoolOwnedByUser(ctx: any, poolId: any, customerId: any, userEmail: string): Promise<any> {
  const pool = await ctx.db.get(poolId);
  if (!pool || String(pool.customer_id) !== String(customerId)) {
    throw new Error("Pool not found for customer");
  }
  await ensureCustomerOwnedByUser(ctx, customerId, userEmail);
  return pool;
}

// ============================================
// Soft delete / tombstones
// ============================================

const DELETABLE_TABLES = [
  "customers",
  "serviceLogs",
  "chemicalUsage",
  "notes",
  "saltCellLogs",
  "pools",
  "equipment",
] as const;
type DeletableTable = typeof DELETABLE_TABLES[number];

/** Rows that carry a tombstone must not be resurrected by offline edits. */
export function isDeleted(row: any): boolean {
  return typeof row?.deleted_at === "number";
}

async function tombstone(ctx: any, id: any, now: number): Promise<void> {
  await ctx.db.patch(id, { deleted_at: now, updated_at: now });
}

async function collectByIndex(ctx: any, table: string, index: string, field: string, value: any): Promise<any[]> {
  return await ctx.db
    .query(table)
    .withIndex(index, (q: any) => q.eq(field, value))
    .collect();
}

/**
 * Hard-delete the proof-of-service artifacts attached to a service log:
 * servicePhotos rows (plus their storage files) and serviceReports rows.
 */
async function purgeServiceLogArtifacts(ctx: any, serviceLogId: any): Promise<void> {
  const photos = await collectByIndex(ctx, "servicePhotos", "by_service_log", "service_log_id", serviceLogId);
  for (const photo of photos) {
    await ctx.db.delete(photo._id);
    try {
      await ctx.storage.delete(photo.storage_id);
    } catch (error) {
      console.error(`Storage deletion failed for orphaned storage_id ${photo.storage_id}`, error);
    }
  }
  const reports = await collectByIndex(ctx, "serviceReports", "by_service_log", "service_log_id", serviceLogId);
  for (const report of reports) {
    await ctx.db.delete(report._id);
  }
}

/**
 * Soft-delete a customer and everything hanging off it. Child rows keep their
 * documents with `deleted_at` set so the next pull tombstones them on every
 * device; photos and report tokens are hard-deleted along with their storage.
 * Every lookup goes through a by_customer / by_service_log index. Idempotent.
 */
export async function softDeleteCustomerCascade(ctx: any, customerId: any, now: number): Promise<void> {
  for (const table of ["pools", "equipment", "chemicalUsage", "notes", "saltCellLogs"]) {
    const children = await collectByIndex(ctx, table, "by_customer", "customer_id", customerId);
    for (const child of children) {
      if (!isDeleted(child)) await tombstone(ctx, child._id, now);
    }
  }

  const logs = await collectByIndex(ctx, "serviceLogs", "by_customer", "customer_id", customerId);
  for (const log of logs) {
    await purgeServiceLogArtifacts(ctx, log._id);
    if (!isDeleted(log)) await tombstone(ctx, log._id, now);
  }

  // Photos whose service log is missing are only reachable by customer.
  const strayPhotos = await collectByIndex(ctx, "servicePhotos", "by_customer", "customer_id", customerId);
  for (const photo of strayPhotos) {
    await ctx.db.delete(photo._id);
    try {
      await ctx.storage.delete(photo.storage_id);
    } catch (error) {
      console.error(`Storage deletion failed for orphaned storage_id ${photo.storage_id}`, error);
    }
  }

  const customer = await ctx.db.get(customerId);
  if (customer && !isDeleted(customer)) await tombstone(ctx, customerId, now);
}

async function assertCanDeleteRecord(ctx: any, table: DeletableTable, record: any, userEmail: string): Promise<void> {
  switch (table) {
    case "customers":
      if (!(await canAccessCustomer(ctx, record, userEmail))) {
        throw new Error("Access denied: cannot delete another user's customer");
      }
      return;
    case "serviceLogs":
    case "chemicalUsage":
    case "saltCellLogs":
    case "pools":
      await ensureCustomerOwnedByUser(ctx, record.customer_id, userEmail);
      return;
    case "equipment":
      await ensurePoolOwnedByUser(ctx, record.pool_id, record.customer_id, userEmail);
      return;
    case "notes":
      if (record.customer_id) {
        await ensureCustomerOwnedByUser(ctx, record.customer_id, userEmail);
      } else if (normalizeEmail(record.created_by) !== normalizeEmail(userEmail)) {
        throw new Error("Access denied: cannot delete another user's note");
      }
      return;
  }
}

/**
 * Sync-side delete. Records are tombstoned (deleted_at + updated_at) rather
 * than removed so pull can propagate the deletion to every device. Deleting
 * a customer cascades to its pools, equipment, service logs, chemical usage,
 * notes and salt cell logs; photos/reports are hard-deleted. Idempotent: an
 * unknown or already-deleted id returns success.
 *
 * Returns `{ success: true, deleted_at }` where deleted_at is the tombstone
 * timestamp (the original one when the row was already deleted, `now` when
 * the row no longer exists at all).
 */
export const deleteRecord = mutation({
  args: {
    table: v.union(
      v.literal("customers"),
      v.literal("serviceLogs"),
      v.literal("chemicalUsage"),
      v.literal("notes"),
      v.literal("saltCellLogs"),
      v.literal("pools"),
      v.literal("equipment"),
    ),
    id: v.string(),
    idempotency_key: v.optional(v.string()),
  },
  returns: v.object({ success: v.literal(true), deleted_at: v.number() }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) throw new Error("Not authenticated");

    const replay = await getSyncReceipt(ctx, args.idempotency_key, identity.email);
    if (replay) return replay;

    await enforceRateLimit(ctx, identity.email, args.table === "customers" ? "customer.delete" : "serviceLog.delete");

    const now = Date.now();
    const respond = async (deletedAt: number) =>
      await saveSyncReceipt(ctx, args.idempotency_key, identity.email!, args.table, {
        success: true as const,
        deleted_at: deletedAt,
      });

    const id = ctx.db.normalizeId(args.table, args.id);
    if (!id) return await respond(now);
    const record = await ctx.db.get(id);
    if (!record) return await respond(now);
    if (isDeleted(record)) return await respond(record.deleted_at as number);

    await assertCanDeleteRecord(ctx, args.table, record, identity.email);

    if (args.table === "customers") {
      await softDeleteCustomerCascade(ctx, id, now);
    } else {
      if (args.table === "serviceLogs") await purgeServiceLogArtifacts(ctx, id);
      await tombstone(ctx, id, now);
    }
    return await respond(now);
  },
});

/** Response returned by sync update mutations when the target row is tombstoned. */
function deletedResponse(convexId: any, localId: number, existing: any) {
  return {
    convex_id: convexId,
    local_id: localId,
    success: false as const,
    operation: "deleted" as const,
    deleted_at: existing.deleted_at,
    remote_data: existing,
  };
}

/**
 * Optimistic concurrency check on the base version the device last saw.
 *
 * `base_updated_at` is the server `updated_at` the client stored after its last
 * successful push/pull of this row. Comparing server stamp against server stamp
 * avoids cross-clock comparisons (device clock vs server clock), which falsely
 * reported conflicts for quick successive edits and under clock skew.
 *
 * Legacy clients that do not send `base_updated_at` fall back to the old
 * device-clock comparison so they keep working.
 */
export function isRemoteNewerThanBase(
  existing: { updated_at?: number | null } | null | undefined,
  args: { base_updated_at?: number | null; local_updated_at?: number | null },
): boolean {
  const remoteUpdatedAt = (existing && existing.updated_at) || 0;
  const base = args.base_updated_at;
  if (typeof base === 'number' && Number.isFinite(base)) {
    return remoteUpdatedAt > base;
  }
  const safeLocalUpdatedAt =
    typeof args.local_updated_at === 'number' && Number.isFinite(args.local_updated_at)
      ? args.local_updated_at
      : 0;
  return remoteUpdatedAt > safeLocalUpdatedAt;
}

// ============================================
// Customer Sync
// ============================================

export const syncCustomer = mutation({
  args: {
    local_id: v.number(),
    data: v.object({
      full_name: v.string(),
      address: v.string(),
      phone: v.optional(v.string()),
      email: v.optional(v.string()),
      gate_code: v.optional(v.string()),
      service_day: v.string(),
      pool_gallons: v.optional(v.number()),
      pool_type: v.string(),
      surface_type: v.string(),
      sort_order: v.optional(v.number()),
      created_by: v.optional(v.string()),
      report_settings: v.optional(v.object({
        show_chemical_readings: v.boolean(),
        show_photos: v.boolean(),
        show_service_notes: v.boolean(),
        show_technician_name: v.boolean(),
        show_service_duration: v.boolean(),
        show_overall_status: v.boolean(),
      })),
    }),
    local_updated_at: v.number(),
    base_updated_at: v.optional(v.number()),
    convex_id: v.optional(v.id("customers")), // If updating existing record
    idempotency_key: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // SECURITY: Require authentication
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const replay = await getSyncReceipt(ctx, args.idempotency_key, identity.email!);
    if (replay) return replay;

    // SECURITY: Enforce rate limiting (database-backed for distributed rate limiting)
    await enforceRateLimit(ctx, identity.email!, 'customer.update');

    const { local_id, data, local_updated_at, convex_id } = args;
    const safeLocalUpdatedAt = Number.isFinite(local_updated_at) ? local_updated_at : 0;

    // Resolve business context so we can set business_id (matches customers.create behavior)
    const business = await resolveBusinessContext(ctx, identity.email!);
    const createdBy = business ? business.owner_email : identity.email!;
    const businessId = business ? String(business._id) : undefined;

    const customerData = {
      ...data,
      // Always derive tenancy from auth identity, not client payload.
      created_by: createdBy,
      business_id: businessId,
    };

    // If convex_id provided, update existing record
    if (convex_id) {
      const existingCustomer = await ctx.db.get(convex_id);
      if (!existingCustomer) {
        throw new Error(`Customer with convex_id ${convex_id} not found`);
      }

      // SECURITY: Verify ownership of existing record
      if (!(await canAccessCustomer(ctx, existingCustomer, identity.email!))) {
        throw new Error("Access denied: cannot update another user's customer");
      }

      // A tombstoned row must never be resurrected by an offline edit.
      if (isDeleted(existingCustomer)) {
        return await saveSyncReceipt(ctx, args.idempotency_key, identity.email!, "customers",
          deletedResponse(convex_id, local_id, existingCustomer));
      }

      // Conflict detection: check if remote record was modified after local timestamp
      const remoteUpdatedAt = existingCustomer.updated_at || 0;
      if (isRemoteNewerThanBase(existingCustomer, args)) {
        console.log(`Conflict detected for customer ${convex_id}: remote newer than local`);

        // Return conflict information for client-side resolution
        return await saveSyncReceipt(ctx, args.idempotency_key, identity.email!, "customers", {
          convex_id,
          local_id,
          success: false,
          operation: 'conflict' as const,
          conflict: {
            remote_data: existingCustomer,
            remote_updated_at: remoteUpdatedAt,
            local_updated_at: safeLocalUpdatedAt,
          },
        });
      }

      // Update the existing customer
      const now = Date.now();
      await ctx.db.patch(convex_id, {
        ...customerData,
        updated_at: now,
      });

      return await saveSyncReceipt(ctx, args.idempotency_key, identity.email!, "customers", {
        convex_id,
        local_id,
        success: true,
        operation: 'update' as const,
        updated_at: now, // Return server timestamp
      });
    }

    // Create new customer record
    await assertWriteAllowed(ctx, identity.email!);
    const now = Date.now();
    const newCustomerId = await ctx.db.insert("customers", {
      ...customerData,
      created_at: now,
      updated_at: now,
    });

    return await saveSyncReceipt(ctx, args.idempotency_key, identity.email!, "customers", {
      convex_id: newCustomerId,
      local_id,
      success: true,
      operation: 'create' as const,
      updated_at: now, // Return server timestamp
    });
  },
});

// ============================================
// Service Log Sync
// ============================================

export const syncServiceLog = mutation({
  args: {
    local_id: v.number(),
    convex_customer_id: v.id("customers"),
    data: v.object({
      pool_id: v.optional(v.id("pools")),
      service_date: v.string(),
      status: v.string(),
      service_type: v.optional(v.string()),
      notes: v.optional(v.string()),
      ph: v.string(),
      chlorine: v.string(),
      alkalinity: v.string(),
      stabilizer: v.string(),
      salt: v.optional(v.number()),
      ph_value: v.optional(v.number()),
      chlorine_value: v.optional(v.number()),
      total_chlorine_value: v.optional(v.number()),
      total_bromine_value: v.optional(v.number()),
      strip_scan_method: v.optional(v.literal("aquachek_select_photo")),
      strip_scan_confidence: v.optional(v.union(v.literal("low"), v.literal("medium"), v.literal("high"))),
      strip_scan_analysis_version: v.optional(stripScanAnalysisVersionValidator),
      strip_scan_pad_confidence: v.optional(stripScanPadConfidenceValidator),
      strip_scan_quality: v.optional(stripScanQualityValidator),
      lsi_calculation_version: v.optional(v.union(v.literal("aquachek-epa-v1"), v.literal("lsi-v1"))),
      alkalinity_value: v.optional(v.number()),
      stabilizer_value: v.optional(v.number()),
      hardness_value: v.optional(v.number()),
      hardness_source: v.optional(v.union(v.literal("aquachek_total"), v.literal("calcium"))),
      water_temperature: v.optional(v.number()),
      water_temperature_source: v.optional(v.union(v.literal("measured"), v.literal("assumed"))),
      tds_value: v.optional(v.number()),
      tds_source: v.optional(v.union(v.literal("measured"), v.literal("assumed"))),
      start_time: v.optional(v.string()),
      end_time: v.optional(v.string()),
      duration_ms: v.optional(v.number()),
    }),
    local_updated_at: v.number(),
    base_updated_at: v.optional(v.number()),
    convex_id: v.optional(v.id("serviceLogs")), // If updating existing record
    idempotency_key: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // SECURITY: Require authentication
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    validateLsiFields(args.data, true);

    const replay = await getSyncReceipt(ctx, args.idempotency_key, identity.email!);
    if (replay) return replay;

    // SECURITY: Enforce rate limiting (database-backed for distributed rate limiting)
    await enforceRateLimit(ctx, identity.email!, 'serviceLog.update');

    const { local_id, convex_customer_id, data, local_updated_at, convex_id } = args;
    const safeLocalUpdatedAt = Number.isFinite(local_updated_at) ? local_updated_at : 0;

    // Verify customer exists AND belongs to authenticated user (tenant isolation)
    const customer = await ctx.db.get(convex_customer_id);
    if (!customer) {
      throw new Error(`Customer with id ${convex_customer_id} not found`);
    }

    // SECURITY: Verify customer ownership
    if (!(await canAccessCustomer(ctx, customer, identity.email!))) {
      throw new Error("Access denied: cannot sync data for another user's customer");
    }
    if (data.pool_id) await ensurePoolOwnedByUser(ctx, data.pool_id, convex_customer_id, identity.email!);

    // If convex_id provided, update existing record
    if (convex_id) {
      const existingServiceLog = await ctx.db.get(convex_id);
      if (!existingServiceLog) {
        throw new Error(`ServiceLog with convex_id ${convex_id} not found`);
      }
      await ensureCustomerOwnedByUser(ctx, existingServiceLog.customer_id, identity.email!);
      if (isDeleted(existingServiceLog)) {
        return await saveSyncReceipt(ctx, args.idempotency_key, identity.email!, "serviceLogs",
          deletedResponse(convex_id, local_id, existingServiceLog));
      }

      // Conflict detection: check if remote record was modified after local timestamp
      const remoteUpdatedAt = existingServiceLog.updated_at || 0;
      if (isRemoteNewerThanBase(existingServiceLog, args)) {
        console.log(`Conflict detected for service log ${convex_id}: remote newer than local`);

        // Return conflict information for client-side resolution
        return await saveSyncReceipt(ctx, args.idempotency_key, identity.email!, "serviceLogs", {
          convex_id,
          local_id,
          success: false,
          operation: 'conflict' as const,
          conflict: {
            remote_data: existingServiceLog,
            remote_updated_at: remoteUpdatedAt,
            local_updated_at: safeLocalUpdatedAt,
          },
        });
      }

      // Update the existing service log
      const now = Date.now();
      await ctx.db.patch(convex_id, {
        ...data,
        customer_id: convex_customer_id,
        created_by: existingServiceLog.created_by || customer.created_by || identity.email!,
        updated_at: now,
      });

      return await saveSyncReceipt(ctx, args.idempotency_key, identity.email!, "serviceLogs", {
        convex_id,
        local_id,
        success: true,
        operation: 'update' as const,
        updated_at: now, // Return server timestamp
      });
    }

    // Create new service log record
    const now = Date.now();
    const newServiceLogId = await ctx.db.insert("serviceLogs", {
      ...data,
      customer_id: convex_customer_id,
      created_by: customer.created_by || identity.email!,
      created_at: now,
      updated_at: now,
    });

    return await saveSyncReceipt(ctx, args.idempotency_key, identity.email!, "serviceLogs", {
      convex_id: newServiceLogId,
      local_id,
      success: true,
      operation: 'create' as const,
      updated_at: now, // Return server timestamp
    });
  },
});

// ============================================
// Chemical Usage Sync
// ============================================

export const syncChemicalUsage = mutation({
  args: {
    local_id: v.number(),
    convex_customer_id: v.id("customers"),
    data: v.object({
      pool_id: v.optional(v.id("pools")),
      chemical_type: v.string(),
      quantity: v.string(),
      notes: v.optional(v.string()),
      created_date: v.optional(v.string()),
    }),
    local_updated_at: v.number(),
    base_updated_at: v.optional(v.number()),
    convex_id: v.optional(v.id("chemicalUsage")), // If updating existing record
    idempotency_key: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // SECURITY: Require authentication
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const replay = await getSyncReceipt(ctx, args.idempotency_key, identity.email!);
    if (replay) return replay;

    // SECURITY: Enforce rate limiting (database-backed for distributed rate limiting)
    await enforceRateLimit(ctx, identity.email!, 'chemical.create');

    const { local_id, convex_customer_id, data, local_updated_at, convex_id } = args;
    const safeLocalUpdatedAt = Number.isFinite(local_updated_at) ? local_updated_at : 0;

    // Verify customer exists AND belongs to authenticated user (tenant isolation)
    const customer = await ctx.db.get(convex_customer_id);
    if (!customer) {
      throw new Error(`Customer with id ${convex_customer_id} not found`);
    }

    // SECURITY: Verify customer ownership
    if (!(await canAccessCustomer(ctx, customer, identity.email!))) {
      throw new Error("Access denied: cannot sync data for another user's customer");
    }
    if (data.pool_id) await ensurePoolOwnedByUser(ctx, data.pool_id, convex_customer_id, identity.email!);

    // If convex_id provided, update existing record
    if (convex_id) {
      const existingChemicalUsage = await ctx.db.get(convex_id);
      if (!existingChemicalUsage) {
        throw new Error(`ChemicalUsage with convex_id ${convex_id} not found`);
      }
      await ensureCustomerOwnedByUser(ctx, existingChemicalUsage.customer_id, identity.email!);
      if (isDeleted(existingChemicalUsage)) {
        return await saveSyncReceipt(ctx, args.idempotency_key, identity.email!, "chemicalUsage",
          deletedResponse(convex_id, local_id, existingChemicalUsage));
      }

      // Conflict detection: check if remote record was modified after local timestamp
      const remoteUpdatedAt = existingChemicalUsage.updated_at || 0;
      if (isRemoteNewerThanBase(existingChemicalUsage, args)) {
        console.log(`Conflict detected for chemical usage ${convex_id}: remote newer than local`);

        // Return conflict information for client-side resolution
        return await saveSyncReceipt(ctx, args.idempotency_key, identity.email!, "chemicalUsage", {
          convex_id,
          local_id,
          success: false,
          operation: 'conflict' as const,
          conflict: {
            remote_data: existingChemicalUsage,
            remote_updated_at: remoteUpdatedAt,
            local_updated_at: safeLocalUpdatedAt,
          },
        });
      }

      // Update the existing chemical usage record
      const now = Date.now();
      await ctx.db.patch(convex_id, {
        ...data,
        customer_id: convex_customer_id,
        created_by: existingChemicalUsage.created_by || customer.created_by || identity.email!,
        updated_at: now,
      });

      return await saveSyncReceipt(ctx, args.idempotency_key, identity.email!, "chemicalUsage", {
        convex_id,
        local_id,
        success: true,
        operation: 'update' as const,
        updated_at: now, // Return server timestamp
      });
    }

    // Create new chemical usage record
    const now = Date.now();
    const newChemicalUsageId = await ctx.db.insert("chemicalUsage", {
      ...data,
      customer_id: convex_customer_id,
      created_by: customer.created_by || identity.email!,
      created_at: now,
      updated_at: now,
    });

    return await saveSyncReceipt(ctx, args.idempotency_key, identity.email!, "chemicalUsage", {
      convex_id: newChemicalUsageId,
      local_id,
      success: true,
      operation: 'create' as const,
      updated_at: now, // Return server timestamp
    });
  },
});

// ============================================
// Notes Sync
// ============================================

export const syncNote = mutation({
  args: {
    local_id: v.number(),
    convex_customer_id: v.optional(v.id("customers")),
    data: v.object({
      pool_id: v.optional(v.id("pools")),
      title: v.string(),
      content: v.string(),
      category: v.string(),
      priority: v.string(),
      completed: v.optional(v.boolean()),
      created_date: v.optional(v.string()),
    }),
    local_updated_at: v.number(),
    base_updated_at: v.optional(v.number()),
    convex_id: v.optional(v.id("notes")), // If updating existing record
    idempotency_key: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // SECURITY: Require authentication
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const replay = await getSyncReceipt(ctx, args.idempotency_key, identity.email!);
    if (replay) return replay;

    // SECURITY: Enforce rate limiting (database-backed for distributed rate limiting)
    await enforceRateLimit(ctx, identity.email!, 'note.create');

    const { local_id, convex_customer_id, data, local_updated_at, convex_id } = args;
    const safeLocalUpdatedAt = Number.isFinite(local_updated_at) ? local_updated_at : 0;

    // Verify customer exists if customer_id provided AND belongs to user (tenant isolation)
    if (convex_customer_id) {
      const customer = await ctx.db.get(convex_customer_id);
      if (!customer) {
        throw new Error(`Customer with id ${convex_customer_id} not found`);
      }
      // SECURITY: Verify customer ownership
      if (!(await canAccessCustomer(ctx, customer, identity.email!))) {
        throw new Error("Access denied: cannot sync notes for another user's customer");
      }
      if (data.pool_id) await ensurePoolOwnedByUser(ctx, data.pool_id, convex_customer_id, identity.email!);
    }

    // If convex_id provided, update existing record
    if (convex_id) {
      const existingNote = await ctx.db.get(convex_id);
      if (!existingNote) {
        throw new Error(`Note with convex_id ${convex_id} not found`);
      }
      if (existingNote.customer_id) {
        await ensureCustomerOwnedByUser(ctx, existingNote.customer_id, identity.email!);
      } else if (!(await canAccessGeneralNote(ctx, existingNote, identity.email!))) {
        throw new Error("Access denied: cannot update another user's note");
      }
      if (isDeleted(existingNote)) {
        return await saveSyncReceipt(ctx, args.idempotency_key, identity.email!, "notes",
          deletedResponse(convex_id, local_id, existingNote));
      }

      // Conflict detection: check if remote record was modified after local timestamp
      const remoteUpdatedAt = existingNote.updated_at || 0;
      if (isRemoteNewerThanBase(existingNote, args)) {
        console.log(`Conflict detected for note ${convex_id}: remote newer than local`);

        // Return conflict information for client-side resolution
        return await saveSyncReceipt(ctx, args.idempotency_key, identity.email!, "notes", {
          convex_id,
          local_id,
          success: false,
          operation: 'conflict' as const,
          conflict: {
            remote_data: existingNote,
            remote_updated_at: remoteUpdatedAt,
            local_updated_at: safeLocalUpdatedAt,
          },
        });
      }

      // Update the existing note
      const now = Date.now();
      await ctx.db.patch(convex_id, {
        ...data,
        customer_id: convex_customer_id,
        created_by: existingNote.created_by || identity.email!,
        updated_at: now,
      });

      return await saveSyncReceipt(ctx, args.idempotency_key, identity.email!, "notes", {
        convex_id,
        local_id,
        success: true,
        operation: 'update' as const,
        updated_at: now, // Return server timestamp
      });
    }

    // Create new note record with user's email for tenant isolation
    const now = Date.now();
    const newNoteId = await ctx.db.insert("notes", {
      ...data,
      customer_id: convex_customer_id,
      created_by: identity.email, // SECURITY: Set created_by for general notes
      created_at: now,
      updated_at: now,
    });

    return await saveSyncReceipt(ctx, args.idempotency_key, identity.email!, "notes", {
      convex_id: newNoteId,
      local_id,
      success: true,
      operation: 'create' as const,
      updated_at: now, // Return server timestamp
    });
  },
});

// ============================================
// Salt Cell Log Sync
// ============================================

export const syncSaltCellLog = mutation({
  args: {
    local_id: v.number(),
    convex_customer_id: v.id("customers"),
    data: v.object({
      pool_id: v.optional(v.id("pools")),
      cleaning_date: v.string(),
      condition: v.string(),
      notes: v.optional(v.string()),
      next_cleaning_due: v.optional(v.string()),
    }),
    local_updated_at: v.number(),
    base_updated_at: v.optional(v.number()),
    convex_id: v.optional(v.id("saltCellLogs")), // If updating existing record
    idempotency_key: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // SECURITY: Require authentication
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const replay = await getSyncReceipt(ctx, args.idempotency_key, identity.email!);
    if (replay) return replay;

    // SECURITY: Enforce rate limiting (database-backed for distributed rate limiting)
    await enforceRateLimit(ctx, identity.email!, 'customer.update');

    const { local_id, convex_customer_id, data, local_updated_at, convex_id } = args;
    const safeLocalUpdatedAt = Number.isFinite(local_updated_at) ? local_updated_at : 0;

    // Verify customer exists AND belongs to authenticated user (tenant isolation)
    const customer = await ctx.db.get(convex_customer_id);
    if (!customer) {
      throw new Error(`Customer with id ${convex_customer_id} not found`);
    }

    // SECURITY: Verify customer ownership
    if (!(await canAccessCustomer(ctx, customer, identity.email!))) {
      throw new Error("Access denied: cannot sync data for another user's customer");
    }
    if (data.pool_id) await ensurePoolOwnedByUser(ctx, data.pool_id, convex_customer_id, identity.email!);

    // If convex_id provided, update existing record
    if (convex_id) {
      const existingSaltCellLog = await ctx.db.get(convex_id);
      if (!existingSaltCellLog) {
        throw new Error(`SaltCellLog with convex_id ${convex_id} not found`);
      }
      await ensureCustomerOwnedByUser(ctx, existingSaltCellLog.customer_id, identity.email!);
      if (isDeleted(existingSaltCellLog)) {
        return await saveSyncReceipt(ctx, args.idempotency_key, identity.email!, "saltCellLogs",
          deletedResponse(convex_id, local_id, existingSaltCellLog));
      }

      // Conflict detection: check if remote record was modified after local timestamp
      const remoteUpdatedAt = existingSaltCellLog.updated_at || 0;
      if (isRemoteNewerThanBase(existingSaltCellLog, args)) {
        console.log(`Conflict detected for salt cell log ${convex_id}: remote newer than local`);

        // Return conflict information for client-side resolution
        return await saveSyncReceipt(ctx, args.idempotency_key, identity.email!, "saltCellLogs", {
          convex_id,
          local_id,
          success: false,
          operation: 'conflict' as const,
          conflict: {
            remote_data: existingSaltCellLog,
            remote_updated_at: remoteUpdatedAt,
            local_updated_at: safeLocalUpdatedAt,
          },
        });
      }

      // Update the existing salt cell log
      const now = Date.now();
      await ctx.db.patch(convex_id, {
        ...data,
        customer_id: convex_customer_id,
        created_by: existingSaltCellLog.created_by || customer.created_by || identity.email!,
        updated_at: now,
      });

      return await saveSyncReceipt(ctx, args.idempotency_key, identity.email!, "saltCellLogs", {
        convex_id,
        local_id,
        success: true,
        operation: 'update' as const,
        updated_at: now,
      });
    }

    // Create new salt cell log record
    const now = Date.now();
    const newSaltCellLogId = await ctx.db.insert("saltCellLogs", {
      ...data,
      customer_id: convex_customer_id,
      created_by: customer.created_by || identity.email!,
      created_at: now,
      updated_at: now,
    });

    return await saveSyncReceipt(ctx, args.idempotency_key, identity.email!, "saltCellLogs", {
      convex_id: newSaltCellLogId,
      local_id,
      success: true,
      operation: 'create' as const,
      updated_at: now,
    });
  },
});

// ============================================
// Normalized Pool / Equipment Sync
// ============================================

export const syncPool = mutation({
  args: {
    local_id: v.number(),
    convex_customer_id: v.id("customers"),
    data: v.object({
      name: v.string(),
      address: v.optional(v.string()),
      service_day: v.string(),
      pool_gallons: v.optional(v.number()),
      pool_type: v.string(),
      surface_type: v.string(),
      sort_order: v.optional(v.number()),
      notes: v.optional(v.string()),
      active: v.boolean(),
    }),
    local_updated_at: v.number(),
    base_updated_at: v.optional(v.number()),
    convex_id: v.optional(v.id("pools")),
    idempotency_key: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) throw new Error("Not authenticated");
    const replay = await getSyncReceipt(ctx, args.idempotency_key, identity.email);
    if (replay) return replay;
    await enforceRateLimit(ctx, identity.email, "pool.update");
    await ensureCustomerOwnedByUser(ctx, args.convex_customer_id, identity.email);
    const safeLocalUpdatedAt = Number.isFinite(args.local_updated_at) ? args.local_updated_at : 0;
    if (args.convex_id) {
      const existing = await ctx.db.get(args.convex_id);
      if (!existing) throw new Error("Pool not found");
      await ensurePoolOwnedByUser(ctx, args.convex_id, args.convex_customer_id, identity.email);
      if (isDeleted(existing)) {
        return await saveSyncReceipt(ctx, args.idempotency_key, identity.email, "pools",
          deletedResponse(args.convex_id, args.local_id, existing));
      }
      const remoteUpdatedAt = existing.updated_at || 0;
      if (isRemoteNewerThanBase(existing, args)) {
        return await saveSyncReceipt(ctx, args.idempotency_key, identity.email, "pools", {
          convex_id: args.convex_id, local_id: args.local_id, success: false,
          operation: "conflict" as const,
          conflict: { remote_data: existing, remote_updated_at: remoteUpdatedAt, local_updated_at: safeLocalUpdatedAt },
        });
      }
      const now = Date.now();
      await ctx.db.patch(args.convex_id, { ...args.data, updated_at: now });
      return await saveSyncReceipt(ctx, args.idempotency_key, identity.email, "pools", {
        convex_id: args.convex_id, local_id: args.local_id, success: true, operation: "update" as const, updated_at: now,
      });
    }
    const customer = await ctx.db.get(args.convex_customer_id);
    const business = await resolveBusinessContext(ctx, identity.email);
    const now = Date.now();
    const id = await ctx.db.insert("pools", {
      ...args.data,
      customer_id: args.convex_customer_id,
      business_id: business ? String(business._id) : customer?.business_id,
      created_by: customer?.created_by || identity.email,
      created_at: now,
      updated_at: now,
    });
    return await saveSyncReceipt(ctx, args.idempotency_key, identity.email, "pools", {
      convex_id: id, local_id: args.local_id, success: true, operation: "create" as const, updated_at: now,
    });
  },
});

export const syncEquipment = mutation({
  args: {
    local_id: v.number(),
    convex_pool_id: v.id("pools"),
    data: v.object({
      equipment_type: v.string(),
      name: v.string(),
      brand: v.optional(v.string()),
      model: v.optional(v.string()),
      serial_number: v.optional(v.string()),
      install_date: v.optional(v.string()),
      status: v.string(),
      last_service_date: v.optional(v.string()),
      next_service_due: v.optional(v.string()),
      notes: v.optional(v.string()),
    }),
    local_updated_at: v.number(),
    base_updated_at: v.optional(v.number()),
    convex_id: v.optional(v.id("equipment")),
    idempotency_key: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) throw new Error("Not authenticated");
    const replay = await getSyncReceipt(ctx, args.idempotency_key, identity.email);
    if (replay) return replay;
    await enforceRateLimit(ctx, identity.email, "equipment.update");
    const pool = await ctx.db.get(args.convex_pool_id);
    if (!pool) throw new Error("Pool not found");
    await ensurePoolOwnedByUser(ctx, args.convex_pool_id, pool.customer_id, identity.email);
    const safeLocalUpdatedAt = Number.isFinite(args.local_updated_at) ? args.local_updated_at : 0;
    if (args.convex_id) {
      const existing = await ctx.db.get(args.convex_id);
      if (!existing) throw new Error("Equipment not found");
      await ensurePoolOwnedByUser(ctx, existing.pool_id, existing.customer_id, identity.email);
      if (isDeleted(existing)) {
        return await saveSyncReceipt(ctx, args.idempotency_key, identity.email, "equipment",
          deletedResponse(args.convex_id, args.local_id, existing));
      }
      const remoteUpdatedAt = existing.updated_at || 0;
      if (isRemoteNewerThanBase(existing, args)) {
        return await saveSyncReceipt(ctx, args.idempotency_key, identity.email, "equipment", {
          convex_id: args.convex_id, local_id: args.local_id, success: false,
          operation: "conflict" as const,
          conflict: { remote_data: existing, remote_updated_at: remoteUpdatedAt, local_updated_at: safeLocalUpdatedAt },
        });
      }
      const now = Date.now();
      await ctx.db.patch(args.convex_id, { ...args.data, pool_id: args.convex_pool_id, updated_at: now });
      return await saveSyncReceipt(ctx, args.idempotency_key, identity.email, "equipment", {
        convex_id: args.convex_id, local_id: args.local_id, success: true, operation: "update" as const, updated_at: now,
      });
    }
    const business = await resolveBusinessContext(ctx, identity.email);
    const poolCustomer = await ctx.db.get(pool.customer_id);
    const now = Date.now();
    const id = await ctx.db.insert("equipment", {
      ...args.data,
      pool_id: args.convex_pool_id,
      customer_id: pool.customer_id,
      business_id: business ? String(business._id) : poolCustomer?.business_id,
      created_by: poolCustomer?.created_by || identity.email,
      created_at: now,
      updated_at: now,
    });
    return await saveSyncReceipt(ctx, args.idempotency_key, identity.email, "equipment", {
      convex_id: id, local_id: args.local_id, success: true, operation: "create" as const, updated_at: now,
    });
  },
});

// ============================================
// Batch Sync for Initial Migration
// ============================================

const BATCH_SYNC_MAX_ITEMS = 100;

export const batchSyncCustomers = mutation({
  args: {
    customers: v.array(v.object({
      local_id: v.number(),
      data: v.object({
        full_name: v.string(),
        address: v.string(),
        phone: v.optional(v.string()),
        email: v.optional(v.string()),
        gate_code: v.optional(v.string()),
        service_day: v.string(),
        pool_gallons: v.optional(v.number()),
        pool_type: v.string(),
        surface_type: v.string(),
        sort_order: v.optional(v.number()),
        created_by: v.optional(v.string()),
        report_settings: v.optional(v.object({
          show_chemical_readings: v.boolean(),
          show_photos: v.boolean(),
          show_service_notes: v.boolean(),
          show_technician_name: v.boolean(),
          show_service_duration: v.boolean(),
          show_overall_status: v.boolean(),
        })),
      }),
      local_updated_at: v.number(),
    })),
    idempotency_key: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // SECURITY: Require authentication
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    if (args.customers.length > BATCH_SYNC_MAX_ITEMS) {
      throw new Error(
        `batchSyncCustomers accepts at most ${BATCH_SYNC_MAX_ITEMS} customers per call (received ${args.customers.length}); split the batch`
      );
    }

    const replay = await getSyncReceipt(ctx, args.idempotency_key, identity.email!);
    if (replay) return replay;

    // SECURITY: Enforce rate limiting for batch operations (database-backed for distributed rate limiting)
    await enforceRateLimit(ctx, identity.email!, 'customer.create');
    await assertWriteAllowed(ctx, identity.email!);

    const results = [];

    // Resolve business context so we can set business_id (matches customers.create behavior)
    const business = await resolveBusinessContext(ctx, identity.email!);
    const createdBy = business ? business.owner_email : identity.email!;
    const businessId = business ? String(business._id) : undefined;

    for (const customer of args.customers) {
      try {
        const customerData = {
          ...customer.data,
          // Always derive tenancy from auth identity, not client payload.
          created_by: createdBy,
          business_id: businessId,
        };

        const newCustomerId = await ctx.db.insert("customers", {
          ...customerData,
          created_at: Date.now(),
          updated_at: Date.now(),
        });

        results.push({
          local_id: customer.local_id,
          convex_id: newCustomerId,
          success: true,
          error: null,
        });
      } catch (error) {
        results.push({
          local_id: customer.local_id,
          convex_id: null,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return await saveSyncReceipt(ctx, args.idempotency_key, identity.email!, "batchCustomers", {
      results,
      total: args.customers.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
    });
  },
});
