/**
 * EmailPreview Component
 * 
 * Displays a preview of the email that will be sent to the customer.
 * Uses the same email generation logic as the backend to ensure accuracy.
 * 
 * Requirements: 4.4 - Email preview accuracy
 */

import { useMemo } from 'react';
import { generateSimpleEmailContent, EmailContentParams } from '@/lib/emailPreview';
import { Mail, Eye } from 'lucide-react';

export interface EmailPreviewProps {
  /** Customer's name */
  customerName: string;
  /** Service date in MM/DD/YYYY format */
  serviceDate: string;
  /** Pool status */
  poolStatus: 'good' | 'needs_attention';
  /** Optional custom message included in the outgoing email */
  customNote?: string;
  /** Whether to show the full HTML preview or simplified text preview */
  showFullPreview?: boolean;
}

/**
 * EmailPreview displays a preview of the email content that will be sent.
 * 
 * The preview is generated using the same function as the backend to ensure
 * the preview matches exactly what the customer will receive.
 * 
 * Features:
 * - Shows email subject line
 * - Displays text preview by default
 * - Optional full HTML preview (rendered in iframe for safety)
 * - Updates in real-time as custom note changes
 */
export function EmailPreview({
  customerName,
  serviceDate,
  poolStatus,
  customNote,
  showFullPreview = false,
}: EmailPreviewProps) {
  // Generate email content using the same function as backend
  const emailContent = useMemo(() => {
    return generateSimpleEmailContent({
      customerName,
      serviceDate,
      poolStatus,
      customNote,
    });
  }, [customerName, serviceDate, poolStatus, customNote]);

  if (showFullPreview) {
    // Full HTML preview in an iframe for safety
    return (
      <div className="space-y-2" data-testid="email-preview-full">
        <div className="flex items-center gap-1.5 text-xs text-ink-muted font-medium">
          <Eye className="w-3.5 h-3.5" />
          Email Preview (Full)
        </div>
        <div className="border border-line rounded-lg overflow-hidden">
          <div className="bg-surface-2 px-3 py-2 border-b border-line">
            <div className="text-xs text-ink-muted">Subject:</div>
            <div className="text-sm font-medium text-ink" data-testid="email-subject">
              {emailContent.subject}
            </div>
          </div>
          <iframe
            srcDoc={emailContent.htmlBody}
            title="Email Preview"
            className="w-full h-[400px] bg-white"
            sandbox="allow-same-origin"
            data-testid="email-html-preview"
          />
        </div>
      </div>
    );
  }

  // Simplified text preview (default)
  return (
    <div className="space-y-2" data-testid="email-preview-simple">
      <div className="flex items-center gap-1.5 text-xs text-ink-muted font-medium">
        <Mail className="w-3.5 h-3.5" />
        Email Preview
      </div>
      <div 
        className="p-3 bg-[var(--status-info-soft)] rounded-lg border border-[var(--status-info-line)] text-sm text-ink-secondary"
        data-testid="email-preview-container"
      >
        <div className="text-xs font-medium mb-1">Subject:</div>
        <div className="text-xs mb-3 font-medium text-ink" data-testid="email-subject">
          {emailContent.subject}
        </div>
        <div className="text-xs font-medium mb-1">Message:</div>
        <div 
          className="text-xs whitespace-pre-wrap" 
          data-testid="email-text-preview"
        >
          {emailContent.textBody}
        </div>
      </div>
    </div>
  );
}
