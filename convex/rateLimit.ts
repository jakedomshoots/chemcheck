import { v } from "convex/values";
import { query, internalMutation } from "./_generated/server";
import { Id, Doc } from "./_generated/dataModel";

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
function getRateLimit(action: string): { maxRequests: number; windowMs: number } {
  // Convert action to env var name: customer.create -> RATE_LIMIT_CUSTOMER_CREATE
  const envKey = `RATE_LIMIT_${action.toUpperCase().replace('.', '_')}`;
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

// For backwards compatibility, export the legacy constant
// New code should use getRateLimit() function
const RATE_LIMITS = DEFAULT_RATE_LIMITS;

// Exponential backoff configuration for repeated violations
const BACKOFF_CONFIG = {
  baseMultiplier: 2,       // Double the wait time for each violation
  maxMultiplier: 32,       // Cap at 32x the normal wait time
  violationWindowMs: 300000, // Track violations over 5 minutes
  maxViolations: 5         // After 5 violations, apply max penalty
};

type RateLimitAction = keyof typeof RATE_LIMITS;

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
    const config = RATE_LIMITS[args.action as RateLimitAction] || RATE_LIMITS.default;
    const now = Date.now();

    // Primary key based on user
    const userKey = `${args.userId}:${args.action}`;

    // Check user-based rate limit
    const userResult = await checkRateLimitInternal(ctx, userKey, config, now);

    // If IP is provided, also check IP-based rate limiting (stricter limits)
    if (args.clientIp) {
      const ipKey = `ip:${args.clientIp}:${args.action}`;
      // IP-based limits are 2x the user limits to catch distributed attacks
      const ipConfig = {
        maxRequests: config.maxRequests * 2,
        windowMs: config.windowMs
      };
      const ipResult = await checkRateLimitInternal(ctx, ipKey, ipConfig, now);

      // If either limit is exceeded, deny the request
      if (!ipResult.allowed) {
        return ipResult;
      }
    }

    return userResult;
  }
});

/**
 * Internal helper to check and update rate limit in database
 */
async function checkRateLimitInternal(
  ctx: any,
  key: string,
  config: { maxRequests: number; windowMs: number },
  now: number
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

  let backoffMultiplier = 1;
  if (violationEntry && now < violationEntry.expires_at) {
    const violationCount = Math.min(violationEntry.count, BACKOFF_CONFIG.maxViolations);
    backoffMultiplier = Math.min(
      Math.pow(BACKOFF_CONFIG.baseMultiplier, violationCount),
      BACKOFF_CONFIG.maxMultiplier
    );
  }

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
    // Record violation for exponential backoff
    await recordViolation(ctx, key, now);

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
 * Wrapper function to enforce rate limiting in mutations
 * Throws an error if rate limit exceeded with exponential backoff
 */
export async function enforceRateLimitInMutation(
  ctx: any,
  userId: string,
  action: string,
  clientIp?: string
): Promise<void> {
  const config = RATE_LIMITS[action as RateLimitAction] || RATE_LIMITS.default;
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

    for (const [action, config] of Object.entries(RATE_LIMITS)) {
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
  handler: async (ctx): Promise<{ cleaned: number }> => {
    const now = Date.now();
    let cleaned = 0;
    const BATCH_SIZE = 100;

    // Clean up expired rate limit entries (older than 1 day) in batches so a
    // single cron run can clear the full backlog.
    while (true) {
      const expiredLimits = await ctx.db
        .query("rateLimits")
        .filter((q) => q.lt(q.field("reset_time"), now - 86400000))
        .take(BATCH_SIZE);

      if (expiredLimits.length === 0) break;

      for (const entry of expiredLimits) {
        await ctx.db.delete(entry._id);
        cleaned++;
      }
    }

    // Clean up expired violation entries in batches.
    while (true) {
      const expiredViolations = await ctx.db
        .query("rateLimitViolations")
        .filter((q) => q.lt(q.field("expires_at"), now))
        .take(BATCH_SIZE);

      if (expiredViolations.length === 0) break;

      for (const entry of expiredViolations) {
        await ctx.db.delete(entry._id);
        cleaned++;
      }
    }

    return { cleaned };
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

// Export rate limit configuration for external use
export const RATE_LIMIT_CONFIG = RATE_LIMITS;
