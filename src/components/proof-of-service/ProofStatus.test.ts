/**
 * Property-Based Tests for ProofStatus Component
 * 
 * These tests validate the correctness properties defined in the design document
 * using fast-check for property-based testing.
 * 
 * Feature: proof-of-service
 * Property 10: Sync Status Accuracy
 * Validates: Requirements 6.4
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { formatDuration, getSyncStatusConfig } from './ProofStatus';
import type { SyncStatus } from '../../lib/proof-of-service/types';

// ============================================================================
// Generators for Property-Based Testing
// ============================================================================

/**
 * Generator for valid sync status values
 */
const syncStatusArb: fc.Arbitrary<SyncStatus> = fc.constantFrom<SyncStatus>('synced', 'pending', 'failed');

/**
 * Generator for valid duration in milliseconds (0 to 24 hours)
 */
const durationMsArb = fc.integer({ min: 0, max: 24 * 60 * 60 * 1000 });

/**
 * Generator for photo count (0 to 100)
 */
const photoCountArb = fc.integer({ min: 0, max: 100 });

/**
 * Generator for boolean values
 */
const booleanArb = fc.boolean();

// ============================================================================
// Property-Based Tests
// ============================================================================

describe('ProofStatus Component', () => {
  /**
   * Property 10: Sync Status Accuracy
   * 
   * For any service log with offline data, the sync status SHALL accurately
   * reflect the current state: 'synced' if all data uploaded, 'pending' if
   * upload in progress or queued, 'failed' if upload failed.
   * 
   * **Validates: Requirements 6.4**
   */
  describe('Property 10: Sync Status Accuracy', () => {
    it('getSyncStatusConfig returns correct configuration for all valid sync statuses', () => {
      fc.assert(
        fc.property(
          syncStatusArb,
          (syncStatus) => {
            const config = getSyncStatusConfig(syncStatus);
            
            // Config should always have required properties
            expect(config).toHaveProperty('icon');
            expect(config).toHaveProperty('label');
            expect(config).toHaveProperty('colorClass');
            expect(config).toHaveProperty('bgClass');
            
            // Label should be a non-empty string
            expect(typeof config.label).toBe('string');
            expect(config.label.length).toBeGreaterThan(0);
            
            // Color classes should be non-empty strings
            expect(typeof config.colorClass).toBe('string');
            expect(config.colorClass.length).toBeGreaterThan(0);
            expect(typeof config.bgClass).toBe('string');
            expect(config.bgClass.length).toBeGreaterThan(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('synced status returns green-themed configuration', () => {
      fc.assert(
        fc.property(
          fc.constant('synced' as SyncStatus),
          (syncStatus) => {
            const config = getSyncStatusConfig(syncStatus);
            
            expect(config.label).toBe('Synced');
            expect(config.colorClass).toContain('green');
            expect(config.bgClass).toContain('green');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('pending status returns amber-themed configuration', () => {
      fc.assert(
        fc.property(
          fc.constant('pending' as SyncStatus),
          (syncStatus) => {
            const config = getSyncStatusConfig(syncStatus);
            
            expect(config.label).toBe('Pending');
            expect(config.colorClass).toContain('amber');
            expect(config.bgClass).toContain('amber');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('failed status returns red-themed configuration', () => {
      fc.assert(
        fc.property(
          fc.constant('failed' as SyncStatus),
          (syncStatus) => {
            const config = getSyncStatusConfig(syncStatus);
            
            expect(config.label).toBe('Failed');
            expect(config.colorClass).toContain('red');
            expect(config.bgClass).toContain('red');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('each sync status maps to a unique label', () => {
      const statuses: SyncStatus[] = ['synced', 'pending', 'failed'];
      const labels = statuses.map(s => getSyncStatusConfig(s).label);
      
      // All labels should be unique
      const uniqueLabels = new Set(labels);
      expect(uniqueLabels.size).toBe(statuses.length);
    });

    it('sync status configuration is deterministic', () => {
      fc.assert(
        fc.property(
          syncStatusArb,
          (syncStatus) => {
            const config1 = getSyncStatusConfig(syncStatus);
            const config2 = getSyncStatusConfig(syncStatus);
            
            // Same input should always produce same output
            expect(config1.label).toBe(config2.label);
            expect(config1.colorClass).toBe(config2.colorClass);
            expect(config1.bgClass).toBe(config2.bgClass);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Additional tests for formatDuration helper
   * These support the time tracking indicator display
   */
  describe('formatDuration helper', () => {
    it('formats valid durations correctly', () => {
      fc.assert(
        fc.property(
          durationMsArb,
          (durationMs) => {
            const formatted = formatDuration(durationMs);
            
            // Should return a non-empty string
            expect(typeof formatted).toBe('string');
            expect(formatted.length).toBeGreaterThan(0);
            
            // Should contain time units (min or h)
            expect(formatted).toMatch(/(\d+\s*min|\d+h)/);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('returns "--" for undefined duration', () => {
      expect(formatDuration(undefined)).toBe('--');
    });

    it('returns "--" for negative duration', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: -1000000, max: -1 }),
          (negativeDuration) => {
            expect(formatDuration(negativeDuration)).toBe('--');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('formats zero duration as "0 min"', () => {
      expect(formatDuration(0)).toBe('0 min');
    });

    it('formats durations under 1 hour correctly', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 59 }),
          (minutes) => {
            const durationMs = minutes * 60 * 1000;
            const formatted = formatDuration(durationMs);
            
            // Should show minutes only
            expect(formatted).toBe(`${minutes} min`);
            expect(formatted).not.toContain('h');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('formats exact hours correctly', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 24 }),
          (hours) => {
            const durationMs = hours * 60 * 60 * 1000;
            const formatted = formatDuration(durationMs);
            
            // Should show hours only (no minutes)
            expect(formatted).toBe(`${hours}h`);
            expect(formatted).not.toContain('min');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('formats hours and minutes correctly', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 23 }),
          fc.integer({ min: 1, max: 59 }),
          (hours, minutes) => {
            const durationMs = (hours * 60 + minutes) * 60 * 1000;
            const formatted = formatDuration(durationMs);
            
            // Should show both hours and minutes
            expect(formatted).toBe(`${hours}h ${minutes}min`);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('duration calculation is consistent with input', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 23 }),
          fc.integer({ min: 0, max: 59 }),
          (hours, minutes) => {
            const durationMs = (hours * 60 + minutes) * 60 * 1000;
            const formatted = formatDuration(durationMs);
            
            // Parse the formatted string and verify it matches input
            const hourMatch = formatted.match(/(\d+)h/);
            const minMatch = formatted.match(/(\d+)\s*min/);
            
            const parsedHours = hourMatch ? parseInt(hourMatch[1], 10) : 0;
            const parsedMinutes = minMatch ? parseInt(minMatch[1], 10) : 0;
            
            expect(parsedHours).toBe(hours);
            expect(parsedMinutes).toBe(minutes);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
