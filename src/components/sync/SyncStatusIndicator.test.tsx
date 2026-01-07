/**
 * Property-Based Tests for Sync Status Display
 * 
 * These tests validate the correctness properties defined in the design document
 * using fast-check for property-based testing.
 * 
 * Feature: data-sync
 * Property 5: Sync Status Displayed Correctly
 * Validates: Requirements 5.1, 5.2, 5.4
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { 
  getStatusText, 
  getStatusColor, 
  isSyncButtonDisabled,
  getRecordStatusText,
  getRecordStatusColor
} from './syncStatusUtils';

// ============================================================================
// Generators for Property-Based Testing
// ============================================================================

/**
 * Generator for sync status values
 */
const syncStatusArb = fc.constantFrom('idle', 'syncing', 'error', 'offline');

/**
 * Generator for record sync status values
 */
const recordSyncStatusArb = fc.constantFrom('synced', 'pending', 'error');

/**
 * Generator for pending count (non-negative integer)
 */
const pendingCountArb = fc.integer({ min: 0, max: 1000 });

// ============================================================================
// Property-Based Tests
// ============================================================================

describe('Sync Status Display Utilities', () => {
  /**
   * Property 5: Sync Status Displayed Correctly
   * 
   * For any sync status value, the sync status display functions SHALL return the correct
   * text, color, and button state that accurately reflects the current sync status.
   * 
   * **Validates: Requirements 5.1, 5.2, 5.4**
   */
  describe('Property 5: Sync Status Displayed Correctly', () => {
    it('getStatusText returns correct text for any sync status and pending count', () => {
      fc.assert(
        fc.property(
          syncStatusArb,
          pendingCountArb,
          (status, pendingCount) => {
            const text = getStatusText(status, pendingCount);

            // Verify the correct status text is returned based on status and pending count
            let expectedText: string;
            switch (status) {
              case 'syncing':
                expectedText = 'Syncing...';
                break;
              case 'error':
                expectedText = 'Sync error';
                break;
              case 'offline':
                expectedText = 'Offline';
                break;
              case 'idle':
                expectedText = pendingCount > 0 
                  ? `${pendingCount} pending` 
                  : 'All synced';
                break;
              default:
                expectedText = 'Unknown';
            }

            expect(text).toBe(expectedText);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('getStatusText for idle status reflects pending count accurately', () => {
      fc.assert(
        fc.property(
          pendingCountArb,
          (pendingCount) => {
            const text = getStatusText('idle', pendingCount);

            if (pendingCount > 0) {
              expect(text).toBe(`${pendingCount} pending`);
              expect(text).toContain(String(pendingCount));
            } else {
              expect(text).toBe('All synced');
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('getStatusText for non-idle statuses ignores pending count', () => {
      fc.assert(
        fc.property(
          syncStatusArb.filter(s => s !== 'idle'),
          pendingCountArb,
          (status, pendingCount) => {
            const text = getStatusText(status, pendingCount);

            // Non-idle statuses should not include pending count in text
            expect(text).not.toContain(String(pendingCount));

            // Verify expected text
            const expectedTexts = {
              'syncing': 'Syncing...',
              'error': 'Sync error',
              'offline': 'Offline'
            };
            expect(text).toBe(expectedTexts[status]);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('getStatusColor returns correct color classes for any sync status and pending count', () => {
      fc.assert(
        fc.property(
          syncStatusArb,
          pendingCountArb,
          (status, pendingCount) => {
            const color = getStatusColor(status, pendingCount);

            // Verify the color is a non-empty string
            expect(color).toBeTruthy();
            expect(typeof color).toBe('string');

            // Verify it contains expected Tailwind classes
            expect(color).toMatch(/bg-\w+-\d+/);
            expect(color).toMatch(/text-\w+-\d+/);
            expect(color).toMatch(/border-\w+-\d+/);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('getStatusColor for idle status changes based on pending count', () => {
      fc.assert(
        fc.property(
          pendingCountArb,
          (pendingCount) => {
            const color = getStatusColor('idle', pendingCount);

            if (pendingCount > 0) {
              // Should be yellow when pending
              expect(color).toContain('yellow');
            } else {
              // Should be green when all synced
              expect(color).toContain('green');
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('getStatusColor for non-idle statuses ignores pending count', () => {
      fc.assert(
        fc.property(
          syncStatusArb.filter(s => s !== 'idle'),
          fc.tuple(pendingCountArb, pendingCountArb),
          (status, [count1, count2]) => {
            const color1 = getStatusColor(status, count1);
            const color2 = getStatusColor(status, count2);

            // Color should be the same regardless of pending count for non-idle statuses
            expect(color1).toBe(color2);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('isSyncButtonDisabled returns true only for syncing and offline', () => {
      fc.assert(
        fc.property(
          syncStatusArb,
          (status) => {
            const disabled = isSyncButtonDisabled(status);

            if (status === 'syncing' || status === 'offline') {
              expect(disabled).toBe(true);
            } else {
              expect(disabled).toBe(false);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('isSyncButtonDisabled is consistent for same status', () => {
      fc.assert(
        fc.property(
          syncStatusArb,
          (status) => {
            const disabled1 = isSyncButtonDisabled(status);
            const disabled2 = isSyncButtonDisabled(status);

            expect(disabled1).toBe(disabled2);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 5: Record Sync Status Displayed Correctly
   * 
   * For any record sync status value, the record sync status display functions SHALL
   * return the correct text and color that accurately reflects the record's sync status.
   * 
   * **Validates: Requirements 5.1, 5.2**
   */
  describe('Property 5: Record Sync Status Displayed Correctly', () => {
    it('getRecordStatusText returns correct text for any record sync status', () => {
      fc.assert(
        fc.property(
          recordSyncStatusArb,
          (status) => {
            const text = getRecordStatusText(status);

            // Verify the correct status text is returned
            const expectedMapping = {
              'synced': 'Synced',
              'pending': 'Pending',
              'error': 'Error'
            };

            expect(text).toBe(expectedMapping[status]);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('getRecordStatusText returns Unknown for invalid status', () => {
      const invalidStatuses = ['invalid', 'unknown', '', 'SYNCED', 'Pending'];
      
      invalidStatuses.forEach(status => {
        const text = getRecordStatusText(status);
        expect(text).toBe('Unknown');
      });
    });

    it('getRecordStatusColor returns correct color classes for any record sync status', () => {
      fc.assert(
        fc.property(
          recordSyncStatusArb,
          (status) => {
            const color = getRecordStatusColor(status);

            // Verify the color is a non-empty string
            expect(color).toBeTruthy();
            expect(typeof color).toBe('string');

            // Verify it contains expected Tailwind classes
            expect(color).toMatch(/bg-\w+-\d+/);
            expect(color).toMatch(/text-\w+-\d+/);
            expect(color).toMatch(/border-\w+-\d+/);

            // Verify correct color for each status
            if (status === 'synced') {
              expect(color).toContain('green');
            } else if (status === 'pending') {
              expect(color).toContain('yellow');
            } else if (status === 'error') {
              expect(color).toContain('red');
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('getRecordStatusColor is consistent for same status', () => {
      fc.assert(
        fc.property(
          recordSyncStatusArb,
          (status) => {
            const color1 = getRecordStatusColor(status);
            const color2 = getRecordStatusColor(status);

            expect(color1).toBe(color2);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('different record statuses produce different colors', () => {
      const statuses = ['synced', 'pending', 'error'];
      const colors = statuses.map(s => getRecordStatusColor(s));

      // All colors should be unique
      const uniqueColors = new Set(colors);
      expect(uniqueColors.size).toBe(statuses.length);
    });

    it('different record statuses produce different texts', () => {
      const statuses = ['synced', 'pending', 'error'];
      const texts = statuses.map(s => getRecordStatusText(s));

      // All texts should be unique
      const uniqueTexts = new Set(texts);
      expect(uniqueTexts.size).toBe(statuses.length);
    });
  });
});

// ============================================================================
// Integration Tests for Sync Status Display Logic
// ============================================================================

describe('Sync Status Display Integration', () => {
  /**
   * Tests the integration between sync state and display logic
   * Requirements: 5.1, 5.2, 5.4
   */

  it('status text and color are consistent for same inputs', () => {
    fc.assert(
      fc.property(
        syncStatusArb,
        pendingCountArb,
        (status, pendingCount) => {
          const text1 = getStatusText(status, pendingCount);
          const text2 = getStatusText(status, pendingCount);
          const color1 = getStatusColor(status, pendingCount);
          const color2 = getStatusColor(status, pendingCount);

          expect(text1).toBe(text2);
          expect(color1).toBe(color2);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('idle status with pending count > 0 shows pending in both text and color', () => {
    fc.assert(
      fc.property(
        pendingCountArb.filter(count => count > 0),
        (pendingCount) => {
          const text = getStatusText('idle', pendingCount);
          const color = getStatusColor('idle', pendingCount);

          // Text should indicate pending
          expect(text).toContain('pending');
          expect(text).toContain(String(pendingCount));

          // Color should be yellow (pending color)
          expect(color).toContain('yellow');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('idle status with pending count = 0 shows synced in both text and color', () => {
    const text = getStatusText('idle', 0);
    const color = getStatusColor('idle', 0);

    // Text should indicate all synced
    expect(text).toBe('All synced');

    // Color should be green (synced color)
    expect(color).toContain('green');
  });

  it('error status always shows error regardless of pending count', () => {
    fc.assert(
      fc.property(
        pendingCountArb,
        (pendingCount) => {
          const text = getStatusText('error', pendingCount);
          const color = getStatusColor('error', pendingCount);

          // Text should always be "Sync error"
          expect(text).toBe('Sync error');

          // Color should always be red
          expect(color).toContain('red');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('offline status always shows offline regardless of pending count', () => {
    fc.assert(
      fc.property(
        pendingCountArb,
        (pendingCount) => {
          const text = getStatusText('offline', pendingCount);
          const color = getStatusColor('offline', pendingCount);

          // Text should always be "Offline"
          expect(text).toBe('Offline');

          // Color should always be gray
          expect(color).toContain('gray');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('syncing status always shows syncing regardless of pending count', () => {
    fc.assert(
      fc.property(
        pendingCountArb,
        (pendingCount) => {
          const text = getStatusText('syncing', pendingCount);
          const color = getStatusColor('syncing', pendingCount);

          // Text should always be "Syncing..."
          expect(text).toBe('Syncing...');

          // Color should always be blue
          expect(color).toContain('blue');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('button disabled state matches status appropriately', () => {
    fc.assert(
      fc.property(
        syncStatusArb,
        (status) => {
          const disabled = isSyncButtonDisabled(status);

          // Button should be disabled for syncing and offline
          // Button should be enabled for idle and error
          if (status === 'syncing' || status === 'offline') {
            expect(disabled).toBe(true);
          } else if (status === 'idle' || status === 'error') {
            expect(disabled).toBe(false);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});