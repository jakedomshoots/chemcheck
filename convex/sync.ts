import { mutation, query, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { enforceRateLimit } from "./rateLimit";

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
 * Cursor-paginated pull for all records owned by the authenticated business.
 * A single opaque cursor contains one Convex cursor per table.  This keeps a
 * pull bounded while still making one deterministic checkpoint for the local
 * Dexie store.  `since` is an updated_at watermark; the first pull (since=0)
 * intentionally includes legacy rows that have no timestamp.
 */
export const pull = query({
  args: {
    cursor: v.optional(v.string()),
    since: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
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
    const business = await resolveBusinessContext(ctx, identity.email!);
    const ownerEmail = business?.owner_email || identity.email!;

    const customerQuery: any = business
      ? ctx.db.query("customers").withIndex("by_business", (q: any) => q.eq("business_id", String(business._id)))
      : ctx.db.query("customers").withIndex("by_created_by", (q: any) => q.eq("created_by", identity.email!));
    let childQuery: (table: string) => any;
    if (business) {
      const members = await ctx.db
        .query("team_members")
        .withIndex("by_business", (q: any) => q.eq("business_id", business._id))
        .filter((q: any) => q.eq(q.field("is_active"), true))
        .collect();
      const accessibleEmails = Array.from(new Set([
        business.owner_email,
        identity.email!,
        ...members.map((member: any) => member.user_email),
      ].filter(Boolean)));
      childQuery = (table: string): any => {
        const query = (ctx.db as any).query(table);
        return query.filter((q: any) => q.or(...accessibleEmails.map((email) => q.eq(q.field("created_by"), email))));
      };
    } else {
      childQuery = (table: string): any =>
        (ctx.db as any).query(table).withIndex("by_created_by", (q: any) => q.eq("created_by", ownerEmail));
    }
    let poolQuery: any;
    let equipmentQuery: any;
    if (business) {
      poolQuery = ctx.db.query("pools").withIndex("by_business", (q: any) => q.eq("business_id", String(business._id)));
      equipmentQuery = ctx.db.query("equipment").withIndex("by_business", (q: any) => q.eq("business_id", String(business._id)));
    } else {
      // Legacy single-user records may not have business_id. Build a bounded
      // customer-id filter from the already tenant-scoped customer query;
      // never fall back to querying every pool/equipment row.
      const ownedCustomers = await customerQuery.collect();
      const ownedIds = ownedCustomers.map((customer: any) => customer._id);
      const onlyOwned = (table: string): any => {
        const query = (ctx.db as any).query(table);
        if (!ownedIds.length) return query.filter((q: any) => q.eq(q.field("_id"), "__none__"));
        return query.filter((q: any) => q.or(...ownedIds.map((id: any) => q.eq(q.field("customer_id"), id))));
      };
      poolQuery = onlyOwned("pools");
      equipmentQuery = onlyOwned("equipment");
    }

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

    const page = async (name: string, q: any): Promise<{ rows: any[]; next: string | null; done: boolean }> => {
      // null explicitly means this table was exhausted on an earlier page.
      if (state[name] === null) return { rows: [], next: null, done: true };
      const result = await filterByWatermark(q).paginate({
        cursor: state[name] || null,
        numItems: pageLimit,
      });
      return {
        rows: result.page,
        next: result.isDone ? null : result.continueCursor,
        done: result.isDone,
      };
    };

    const deferredPage = (): { rows: any[]; next: string | null; done: boolean } => ({
      rows: [],
      next: undefined as any,
      done: false,
    });
    const customers = await page("customers", customerQuery);
    const customersDone = customers.done;
    const pools = customersDone ? await page("pools", poolQuery) : deferredPage();
    const poolsDone = customersDone && pools.done;
    const equipment = poolsDone ? await page("equipment", equipmentQuery) : deferredPage();
    const equipmentDone = poolsDone && equipment.done;
    const serviceLogs = equipmentDone ? await page("serviceLogs", childQuery("serviceLogs")) : deferredPage();
    const chemicalUsage = equipmentDone ? await page("chemicalUsage", childQuery("chemicalUsage")) : deferredPage();
    const notes = equipmentDone ? await page("notes", childQuery("notes")) : deferredPage();
    const saltCellLogs = equipmentDone ? await page("saltCellLogs", childQuery("saltCellLogs")) : deferredPage();

    const nextState: any = {
      since,
      watermark,
      customers: customers.next,
      pools: pools.next,
      equipment: equipment.next,
      serviceLogs: serviceLogs.next,
      chemicalUsage: chemicalUsage.next,
      notes: notes.next,
      saltCellLogs: saltCellLogs.next,
    };
    const isDone = [customers, pools, equipment, serviceLogs, chemicalUsage, notes, saltCellLogs].every((result) => result.done);

    return {
      customers: customers.rows,
      pools: pools.rows,
      equipment: equipment.rows,
      serviceLogs: serviceLogs.rows,
      chemicalUsage: chemicalUsage.rows,
      notes: notes.rows,
      saltCellLogs: saltCellLogs.rows,
      cursor: isDone ? null : JSON.stringify(nextState),
      hasMore: !isDone,
      watermark,
    };
  },
});

async function resolveBusinessContext(ctx: any, userEmail: string) {
  const normalizedUserEmail = normalizeEmail(userEmail);

  const exactTeamMember = await ctx.db
    .query("team_members")
    .withIndex("by_user_email", (q: any) => q.eq("user_email", userEmail))
    .filter((q: any) => q.eq(q.field("is_active"), true))
    .first();

  if (exactTeamMember) {
    const teamBusiness = await ctx.db.get(exactTeamMember.business_id);
    if (teamBusiness) return teamBusiness;
  }

  const exactOwnedBusiness = await ctx.db
    .query("businesses")
    .withIndex("by_owner_email", (q: any) => q.eq("owner_email", userEmail))
    .first();

  if (exactOwnedBusiness) return exactOwnedBusiness;

  // Legacy records may differ only by email casing/whitespace. Index lookups are
  // exact, so fall back to normalized scans before denying sync.
  const teamMembers = await ctx.db
    .query("team_members")
    .filter((q: any) => q.eq(q.field("is_active"), true))
    .collect();

  const normalizedTeamMember = teamMembers.find(
    (member: any) => normalizeEmail(member.user_email) === normalizedUserEmail
  );

  if (normalizedTeamMember) {
    const teamBusiness = await ctx.db.get(normalizedTeamMember.business_id);
    if (teamBusiness) return teamBusiness;
  }

  const businesses = await ctx.db.query("businesses").collect();
  return businesses.find(
    (business: any) => normalizeEmail(business.owner_email) === normalizedUserEmail
  );
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

      // Conflict detection: check if remote record was modified after local timestamp
      const remoteUpdatedAt = existingCustomer.updated_at || 0;
      if (remoteUpdatedAt > safeLocalUpdatedAt) {
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
      alkalinity_value: v.optional(v.number()),
      stabilizer_value: v.optional(v.number()),
      start_time: v.optional(v.string()),
      end_time: v.optional(v.string()),
      duration_ms: v.optional(v.number()),
    }),
    local_updated_at: v.number(),
    convex_id: v.optional(v.id("serviceLogs")), // If updating existing record
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

      // Conflict detection: check if remote record was modified after local timestamp
      const remoteUpdatedAt = existingServiceLog.updated_at || 0;
      if (remoteUpdatedAt > safeLocalUpdatedAt) {
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

      // Conflict detection: check if remote record was modified after local timestamp
      const remoteUpdatedAt = existingChemicalUsage.updated_at || 0;
      if (remoteUpdatedAt > safeLocalUpdatedAt) {
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
      } else if (existingNote.created_by && existingNote.created_by !== identity.email) {
        throw new Error("Access denied: cannot update another user's note");
      }

      // Conflict detection: check if remote record was modified after local timestamp
      const remoteUpdatedAt = existingNote.updated_at || 0;
      if (remoteUpdatedAt > safeLocalUpdatedAt) {
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

      // Conflict detection: check if remote record was modified after local timestamp
      const remoteUpdatedAt = existingSaltCellLog.updated_at || 0;
      if (remoteUpdatedAt > safeLocalUpdatedAt) {
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
      const remoteUpdatedAt = existing.updated_at || 0;
      if (remoteUpdatedAt > safeLocalUpdatedAt) {
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
      const remoteUpdatedAt = existing.updated_at || 0;
      if (remoteUpdatedAt > safeLocalUpdatedAt) {
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
    const now = Date.now();
    const id = await ctx.db.insert("equipment", {
      ...args.data,
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

    const replay = await getSyncReceipt(ctx, args.idempotency_key, identity.email!);
    if (replay) return replay;

    // SECURITY: Enforce rate limiting for batch operations (database-backed for distributed rate limiting)
    await enforceRateLimit(ctx, identity.email!, 'customer.create');

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
