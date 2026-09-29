import { v } from "convex/values";
import { query, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";

// ============================================
// Database-Backed Rate Limiting for Convex
// Persistent, distributed rate limiting that survives restarts
// ============================================

// Default rate limit configuration per action type
// These can be overridden via environment variables
// Format: RATE_LIMIT_{ACTION_NAME}="maxRequests:windowMs"
// Example: RATE_LIMIT_CUSTOMER_CREATE="30:60000"
const DEFAULT_RATE_LIMITS: Record<string, { maxRequests: number; windowMs: number }> = {
  // Mutations (writes)
  'customer.create': { maxRequests: 20, windowMs: 60000 },    // 20 per minute
  'customer.update': { maxRequests: 50, windowMs: 60000 },    // 50 per minute
  'customer.delete': { maxRequests: 10, windowMs: 60000 },    // 10 per minute
  'serviceLog.create': { maxRequests: 100, windowMs: 60000 }, // 100 per minute
  'serviceLog.update': { maxRequests: 100, windowMs: 60000 }, // 100 per minute
  'serviceLog.delete': { maxRequests: 20, windowMs: 60000 },  // 20 per minute
  'note.create': { maxRequests: 50, windowMs: 60000 },        // 50 per minute
  'chemical.create': { maxRequests: 100, windowMs: 60000 },   // 100 per minute
  'invoice.write': { maxRequests: 60, windowMs: 60000 },      // 60 per minute
  'quote.write': { maxRequests: 60, windowMs: 60000 },        // 60 per minute
  'workOrder.write': { maxRequests: 100, windowMs: 60000 },   // 100 per minute
  'business.write': { maxRequests: 30, windowMs: 60000 },     // 30 per minute
  'team.invite': { maxRequests: 10, windowMs: 60000 },        // 10 per minute
  'team.write': { maxRequests: 30, windowMs: 60000 },         // 30 per minute
  'pool.write': { maxRequests: 60, windowMs: 60000 },         // 60 per minute
  'equipment.write': { maxRequests: 60, windowMs: 60000 },    // 60 per minute
  'communication.sms': { maxRequests: 20, windowMs: 60000 },  // 20 per minute
  'report.send': { maxRequests: 30, windowMs: 60000 },        // 30 per minute

  // Queries (reads) - more lenient
  'query.list': { maxRequests: 200, windowMs: 60000 },        // 200 per minute
  'query.get': { maxRequests: 500, windowMs: 60000 },         // 500 per minute

  // Default fallback
  'default': { maxRequests: 100, windowMs: 60000 }            // 100 per minute
};

/**
 * Get rate limit configuration for an action.
 * Checks environment variables first, then falls back to defaults.
 * 
 * Environment variable format: RATE_LIMIT_{ACTION}="maxRequests:windowMs"
 * Example: RATE_LIMIT_CUSTOMER_CREATE="30:60000"
 * 
 * @param action - The action to get rate limit for (e.g., 'customer.create')
 * @returns Rate limit configuration with maxRequests and windowMs
 */
export function getRateLimit(action: string): { maxRequests: number; windowMs: number } {
  // Convert action to env var name: customer.create -> RATE_LIMIT_CUSTOMER_CREATE
  const envKey = `RATE_LIMIT_${action.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
  const envValue = process.env[envKey];

  if (envValue) {
    const parts = envValue.split(':');
    if (parts.length === 2) {
      const maxRequests = parseInt(parts[0], 10);
      const windowMs = parseInt(parts[1], 10);

      if (!isNaN(maxRequests) && !isNaN(windowMs) && maxRequests > 0 && windowMs > 0) {
        return { maxRequests, windowMs };
      }
    }
    // Log warning for malformed env var in development
    if (process.env.NODE_ENV === 'development') {
      console.warn(`[RateLimit] Invalid format for ${envKey}: ${envValue}. Expected "maxRequests:windowMs"`);
    }
  }

  // Fall back to defaults
  return DEFAULT_RATE_LIMITS[action] || DEFAULT_RATE_LIMITS['default'];
}

// Exponential backoff configuration for repeated violations
const BACKOFF_CONFIG = {
  baseMultiplier: 2,       // Double the wait time for each violation
  maxMultiplier: 32,       // Cap at 32x the normal wait time
  violationWindowMs: 300000, // Track violations over 5 minutes
  maxViolations: 5         // After 5 violations, apply max penalty
};

/**
 * Check rate limit and increment counter atomically using database
 * This is the core rate limiting function that should be called within mutations
 */
export const checkAndConsumeRateLimit = internalMutation({
  args: {
    userId: v.string(),
    action: v.string(),
    clientIp: v.optional(v.string()), // Optional IP for additional limiting
  },
  handler: async (ctx, args): Promise<{
    allowed: boolean;
    remaining: number;
    resetIn: number;
    retryAfter?: number;
  }> => {
    const config = getRateLimit(args.action);
    const now = Date.now();

    // Primary key based on user
    const userKey = `${args.userId}:${args.action}`;

    // Check user-based rate limit. This internal mutation returns instead of
    // throwing, so violation records written here persist and feed backoff.
    const userResult = await checkRateLimitInternal(ctx, userKey, config, now, true);

    // If IP is provided, also check IP-based rate limiting (stricter limits)
    if (args.clientIp) {
      const ipKey = `ip:${args.clientIp}:${args.action}`;
      // IP-based limits are 2x the user limits to catch distributed attacks
      const ipConfig = {
        maxRequests: config.maxRequests * 2,
        windowMs: config.windowMs
      };
      const ipResult = await checkRateLimitInternal(ctx, ipKey, ipConfig, now, true);

      // If either limit is exceeded, deny the request
      if (!ipResult.allowed) {
        return ipResult;
      }
    }

    return userResult;
  }
});

/**
 * Backoff multiplier for a denied request.
 *
 * Violations recorded inside a mutation that then throws are rolled back, so
 * the enforcing path cannot rely on persisted violation rows. Instead we use
 * the persisted violation record when one exists (written by the non-throwing
 * checkAndConsumeRateLimit path) and otherwise fall back to 1x: the caller
 * must simply wait for the current window to reset.
 */
export function computeBackoffMultiplier(violationCount: number): number {
  if (!Number.isFinite(violationCount) || violationCount <= 0) return 1;
  const count = Math.min(violationCount, BACKOFF_CONFIG.maxViolations);
  return Math.min(Math.pow(BACKOFF_CONFIG.baseMultiplier, count), BACKOFF_CONFIG.maxMultiplier);
}

/**
 * Internal helper to check and update rate limit in database.
 *
 * `persistViolation` must only be true when the calling mutation returns
 * normally on denial; a thrown error rolls the violation write back anyway.
 */
async function checkRateLimitInternal(
  ctx: any,
  key: string,
  config: { maxRequests: number; windowMs: number },
  now: number,
  persistViolation = false
): Promise<{ allowed: boolean; remaining: number; resetIn: number; retryAfter?: number }> {
  // Query existing rate limit entry
  const existing = await ctx.db
    .query("rateLimits")
    .withIndex("by_key", (q: any) => q.eq("key", key))
    .first();

  // Check for recent violations and apply exponential backoff
  const violationEntry = await ctx.db
    .query("rateLimitViolations")
    .withIndex("by_key", (q: any) => q.eq("key", key))
    .first();

  const backoffMultiplier =
    violationEntry && now < violationEntry.expires_at ? computeBackoffMultiplier(violationEntry.count) : 1;

  // If no entry or window has passed, create/reset
  if (!existing || now > existing.reset_time) {
    const resetTime = now + config.windowMs;

    if (existing) {
      // Update existing entry - reset the window
      await ctx.db.patch(existing._id, {
        count: 1,
        reset_time: resetTime,
        updated_at: now
      });
    } else {
      // Create new entry
      await ctx.db.insert("rateLimits", {
        key,
        count: 1,
        reset_time: resetTime,
        created_at: now,
        updated_at: now
      });
    }

    return {
      allowed: true,
      remaining: config.maxRequests - 1,
      resetIn: Math.ceil(config.windowMs / 1000)
    };
  }

  // Check if limit exceeded
  if (existing.count >= config.maxRequests) {
    // Record violation for exponential backoff (only where it can persist).
    if (persistViolation) {
      await recordViolation(ctx, key, now);
    }

    const baseResetIn = Math.ceil((existing.reset_time - now) / 1000);
    const retryAfter = Math.ceil(baseResetIn * backoffMultiplier);

    return {
      allowed: false,
      remaining: 0,
      resetIn: baseResetIn,
      retryAfter
    };
  }

  // Increment counter
  await ctx.db.patch(existing._id, {
    count: existing.count + 1,
    updated_at: now
  });

  return {
    allowed: true,
    remaining: config.maxRequests - existing.count - 1,
    resetIn: Math.ceil((existing.reset_time - now) / 1000)
  };
}

/**
 * Record a rate limit violation for exponential backoff
 */
async function recordViolation(ctx: any, key: string, now: number): Promise<void> {
  const existing = await ctx.db
    .query("rateLimitViolations")
    .withIndex("by_key", (q: any) => q.eq("key", key))
    .first();

  if (existing && now < existing.expires_at) {
    // Increment violation count
    await ctx.db.patch(existing._id, {
      count: existing.count + 1,
      last_violation_at: now,
      expires_at: now + BACKOFF_CONFIG.violationWindowMs
    });
  } else if (existing) {
    // Reset expired violation entry
    await ctx.db.patch(existing._id, {
      count: 1,
      last_violation_at: now,
      expires_at: now + BACKOFF_CONFIG.violationWindowMs
    });
  } else {
    // Create new violation entry
    await ctx.db.insert("rateLimitViolations", {
      key,
      count: 1,
      last_violation_at: now,
      expires_at: now + BACKOFF_CONFIG.violationWindowMs
    });
  }
}

/**
 * Wrapper function to enforce rate limiting in mutations.
 * Throws when the limit is exceeded. Because the throw rolls back every write
 * made by the mutation, nothing is persisted on denial; the retry hint is the
 * remaining time in the current window (scaled by any persisted backoff).
 */
export async function enforceRateLimitInMutation(
  ctx: any,
  userId: string,
  action: string,
  clientIp?: string
): Promise<void> {
  const config = getRateLimit(action);
  const now = Date.now();

  // Check user-based limit
  const userKey = `${userId}:${action}`;
  const result = await checkRateLimitInternal(ctx, userKey, config, now);

  if (!result.allowed) {
    const retryAfter = result.retryAfter || result.resetIn;
    throw new Error(
      `Rate limit exceeded for ${action}. ` +
      `Please wait ${retryAfter} seconds before trying again.`
    );
  }

  // Check IP-based limit if provided
  if (clientIp) {
    const ipKey = `ip:${clientIp}:${action}`;
    const ipConfig = {
      maxRequests: config.maxRequests * 2,
      windowMs: config.windowMs
    };
    const ipResult = await checkRateLimitInternal(ctx, ipKey, ipConfig, now);

    if (!ipResult.allowed) {
      const retryAfter = ipResult.retryAfter || ipResult.resetIn;
      throw new Error(
        `Rate limit exceeded. ` +
        `Please wait ${retryAfter} seconds before trying again.`
      );
    }
  }
}

/**
 * Get rate limit status for a user (for displaying in UI)
 */
export const getRateLimitStatus = query({
  args: {},
  handler: async (ctx, args): Promise<Record<string, {
    action: string;
    remaining: number;
    resetIn: number;
    limit: number;
  }>> => {
    void args;
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) throw new Error("Not authenticated");

    const status: Record<string, { action: string; remaining: number; resetIn: number; limit: number }> = {};
    const now = Date.now();

    for (const action of Object.keys(DEFAULT_RATE_LIMITS)) {
      const config = getRateLimit(action);
      const key = `${identity.email}:${action}`;
      const entry = await ctx.db
        .query("rateLimits")
        .withIndex("by_key", (q) => q.eq("key", key))
        .first();

      if (entry && now < entry.reset_time) {
        status[action] = {
          action,
          remaining: Math.max(0, config.maxRequests - entry.count),
          resetIn: Math.ceil((entry.reset_time - now) / 1000),
          limit: config.maxRequests
        };
      } else {
        status[action] = {
          action,
          remaining: config.maxRequests,
          resetIn: 0,
          limit: config.maxRequests
        };
      }
    }

    return status;
  }
});

/**
 * Cleanup expired rate limit entries (scheduled function)
 * Run periodically via Convex scheduled functions
 */
export const cleanupExpiredRateLimits = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ cleaned: number; hasMore: boolean }> => {
    const now = Date.now();
    let cleaned = 0;
    const BATCH_SIZE = 500;

    // Indexed range scans keep each run bounded; if a full batch was removed,
    // schedule a follow-up run to clear the remaining backlog.
    const expiredLimits = await ctx.db
      .query("rateLimits")
      .withIndex("by_reset_time", (q) => q.lt("reset_time", now - 86400000))
      .take(BATCH_SIZE);
    for (const entry of expiredLimits) {
      await ctx.db.delete(entry._id);
      cleaned++;
    }

    const expiredViolations = await ctx.db
      .query("rateLimitViolations")
      .withIndex("by_expires_at", (q) => q.lt("expires_at", now))
      .take(BATCH_SIZE);
    for (const entry of expiredViolations) {
      await ctx.db.delete(entry._id);
      cleaned++;
    }

    const hasMore = expiredLimits.length === BATCH_SIZE || expiredViolations.length === BATCH_SIZE;
    if (hasMore) {
      await ctx.scheduler.runAfter(0, internal.rateLimit.cleanupExpiredRateLimits, {});
    }

    return { cleaned, hasMore };
  }
});

/**
 * Get violation history for a user (for admin/monitoring)
 */
export const getViolationHistory = query({
  args: {},
  handler: async (ctx, args): Promise<Array<{
    action: string;
    violationCount: number;
    lastViolation: number;
    expiresAt: number;
  }>> => {
    void args;
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) throw new Error("Not authenticated");

    const now = Date.now();
    const violations: Array<{
      action: string;
      violationCount: number;
      lastViolation: number;
      expiresAt: number;
    }> = [];

    // Query violations for this user across all actions
    const allViolations = await ctx.db
      .query("rateLimitViolations")
      .filter((q) =>
        q.and(
          q.gt(q.field("expires_at"), now),
          q.gte(q.field("key"), `${identity.email}:`),
          q.lt(q.field("key"), `${identity.email}:\uffff`)
        )
      )
      .take(50);

    for (const v of allViolations) {
      const action = v.key.split(':').slice(1).join(':');
      violations.push({
        action,
        violationCount: v.count,
        lastViolation: v.last_violation_at,
        expiresAt: v.expires_at
      });
    }

    return violations;
  }
});

/**
 * Backward-compatible synchronous enforceRateLimit function
 * This function is designed to be called within Convex mutation handlers
 * It directly accesses the database through the mutation context
 * 
 * Usage in mutations:
 *   await enforceRateLimit(ctx, identity.email!, 'customer.create');
 */
export async function enforceRateLimit(
  ctx: any,
  userId: string,
  action: string,
  clientIp?: string
): Promise<void> {
  await enforceRateLimitInMutation(ctx, userId, action, clientIp);
}

// Export default rate limit configuration for external use
export const RATE_LIMIT_CONFIG = DEFAULT_RATE_LIMITS;
