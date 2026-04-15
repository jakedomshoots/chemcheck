/**
 * Property-Based Tests for Time Tracking Utilities
 * 
 * These tests validate the correctness properties defined in the design document
 * using fast-check for property-based testing.
 * 
 * Feature: proof-of-service
 * Property 5: Time Tracking Duration Calculation
 * Property 6: Time Storage in UTC
 * Validates: Requirements 3.3, 3.6
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  generateUTCTimestamp,
  toUTCString,
  parseUTCString,
  isValidUTCTimestamp,
  calculateDuration,
  formatDuration,
  isEndAtOrAfterStart,
} from './timeUtils';

// ============================================================================
// Generators for Property-Based Testing
// ============================================================================

/**
 * Generator for valid timestamps within a reasonable range
 * Using integer-based generation to avoid invalid date issues
 */
const timestampMsArb = fc.integer({
  min: new Date('2020-01-01').getTime(),
  max: new Date('2030-12-31').getTime(),
});

/**
 * Generator for valid ISO 8601 UTC timestamps
 */
const utcTimestampArb = timestampMsArb.map(ms => new Date(ms).toISOString());

/**
 * Generator for a pair of timestamps where end >= start
 */
const orderedTimestampPairArb = fc.tuple(timestampMsArb, timestampMsArb)
  .map(([a, b]) => {
    const start = Math.min(a, b);
    const end = Math.max(a, b);
    return {
      startTime: new Date(start).toISOString(),
      endTime: new Date(end).toISOString(),
      expectedDuration: end - start,
    };
  });

/**
 * Generator for duration in milliseconds (0 to 24 hours)
 */
const durationMsArb = fc.integer({ min: 0, max: 24 * 60 * 60 * 1000 });

// ============================================================================
// Property-Based Tests
// ============================================================================

describe('Time Tracking Utilities', () => {
  /**
   * Property 5: Time Tracking Duration Calculation
   * 
   * For any service visit with valid start and end times, the calculated duration
   * SHALL equal (endTime - startTime) in milliseconds, and SHALL be non-negative.
   * 
   * **Validates: Requirements 3.3**
   */
  describe('Property 5: Time Tracking Duration Calculation', () => {
    it('duration equals endTime minus startTime in milliseconds', async () => {
      await fc.assert(
        fc.asyncProperty(
          orderedTimestampPairArb,
          async ({ startTime, endTime, expectedDuration }) => {
            const calculatedDuration = calculateDuration(startTime, endTime);
            
            // Duration should equal end - start
            expect(calculatedDuration).toBe(expectedDuration);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('duration is always non-negative', async () => {
      await fc.assert(
        fc.asyncProperty(
          utcTimestampArb,
          utcTimestampArb,
          async (time1, time2) => {
            const duration = calculateDuration(time1, time2);
            
            // Duration should always be non-negative
            expect(duration).toBeGreaterThanOrEqual(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('duration is zero when start equals end', async () => {
      await fc.assert(
        fc.asyncProperty(
          utcTimestampArb,
          async (timestamp) => {
            const duration = calculateDuration(timestamp, timestamp);
            
            // Duration should be zero when start equals end
            expect(duration).toBe(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('formatDuration produces valid human-readable output', async () => {
      await fc.assert(
        fc.asyncProperty(
          durationMsArb,
          async (durationMs) => {
            const formatted = formatDuration(durationMs);
            
            // Should be a non-empty string
            expect(typeof formatted).toBe('string');
            expect(formatted.length).toBeGreaterThan(0);
            
            // Should contain 'min' or 'h' for time units
            expect(formatted).toMatch(/min|h/);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 6: Time Storage in UTC
   * 
   * For any stored time value, the time SHALL be in UTC format.
   * When displayed, it SHALL be converted to the user's local timezone.
   * 
   * **Validates: Requirements 3.6**
   */
  describe('Property 6: Time Storage in UTC', () => {
    it('generateUTCTimestamp always produces valid UTC format', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constant(null), // No input needed, just run multiple times
          async () => {
            const timestamp = generateUTCTimestamp();
            
            // Should be valid UTC format
            expect(isValidUTCTimestamp(timestamp)).toBe(true);
            
            // Should end with 'Z' (UTC indicator)
            expect(timestamp.endsWith('Z')).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('toUTCString always produces valid UTC format', async () => {
      await fc.assert(
        fc.asyncProperty(
          timestampMsArb,
          async (ms) => {
            const date = new Date(ms);
            const utcString = toUTCString(date);
            
            // Should be valid UTC format
            expect(isValidUTCTimestamp(utcString)).toBe(true);
            
            // Should end with 'Z' (UTC indicator)
            expect(utcString.endsWith('Z')).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('parseUTCString round-trips correctly', async () => {
      await fc.assert(
        fc.asyncProperty(
          timestampMsArb,
          async (ms) => {
            const originalDate = new Date(ms);
            const utcString = toUTCString(originalDate);
            const parsedDate = parseUTCString(utcString);
            
            // Should parse back to equivalent date
            expect(parsedDate).not.toBeNull();
            expect(parsedDate!.getTime()).toBe(originalDate.getTime());
          }
        ),
        { numRuns: 100 }
      );
    });

    it('UTC timestamps preserve exact millisecond precision', async () => {
      await fc.assert(
        fc.asyncProperty(
          timestampMsArb,
          async (ms) => {
            const date = new Date(ms);
            const utcString = toUTCString(date);
            const parsed = parseUTCString(utcString);
            
            // Milliseconds should be preserved exactly
            expect(parsed!.getTime()).toBe(date.getTime());
          }
        ),
        { numRuns: 100 }
      );
    });

    it('isEndAtOrAfterStart correctly validates time ordering', async () => {
      await fc.assert(
        fc.asyncProperty(
          orderedTimestampPairArb,
          async ({ startTime, endTime }) => {
            // When end >= start, should return true
            expect(isEndAtOrAfterStart(startTime, endTime)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('isEndAtOrAfterStart allows zero-duration events (equal timestamps)', async () => {
      await fc.assert(
        fc.asyncProperty(
          utcTimestampArb,
          async (timestamp) => {
            // Same start and end time should be valid (zero-duration event)
            expect(isEndAtOrAfterStart(timestamp, timestamp)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
