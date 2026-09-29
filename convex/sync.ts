import { mutation, query, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { enforceRateLimit } from "./rateLimit";
import {
  validateChemicalUsageCreate,
  validateCustomerCreate,
  validateCustomerUpdate,
  validateLsiFields,
  validateNoteCreate,
  validateOptionalString,
  validateRequiredString,
} from "./validation";
import { stripScanAnalysisVersionValidator, stripScanPadConfidenceValidator, stripScanQualityValidator } from "./lsiValidators";

/**
 * Convex mutations for syncing data from Dexie (local IndexedDB) to Convex (cloud)
 * These mutations handle upsert logic and conflict detection for bidirectional sync
 *
 * SECURITY: All sync mutations require authentication and enforce tenant isolation
 *
 * CONFLICT DETECTION: clients send `base_updated_at`, the server `updated_at`
 * they last observed for the record.  A write conflicts when the server copy
 * has been modified since that base version.  All `updated_at` values are
 * stamped with the server clock, so client clock skew cannot hide or invent a
 * conflict.  Older clients that do not send a base fall back to comparing the
 * client `local_updated_at` (legacy behaviour).
 */

function normalizeEmail(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

const SYNC_RECEIPT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const CLEANUP_BATCH_SIZE = 500;
export const MAX_SYNC_BATCH_SIZE = 100;
// Batch creates consume one `customer.create` token per this many customers.
const BATCH_CUSTOMERS_PER_RATE_LIMIT_TOKEN = 5;
const CUSTOMER_WRITE_ROLES = new Set(["owner", "admin"]);
// Mirrors convex/pools.ts WRITE_ROLES.
const POOL_WRITE_ROLES = new Set(["owner", "admin", "technician"]);
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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
// Child tables are tenant scoped by the `created_by` email and are pulled
// through the (created_by, updated_at) index, one stream per tenant email.
const EMAIL_SCOPED_TABLES = new Set<string>(["serviceLogs", "chemicalUsage", "notes", "saltCellLogs"]);
const TOMBSTONE_STREAM = "tombstones";

const DELETABLE_TABLES = [
  "customers",
  "pools",
  "equipment",
  "serviceLogs",
  "chemicalUsage",
  "notes",
  "saltCellLogs",
] as const;
type DeletableTable = typeof DELETABLE_TABLES[number];
const DELETE_RATE_LIMIT_ACTIONS: Record<DeletableTable, string> = {
  customers: "customer.delete",
  pools: "pool.delete",
  equipment: "equipment.delete",
  serviceLogs: "serviceLog.delete",
  chemicalUsage: "chemical.delete",
  notes: "note.delete",
  saltCellLogs: "saltCellLog.delete",
};
// Children removed together with a customer.  Order matters: equipment
// references pools, so it is deleted first.
const CUSTOMER_CHILD_TABLES = ["serviceLogs", "chemicalUsage", "notes", "saltCellLogs", "equipment", "pools"] as const;

export const cleanupSyncOperations = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ deleted: number; tombstonesDeleted: number }> => {
    const now = Date.now();
    const expired = await ctx.db
      .query("syncOperations")
      .withIndex("by_expires_at", (q) => q.lt("expires_at", now))
      .take(CLEANUP_BATCH_SIZE);
    for (const receipt of expired) await ctx.db.delete(receipt._id);

    const staleTombstones = await ctx.db
      .query("syncTombstones")
      .withIndex("by_deleted_at", (q) => q.lt("deleted_at", now - TOMBSTONE_TTL_MS))
      .take(CLEANUP_BATCH_SIZE);
    for (const tombstone of staleTombstones) await ctx.db.delete(tombstone._id);

    if (expired.length === CLEANUP_BATCH_SIZE || staleTombstones.length === CLEANUP_BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.sync.cleanupSyncOperations, {});
    }
    return { deleted: expired.length, tombstonesDeleted: staleTombstones.length };
  },
});

/**
 * One-off backfill: legacy saltCellLogs/chemicalUsage rows were inserted
 * without `created_by`, which hides them from tenant-scoped pulls.  Derive the
 * tenant from the parent customer and bump `updated_at` so devices that
 * already hold a watermark pull the rows on their next incremental sync.
 *
 *   npx convex run sync:backfillChildCreatedBy '{"table":"saltCellLogs"}'
 */
export const backfillChildCreatedBy = internalMutation({
  args: {
    table: v.union(v.literal("saltCellLogs"), v.literal("chemicalUsage")),
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ patched: number; isDone: boolean }> => {
    const numItems = Math.max(1, Math.min(Math.floor(args.batchSize ?? 200), 500));
    const page = await ctx.db.query(args.table).paginate({ cursor: args.cursor ?? null, numItems });
    let patched = 0;
    const now = Date.now();
    for (const row of page.page) {
      if (row.created_by) continue;
      const customer = await ctx.db.get(row.customer_id);
      if (!customer?.created_by) continue;
      await ctx.db.patch(row._id, { created_by: customer.created_by, updated_at: now });
      patched += 1;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.sync.backfillChildCreatedBy, {
        table: args.table,
        cursor: page.continueCursor,
        batchSize: numItems,
      });
    }
    return { patched, isDone: page.isDone };
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

async function enforceRateLimitTokens(ctx: any, userEmail: string, action: string, tokens: number): Promise<void> {
  const count = Math.max(1, Math.ceil(tokens));
  for (let index = 0; index < count; index += 1) {
    await enforceRateLimit(ctx, userEmail, action);
  }
}

/**
 * Detect a write against a stale copy of the record.
 * `base` is the server `updated_at` the client last saw; when absent (older
 * clients) fall back to the legacy client-clock comparison.
 */
export function isStaleWrite(existing: any, base: number | undefined, legacyLocalUpdatedAt: number): boolean {
  const remoteUpdatedAt = Number(existing?.updated_at || 0);
  if (typeof base === "number" && Number.isFinite(base)) {
    return remoteUpdatedAt > base;
  }
  return remoteUpdatedAt > legacyLocalUpdatedAt;
}

function conflictResponse(convexId: any, localId: number, existing: any, localUpdatedAt: number, base?: number) {
  return {
    convex_id: convexId,
    local_id: localId,
    success: false,
    operation: "conflict" as const,
    conflict: {
      remote_data: existing,
      remote_updated_at: existing.updated_at || 0,
      local_updated_at: localUpdatedAt,
      base_updated_at: base,
    },
  };
}

function safeTimestamp(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function assertDateOnly(value: string | undefined, fieldName: string): void {
  if (value === undefined) return;
  if (!DATE_ONLY_PATTERN.test(value)) {
    throw new Error(`${fieldName} must be in YYYY-MM-DD format`);
  }
}

// ============================================
// Tenancy helpers
// ============================================

/**
 * Team members only grant access while they are active: `is_active` must be
 * true and the (optional) invitation `status` must be absent or "active".
 */
export function isActiveTeamMember(member: any): boolean {
  if (!member || member.is_active !== true) return false;
  return member.status === undefined || member.status === null || member.status === "active";
}

function emailLookupCandidates(userEmail: string): string[] {
  const raw = String(userEmail || "").trim();
  const normalized = normalizeEmail(userEmail);
  return Array.from(new Set([String(userEmail || ""), raw, normalized].filter(Boolean)));
}

async function findActiveMembershipsByEmail(ctx: any, userEmail: string): Promise<any[]> {
  const memberships: any[] = [];
  for (const email of emailLookupCandidates(userEmail)) {
    const rows = await ctx.db
      .query("team_members")
      .withIndex("by_user_email", (q: any) => q.eq("user_email", email))
      .collect();
    memberships.push(...rows.filter(isActiveTeamMember));
  }
  return memberships;
}

/**
 * Resolve the business the user belongs to using index lookups only.  Legacy
 * rows whose stored email differs from the identity only by case/whitespace
 * are matched through the normalized (lower-cased) variant.
 */
async function resolveBusinessContext(ctx: any, userEmail: string) {
  const memberships = await findActiveMembershipsByEmail(ctx, userEmail);
  for (const membership of memberships) {
    const teamBusiness = await ctx.db.get(membership.business_id);
    if (teamBusiness) return teamBusiness;
  }

  for (const email of emailLookupCandidates(userEmail)) {
    const ownedBusiness = await ctx.db
      .query("businesses")
      .withIndex("by_owner_email", (q: any) => q.eq("owner_email", email))
      .first();
    if (ownedBusiness) return ownedBusiness;
  }
  return null;
}

async function getActiveBusinessMembers(ctx: any, businessId: any): Promise<any[]> {
  const members = await ctx.db
    .query("team_members")
    .withIndex("by_business", (q: any) => q.eq("business_id", businessId))
    .collect();
  return members.filter(isActiveTeamMember);
}

async function getActiveBusinessMemberEmails(
  ctx: any,
  businessId: any,
  ownerEmail: string
): Promise<Set<string>> {
  const members = await getActiveBusinessMembers(ctx, businessId);
  const emails = new Set<string>([normalizeEmail(ownerEmail)]);
  for (const member of members) {
    const email = normalizeEmail(member.user_email);
    if (email) emails.add(email);
  }
  return emails;
}

async function getBusinessRole(ctx: any, business: any, userEmail: string): Promise<string | null> {
  if (normalizeEmail(business?.owner_email) === normalizeEmail(userEmail)) return "owner";
  const memberships = await findActiveMembershipsByEmail(ctx, userEmail);
  const member = memberships.find((row) => String(row.business_id) === String(business._id));
  return member?.role || null;
}

/** Same role gate as customers.update / pools.update on the normal path. */
async function assertBusinessRole(ctx: any, business: any, userEmail: string, allowedRoles: Set<string>): Promise<void> {
  if (!business) return;
  const role = await getBusinessRole(ctx, business, userEmail);
  if (!role || !allowedRoles.has(role)) {
    throw new Error("Insufficient role permissions");
  }
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

async function ensureCustomerOwnedByUser(ctx: any, customerId: any, userEmail: string): Promise<any> {
  const customer = await ctx.db.get(customerId);
  const allowed = await canAccessCustomer(ctx, customer, userEmail);
  if (!allowed) {
    throw new Error("Access denied: cannot sync data for another user's customer");
  }
  return customer;
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
// Pull
// ============================================

interface PullStream {
  table: PullTableName | typeof TOMBSTONE_STREAM;
  key: string;
}

/**
 * Cursor-paginated pull for all records owned by the authenticated business.
 * Convex permits only one paginated database query per function invocation,
 * so the opaque cursor advances through one stream at a time.  A stream is a
 * table, or a (child table, tenant email) pair for email-scoped tables, and a
 * final tombstone stream reporting deletions.  `since` is an updated_at
 * watermark; the first pull (since=0) intentionally includes legacy rows that
 * have no timestamp.
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
    tombstones: v.array(v.any()),
    cursor: v.union(v.string(), v.null()),
    hasMore: v.boolean(),
    watermark: v.number(),
  }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const identityEmail = identity.email!;

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
    const business = await resolveBusinessContext(ctx, identityEmail);
    const ownerEmail = business?.owner_email || identityEmail;

    // Emails whose child rows belong to this tenant (indexed lookups only).
    let tenantEmails: string[];
    if (business) {
      const members = await getActiveBusinessMembers(ctx, business._id);
      tenantEmails = Array.from(new Set([
        business.owner_email,
        identityEmail,
        ...members.map((member: any) => member.user_email),
      ].filter(Boolean)));
    } else {
      tenantEmails = [ownerEmail];
    }

    const streams: PullStream[] = [];
    for (const table of PULL_TABLES) {
      if (EMAIL_SCOPED_TABLES.has(table)) {
        for (const email of tenantEmails) streams.push({ table, key: email });
      } else {
        streams.push({ table, key: "" });
      }
    }
    streams.push({ table: TOMBSTONE_STREAM, key: "" });

    let activeStreamIndex = 0;
    let streamCursor: string | null = null;
    if (state.version === 3 && typeof state.table === "string") {
      const exact = streams.findIndex((stream) => stream.table === state.table && stream.key === (state.key ?? ""));
      if (exact >= 0) {
        activeStreamIndex = exact;
        streamCursor = typeof state.tableCursor === "string" ? state.tableCursor : null;
      } else {
        // The tenant email list changed mid-pull; restart that table. Merges
        // are idempotent, so re-reading a stream is harmless.
        const sameTable = streams.findIndex((stream) => stream.table === state.table);
        activeStreamIndex = sameTable >= 0 ? sameTable : 0;
      }
    } else if (args.cursor) {
      // Resume v2 and legacy per-table cursors.  Only tables whose query
      // shape is unchanged can reuse their Convex cursor.
      let legacyTable: string | undefined;
      let legacyCursor: unknown = null;
      if (state.version === 2 && PULL_TABLES.includes(state.table)) {
        legacyTable = state.table;
        legacyCursor = state.tableCursor;
      } else {
        legacyTable = PULL_TABLES.find((table) => state[table] !== null);
        legacyCursor = legacyTable ? state[legacyTable] : null;
      }
      const index = streams.findIndex((stream) => stream.table === legacyTable);
      activeStreamIndex = index >= 0 ? index : 0;
      streamCursor = legacyTable && !EMAIL_SCOPED_TABLES.has(legacyTable) && typeof legacyCursor === "string"
        ? legacyCursor
        : null;
    }
    const activeStream = streams[activeStreamIndex];

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

    const buildQuery = (stream: PullStream): any => {
      const db: any = ctx.db;
      if (stream.table === TOMBSTONE_STREAM) {
        const range = (q: any) => (since > 0 ? q.gt("deleted_at", since) : q).lte("deleted_at", watermark);
        return business
          ? db.query("syncTombstones").withIndex("by_business_and_deleted_at", (q: any) =>
            range(q.eq("business_id", String(business._id))))
          : db.query("syncTombstones").withIndex("by_created_by_and_deleted_at", (q: any) =>
            range(q.eq("created_by", ownerEmail)));
      }
      if (EMAIL_SCOPED_TABLES.has(stream.table)) {
        return db.query(stream.table).withIndex("by_created_by_and_updated_at", (q: any) => {
          const scoped = q.eq("created_by", stream.key);
          return since > 0 ? scoped.gt("updated_at", since).lte("updated_at", watermark) : scoped;
        });
      }
      if (stream.table === "customers") {
        return filterByWatermark(business
          ? db.query("customers").withIndex("by_business", (q: any) => q.eq("business_id", String(business._id)))
          : db.query("customers").withIndex("by_created_by", (q: any) => q.eq("created_by", identityEmail)));
      }
      // pools / equipment
      if (business) {
        return filterByWatermark(db.query(stream.table).withIndex("by_business", (q: any) =>
          q.eq("business_id", String(business._id))));
      }
      return null; // resolved below for legacy single-user accounts
    };

    let activeQuery = buildQuery(activeStream);
    if (!activeQuery) {
      // Legacy single-user records may not have business_id. Build a bounded
      // customer-id filter from the tenant-scoped customer query; never fall
      // back to querying every pool/equipment row.
      const ownedCustomers = await ctx.db
        .query("customers")
        .withIndex("by_created_by", (q: any) => q.eq("created_by", identityEmail))
        .collect();
      const ownedIds = ownedCustomers.map((customer: any) => customer._id);
      const base = (ctx.db as any).query(activeStream.table);
      activeQuery = filterByWatermark(ownedIds.length
        ? base.filter((q: any) => q.or(...ownedIds.map((id: any) => q.eq(q.field("customer_id"), id))))
        : base.filter((q: any) => q.eq(q.field("_id"), "__none__")));
    }

    const result = await activeQuery.paginate({ cursor: streamCursor, numItems: pageLimit });
    const rows: Record<PullTableName | typeof TOMBSTONE_STREAM, any[]> = {
      customers: [],
      pools: [],
      equipment: [],
      serviceLogs: [],
      chemicalUsage: [],
      notes: [],
      saltCellLogs: [],
      tombstones: [],
    };
    rows[activeStream.table] = activeStream.table === TOMBSTONE_STREAM
      ? result.page.map((tombstone: any) => ({
        table: tombstone.table,
        server_id: tombstone.server_id,
        deleted_at: tombstone.deleted_at,
      }))
      : result.page;

    let nextStreamIndex = activeStreamIndex;
    let nextCursor: string | null = result.isDone ? null : result.continueCursor;
    if (result.isDone) nextStreamIndex += 1;
    const isDone = nextStreamIndex >= streams.length;
    const nextState = isDone ? null : JSON.stringify({
      version: 3,
      since,
      watermark,
      table: streams[nextStreamIndex].table,
      key: streams[nextStreamIndex].key,
      tableCursor: nextCursor,
    });

    return {
      ...rows,
      cursor: nextState,
      hasMore: !isDone,
      watermark,
    };
  },
});

// ============================================
// Delete Sync
// ============================================

async function writeTombstone(ctx: any, table: string, serverId: any, tenancy: TombstoneTenancy, now: number) {
  await ctx.db.insert("syncTombstones", {
    table,
    server_id: String(serverId),
    business_id: tenancy.business_id,
    created_by: tenancy.created_by,
    deleted_by: tenancy.deleted_by,
    deleted_at: now,
  });
}

interface TombstoneTenancy {
  business_id?: string;
  created_by: string;
  deleted_by: string;
}

async function deleteWithTombstone(ctx: any, table: string, id: any, tenancy: TombstoneTenancy, now: number) {
  await ctx.db.delete(id);
  await writeTombstone(ctx, table, id, tenancy, now);
}

/**
 * Delete a record that was deleted on an offline device and leave a
 * tombstone so other devices drop their cached copy.  Deleting a customer
 * also removes its synced children (otherwise their pulls would reference a
 * missing parent); deleting a pool removes its equipment.
 * Idempotent: deleting an already-deleted record succeeds.
 */
export const syncDelete = mutation({
  args: {
    table: v.union(
      v.literal("customers"),
      v.literal("pools"),
      v.literal("equipment"),
      v.literal("serviceLogs"),
      v.literal("chemicalUsage"),
      v.literal("notes"),
      v.literal("saltCellLogs"),
    ),
    server_id: v.string(),
    idempotency_key: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) throw new Error("Not authenticated");
    const userEmail = identity.email;

    const replay = await getSyncReceipt(ctx, args.idempotency_key, userEmail);
    if (replay) return replay;

    await enforceRateLimit(ctx, userEmail, DELETE_RATE_LIMIT_ACTIONS[args.table]);

    const id = ctx.db.normalizeId(args.table, args.server_id);
    if (!id) throw new Error(`Invalid ${args.table} id`);

    const record: any = await ctx.db.get(id);
    if (!record) {
      return await saveSyncReceipt(ctx, args.idempotency_key, userEmail, args.table, {
        success: true,
        operation: "delete" as const,
        server_id: args.server_id,
        already_deleted: true,
        deleted_count: 0,
      });
    }

    const business = await resolveBusinessContext(ctx, userEmail);
    switch (args.table) {
      case "customers":
        if (!(await canAccessCustomer(ctx, record, userEmail))) throw new Error("Access denied");
        // Same role gate as customers.remove.
        await assertBusinessRole(ctx, business, userEmail, CUSTOMER_WRITE_ROLES);
        break;
      case "pools":
        await ensureCustomerOwnedByUser(ctx, record.customer_id, userEmail);
        await assertBusinessRole(ctx, business, userEmail, POOL_WRITE_ROLES);
        break;
      case "equipment":
        await ensurePoolOwnedByUser(ctx, record.pool_id, record.customer_id, userEmail);
        break;
      case "notes":
        if (record.customer_id) {
          await ensureCustomerOwnedByUser(ctx, record.customer_id, userEmail);
        } else if (record.created_by && normalizeEmail(record.created_by) !== normalizeEmail(userEmail)) {
          throw new Error("Access denied: cannot delete another user's note");
        }
        break;
      default:
        await ensureCustomerOwnedByUser(ctx, record.customer_id, userEmail);
    }

    const tenancy: TombstoneTenancy = {
      business_id: business ? String(business._id) : undefined,
      created_by: business ? business.owner_email : userEmail,
      deleted_by: userEmail,
    };
    const now = Date.now();
    let deletedCount = 0;

    if (args.table === "customers") {
      for (const childTable of CUSTOMER_CHILD_TABLES) {
        const children = await (ctx.db as any)
          .query(childTable)
          .withIndex("by_customer", (q: any) => q.eq("customer_id", id))
          .collect();
        for (const child of children) {
          await deleteWithTombstone(ctx, childTable, child._id, tenancy, now);
          deletedCount += 1;
        }
      }
    } else if (args.table === "pools") {
      const equipment = await ctx.db
        .query("equipment")
        .withIndex("by_pool", (q: any) => q.eq("pool_id", id))
        .collect();
      for (const item of equipment) {
        await deleteWithTombstone(ctx, "equipment", item._id, tenancy, now);
        deletedCount += 1;
      }
    }

    await deleteWithTombstone(ctx, args.table, id, tenancy, now);
    deletedCount += 1;

    return await saveSyncReceipt(ctx, args.idempotency_key, userEmail, args.table, {
      success: true,
      operation: "delete" as const,
      server_id: args.server_id,
      already_deleted: false,
      deleted_count: deletedCount,
    });
  },
});

// ============================================
// Customer Sync
// ============================================

const customerDataValidator = v.object({
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
});

export const syncCustomer = mutation({
  args: {
    local_id: v.number(),
    data: customerDataValidator,
    local_updated_at: v.number(),
    // Server `updated_at` of the version the client edited (conflict base).
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

    const { local_id, data, convex_id, base_updated_at } = args;
    const safeLocalUpdatedAt = safeTimestamp(args.local_updated_at);
    const { report_settings, created_by: _ignoredCreatedBy, ...fields } = data;

    // Resolve business context so we can set business_id (matches customers.create behavior)
    const business = await resolveBusinessContext(ctx, identity.email!);
    const createdBy = business ? business.owner_email : identity.email!;
    const businessId = business ? String(business._id) : undefined;

    // If convex_id provided, update existing record
    if (convex_id) {
      const existingCustomer = await ctx.db.get(convex_id);
      if (!existingCustomer) {
        throw new Error(`Customer with convex_id ${convex_id} not found`);
      }

      // SECURITY: Verify ownership of existing record and the same role
      // gate customers.update applies.
      if (!(await canAccessCustomer(ctx, existingCustomer, identity.email!))) {
        throw new Error("Access denied: cannot update another user's customer");
      }
      await assertBusinessRole(ctx, business, identity.email!, CUSTOMER_WRITE_ROLES);

      // SECURITY: Same validation/sanitization as customers.update.
      const validated = validateCustomerUpdate(fields);

      if (isStaleWrite(existingCustomer, base_updated_at, safeLocalUpdatedAt)) {
        console.log(`Conflict detected for customer ${convex_id}: remote changed since client base`);
        return await saveSyncReceipt(ctx, args.idempotency_key, identity.email!, "customers",
          conflictResponse(convex_id, local_id, existingCustomer, safeLocalUpdatedAt, base_updated_at));
      }

      const now = Date.now();
      await ctx.db.patch(convex_id, {
        // Sync sends the whole record: optional fields missing from the
        // payload were cleared locally and are cleared here too.
        phone: undefined,
        email: undefined,
        gate_code: undefined,
        pool_gallons: undefined,
        sort_order: undefined,
        ...validated,
        ...(report_settings ? { report_settings } : {}),
        // Tenancy is derived server side and never moved by a sync write.
        created_by: existingCustomer.created_by || createdBy,
        business_id: existingCustomer.business_id || businessId,
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

    // SECURITY: Same validation/sanitization as customers.create.
    const validated = validateCustomerCreate(fields);

    // TODO(plan-limits): await assertCanAddCustomers(ctx, business, identity.email!, 1);

    // Create new customer record
    const now = Date.now();
    const newCustomerId = await ctx.db.insert("customers", {
      ...validated,
      ...(report_settings ? { report_settings } : {}),
      // Always derive tenancy from auth identity, not client payload.
      created_by: createdBy,
      business_id: businessId,
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
    assertDateOnly(args.data.service_date, "Service date");

    const replay = await getSyncReceipt(ctx, args.idempotency_key, identity.email!);
    if (replay) return replay;

    // SECURITY: Enforce rate limiting (database-backed for distributed rate limiting)
    await enforceRateLimit(ctx, identity.email!, 'serviceLog.update');

    const { local_id, convex_customer_id, convex_id, base_updated_at } = args;
    const safeLocalUpdatedAt = safeTimestamp(args.local_updated_at);
    const data = {
      ...args.data,
      status: validateRequiredString(args.data.status, "Status", 1, 50),
      service_type: validateOptionalString(args.data.service_type, "Service type", 100),
      notes: validateOptionalString(args.data.notes, "Notes", 5000),
    };

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

      if (isStaleWrite(existingServiceLog, base_updated_at, safeLocalUpdatedAt)) {
        console.log(`Conflict detected for service log ${convex_id}: remote changed since client base`);
        return await saveSyncReceipt(ctx, args.idempotency_key, identity.email!, "serviceLogs",
          conflictResponse(convex_id, local_id, existingServiceLog, safeLocalUpdatedAt, base_updated_at));
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

    const { local_id, convex_customer_id, convex_id, base_updated_at } = args;
    const safeLocalUpdatedAt = safeTimestamp(args.local_updated_at);
    // SECURITY: Same validation/sanitization as the normal create path.
    const { customer_id: _customerId, ...validated } = validateChemicalUsageCreate({
      ...args.data,
      customer_id: convex_customer_id,
    });
    const data = { ...validated, pool_id: args.data.pool_id };

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

      if (isStaleWrite(existingChemicalUsage, base_updated_at, safeLocalUpdatedAt)) {
        console.log(`Conflict detected for chemical usage ${convex_id}: remote changed since client base`);
        return await saveSyncReceipt(ctx, args.idempotency_key, identity.email!, "chemicalUsage",
          conflictResponse(convex_id, local_id, existingChemicalUsage, safeLocalUpdatedAt, base_updated_at));
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
      // SECURITY: tenant email derived server side (required for pulls).
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

    const { local_id, convex_customer_id, convex_id, base_updated_at } = args;
    const safeLocalUpdatedAt = safeTimestamp(args.local_updated_at);
    // SECURITY: Same validation/sanitization as the normal create path.
    const { customer_id: _customerId, ...validated } = validateNoteCreate(args.data);
    const data = { ...validated, completed: args.data.completed, pool_id: args.data.pool_id };

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
      } else if (existingNote.created_by && existingNote.created_by !== identity.email) {
        throw new Error("Access denied: cannot update another user's note");
      }

      if (isStaleWrite(existingNote, base_updated_at, safeLocalUpdatedAt)) {
        console.log(`Conflict detected for note ${convex_id}: remote changed since client base`);
        return await saveSyncReceipt(ctx, args.idempotency_key, identity.email!, "notes",
          conflictResponse(convex_id, local_id, existingNote, safeLocalUpdatedAt, base_updated_at));
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

    const { local_id, convex_customer_id, convex_id, base_updated_at } = args;
    const safeLocalUpdatedAt = safeTimestamp(args.local_updated_at);
    assertDateOnly(args.data.cleaning_date, "Cleaning date");
    assertDateOnly(args.data.next_cleaning_due || undefined, "Next cleaning due");
    const data = {
      ...args.data,
      condition: validateRequiredString(args.data.condition, "Condition", 1, 50),
      notes: validateOptionalString(args.data.notes, "Notes", 2000),
    };

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

      if (isStaleWrite(existingSaltCellLog, base_updated_at, safeLocalUpdatedAt)) {
        console.log(`Conflict detected for salt cell log ${convex_id}: remote changed since client base`);
        return await saveSyncReceipt(ctx, args.idempotency_key, identity.email!, "saltCellLogs",
          conflictResponse(convex_id, local_id, existingSaltCellLog, safeLocalUpdatedAt, base_updated_at));
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
      // SECURITY: tenant email derived server side (required for pulls).
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
    const business = await resolveBusinessContext(ctx, identity.email);
    // Same role gate as pools.create/update.
    await assertBusinessRole(ctx, business, identity.email, POOL_WRITE_ROLES);
    const data = {
      ...args.data,
      name: validateRequiredString(args.data.name, "Pool name", 1, 200),
      notes: validateOptionalString(args.data.notes, "Notes", 2000),
    };
    const safeLocalUpdatedAt = safeTimestamp(args.local_updated_at);
    if (args.convex_id) {
      const existing = await ctx.db.get(args.convex_id);
      if (!existing) throw new Error("Pool not found");
      await ensurePoolOwnedByUser(ctx, args.convex_id, args.convex_customer_id, identity.email);
      if (isStaleWrite(existing, args.base_updated_at, safeLocalUpdatedAt)) {
        return await saveSyncReceipt(ctx, args.idempotency_key, identity.email, "pools",
          conflictResponse(args.convex_id, args.local_id, existing, safeLocalUpdatedAt, args.base_updated_at));
      }
      const now = Date.now();
      await ctx.db.patch(args.convex_id, { ...data, updated_at: now });
      return await saveSyncReceipt(ctx, args.idempotency_key, identity.email, "pools", {
        convex_id: args.convex_id, local_id: args.local_id, success: true, operation: "update" as const, updated_at: now,
      });
    }
    const customer = await ctx.db.get(args.convex_customer_id);
    const now = Date.now();
    const id = await ctx.db.insert("pools", {
      ...data,
      customer_id: args.convex_customer_id,
      business_id: business ? String(business._id) : customer?.business_id,
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
    const data = {
      ...args.data,
      name: validateRequiredString(args.data.name, "Equipment name", 1, 200),
      equipment_type: validateRequiredString(args.data.equipment_type, "Equipment type", 1, 100),
      status: validateRequiredString(args.data.status, "Status", 1, 50),
      notes: validateOptionalString(args.data.notes, "Notes", 2000),
    };
    const safeLocalUpdatedAt = safeTimestamp(args.local_updated_at);
    if (args.convex_id) {
      const existing = await ctx.db.get(args.convex_id);
      if (!existing) throw new Error("Equipment not found");
      await ensurePoolOwnedByUser(ctx, existing.pool_id, existing.customer_id, identity.email);
      if (isStaleWrite(existing, args.base_updated_at, safeLocalUpdatedAt)) {
        return await saveSyncReceipt(ctx, args.idempotency_key, identity.email, "equipment",
          conflictResponse(args.convex_id, args.local_id, existing, safeLocalUpdatedAt, args.base_updated_at));
      }
      const now = Date.now();
      await ctx.db.patch(args.convex_id, { ...data, pool_id: args.convex_pool_id, updated_at: now });
      return await saveSyncReceipt(ctx, args.idempotency_key, identity.email, "equipment", {
        convex_id: args.convex_id, local_id: args.local_id, success: true, operation: "update" as const, updated_at: now,
      });
    }
    const business = await resolveBusinessContext(ctx, identity.email);
    const now = Date.now();
    const id = await ctx.db.insert("equipment", {
      ...data,
      pool_id: args.convex_pool_id,
      customer_id: pool.customer_id,
      business_id: business ? String(business._id) : undefined,
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

export const batchSyncCustomers = mutation({
  args: {
    customers: v.array(v.object({
      local_id: v.number(),
      data: customerDataValidator,
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

    if (args.customers.length > MAX_SYNC_BATCH_SIZE) {
      throw new Error(`Batch too large: at most ${MAX_SYNC_BATCH_SIZE} customers per request`);
    }

    const replay = await getSyncReceipt(ctx, args.idempotency_key, identity.email!);
    if (replay) return replay;

    // SECURITY: Rate-limit cost scales with the batch size so batching cannot
    // bypass the per-request `customer.create` budget.
    await enforceRateLimitTokens(
      ctx,
      identity.email!,
      'customer.create',
      args.customers.length / BATCH_CUSTOMERS_PER_RATE_LIMIT_TOKEN,
    );

    const results = [];

    // Resolve business context so we can set business_id (matches customers.create behavior)
    const business = await resolveBusinessContext(ctx, identity.email!);
    const createdBy = business ? business.owner_email : identity.email!;
    const businessId = business ? String(business._id) : undefined;

    // TODO(plan-limits): await assertCanAddCustomers(ctx, business, identity.email!, args.customers.length);

    for (const customer of args.customers) {
      try {
        const { report_settings, created_by: _ignoredCreatedBy, ...fields } = customer.data;
        // SECURITY: Same validation/sanitization as customers.create.
        const validated = validateCustomerCreate(fields);
        const now = Date.now();

        const newCustomerId = await ctx.db.insert("customers", {
          ...validated,
          ...(report_settings ? { report_settings } : {}),
          // Always derive tenancy from auth identity, not client payload.
          created_by: createdBy,
          business_id: businessId,
          created_at: now,
          updated_at: now,
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
