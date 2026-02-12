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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as fc from 'fast-check';
import { SyncStatusIndicator, SyncStatusBadge } from './SyncStatusIndicator';
import { useSyncState } from '@/hooks/useSyncState';

// Mock the useSyncState hook
vi.mock('@/hooks/useSyncState', () => ({
  useSyncState: vi.fn(),
}));

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

/**
 * Generator for timestamps
 */
const timestampArb = fc.integer({ min: 0, max: Date.now() });

/**
 * Generator for error messages
 */
const errorMessageArb = fc.oneof(
  fc.constant(null),
  fc.string({ minLength: 1, maxLength: 100 })
);

/**
 * Generator for complete sync state
 */
const mockFnArb = fc.constant(null).map(() => vi.fn());

const syncStateArb = fc.record({
  status: syncStatusArb,
  pendingCount: pendingCountArb,
  lastSyncAt: fc.oneof(fc.constant(null), timestampArb),
  error: errorMessageArb,
  syncNow: mockFnArb,
  isRecordSynced: mockFnArb,
  getRecordSyncStatus: mockFnArb,
  refreshPendingCount: mockFnArb,
});

// ============================================================================
// Property-Based Tests
// ============================================================================

describe('SyncStatusIndicator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Property 5: Sync Status Displayed Correctly
   * 
   * For any sync status value, the SyncStatusIndicator SHALL display the correct
   * visual representation (icon, text, color) that accurately reflects the current
   * sync status.
   * 
   * **Validates: Requirements 5.1, 5.2, 5.4**
   */
  describe('Property 5: Sync Status Displayed Correctly', () => {
    it('displays correct status text for any sync status', () => {
      fc.assert(
        fc.property(
          syncStateArb,
          (syncState) => {
            (useSyncState as any).mockReturnValue(syncState);

            render(<SyncStatusIndicator showLabel={true} />);

            // Verify the correct status text is displayed based on status and pending count
            let expectedText: string;
            switch (syncState.status) {
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
                expectedText = syncState.pendingCount > 0
                  ? `${syncState.pendingCount} pending`
                  : 'All synced';
                break;
              default:
                expectedText = 'Unknown';
            }

            expect(screen.getByText(expectedText)).toBeInTheDocument();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('displays pending count badge when pendingCount > 0 and showPendingCount is true', () => {
      fc.assert(
        fc.property(
          syncStateArb.filter(state => state.pendingCount > 0),
          (syncState) => {
            (useSyncState as any).mockReturnValue(syncState);

            render(<SyncStatusIndicator showPendingCount={true} />);

            // Should display the pending count as a badge
            expect(screen.getByText(String(syncState.pendingCount))).toBeInTheDocument();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('does not display pending count badge when pendingCount is 0', () => {
      fc.assert(
        fc.property(
          syncStateArb.filter(state => state.pendingCount === 0),
          (syncState) => {
            (useSyncState as any).mockReturnValue(syncState);

            render(<SyncStatusIndicator showPendingCount={true} />);

            // Should not display any pending count badge
            const badges = screen.queryAllByText('0');
            expect(badges).toHaveLength(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('does not display pending count badge when showPendingCount is false', () => {
      fc.assert(
        fc.property(
          syncStateArb.filter(state => state.pendingCount > 0),
          (syncState) => {
            (useSyncState as any).mockReturnValue(syncState);

            render(<SyncStatusIndicator showPendingCount={false} />);

            // Should not display the pending count badge even if count > 0
            expect(screen.queryByText(String(syncState.pendingCount))).not.toBeInTheDocument();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('button is disabled when status is syncing or offline', () => {
      fc.assert(
        fc.property(
          syncStateArb.filter(state => state.status === 'syncing' || state.status === 'offline'),
          (syncState) => {
            (useSyncState as any).mockReturnValue(syncState);

            render(<SyncStatusIndicator />);

            const button = screen.getByRole('button');
            expect(button).toBeDisabled();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('button is enabled when status is idle or error', () => {
      fc.assert(
        fc.property(
          syncStateArb.filter(state => state.status === 'idle' || state.status === 'error'),
          (syncState) => {
            (useSyncState as any).mockReturnValue(syncState);

            render(<SyncStatusIndicator />);

            const button = screen.getByRole('button');
            expect(button).not.toBeDisabled();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('displays status text only when showLabel is true', () => {
      fc.assert(
        fc.property(
          syncStateArb,
          (syncState) => {
            (useSyncState as any).mockReturnValue(syncState);

            const { rerender } = render(<SyncStatusIndicator showLabel={false} />);

            // Get expected text
            let expectedText: string;
            switch (syncState.status) {
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
                expectedText = syncState.pendingCount > 0
                  ? `${syncState.pendingCount} pending`
                  : 'All synced';
                break;
              default:
                expectedText = 'Unknown';
            }

            // Should not show text when showLabel is false
            expect(screen.queryByText(expectedText)).not.toBeInTheDocument();

            // Should show text when showLabel is true
            rerender(<SyncStatusIndicator showLabel={true} />);
            expect(screen.getByText(expectedText)).toBeInTheDocument();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('status consistency: idle with pending count > 0 shows pending text', () => {
      fc.assert(
        fc.property(
          pendingCountArb.filter(count => count > 0),
          (pendingCount) => {
            const syncState = {
              status: 'idle' as const,
              pendingCount,
              lastSyncAt: null,
              error: null,
              syncNow: vi.fn(),
              isRecordSynced: vi.fn(),
              getRecordSyncStatus: vi.fn(),
              refreshPendingCount: vi.fn(),
            };

            (useSyncState as any).mockReturnValue(syncState);

            render(<SyncStatusIndicator showLabel={true} />);

            expect(screen.getByText(`${pendingCount} pending`)).toBeInTheDocument();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('status consistency: idle with pending count = 0 shows all synced text', () => {
      const syncState = {
        status: 'idle' as const,
        pendingCount: 0,
        lastSyncAt: null,
        error: null,
        syncNow: vi.fn(),
        isRecordSynced: vi.fn(),
        getRecordSyncStatus: vi.fn(),
        refreshPendingCount: vi.fn(),
      };

      (useSyncState as any).mockReturnValue(syncState);

      render(<SyncStatusIndicator showLabel={true} />);

      expect(screen.getByText('All synced')).toBeInTheDocument();
    });
  });
});

// Status-to-text mapping for consistent conversion
const statusTextMap: Record<string, string> = {
  synced: 'Synced',
  pending: 'Pending',
  error: 'Error',
};

describe('SyncStatusBadge', () => {
  /**
   * Property 5: Sync Status Displayed Correctly (Record Level)
   * 
   * For any record sync status value, the SyncStatusBadge SHALL display the correct
   * visual representation (icon, text, color) that accurately reflects the record's
   * sync status.
   * 
   * **Validates: Requirements 5.1, 5.2**
   */
  describe('Property 5: Record Sync Status Displayed Correctly', () => {
    it('displays correct status text for any record sync status', () => {
      fc.assert(
        fc.property(
          recordSyncStatusArb,
          (status) => {
            render(<SyncStatusBadge status={status} />);

            // Verify the correct status text is displayed
            let expectedText: string;
            switch (status) {
              case 'synced':
                expectedText = 'Synced';
                break;
              case 'pending':
                expectedText = 'Pending';
                break;
              case 'error':
                expectedText = 'Error';
                break;
              default:
                expectedText = 'Unknown';
            }

            expect(screen.getByText(expectedText)).toBeInTheDocument();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('badge is clickable only when status is error and onRetry is provided', () => {
      const mockRetry = vi.fn();

      fc.assert(
        fc.property(
          recordSyncStatusArb,
          (status) => {
            const { rerender } = render(<SyncStatusBadge status={status} />);

            const badge = screen.getByText(statusTextMap[status] ?? 'Unknown');

            if (status === 'error') {
              // Without onRetry, should not be clickable
              expect(badge).not.toHaveClass('cursor-pointer');

              // With onRetry, should be clickable
              rerender(<SyncStatusBadge status={status} onRetry={mockRetry} />);
              const retryableBadge = screen.getByText('Error');
              expect(retryableBadge).toHaveClass('cursor-pointer');
            } else {
              // Non-error statuses should never be clickable
              expect(badge).toHaveClass('cursor-default');
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('badge has expected structure and is contained within a button element', () => {
      fc.assert(
        fc.property(
          recordSyncStatusArb,
          (status) => {
            render(<SyncStatusBadge status={status} />);

            // The badge is rendered and contains the expected status text
            const badge = screen.getByText(statusTextMap[status] ?? 'Unknown');
            expect(badge).toBeInTheDocument();

            // Verify the badge is contained within a button element for clickable badges
            expect(badge.closest('[role="button"]')).toBeInTheDocument();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('status text matches status value consistently', () => {
      fc.assert(
        fc.property(
          recordSyncStatusArb,
          (status) => {
            render(<SyncStatusBadge status={status} />);

            // Verify that the displayed text matches the expected mapping
            const expectedMapping = {
              'synced': 'Synced',
              'pending': 'Pending',
              'error': 'Error'
            };

            const expectedText = expectedMapping[status];
            expect(screen.getByText(expectedText)).toBeInTheDocument();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('unknown status defaults to Unknown text', () => {
      // @ts-expect-error - Testing invalid status
      render(<SyncStatusBadge status="invalid-status" />);

      expect(screen.getByText('Unknown')).toBeInTheDocument();
    });
  });
});

// ============================================================================
// Integration Tests for Sync Status Display Logic
// ============================================================================

describe('Sync Status Display Integration', () => {
  /**
   * Tests the integration between sync state and display components
   * Requirements: 5.1, 5.2, 5.4
   */

  it('sync status and pending count are consistent', () => {
    fc.assert(
      fc.property(
        syncStateArb,
        (syncState) => {
          (useSyncState as any).mockReturnValue(syncState);

          render(<SyncStatusIndicator showLabel={true} showPendingCount={true} />);

          // When status is idle and pendingCount > 0, should show pending text
          if (syncState.status === 'idle' && syncState.pendingCount > 0) {
            expect(screen.getByText(`${syncState.pendingCount} pending`)).toBeInTheDocument();
            expect(screen.getByText(String(syncState.pendingCount))).toBeInTheDocument();
          }

          // When status is idle and pendingCount = 0, should show all synced
          if (syncState.status === 'idle' && syncState.pendingCount === 0) {
            expect(screen.getByText('All synced')).toBeInTheDocument();
            expect(screen.queryByText('0')).not.toBeInTheDocument();
          }

          // When status is not idle, pending count badge behavior should be independent
          if (syncState.status !== 'idle') {
            if (syncState.pendingCount > 0) {
              expect(screen.getByText(String(syncState.pendingCount))).toBeInTheDocument();
            } else {
              expect(screen.queryByText('0')).not.toBeInTheDocument();
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('error status displays error text regardless of pending count', () => {
    fc.assert(
      fc.property(
        pendingCountArb,
        (pendingCount) => {
          const syncState = {
            status: 'error' as const,
            pendingCount,
            lastSyncAt: null,
            error: 'Network error',
            syncNow: vi.fn(),
            isRecordSynced: vi.fn(),
            getRecordSyncStatus: vi.fn(),
            refreshPendingCount: vi.fn(),
          };

          (useSyncState as any).mockReturnValue(syncState);

          render(<SyncStatusIndicator showLabel={true} />);

          // Should always show "Sync error" regardless of pending count
          expect(screen.getByText('Sync error')).toBeInTheDocument();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('offline status displays offline text regardless of pending count', () => {
    fc.assert(
      fc.property(
        pendingCountArb,
        (pendingCount) => {
          const syncState = {
            status: 'offline' as const,
            pendingCount,
            lastSyncAt: null,
            error: null,
            syncNow: vi.fn(),
            isRecordSynced: vi.fn(),
            getRecordSyncStatus: vi.fn(),
            refreshPendingCount: vi.fn(),
          };

          (useSyncState as any).mockReturnValue(syncState);

          render(<SyncStatusIndicator showLabel={true} />);

          // Should always show "Offline" regardless of pending count
          expect(screen.getByText('Offline')).toBeInTheDocument();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('syncing status displays syncing text regardless of pending count', () => {
    fc.assert(
      fc.property(
        pendingCountArb,
        (pendingCount) => {
          const syncState = {
            status: 'syncing' as const,
            pendingCount,
            lastSyncAt: null,
            error: null,
            syncNow: vi.fn(),
            isRecordSynced: vi.fn(),
            getRecordSyncStatus: vi.fn(),
            refreshPendingCount: vi.fn(),
          };

          (useSyncState as any).mockReturnValue(syncState);

          render(<SyncStatusIndicator showLabel={true} />);

          // Should always show "Syncing..." regardless of pending count
          expect(screen.getByText('Syncing...')).toBeInTheDocument();
        }
      ),
      { numRuns: 100 }
    );
  });
});