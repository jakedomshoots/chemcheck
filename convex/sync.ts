import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { enforceRateLimit } from "./rateLimit";

/**
 * Convex mutations for syncing data from Dexie (local IndexedDB) to Convex (cloud)
 * These mutations handle upsert logic and conflict detection for bidirectional sync
 * 
 * SECURITY: All sync mutations require authentication and enforce tenant isolation
 */

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
      created_by: v.string(),
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
  },
  handler: async (ctx, args) => {
    // SECURITY: Require authentication
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    // SECURITY: Enforce rate limiting (database-backed for distributed rate limiting)
    await enforceRateLimit(ctx, identity.email!, 'customer.update');

    const { local_id, data, local_updated_at, convex_id } = args;

    // SECURITY: Verify created_by matches authenticated user (tenant isolation)
    if (data.created_by !== identity.email) {
      throw new Error("Access denied: cannot sync data for another user");
    }

    // If convex_id provided, update existing record
    if (convex_id) {
      const existingCustomer = await ctx.db.get(convex_id);
      if (!existingCustomer) {
        throw new Error(`Customer with convex_id ${convex_id} not found`);
      }

      // SECURITY: Verify ownership of existing record
      if (existingCustomer.created_by !== identity.email) {
        throw new Error("Access denied: cannot update another user's customer");
      }

      // Conflict detection: check if remote record was modified after local timestamp
      const remoteUpdatedAt = existingCustomer.updated_at || 0;
      if (remoteUpdatedAt > local_updated_at) {
        console.log(`Conflict detected for customer ${convex_id}: remote newer than local`);

        // Return conflict information for client-side resolution
        return {
          convex_id,
          local_id,
          success: false,
          operation: 'conflict' as const,
          conflict: {
            remote_data: existingCustomer,
            remote_updated_at: remoteUpdatedAt,
            local_updated_at,
          },
        };
      }

      // Update the existing customer
      const now = Date.now();
      await ctx.db.patch(convex_id, {
        ...data,
        updated_at: now,
      });

      return {
        convex_id,
        local_id,
        success: true,
        operation: 'update' as const,
        updated_at: now, // Return server timestamp
      };
    }

    // Create new customer record
    const now = Date.now();
    const newCustomerId = await ctx.db.insert("customers", {
      ...data,
      created_at: now,
      updated_at: now,
    });

    return {
      convex_id: newCustomerId,
      local_id,
      success: true,
      operation: 'create' as const,
      updated_at: now, // Return server timestamp
    };
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
      service_date: v.string(),
      status: v.string(),
      notes: v.optional(v.string()),
      ph: v.string(),
      chlorine: v.string(),
      alkalinity: v.string(),
      stabilizer: v.string(),
      salt: v.optional(v.number()),
      start_time: v.optional(v.string()),
      end_time: v.optional(v.string()),
      duration_ms: v.optional(v.number()),
    }),
    local_updated_at: v.number(),
    convex_id: v.optional(v.id("serviceLogs")), // If updating existing record
  },
  handler: async (ctx, args) => {
    // SECURITY: Require authentication
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    // SECURITY: Enforce rate limiting (database-backed for distributed rate limiting)
    await enforceRateLimit(ctx, identity.email!, 'serviceLog.update');

    const { local_id, convex_customer_id, data, local_updated_at, convex_id } = args;

    // Verify customer exists AND belongs to authenticated user (tenant isolation)
    const customer = await ctx.db.get(convex_customer_id);
    if (!customer) {
      throw new Error(`Customer with id ${convex_customer_id} not found`);
    }

    // SECURITY: Verify customer ownership
    if (customer.created_by !== identity.email) {
      throw new Error("Access denied: cannot sync data for another user's customer");
    }

    // If convex_id provided, update existing record
    if (convex_id) {
      const existingServiceLog = await ctx.db.get(convex_id);
      if (!existingServiceLog) {
        throw new Error(`ServiceLog with convex_id ${convex_id} not found`);
      }

      // Conflict detection: check if remote record was modified after local timestamp
      const remoteUpdatedAt = existingServiceLog.updated_at || 0;
      if (remoteUpdatedAt > local_updated_at) {
        console.log(`Conflict detected for service log ${convex_id}: remote newer than local`);

        // Return conflict information for client-side resolution
        return {
          convex_id,
          local_id,
          success: false,
          operation: 'conflict' as const,
          conflict: {
            remote_data: existingServiceLog,
            remote_updated_at: remoteUpdatedAt,
            local_updated_at,
          },
        };
      }

      // Update the existing service log
      const now = Date.now();
      await ctx.db.patch(convex_id, {
        ...data,
        customer_id: convex_customer_id,
        updated_at: now,
      });

      return {
        convex_id,
        local_id,
        success: true,
        operation: 'update' as const,
        updated_at: now, // Return server timestamp
      };
    }

    // Create new service log record
    const now = Date.now();
    const newServiceLogId = await ctx.db.insert("serviceLogs", {
      ...data,
      customer_id: convex_customer_id,
      created_at: now,
      updated_at: now,
    });

    return {
      convex_id: newServiceLogId,
      local_id,
      success: true,
      operation: 'create' as const,
      updated_at: now, // Return server timestamp
    };
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
      chemical_type: v.string(),
      quantity: v.string(),
      notes: v.optional(v.string()),
      created_date: v.optional(v.string()),
    }),
    local_updated_at: v.number(),
    convex_id: v.optional(v.id("chemicalUsage")), // If updating existing record
  },
  handler: async (ctx, args) => {
    // SECURITY: Require authentication
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    // SECURITY: Enforce rate limiting (database-backed for distributed rate limiting)
    await enforceRateLimit(ctx, identity.email!, 'chemical.create');

    const { local_id, convex_customer_id, data, local_updated_at, convex_id } = args;

    // Verify customer exists AND belongs to authenticated user (tenant isolation)
    const customer = await ctx.db.get(convex_customer_id);
    if (!customer) {
      throw new Error(`Customer with id ${convex_customer_id} not found`);
    }

    // SECURITY: Verify customer ownership
    if (customer.created_by !== identity.email) {
      throw new Error("Access denied: cannot sync data for another user's customer");
    }

    // If convex_id provided, update existing record
    if (convex_id) {
      const existingChemicalUsage = await ctx.db.get(convex_id);
      if (!existingChemicalUsage) {
        throw new Error(`ChemicalUsage with convex_id ${convex_id} not found`);
      }

      // Conflict detection: check if remote record was modified after local timestamp
      const remoteUpdatedAt = existingChemicalUsage.updated_at || 0;
      if (remoteUpdatedAt > local_updated_at) {
        console.log(`Conflict detected for chemical usage ${convex_id}: remote newer than local`);

        // Return conflict information for client-side resolution
        return {
          convex_id,
          local_id,
          success: false,
          operation: 'conflict' as const,
          conflict: {
            remote_data: existingChemicalUsage,
            remote_updated_at: remoteUpdatedAt,
            local_updated_at,
          },
        };
      }

      // Update the existing chemical usage record
      const now = Date.now();
      await ctx.db.patch(convex_id, {
        ...data,
        customer_id: convex_customer_id,
        updated_at: now,
      });

      return {
        convex_id,
        local_id,
        success: true,
        operation: 'update' as const,
        updated_at: now, // Return server timestamp
      };
    }

    // Create new chemical usage record
    const now = Date.now();
    const newChemicalUsageId = await ctx.db.insert("chemicalUsage", {
      ...data,
      customer_id: convex_customer_id,
      created_at: now,
      updated_at: now,
    });

    return {
      convex_id: newChemicalUsageId,
      local_id,
      success: true,
      operation: 'create' as const,
      updated_at: now, // Return server timestamp
    };
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
      title: v.string(),
      content: v.string(),
      category: v.string(),
      priority: v.string(),
      completed: v.optional(v.boolean()),
      created_date: v.optional(v.string()),
    }),
    local_updated_at: v.number(),
    convex_id: v.optional(v.id("notes")), // If updating existing record
  },
  handler: async (ctx, args) => {
    // SECURITY: Require authentication
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    // SECURITY: Enforce rate limiting (database-backed for distributed rate limiting)
    await enforceRateLimit(ctx, identity.email!, 'note.create');

    const { local_id, convex_customer_id, data, local_updated_at, convex_id } = args;

    // Verify customer exists if customer_id provided AND belongs to user (tenant isolation)
    if (convex_customer_id) {
      const customer = await ctx.db.get(convex_customer_id);
      if (!customer) {
        throw new Error(`Customer with id ${convex_customer_id} not found`);
      }
      // SECURITY: Verify customer ownership
      if (customer.created_by !== identity.email) {
        throw new Error("Access denied: cannot sync notes for another user's customer");
      }
    }

    // If convex_id provided, update existing record
    if (convex_id) {
      const existingNote = await ctx.db.get(convex_id);
      if (!existingNote) {
        throw new Error(`Note with convex_id ${convex_id} not found`);
      }

      // Conflict detection: check if remote record was modified after local timestamp
      const remoteUpdatedAt = existingNote.updated_at || 0;
      if (remoteUpdatedAt > local_updated_at) {
        console.log(`Conflict detected for note ${convex_id}: remote newer than local`);

        // Return conflict information for client-side resolution
        return {
          convex_id,
          local_id,
          success: false,
          operation: 'conflict' as const,
          conflict: {
            remote_data: existingNote,
            remote_updated_at: remoteUpdatedAt,
            local_updated_at,
          },
        };
      }

      // Update the existing note
      const now = Date.now();
      await ctx.db.patch(convex_id, {
        ...data,
        customer_id: convex_customer_id,
        updated_at: now,
      });

      return {
        convex_id,
        local_id,
        success: true,
        operation: 'update' as const,
        updated_at: now, // Return server timestamp
      };
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

    return {
      convex_id: newNoteId,
      local_id,
      success: true,
      operation: 'create' as const,
      updated_at: now, // Return server timestamp
    };
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
      cleaning_date: v.string(),
      condition: v.string(),
      notes: v.optional(v.string()),
      next_cleaning_due: v.optional(v.string()),
    }),
    local_updated_at: v.number(),
    convex_id: v.optional(v.id("saltCellLogs")), // If updating existing record
  },
  handler: async (ctx, args) => {
    // SECURITY: Require authentication
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    // SECURITY: Enforce rate limiting (database-backed for distributed rate limiting)
    await enforceRateLimit(ctx, identity.email!, 'customer.update');

    const { local_id, convex_customer_id, data, local_updated_at, convex_id } = args;

    // Verify customer exists AND belongs to authenticated user (tenant isolation)
    const customer = await ctx.db.get(convex_customer_id);
    if (!customer) {
      throw new Error(`Customer with id ${convex_customer_id} not found`);
    }

    // SECURITY: Verify customer ownership
    if (customer.created_by !== identity.email) {
      throw new Error("Access denied: cannot sync data for another user's customer");
    }

    // If convex_id provided, update existing record
    if (convex_id) {
      const existingSaltCellLog = await ctx.db.get(convex_id);
      if (!existingSaltCellLog) {
        throw new Error(`SaltCellLog with convex_id ${convex_id} not found`);
      }

      // Conflict detection: check if remote record was modified after local timestamp
      const remoteUpdatedAt = existingSaltCellLog.updated_at || 0;
      if (remoteUpdatedAt > local_updated_at) {
        console.log(`Conflict detected for salt cell log ${convex_id}: remote newer than local`);

        // Return conflict information for client-side resolution
        return {
          convex_id,
          local_id,
          success: false,
          operation: 'conflict' as const,
          conflict: {
            remote_data: existingSaltCellLog,
            remote_updated_at: remoteUpdatedAt,
            local_updated_at,
          },
        };
      }

      // Update the existing salt cell log
      const now = Date.now();
      await ctx.db.patch(convex_id, {
        ...data,
        customer_id: convex_customer_id,
        updated_at: now,
      });

      return {
        convex_id,
        local_id,
        success: true,
        operation: 'update' as const,
        updated_at: now,
      };
    }

    // Create new salt cell log record
    const now = Date.now();
    const newSaltCellLogId = await ctx.db.insert("saltCellLogs", {
      ...data,
      customer_id: convex_customer_id,
      created_at: now,
      updated_at: now,
    });

    return {
      convex_id: newSaltCellLogId,
      local_id,
      success: true,
      operation: 'create' as const,
      updated_at: now,
    };
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
        created_by: v.string(),
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
  },
  handler: async (ctx, args) => {
    // SECURITY: Require authentication
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    // SECURITY: Enforce rate limiting for batch operations (database-backed for distributed rate limiting)
    await enforceRateLimit(ctx, identity.email!, 'customer.create');

    const results = [];

    for (const customer of args.customers) {
      try {
        // SECURITY: Verify created_by matches authenticated user
        if (customer.data.created_by !== identity.email) {
          results.push({
            local_id: customer.local_id,
            convex_id: null,
            success: false,
            error: 'Access denied: cannot create customers for another user',
          });
          continue;
        }

        const newCustomerId = await ctx.db.insert("customers", {
          ...customer.data,
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

    return {
      results,
      total: args.customers.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
    };
  },
});