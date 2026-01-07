# Requirements Document

## Introduction

This feature enables pool service technicians to view service photos in the service log history and send service reports (with photos and chemical readings) to customers via SMS. This transforms the proof-of-service photo capture from a documentation tool into a customer communication feature that builds trust and transparency.

## Glossary

- **Service_Report**: A formatted summary of a service visit including chemical readings, notes, and photos
- **Service_Log_Card**: The UI component that displays a service log entry in the customer detail view
- **Photo_Gallery**: A component that displays before/after photos for a service log
- **SMS_Notification**: A text message sent to a customer's phone number via Telnyx API containing service report information
- **Telnyx**: The SMS provider used for sending text messages to customers
- **Report_Link**: A unique URL that allows customers to view their full service report with photos

## Requirements

### Requirement 1: Display Photos in Service Log History

**User Story:** As a pool service technician, I want to see photos attached to previous service logs, so that I can review what was documented during past visits.

#### Acceptance Criteria

1. WHEN a service log has associated photos, THE Service_Log_Card SHALL display a photo indicator showing the count of before and after photos
2. WHEN a user expands a service log entry, THE Service_Log_Card SHALL display a Photo_Gallery showing all associated photos
3. WHEN photos are displayed, THE Photo_Gallery SHALL group photos by category (before/after) with clear labels
4. WHEN a user taps on a photo thumbnail, THE Photo_Gallery SHALL display the full-size photo in a lightbox view
5. IF a service log has no associated photos, THEN THE Service_Log_Card SHALL not display any photo-related UI elements

### Requirement 2: Send Service Report via SMS

**User Story:** As a pool service technician, I want to send a service report to my customer via SMS, so that they are informed about the work completed and can see photos of their pool.

#### Acceptance Criteria

1. WHEN viewing a service log, THE System SHALL provide a "Send Report" button
2. WHEN a user taps "Send Report", THE System SHALL display a confirmation dialog showing the customer's phone number and a preview of the SMS message content
3. THE SMS message preview SHALL include: business name, service date, overall pool status (good/needs attention), and the Report_Link
4. WHEN the user confirms sending, THE System SHALL generate a unique Report_Link for the service report
5. WHEN the user confirms sending, THE System SHALL send an SMS via Telnyx to the customer's phone number containing the previewed message
6. IF the customer has no phone number on file, THEN THE System SHALL display an error message prompting the user to add a phone number
7. IF the Telnyx API returns an error, THEN THE System SHALL display the error message to the user
8. WHEN an SMS is sent successfully, THE System SHALL display a success confirmation to the user

### Requirement 3: Customer-Facing Service Report Page

**User Story:** As a pool service customer, I want to view my service report via a link, so that I can see the details of the work performed and photos of my pool.

#### Acceptance Criteria

1. WHEN a customer opens a Report_Link, THE System SHALL display the service report without requiring login
2. THE Service_Report page SHALL display the service date and technician name
3. THE Service_Report page SHALL display all chemical readings with visual indicators (good/low/high/critical)
4. THE Service_Report page SHALL display any service notes
5. THE Service_Report page SHALL display all before and after photos in a gallery format
6. THE Service_Report page SHALL be mobile-responsive and achieve Largest Contentful Paint (LCP) under 2.5 seconds on 4G connections
7. Report_Links SHALL not expire and SHALL remain accessible indefinitely

### Requirement 4: Phone Number Management

**User Story:** As a pool service technician, I want to store customer phone numbers, so that I can send them service reports.

#### Acceptance Criteria

1. THE Customer record SHALL include an optional phone_number field
2. WHEN creating a new customer, THE System SHALL allow entering an optional phone number
3. WHEN editing a customer, THE System SHALL allow entering and updating the phone number
4. WHEN entering or editing a phone number, THE System SHALL validate it is a valid phone number format
5. THE System SHALL store phone numbers in E.164 format for SMS compatibility

### Requirement 5: Report History Tracking

**User Story:** As a pool service technician, I want to see which reports have been sent to customers, so that I know the communication history.

#### Acceptance Criteria

1. WHEN a service report has been sent, THE Service_Log_Card SHALL display a "Report Sent" indicator with the sent date
2. THE System SHALL allow re-sending a report if needed
3. WHEN re-sending a report, THE System SHALL use the same Report_Link (not generate a new one)
