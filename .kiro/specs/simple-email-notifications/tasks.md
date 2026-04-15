# Implementation Plan: Simple Email Notifications

## Overview

Implement a simplified email notification system that sends clean, focused notifications about pool service completion. The system will automatically detect pool status and provide appropriate messaging with optional custom notes for issues.

## Tasks

- [x] 1. Update email template generation in backend
- [x] 1.1 Create simplified email template functions
  - Modify `sendViaEmail` function in `convex/serviceReports.ts`
  - Create `generateSimpleEmailContent` helper function
  - Implement good status and needs attention templates
  - Update branding to use "Dominick Pool Solutions"
  - Add custom footer text
  - _Requirements: 1.1, 1.2, 3.2, 3.6, 3.7_

- [x] 1.2 Write property test for email content generation
  - **Property 1: Email Content Generation**
  - **Validates: Requirements 1.1, 1.2, 3.2, 3.6, 3.7**

- [x] 1.3 Remove complex report elements from email templates
  - Remove "View Full Report" buttons and links
  - Remove detailed chemical readings display
  - Simplify email structure to focus on service completion
  - _Requirements: 1.4_

- [x] 1.4 Write property test for email content exclusions
  - **Property 2: Email Content Exclusions**
  - **Validates: Requirements 1.4**

- [x] 2. Enhance SendReportDialog component
- [x] 2.1 Add pool status detection and custom note input
  - Update `SendReportDialogProps` interface to include pool status
  - Add conditional custom note input field for needs_attention status
  - Implement character limit validation (500 characters)
  - Add note input UI with character counter
  - _Requirements: 2.1, 2.5, 4.1, 4.2_

- [x] 2.2 Write property test for dialog behavior
  - **Property 5: Dialog Behavior**
  - **Validates: Requirements 4.1, 4.2**

- [x] 2.3 Implement custom note validation
  - Add validation for empty notes when status is needs_attention
  - Show error messages for invalid input
  - Disable send button when validation fails
  - _Requirements: 2.4, 4.3_

- [x] 2.4 Write property test for input validation
  - **Property 4: Input Validation**
  - **Validates: Requirements 2.4, 4.3**

- [x] 3. Update email generation logic
- [x] 3.1 Implement custom note handling in email content
  - Modify email generation to include custom notes for needs_attention status
  - Add fallback generic message when no custom note provided
  - Ensure proper HTML escaping for custom notes
  - _Requirements: 2.2, 2.3_

- [x] 3.2 Write property test for custom note integration
  - **Property 3: Custom Note Email Integration**
  - **Validates: Requirements 2.2, 2.3**

- [x] 3.3 Add email preview functionality
  - Create preview component that shows email content before sending
  - Ensure preview matches actual email content exactly
  - Display preview in dialog before send confirmation
  - _Requirements: 4.4_

- [x] 3.4 Write property test for email preview accuracy
  - **Property 6: Email Preview Accuracy**
  - **Validates: Requirements 4.4**

- [x] 4. Update parent component integration
- [x] 4.1 Modify CustomerDetail.jsx to pass pool status to dialog
  - Extract pool status determination logic from existing code
  - Pass pool status and custom note handling to SendReportDialog
  - Update dialog event handlers for custom notes
  - _Requirements: 2.1, 4.1, 4.2_

- [x] 4.2 Implement cancel behavior protection
  - Ensure dialog cancellation prevents email sending
  - Add proper cleanup of custom note state on cancel
  - Test cancel behavior doesn't trigger send operations
  - _Requirements: 4.5_

- [x] 4.3 Write property test for cancel prevention
  - **Property 7: Cancel Prevention**
  - **Validates: Requirements 4.5**

- [x] 5. Ensure backward compatibility
- [x] 5.1 Test with existing customer data and email infrastructure
  - Verify new system works with existing customer email addresses
  - Ensure SendGrid integration remains functional
  - Maintain existing email delivery tracking
  - Preserve existing email preferences and settings
  - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [x] 5.2 Write property test for backward compatibility
  - **Property 8: Backward Compatibility**
  - **Validates: Requirements 5.1, 5.2, 5.3, 5.4**

- [x] 5.3 Implement error handling for missing email addresses
  - Update error messages for customers without email addresses
  - Ensure appropriate error display in dialog
  - Test error handling with various edge cases
  - _Requirements: 5.5_

- [x] 5.4 Write property test for error message display
  - **Property 9: Error Message Display**
  - **Validates: Requirements 5.5**

- [x] 6. Checkpoint - Ensure all tests pass
- All property tests pass for email content generation, exclusions, custom note integration, input validation, dialog behavior, email preview accuracy, cancel prevention, backward compatibility, and error message display.

- [x] 7. Integration and final testing
- [x] 7.1 Test complete email flow with different pool statuses
  - Good status emails verified with simple notification
  - Needs attention emails verified with custom notes
  - Needs attention emails verified without custom notes (generic message)
  - Branding and footer text verified in all scenarios
  - _Requirements: All requirements_

- [x] 7.2 Write integration tests for complete email flow
  - Property tests cover end-to-end email generation with different scenarios
  - UI interactions and email generation tested via SendReportDialog.property.test.tsx
  - Backend email generation tested via serviceReports.property.test.ts
  - Email preview accuracy tested via emailPreview.test.ts
  - Backward compatibility tested via emailBackwardCompatibility.property.test.ts
  - Error handling tested via emailErrorDisplay.property.test.ts
  - _Requirements: All requirements_

- [x] 8. Final checkpoint - Ensure all tests pass
- All tests pass. Feature implementation complete.

## Notes

- All tasks are required for comprehensive implementation
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- The system maintains backward compatibility with existing email infrastructure
- Custom notes are validated but not persisted to database (temporary UI state only)