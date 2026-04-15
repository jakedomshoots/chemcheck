# Requirements Document

## Introduction

Improve the customer email notification system to provide simple, clean notifications about pool service completion. Replace the current complex email template with a streamlined notification that focuses on service completion status and optional custom notes for issues.

## Glossary

- **Simple_Email_System**: The improved email notification system that sends basic service completion notifications
- **Service_Status**: The overall condition of the pool after service (perfect/needs_attention)
- **Custom_Note**: Optional technician-provided message for when issues are found
- **Service_Notification**: Basic email informing customer that pool service was completed

## Requirements

### Requirement 1: Simple Service Completion Notification

**User Story:** As a customer, I want to receive a simple email notification when my pool service is completed, so that I know the work has been done without unnecessary complexity.

#### Acceptance Criteria

1. WHEN a service is completed with no issues, THE Simple_Email_System SHALL send a clean notification stating the pool was serviced and everything is perfect
2. WHEN sending a notification, THE Simple_Email_System SHALL include the service date and business name
3. WHEN sending a notification, THE Simple_Email_System SHALL use a professional but simple email template
4. THE Simple_Email_System SHALL NOT include complex report links or detailed chemical readings in the basic notification
5. WHEN the email is sent, THE Simple_Email_System SHALL use a clear subject line indicating service completion

### Requirement 2: Custom Note for Issues

**User Story:** As a technician, I want to add a custom note to the email when there are pool issues, so that I can communicate specific problems or recommendations to the customer.

#### Acceptance Criteria

1. WHEN the pool status indicates issues, THE Simple_Email_System SHALL provide an option to add a custom note before sending
2. WHEN a custom note is provided, THE Simple_Email_System SHALL include it prominently in the email notification
3. WHEN no custom note is provided for issues, THE Simple_Email_System SHALL include a generic message about pool attention needed
4. THE Simple_Email_System SHALL validate that custom notes are not empty when issues are present
5. WHEN displaying the custom note input, THE Simple_Email_System SHALL provide a text area with reasonable character limits

### Requirement 3: Streamlined Email Template

**User Story:** As a customer, I want to receive clean, easy-to-read email notifications, so that I can quickly understand my pool service status without information overload.

#### Acceptance Criteria

1. THE Simple_Email_System SHALL use a minimal email template with clear typography and spacing
2. WHEN the pool is in good condition, THE Simple_Email_System SHALL display a positive status message
3. WHEN the pool needs attention, THE Simple_Email_System SHALL display an attention-needed message with the custom note
4. THE Simple_Email_System SHALL include business contact information for customer questions
5. THE Simple_Email_System SHALL maintain consistent branding with the existing app design
6. THE Simple_Email_System SHALL use "Dominick Pool Solutions" as the business name in email content
7. THE Simple_Email_System SHALL include footer text "This email is powered by ChemCheck Pool Software built by Dominick Pool Solutions"

### Requirement 4: Improved Send Dialog

**User Story:** As a technician, I want an improved send dialog that allows me to add notes for issues, so that I can customize the customer communication before sending.

#### Acceptance Criteria

1. WHEN the pool status is good, THE Simple_Email_System SHALL show a simple send confirmation dialog
2. WHEN the pool status needs attention, THE Simple_Email_System SHALL show a dialog with a custom note input field
3. WHEN the custom note field is displayed, THE Simple_Email_System SHALL require input before allowing send
4. THE Simple_Email_System SHALL provide a preview of the email content before sending
5. WHEN the user cancels the dialog, THE Simple_Email_System SHALL not send any notification

### Requirement 5: Backward Compatibility

**User Story:** As a system administrator, I want the new email system to work with existing customer data, so that the transition is seamless.

#### Acceptance Criteria

1. THE Simple_Email_System SHALL work with existing customer email addresses
2. THE Simple_Email_System SHALL use the existing SendGrid email infrastructure
3. THE Simple_Email_System SHALL maintain existing email delivery tracking
4. THE Simple_Email_System SHALL preserve existing email preferences and settings
5. WHEN customers have no email address, THE Simple_Email_System SHALL show appropriate error messages