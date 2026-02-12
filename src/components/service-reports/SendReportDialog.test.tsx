/**
 * Tests for SendReportDialog Component
 * 
 * Tests email delivery, validation, and UI states.
 * Note: SMS functionality has been disabled in favor of email-only delivery.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SendReportDialog } from './SendReportDialog';

describe('SendReportDialog', () => {
  const mockOnClose = vi.fn();
  const mockOnConfirm = vi.fn();

  const defaultProps = {
    isOpen: true,
    onClose: mockOnClose,
    onConfirm: mockOnConfirm,
    messagePreview: 'Test message preview',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Email Delivery', () => {
    it('shows email method button when email is available', () => {
      render(
        <SendReportDialog
          {...defaultProps}
          customerEmail="customer@acmepools.com"
        />
      );

      expect(screen.getByTestId('email-method-button')).toBeInTheDocument();
    });

    it('email button is always selected when email is available', () => {
      render(
        <SendReportDialog
          {...defaultProps}
          customerEmail="customer@acmepools.com"
        />
      );

      const emailButton = screen.getByTestId('email-method-button');
      expect(emailButton).toHaveAttribute('aria-pressed', 'true');
    });
  });

  describe('Recipient Display', () => {
    it('shows email address when email is available', () => {
      render(
        <SendReportDialog
          {...defaultProps}
          customerEmail="customer@acmepools.com"
        />
      );

      const recipient = screen.getByTestId('recipient-display');
      expect(recipient).toHaveTextContent('customer@acmepools.com');
    });

    it('shows error when no email on file', () => {
      render(
        <SendReportDialog
          {...defaultProps}
        />
      );

      expect(screen.getByText(/No email address on file/i)).toBeInTheDocument();
    });

    it('shows error when email format is invalid', () => {
      render(
        <SendReportDialog
          {...defaultProps}
          customerEmail="bad-email"
        />
      );

      expect(screen.getAllByText(/email on file is invalid/i).length).toBeGreaterThan(0);
    });

    it('shows error when email is a placeholder domain', () => {
      render(
        <SendReportDialog
          {...defaultProps}
          customerEmail="admin@example.com"
        />
      );

      expect(screen.getAllByText(/looks like a placeholder/i).length).toBeGreaterThan(0);
    });

    it('shows attached photos preview when photos are provided', () => {
      render(
        <SendReportDialog
          {...defaultProps}
          customerEmail="customer@acmepools.com"
          attachedPhotos={[
            { id: '1', category: 'before', url: 'data:image/jpeg;base64,before' },
            { id: '2', category: 'after', url: 'data:image/jpeg;base64,after' },
          ]}
        />
      );

      expect(screen.getByTestId('attached-photos-preview')).toBeInTheDocument();
      expect(screen.getByText(/Attached Photos \(2\)/i)).toBeInTheDocument();
    });
  });

  describe('Email Preview', () => {
    it('shows email preview when email is available', () => {
      render(
        <SendReportDialog
          {...defaultProps}
          customerEmail="customer@acmepools.com"
        />
      );

      const preview = screen.getByTestId('email-preview');
      expect(preview).toHaveTextContent('Pool Service Completed');
    });
  });

  describe('Send Confirmation', () => {
    it('calls onConfirm with email method when send button clicked', async () => {
      mockOnConfirm.mockResolvedValue(undefined);

      render(
        <SendReportDialog
          {...defaultProps}
          customerEmail="customer@acmepools.com"
        />
      );

      const sendButton = screen.getByTestId('confirm-send-button');
      fireEvent.click(sendButton);

      await waitFor(() => {
        expect(mockOnConfirm).toHaveBeenCalledWith('email', undefined);
      });
    });

    it('disables send button when no email available', () => {
      render(
        <SendReportDialog
          {...defaultProps}
        />
      );

      const sendButton = screen.getByTestId('confirm-send-button');
      expect(sendButton).toBeDisabled();
    });

    it('disables send button when email format is invalid', () => {
      render(
        <SendReportDialog
          {...defaultProps}
          customerEmail="invalid-email"
        />
      );

      const sendButton = screen.getByTestId('confirm-send-button');
      expect(sendButton).toBeDisabled();
    });

    it('shows loading state during send', async () => {
      mockOnConfirm.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 100)));

      render(
        <SendReportDialog
          {...defaultProps}
          customerEmail="customer@acmepools.com"
        />
      );

      const sendButton = screen.getByTestId('confirm-send-button');
      fireEvent.click(sendButton);

      await waitFor(() => {
        expect(screen.getByText('Sending...')).toBeInTheDocument();
      });
    });
  });

  describe('Error Handling', () => {
    it('displays error message when provided', () => {
      render(
        <SendReportDialog
          {...defaultProps}
          customerEmail="customer@acmepools.com"
          error="Failed to send email"
        />
      );

      expect(screen.getByTestId('error-message')).toHaveTextContent('Failed to send email');
    });
  });

  describe('Resend Mode', () => {
    it('shows resend title when isResend is true', () => {
      render(
        <SendReportDialog
          {...defaultProps}
          customerEmail="customer@acmepools.com"
          isResend={true}
        />
      );

      expect(screen.getByText('Resend Service Report')).toBeInTheDocument();
    });

    it('shows resend button text when isResend is true', () => {
      render(
        <SendReportDialog
          {...defaultProps}
          customerEmail="customer@acmepools.com"
          isResend={true}
        />
      );

      expect(screen.getByText('Resend Report')).toBeInTheDocument();
    });
  });

  describe('Pool Status and Custom Notes', () => {
    it('shows pool status indicator for good status', () => {
      render(
        <SendReportDialog
          {...defaultProps}
          customerEmail="customer@acmepools.com"
          poolStatus="good"
        />
      );

      const statusIndicator = screen.getByTestId('pool-status-indicator');
      expect(statusIndicator).toHaveTextContent('Everything is Perfect');
    });

    it('shows pool status indicator for needs_attention status', () => {
      render(
        <SendReportDialog
          {...defaultProps}
          customerEmail="customer@acmepools.com"
          poolStatus="needs_attention"
        />
      );

      const statusIndicator = screen.getByTestId('pool-status-indicator');
      expect(statusIndicator).toHaveTextContent('Needs Attention');
    });

    it('shows custom note input for needs_attention status', () => {
      render(
        <SendReportDialog
          {...defaultProps}
          customerEmail="customer@acmepools.com"
          poolStatus="needs_attention"
        />
      );

      expect(screen.getByTestId('custom-note-section')).toBeInTheDocument();
      expect(screen.getByTestId('custom-note-input')).toBeInTheDocument();
    });

    it('shows optional custom message input for good status', () => {
      render(
        <SendReportDialog
          {...defaultProps}
          customerEmail="customer@acmepools.com"
          poolStatus="good"
        />
      );

      expect(screen.getByTestId('custom-note-section')).toBeInTheDocument();
      expect(screen.getByText(/Custom Message/i)).toBeInTheDocument();
    });

    it('disables send button when needs_attention and no custom note', () => {
      render(
        <SendReportDialog
          {...defaultProps}
          customerEmail="customer@acmepools.com"
          poolStatus="needs_attention"
        />
      );

      const sendButton = screen.getByTestId('confirm-send-button');
      expect(sendButton).toBeDisabled();
    });

    it('enables send button when needs_attention and custom note provided', () => {
      render(
        <SendReportDialog
          {...defaultProps}
          customerEmail="customer@acmepools.com"
          poolStatus="needs_attention"
          customNote="pH levels are high"
        />
      );

      const sendButton = screen.getByTestId('confirm-send-button');
      expect(sendButton).not.toBeDisabled();
    });

    it('shows character counter for custom note', () => {
      render(
        <SendReportDialog
          {...defaultProps}
          customerEmail="customer@acmepools.com"
          poolStatus="needs_attention"
          customNote="Test note"
        />
      );

      const counter = screen.getByTestId('character-counter');
      expect(counter).toHaveTextContent('9/500');
    });
  });
});
