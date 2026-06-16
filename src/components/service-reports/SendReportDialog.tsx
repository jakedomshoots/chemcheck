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
import { Send, AlertCircle, Loader2, Mail, AlertTriangle, Image as ImageIcon, MessageSquare, WifiOff } from 'lucide-react';
import { EmailPreview } from './EmailPreview';
import { getEmailDeliveryValidationError } from '@/lib/emailValidation';

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
  /** Enabled delivery channels in UI (defaults to both if omitted) */
  enabledChannels?: DeliveryMethod[];
  /** Photos tied to this service log (local preview before sending) */
  attachedPhotos?: Array<{
    id: string;
    category: 'before' | 'after';
    url: string;
    timestamp?: string;
  }>;
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
  enabledChannels,
  attachedPhotos = [],
}: SendReportDialogProps) {
  const [internalLoading, setInternalLoading] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState<DeliveryMethod>('email');
  const [internalCustomNote, setInternalCustomNote] = useState('');
  const [noteValidationError, setNoteValidationError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);

  // Track online/offline state so the UI can explain queued sends.
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Use external custom note if provided, otherwise use internal state
  const customNote = externalCustomNote !== undefined ? externalCustomNote : internalCustomNote;
  
  // Show editable message input by default so users can customize outgoing text.
  const shouldShowNoteInput = showNoteInput !== undefined ? showNoteInput : true;
  const isNoteRequired = poolStatus === 'needs_attention';
  
  // Use external loading state if provided, otherwise use internal
  const loading = isLoading || internalLoading;
  
  const normalizedPhone = customerPhone?.trim() || '';
  const normalizedEmail = customerEmail?.trim() || '';
  const hasPhone = Boolean(normalizedPhone.length > 0);
  const normalizedPhoneDigits = normalizedPhone.replace(/[^\d]/g, '');
  const hasValidPhone = hasPhone && normalizedPhoneDigits.length >= 7 && normalizedPhoneDigits.length <= 15;
  const hasEmail = Boolean(normalizedEmail.length > 0);
  const emailValidationError = hasEmail ? getEmailDeliveryValidationError(normalizedEmail) : null;
  const hasValidEmail = hasEmail && !emailValidationError;
  
  const requestedChannels = Array.isArray(enabledChannels) && enabledChannels.length > 0
    ? enabledChannels
    : (['sms', 'email'] as DeliveryMethod[]);
  const canUseSmsChannel = requestedChannels.includes('sms');
  const canUseEmailChannel = requestedChannels.includes('email');

  const availableMethods = {
    sms: canUseSmsChannel && hasValidPhone,
    email: canUseEmailChannel && hasValidEmail,
  };
  const availableMethodOrder: DeliveryMethod[] = ['sms', 'email'];
  const firstAvailableMethod = availableMethodOrder.find((method) => availableMethods[method]) || null;
  
  // Auto-select the first available channel when the dialog opens.
  useEffect(() => {
    if (!isOpen) return;
    if (availableMethods[selectedMethod]) return;
    if (firstAvailableMethod) {
      setSelectedMethod(firstAvailableMethod);
    }
  }, [availableMethods.email, availableMethods.sms, firstAvailableMethod, isOpen, selectedMethod]);
  
  // Reset internal state when dialog opens/closes
  useEffect(() => {
    if (!isOpen) {
      setInternalCustomNote('');
      setNoteValidationError(null);
    }
  }, [isOpen]);
  
  const canSend = Boolean(availableMethods[selectedMethod]);
  const beforePhotos = attachedPhotos.filter((photo) => photo.category === 'before');
  const afterPhotos = attachedPhotos.filter((photo) => photo.category === 'after');
  
  // Validate custom note
  const validateCustomNote = (): boolean => {
    if (shouldShowNoteInput) {
      if (customNote.length > CUSTOM_NOTE_MAX_LENGTH) {
        setNoteValidationError(`Note must be ${CUSTOM_NOTE_MAX_LENGTH} characters or less`);
        return false;
      }
      if (isNoteRequired && (!customNote || customNote.trim().length === 0)) {
        setNoteValidationError('Please add a note about what needs attention');
        return false;
      }
    }
    setNoteValidationError(null);
    return true;
  };
  
  // Check if send button should be disabled
  const isNoteValid = !shouldShowNoteInput
    || (isNoteRequired
      ? (customNote && customNote.trim().length > 0 && customNote.length <= CUSTOM_NOTE_MAX_LENGTH)
      : customNote.length <= CUSTOM_NOTE_MAX_LENGTH);
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
      const trimmedNote = customNote?.trim() || '';
      await onConfirm(selectedMethod, trimmedNote.length > 0 ? trimmedNote : undefined);
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
  const selectedRecipient = selectedMethod === 'sms' ? normalizedPhone : normalizedEmail;
  const selectedChannelError = selectedMethod === 'sms'
    ? (!hasPhone ? 'No phone number on file. Please add a phone number to send SMS reports.' : (!hasValidPhone ? 'The phone number on file appears invalid. Please update it before sending.' : null))
    : (!hasEmail
      ? 'No email address on file. Please add an email address to send reports.'
      : (emailValidationError || 'The email on file is invalid. Please update it before sending.'));

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-[90%] sm:max-w-md rounded-xl max-h-[90vh] overflow-y-auto">
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
                  {isNoteRequired ? (
                    <>Technician Notes <span className="text-red-500">*</span></>
                  ) : (
                    <>Custom Message <span className="text-slate-400">(optional)</span></>
                  )}
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
                placeholder={
                  isNoteRequired
                    ? "Describe what needs attention (e.g., 'pH levels are high, recommend adding acid')"
                    : "Add a personal message for the customer (optional)"
                }
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

          {/* Delivery Method Selection */}
          {(canUseSmsChannel || canUseEmailChannel) && (
            <div className="space-y-2">
              <div className="text-xs text-slate-500 font-medium">Delivery Method</div>
              <div className="flex gap-2">
                {canUseSmsChannel && (
                  <Button
                    type="button"
                    variant={selectedMethod === 'sms' ? 'default' : 'outline'}
                    size="sm"
                    disabled={loading || !availableMethods.sms}
                    onClick={() => setSelectedMethod('sms')}
                    className={selectedMethod === 'sms' ? 'flex-1 bg-cyan-600 hover:bg-cyan-700' : 'flex-1'}
                    data-testid="sms-method-button"
                    aria-pressed={selectedMethod === 'sms'}
                    aria-label="Send via SMS"
                  >
                    <MessageSquare className="w-3.5 h-3.5 mr-1.5" />
                    SMS
                  </Button>
                )}
                <Button
                  type="button"
                  variant={selectedMethod === 'email' ? 'default' : 'outline'}
                  size="sm"
                  disabled={loading || !availableMethods.email}
                  onClick={() => setSelectedMethod('email')}
                  className={selectedMethod === 'email' ? 'flex-1 bg-cyan-600 hover:bg-cyan-700' : 'flex-1'}
                  data-testid="email-method-button"
                  aria-pressed={selectedMethod === 'email'}
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
            {selectedMethod === 'sms' ? (
              <MessageSquare className="w-4 h-4 text-slate-500 flex-shrink-0" />
            ) : (
              <Mail className="w-4 h-4 text-slate-500 flex-shrink-0" />
            )}
            <div>
              <div className="text-xs text-slate-500 font-medium">
                Sending to {selectedMethod === 'sms' ? 'phone' : 'email'}
              </div>
              <div 
                className={`text-sm ${canSend ? 'text-slate-900' : 'text-red-600'}`}
                data-testid="recipient-display"
              >
                {selectedRecipient || `No ${selectedMethod === 'sms' ? 'phone' : 'email'} on file`}
              </div>
            </div>
          </div>
          {selectedMethod === 'email' && emailValidationError && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1">
              {emailValidationError}
            </p>
          )}

          {/* Pre-send photo preview */}
          {attachedPhotos.length > 0 && (
            <div className="space-y-2" data-testid="attached-photos-preview">
              <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium">
                <ImageIcon className="w-3.5 h-3.5" />
                Attached Photos ({attachedPhotos.length})
              </div>

              {beforePhotos.length > 0 && (
                <div>
                  <div className="text-[11px] text-slate-500 mb-1">Before ({beforePhotos.length})</div>
                  <div className="grid grid-cols-3 gap-2">
                    {beforePhotos.map((photo) => (
                      <img
                        key={photo.id}
                        src={photo.url}
                        alt="Before service"
                        className="w-full h-20 object-cover rounded-md border border-slate-200"
                        loading="lazy"
                      />
                    ))}
                  </div>
                </div>
              )}

              {afterPhotos.length > 0 && (
                <div>
                  <div className="text-[11px] text-slate-500 mb-1">After ({afterPhotos.length})</div>
                  <div className="grid grid-cols-3 gap-2">
                    {afterPhotos.map((photo) => (
                      <img
                        key={photo.id}
                        src={photo.url}
                        alt="After service"
                        className="w-full h-20 object-cover rounded-md border border-slate-200"
                        loading="lazy"
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

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

          {/* Offline Queue Notice - Phase 2.5 */}
          {!isOnline && (
            <Alert className="py-2 bg-amber-50 border-amber-200 text-amber-700">
              <WifiOff className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-xs" data-testid="offline-queue-notice">
                You appear offline. Tapping Send will queue this report and it will send automatically when connectivity returns.
              </AlertDescription>
            </Alert>
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
                {selectedChannelError}
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
                {isOnline ? 'Sending...' : 'Queuing...'}
              </>
            ) : (
              <>
                <Send className="w-3.5 h-3.5 mr-1.5" />
                {!isOnline
                  ? (isResend ? 'Queue Resend' : 'Queue Report')
                  : (isResend ? 'Resend Report' : 'Send Report')}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
