/**
 * SendReportDialog Component
 * 
 * Confirmation dialog for sending service reports via SMS or Email.
 * Shows delivery method selection, recipient info, and message preview.
 * Supports pool status detection and custom note input for issues.
 * 
 * Requirements: 2.2, 2.6, 2.7, 2.8, 2.1, 2.5, 4.1, 4.2, 4.3, 4.4
 */

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Textarea } from '@/components/ui/textarea';
import { Send, AlertCircle, Loader2, Mail, AlertTriangle } from 'lucide-react';
import { EmailPreview } from './EmailPreview';

export type DeliveryMethod = 'sms' | 'email';
export type PoolStatus = 'good' | 'needs_attention';

/** Maximum character limit for custom notes */
export const CUSTOM_NOTE_MAX_LENGTH = 500;

export interface SendReportDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Callback when dialog is closed */
  onClose: () => void;
  /** Callback when user confirms sending - receives delivery method and optional custom note */
  onConfirm: (method: DeliveryMethod, customNote?: string) => Promise<void>;
  /** Customer's phone number (E.164 format) */
  customerPhone?: string;
  /** Customer's email address */
  customerEmail?: string;
  /** Customer's name for email preview */
  customerName?: string;
  /** Service date for email preview (MM/DD/YYYY format) */
  serviceDate?: string;
  /** Preview of the SMS message that will be sent */
  messagePreview: string;
  /** Whether the send operation is in progress */
  isLoading?: boolean;
  /** Error message to display (from Telnyx or validation) */
  error?: string;
  /** Whether this is a re-send (report was previously sent) */
  isResend?: boolean;
  /** Pool status - determines if custom note input is shown */
  poolStatus?: PoolStatus;
  /** Callback when custom note changes */
  onCustomNoteChange?: (note: string) => void;
  /** Initial custom note value */
  customNote?: string;
  /** Whether to show the note input field (overrides automatic detection) */
  showNoteInput?: boolean;
}

/**
 * SendReportDialog displays a confirmation dialog before sending a report.
 * 
 * Features:
 * - Choose delivery method (SMS or Email)
 * - Shows masked phone number or email address
 * - Displays message preview
 * - Pool status detection with custom note input for issues
 * - Character limit validation for custom notes
 * - Confirm and cancel buttons
 * - Loading state during send operation
 * - Error message display
 * 
 * Requirements:
 * - 2.2: Display confirmation dialog with recipient and message preview
 * - 2.6: Show error if no contact method on file
 * - 2.7: Display API errors
 * - 2.8: Show success confirmation (handled by parent after dialog closes)
 * - 2.1, 4.1: Show simple confirmation for good status
 * - 2.5, 4.2: Show custom note input for needs_attention status
 * - 4.3: Validate custom note is not empty when issues present
 */
export function SendReportDialog({
  isOpen,
  onClose,
  onConfirm,
  customerPhone,
  customerEmail,
  customerName,
  serviceDate,
  messagePreview,
  isLoading = false,
  error,
  isResend = false,
  poolStatus = 'good',
  onCustomNoteChange,
  customNote: externalCustomNote,
  showNoteInput,
}: SendReportDialogProps) {
  const [internalLoading, setInternalLoading] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState<DeliveryMethod>('sms');
  const [internalCustomNote, setInternalCustomNote] = useState('');
  const [noteValidationError, setNoteValidationError] = useState<string | null>(null);
  
  // Use external custom note if provided, otherwise use internal state
  const customNote = externalCustomNote !== undefined ? externalCustomNote : internalCustomNote;
  
  // Determine if note input should be shown
  const shouldShowNoteInput = showNoteInput !== undefined 
    ? showNoteInput 
    : poolStatus === 'needs_attention';
  
  // Use external loading state if provided, otherwise use internal
  const loading = isLoading || internalLoading;
  
  const hasEmail = Boolean(customerEmail && customerEmail.trim().length > 0);
  
  // Auto-select available method
  const availableMethods = {
    sms: false, // Disable SMS for now due to Twilio issues
    email: hasEmail,
  };
  
  // Auto-select email as the default method
  useEffect(() => {
    setSelectedMethod('email');
  }, []);
  
  // Reset internal state when dialog opens/closes
  useEffect(() => {
    if (!isOpen) {
      setInternalCustomNote('');
      setNoteValidationError(null);
    }
  }, [isOpen]);
  
  const canSend = availableMethods[selectedMethod];
  
  // Validate custom note
  const validateCustomNote = (): boolean => {
    if (shouldShowNoteInput) {
      if (!customNote || customNote.trim().length === 0) {
        setNoteValidationError('Please add a note about what needs attention');
        return false;
      }
      if (customNote.length > CUSTOM_NOTE_MAX_LENGTH) {
        setNoteValidationError(`Note must be ${CUSTOM_NOTE_MAX_LENGTH} characters or less`);
        return false;
      }
    }
    setNoteValidationError(null);
    return true;
  };
  
  // Check if send button should be disabled
  const isNoteValid = !shouldShowNoteInput || (customNote && customNote.trim().length > 0 && customNote.length <= CUSTOM_NOTE_MAX_LENGTH);
  const canSendWithValidation = canSend && isNoteValid;
  
  const handleCustomNoteChange = (value: string) => {
    // Clear validation error when user starts typing
    if (noteValidationError) {
      setNoteValidationError(null);
    }
    
    if (onCustomNoteChange) {
      onCustomNoteChange(value);
    } else {
      setInternalCustomNote(value);
    }
  };

  const handleConfirm = async () => {
    if (!canSend || loading) return;
    
    // Validate custom note before sending
    if (!validateCustomNote()) {
      return;
    }
    
    setInternalLoading(true);
    try {
      await onConfirm(selectedMethod, shouldShowNoteInput ? customNote : undefined);
    } finally {
      setInternalLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      // Clear state on close
      setInternalCustomNote('');
      setNoteValidationError(null);
      onClose();
    }
  };
  
  const characterCount = customNote?.length || 0;
  const isOverLimit = characterCount > CUSTOM_NOTE_MAX_LENGTH;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-[90%] sm:max-w-md rounded-xl">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <Send className="w-4 h-4 text-cyan-600" />
            {isResend ? 'Resend Service Report' : 'Send Service Report'}
          </DialogTitle>
          <DialogDescription className="text-sm">
            {isResend 
              ? 'Send another copy of this service report.'
              : 'Send this service report to your customer.'
            }
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Pool Status Indicator */}
          {poolStatus && (
            <div 
              className={`flex items-center gap-2 p-3 rounded-lg border ${
                poolStatus === 'good' 
                  ? 'bg-green-50 border-green-200' 
                  : 'bg-amber-50 border-amber-200'
              }`}
              data-testid="pool-status-indicator"
            >
              {poolStatus === 'good' ? (
                <>
                  <div className="w-2 h-2 rounded-full bg-green-500" />
                  <span className="text-sm text-green-700 font-medium">Pool Status: Everything is Perfect ✓</span>
                </>
              ) : (
                <>
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  <span className="text-sm text-amber-700 font-medium">Pool Status: Needs Attention</span>
                </>
              )}
            </div>
          )}

          {/* Custom Note Input - Requirements: 2.1, 2.5, 4.1, 4.2 */}
          {shouldShowNoteInput && (
            <div className="space-y-2" data-testid="custom-note-section">
              <div className="flex items-center justify-between">
                <label 
                  htmlFor="custom-note" 
                  className="text-xs text-slate-500 font-medium"
                >
                  Technician Notes <span className="text-red-500">*</span>
                </label>
                <span 
                  className={`text-xs ${isOverLimit ? 'text-red-500' : 'text-slate-400'}`}
                  data-testid="character-counter"
                >
                  {characterCount}/{CUSTOM_NOTE_MAX_LENGTH}
                </span>
              </div>
              <Textarea
                id="custom-note"
                placeholder="Describe what needs attention (e.g., 'pH levels are high, recommend adding acid')"
                value={customNote}
                onChange={(e) => handleCustomNoteChange(e.target.value)}
                className={`min-h-[100px] text-sm ${
                  noteValidationError || isOverLimit 
                    ? 'border-red-300 focus-visible:ring-red-500' 
                    : ''
                }`}
                disabled={loading}
                data-testid="custom-note-input"
                aria-describedby={noteValidationError ? 'note-error' : undefined}
                aria-invalid={!!noteValidationError || isOverLimit}
              />
              {noteValidationError && (
                <p 
                  id="note-error" 
                  className="text-xs text-red-500"
                  data-testid="note-validation-error"
                >
                  {noteValidationError}
                </p>
              )}
            </div>
          )}

          {/* Delivery Method Selection - Email Only */}
          {hasEmail && (
            <div className="space-y-2">
              <div className="text-xs text-slate-500 font-medium">Delivery Method</div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  disabled={loading}
                  className="flex-1 bg-cyan-600 hover:bg-cyan-700"
                  data-testid="email-method-button"
                  aria-pressed={true}
                  aria-label="Send via Email"
                >
                  <Mail className="w-3.5 h-3.5 mr-1.5" />
                  Email
                </Button>
              </div>
            </div>
          )}

          {/* Recipient Display */}
          <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
            <Mail className="w-4 h-4 text-slate-500 flex-shrink-0" />
            <div>
              <div className="text-xs text-slate-500 font-medium">Sending to</div>
              <div 
                className={`text-sm ${canSend ? 'text-slate-900' : 'text-red-600'}`}
                data-testid="recipient-display"
              >
                {customerEmail || 'No email on file'}
              </div>
            </div>
          </div>

          {/* Email Preview - Requirements: 4.4 */}
          {customerName && serviceDate && (
            <EmailPreview
              customerName={customerName}
              serviceDate={serviceDate}
              poolStatus={poolStatus}
              customNote={shouldShowNoteInput ? customNote : undefined}
            />
          )}
          
          {/* Fallback preview when customer name or service date not available */}
          {(!customerName || !serviceDate) && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium">
                <Mail className="w-3.5 h-3.5" />
                Email Preview
              </div>
              <div 
                className="p-3 bg-blue-50 rounded-lg border border-blue-200 text-sm text-slate-700"
                data-testid="email-preview"
              >
                <div className="text-xs font-medium mb-1">Subject:</div>
                <div className="text-xs mb-2">Pool Service Completed</div>
                <div className="text-xs font-medium mb-1">Message:</div>
                <div className="text-xs whitespace-pre-wrap">
                  {messagePreview || 'Your pool service has been completed. Click the link below to view your detailed service report with chemical readings and photos.'}
                </div>
                {shouldShowNoteInput && customNote && customNote.trim() && (
                  <div className="mt-2 pt-2 border-t border-blue-200">
                    <div className="text-xs font-medium mb-1">Technician Notes:</div>
                    <div className="text-xs whitespace-pre-wrap text-amber-700" data-testid="preview-custom-note">
                      {customNote}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Error Display - Requirements: 2.6, 2.7 */}
          {error && (
            <Alert variant="destructive" className="py-2">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs" data-testid="error-message">
                {error}
              </AlertDescription>
            </Alert>
          )}

          {/* No Email Warning */}
          {!canSend && !error && (
            <Alert variant="destructive" className="py-2">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                No email address on file. Please add an email address to send reports.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={loading}
            className="text-sm"
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!canSendWithValidation || loading}
            className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white text-sm"
            data-testid="confirm-send-button"
          >
            {loading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send className="w-3.5 h-3.5 mr-1.5" />
                {isResend ? 'Resend Report' : 'Send Report'}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default SendReportDialog;
