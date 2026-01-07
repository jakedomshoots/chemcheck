import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// ============================================
// Rate Limiting for Convex Functions
// Prevents abuse and ensures fair usage
// ============================================

// Rate limit configuration per action type
const RATE_LIMITS = {
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

// In-memory rate limit tracking (resets on server restart)
// For production, consider using a dedicated rate limiting service
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

/**
 * Check if a request should be rate limited
 * @param userId - The user making the request
 * @param action - The action being performed
 * @returns Object with allowed status and remaining requests
 */
export function checkRateLimit(
  userId: string,
  action: string
): { allowed: boolean; remaining: number; resetIn: number } {
  const config = RATE_LIMITS[action as keyof typeof RATE_LIMITS] || RATE_LIMITS.default;
  const key = `${userId}:${action}`;
  const now = Date.now();

  let entry = rateLimitStore.get(key);

  // Reset if window has passed
  if (!entry || now > entry.resetTime) {
    entry = {
      count: 0,
      resetTime: now + config.windowMs
    };
  }

  // Check if limit exceeded
  if (entry.count >= config.maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetIn: Math.ceil((entry.resetTime - now) / 1000)
    };
  }

  // Increment counter
  entry.count++;
  rateLimitStore.set(key, entry);

  return {
    allowed: true,
    remaining: config.maxRequests - entry.count,
    resetIn: Math.ceil((entry.resetTime - now) / 1000)
  };
}

/**
 * Wrapper to enforce rate limiting on mutations
 * Throws an error if rate limit is exceeded
 */
export function enforceRateLimit(userId: string, action: string): void {
  const result = checkRateLimit(userId, action);
  
  if (!result.allowed) {
    throw new Error(
      `Rate limit exceeded for ${action}. ` +
      `Please wait ${result.resetIn} seconds before trying again.`
    );
  }
}

/**
 * Get rate limit status for a user
 */
export function getRateLimitStatus(userId: string): Record<string, {
  action: string;
  remaining: number;
  resetIn: number;
}> {
  const status: Record<string, { action: string; remaining: number; resetIn: number }> = {};
  const now = Date.now();

  for (const [action, config] of Object.entries(RATE_LIMITS)) {
    const key = `${userId}:${action}`;
    const entry = rateLimitStore.get(key);

    if (entry && now < entry.resetTime) {
      status[action] = {
        action,
        remaining: Math.max(0, config.maxRequests - entry.count),
        resetIn: Math.ceil((entry.resetTime - now) / 1000)
      };
    } else {
      status[action] = {
        action,
        remaining: config.maxRequests,
        resetIn: 0
      };
    }
  }

  return status;
}

/**
 * Clean up expired rate limit entries (call periodically)
 */
export function cleanupRateLimits(): number {
  const now = Date.now();
  let cleaned = 0;

  for (const [key, entry] of rateLimitStore.entries()) {
    if (now > entry.resetTime) {
      rateLimitStore.delete(key);
      cleaned++;
    }
  }

  return cleaned;
}

// Cleanup old entries every 5 minutes
setInterval(() => {
  const cleaned = cleanupRateLimits();
  if (cleaned > 0) {
    console.log(`[RateLimit] Cleaned up ${cleaned} expired entries`);
  }
}, 5 * 60 * 1000);
