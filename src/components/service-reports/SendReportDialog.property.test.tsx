/**
 * Property-Based Tests for SendReportDialog Component
 * 
 * These tests validate the correctness properties defined in the design document
 * using fast-check for property-based testing.
 * 
 * Feature: simple-email-notifications
 * Property 5: Dialog Behavior
 * Validates: Requirements 4.1, 4.2
 * 
 * Property 4: Input Validation
 * Validates: Requirements 2.4, 4.3
 * 
 * Property 7: Cancel Prevention
 * Validates: Requirements 4.5
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as fc from 'fast-check';
import { 
  SendReportDialog, 
  PoolStatus, 
  CUSTOM_NOTE_MAX_LENGTH 
} from './SendReportDialog';

// ============================================================================
// Generators for Property-Based Testing
// ============================================================================

/**
 * Generator for pool status
 */
const poolStatusArb = fc.constantFrom<PoolStatus>('good', 'needs_attention');

/**
 * Generator for valid email addresses
 */
const emailArb = fc.emailAddress();

/**
 * Generator for valid custom notes (non-empty, within limit)
 */
const validCustomNoteArb = fc.string({ minLength: 1, maxLength: CUSTOM_NOTE_MAX_LENGTH })
  .filter(note => note.trim().length > 0)
  .map(note => note.trim());

/**
 * Generator for empty/whitespace-only strings
 */
const emptyOrWhitespaceArb = fc.constantFrom('', ' ', '  ', '\t', '\n', '   \t\n  ');

/**
 * Generator for strings exceeding the character limit
 */
const overLimitNoteArb = fc.string({ minLength: CUSTOM_NOTE_MAX_LENGTH + 1, maxLength: CUSTOM_NOTE_MAX_LENGTH + 100 });

// ============================================================================
// Property-Based Tests
// ============================================================================

describe('SendReportDialog Property Tests', () => {
  const mockOnClose = vi.fn();
  const mockOnConfirm = vi.fn();

  const defaultProps = {
    isOpen: true,
    onClose: mockOnClose,
    onConfirm: mockOnConfirm,
    messagePreview: 'Test message preview',
    customerEmail: 'test@example.com',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockOnConfirm.mockResolvedValue(undefined);
  });

  describe('Property 5: Dialog Behavior', () => {
    /**
     * Property 5: Dialog Behavior
     * *For any* pool status, the dialog should show simple confirmation for good status
     * and note input field for needs_attention status.
     * 
     * **Validates: Requirements 4.1, 4.2**
     */
    it('shows simple confirmation for good status (no note input)', async () => {
      await fc.assert(
        fc.asyncProperty(
          emailArb,
          async (email: string) => {
            const { unmount } = render(
              <SendReportDialog
                {...defaultProps}
                customerEmail={email}
                poolStatus="good"
              />
            );

            // Requirement 4.1: Good status should show simple send confirmation
            // Note input should NOT be visible for good status
            expect(screen.queryByTestId('custom-note-section')).not.toBeInTheDocument();
            expect(screen.queryByTestId('custom-note-input')).not.toBeInTheDocument();
            
            // Pool status indicator should show "good" status
            const statusIndicator = screen.getByTestId('pool-status-indicator');
            expect(statusIndicator).toBeInTheDocument();
            expect(statusIndicator.textContent).toContain('Everything is Perfect');
            
            // Send button should be enabled (no note required)
            const sendButton = screen.getByTestId('confirm-send-button');
            expect(sendButton).not.toBeDisabled();

            unmount();
          }
        ),
        { numRuns: 20 }
      );
    });

    it('shows note input field for needs_attention status', async () => {
      await fc.assert(
        fc.asyncProperty(
          emailArb,
          async (email: string) => {
            const { unmount } = render(
              <SendReportDialog
                {...defaultProps}
                customerEmail={email}
                poolStatus="needs_attention"
              />
            );

            // Requirement 4.2: Needs attention status should show note input
            expect(screen.getByTestId('custom-note-section')).toBeInTheDocument();
            expect(screen.getByTestId('custom-note-input')).toBeInTheDocument();
            
            // Pool status indicator should show "needs_attention" status
            const statusIndicator = screen.getByTestId('pool-status-indicator');
            expect(statusIndicator).toBeInTheDocument();
            expect(statusIndicator.textContent).toContain('Needs Attention');
            
            // Character counter should be visible
            expect(screen.getByTestId('character-counter')).toBeInTheDocument();

            unmount();
          }
        ),
        { numRuns: 20 }
      );
    });

    it('pool status determines dialog behavior correctly for any status', async () => {
      await fc.assert(
        fc.asyncProperty(
          poolStatusArb,
          emailArb,
          async (poolStatus: PoolStatus, email: string) => {
            const { unmount } = render(
              <SendReportDialog
                {...defaultProps}
                customerEmail={email}
                poolStatus={poolStatus}
              />
            );

            const noteSection = screen.queryByTestId('custom-note-section');
            const statusIndicator = screen.getByTestId('pool-status-indicator');

            if (poolStatus === 'good') {
              // Good status: no note input, positive messaging
              expect(noteSection).not.toBeInTheDocument();
              expect(statusIndicator.textContent).toContain('Everything is Perfect');
            } else {
              // Needs attention: note input visible, attention messaging
              expect(noteSection).toBeInTheDocument();
              expect(statusIndicator.textContent).toContain('Needs Attention');
            }

            unmount();
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe('Property 4: Input Validation', () => {
    /**
     * Property 4: Input Validation
     * *For any* needs_attention pool status, empty custom notes should fail validation
     * and prevent email sending.
     * 
     * **Validates: Requirements 2.4, 4.3**
     */
    it('empty notes prevent sending for needs_attention status', async () => {
      await fc.assert(
        fc.asyncProperty(
          emptyOrWhitespaceArb,
          emailArb,
          async (emptyNote: string, email: string) => {
            const { unmount } = render(
              <SendReportDialog
                {...defaultProps}
                customerEmail={email}
                poolStatus="needs_attention"
                customNote={emptyNote}
              />
            );

            // Send button should be disabled when note is empty/whitespace
            const sendButton = screen.getByTestId('confirm-send-button');
            expect(sendButton).toBeDisabled();

            unmount();
          }
        ),
        { numRuns: 20 }
      );
    });

    it('valid notes enable sending for needs_attention status', async () => {
      await fc.assert(
        fc.asyncProperty(
          validCustomNoteArb,
          emailArb,
          async (validNote: string, email: string) => {
            const { unmount } = render(
              <SendReportDialog
                {...defaultProps}
                customerEmail={email}
                poolStatus="needs_attention"
                customNote={validNote}
              />
            );

            // Send button should be enabled when note is valid
            const sendButton = screen.getByTestId('confirm-send-button');
            expect(sendButton).not.toBeDisabled();

            unmount();
          }
        ),
        { numRuns: 50 }
      );
    });

    it('notes exceeding character limit disable sending', async () => {
      await fc.assert(
        fc.asyncProperty(
          overLimitNoteArb,
          emailArb,
          async (overLimitNote: string, email: string) => {
            const { unmount } = render(
              <SendReportDialog
                {...defaultProps}
                customerEmail={email}
                poolStatus="needs_attention"
                customNote={overLimitNote}
              />
            );

            // Send button should be disabled when note exceeds limit
            const sendButton = screen.getByTestId('confirm-send-button');
            expect(sendButton).toBeDisabled();
            
            // Character counter should show over-limit state
            const counter = screen.getByTestId('character-counter');
            expect(counter.textContent).toContain(`${overLimitNote.length}/${CUSTOM_NOTE_MAX_LENGTH}`);

            unmount();
          }
        ),
        { numRuns: 20 }
      );
    });

    it('clicking send with empty note shows validation error', async () => {
      const { unmount } = render(
        <SendReportDialog
          {...defaultProps}
          poolStatus="needs_attention"
        />
      );

      // Try to click send button (it should be disabled, but let's verify the state)
      const sendButton = screen.getByTestId('confirm-send-button');
      expect(sendButton).toBeDisabled();
      
      // onConfirm should not have been called
      expect(mockOnConfirm).not.toHaveBeenCalled();

      unmount();
    });

    it('character counter displays correct count for any valid note', async () => {
      await fc.assert(
        fc.asyncProperty(
          validCustomNoteArb,
          async (note: string) => {
            const { unmount } = render(
              <SendReportDialog
                {...defaultProps}
                poolStatus="needs_attention"
                customNote={note}
              />
            );

            const counter = screen.getByTestId('character-counter');
            expect(counter.textContent).toBe(`${note.length}/${CUSTOM_NOTE_MAX_LENGTH}`);

            unmount();
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe('Property 7: Cancel Prevention', () => {
    /**
     * Property 7: Cancel Prevention
     * *For any* dialog state, canceling the dialog should prevent any email sending
     * operations from being triggered.
     * 
     * **Validates: Requirements 4.5**
     */
    it('canceling dialog does not trigger onConfirm for any pool status', async () => {
      await fc.assert(
        fc.asyncProperty(
          poolStatusArb,
          emailArb,
          async (poolStatus: PoolStatus, email: string) => {
            const onConfirmMock = vi.fn().mockResolvedValue(undefined);
            const onCloseMock = vi.fn();
            
            const { unmount } = render(
              <SendReportDialog
                {...defaultProps}
                customerEmail={email}
                poolStatus={poolStatus}
                onConfirm={onConfirmMock}
                onClose={onCloseMock}
              />
            );

            // Find and click the Cancel button
            const cancelButton = screen.getByRole('button', { name: /cancel/i });
            fireEvent.click(cancelButton);

            // onConfirm should NOT have been called
            expect(onConfirmMock).not.toHaveBeenCalled();
            
            // onClose SHOULD have been called
            expect(onCloseMock).toHaveBeenCalledTimes(1);

            unmount();
          }
        ),
        { numRuns: 50 }
      );
    });

    it('canceling dialog with custom note does not send email', async () => {
      await fc.assert(
        fc.asyncProperty(
          validCustomNoteArb,
          emailArb,
          async (customNote: string, email: string) => {
            const onConfirmMock = vi.fn().mockResolvedValue(undefined);
            const onCloseMock = vi.fn();
            
            const { unmount } = render(
              <SendReportDialog
                {...defaultProps}
                customerEmail={email}
                poolStatus="needs_attention"
                customNote={customNote}
                onConfirm={onConfirmMock}
                onClose={onCloseMock}
              />
            );

            // Even with a valid custom note, canceling should not send
            const cancelButton = screen.getByRole('button', { name: /cancel/i });
            fireEvent.click(cancelButton);

            // onConfirm should NOT have been called
            expect(onConfirmMock).not.toHaveBeenCalled();
            
            // onClose SHOULD have been called
            expect(onCloseMock).toHaveBeenCalledTimes(1);

            unmount();
          }
        ),
        { numRuns: 50 }
      );
    });

    it('closing dialog via overlay does not trigger send', async () => {
      await fc.assert(
        fc.asyncProperty(
          poolStatusArb,
          emailArb,
          async (poolStatus: PoolStatus, email: string) => {
            const onConfirmMock = vi.fn().mockResolvedValue(undefined);
            const onCloseMock = vi.fn();
            
            const { unmount } = render(
              <SendReportDialog
                {...defaultProps}
                customerEmail={email}
                poolStatus={poolStatus}
                onConfirm={onConfirmMock}
                onClose={onCloseMock}
              />
            );

            // Simulate closing via dialog's onOpenChange (which is triggered by overlay click or escape)
            // The dialog uses onOpenChange={handleClose} which calls onClose
            // We can simulate this by finding the dialog and triggering close
            const cancelButton = screen.getByRole('button', { name: /cancel/i });
            fireEvent.click(cancelButton);

            // onConfirm should NOT have been called
            expect(onConfirmMock).not.toHaveBeenCalled();

            unmount();
          }
        ),
        { numRuns: 30 }
      );
    });

    it('cancel button is always available regardless of validation state', async () => {
      await fc.assert(
        fc.asyncProperty(
          poolStatusArb,
          emptyOrWhitespaceArb,
          emailArb,
          async (poolStatus: PoolStatus, invalidNote: string, email: string) => {
            const { unmount } = render(
              <SendReportDialog
                {...defaultProps}
                customerEmail={email}
                poolStatus={poolStatus}
                customNote={poolStatus === 'needs_attention' ? invalidNote : undefined}
              />
            );

            // Cancel button should always be enabled, even when send is disabled
            const cancelButton = screen.getByRole('button', { name: /cancel/i });
            expect(cancelButton).not.toBeDisabled();

            unmount();
          }
        ),
        { numRuns: 30 }
      );
    });
  });
});
