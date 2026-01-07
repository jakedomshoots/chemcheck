# Implementation Plan: Customer Service Reports

## Overview

This plan implements photo display in service log history and SMS service reports via Telnyx. Tasks are ordered to build foundational components first, then integrate them into the UI.

## Tasks

- [x] 1. Add serviceReports table and phone validation utilities
  - [x] 1.1 Add serviceReports table to Convex schema
    - Add table with service_log_id, customer_id, report_token, sent_at, sent_to_phone, created_at
    - Add indexes for by_service_log and by_token queries
    - _Requirements: 2.4, 5.3_
  - [x] 1.2 Create phone validation utility
    - Implement validatePhoneNumber function
    - Implement normalizeToE164 function for US phone numbers
    - Handle various input formats (with/without country code, dashes, spaces, parentheses)
    - _Requirements: 4.4, 4.5_
  - [x] 1.3 Write property tests for phone validation
    - **Property 6: Phone number validation and normalization**
    - **Validates: Requirements 4.4, 4.5**

- [x] 2. Create SMS message formatter and report token generator
  - [x] 2.1 Implement SMS message formatter
    - Create formatSmsMessage function
    - Include business name, service date, pool status, and report link
    - Keep message under 160 characters when possible
    - _Requirements: 2.3_
  - [x] 2.2 Implement report token generator
    - Create generateReportToken function using crypto.randomUUID
    - Ensure tokens are URL-safe
    - _Requirements: 2.4_
  - [x] 2.3 Write property tests for SMS formatter and token generator
    - **Property 3: SMS message content completeness**
    - **Property 4: Report link uniqueness**
    - **Validates: Requirements 2.2, 2.3, 2.4**

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Create Convex mutations for service reports
  - [x] 4.1 Create getOrCreateReport mutation
    - Check if report exists for service_log_id
    - If exists, return existing report (for re-send)
    - If not, create new report with generated token
    - _Requirements: 2.4, 5.3_
  - [x] 4.2 Create sendReport action with Telnyx integration
    - Validate customer has phone number
    - Call Telnyx API to send SMS
    - Update report with sent_at and sent_to_phone
    - Handle and return Telnyx errors
    - _Requirements: 2.5, 2.6, 2.7, 2.8_
  - [x] 4.3 Create getReportByToken query for public page
    - Fetch report by token
    - Join with service log, customer, and photos
    - Return all data needed for public report page
    - _Requirements: 3.1_
  - [x] 4.4 Write property test for report token reuse
    - **Property 5: Report link reuse on re-send**
    - **Validates: Requirements 5.3**

- [x] 5. Create PhotoGallery component for service log history
  - [x] 5.1 Create PhotoGallery component
    - Accept photos array prop
    - Group photos by category (before/after)
    - Display thumbnails in grid layout
    - Add category labels
    - _Requirements: 1.2, 1.3_
  - [x] 5.2 Add lightbox functionality to PhotoGallery
    - Implement lightbox state management
    - Show full-size photo on thumbnail click
    - Add close button and keyboard navigation (Escape)
    - _Requirements: 1.4_
  - [x] 5.3 Write property tests for photo grouping
    - **Property 2: Photo gallery grouping**
    - **Validates: Requirements 1.2, 1.3**

- [x] 6. Enhance ServiceLogCard with photos and send report
  - [x] 6.1 Add photo indicator to ServiceLogCard
    - Fetch photos for service log
    - Display photo count badge when photos exist
    - Show before/after counts
    - Hide indicator when no photos
    - _Requirements: 1.1, 1.5_
  - [x] 6.2 Integrate PhotoGallery into expanded ServiceLogCard
    - Show PhotoGallery when card is expanded
    - Pass photos to gallery component
    - _Requirements: 1.2_
  - [x] 6.3 Add "Send Report" button to ServiceLogCard
    - Add button to expanded card view
    - Show "Report Sent" indicator if already sent
    - Display sent date
    - _Requirements: 2.1, 5.1_
  - [x] 6.4 Write property tests for photo indicator and sent indicator
    - **Property 1: Photo count indicator accuracy**
    - **Property 8: Report sent indicator accuracy**
    - **Validates: Requirements 1.1, 1.5, 5.1**

- [x] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Create SendReportDialog component
  - [x] 8.1 Create SendReportDialog component
    - Show customer phone (masked, last 4 digits visible)
    - Display SMS message preview
    - Add confirm and cancel buttons
    - Show loading state during send
    - Display error messages from Telnyx
    - _Requirements: 2.2, 2.6, 2.7, 2.8_
  - [x] 8.2 Wire SendReportDialog to ServiceLogCard
    - Open dialog on "Send Report" button click
    - Call sendReport mutation on confirm
    - Update UI on success
    - _Requirements: 2.1, 2.5_

- [x] 9. Create public Report Page
  - [x] 9.1 Create ReportPage component
    - Add route /report/:reportId
    - Fetch report data using token
    - Display loading and error states
    - _Requirements: 3.1_
  - [x] 9.2 Implement report content display
    - Show service date and technician name
    - Display chemical readings with status indicators
    - Show service notes if present
    - Render photo gallery with before/after sections
    - _Requirements: 3.2, 3.3, 3.4, 3.5_
  - [x] 9.3 Style report page for mobile responsiveness
    - Ensure responsive layout
    - Optimize image loading for performance
    - _Requirements: 3.6_
  - [x] 9.4 Write property tests for report page content
    - **Property 7: Report page content completeness**
    - **Validates: Requirements 3.2, 3.3, 3.4, 3.5**

- [x] 10. Add phone number field to customer forms
  - [x] 10.1 Add phone field to NewClient form
    - Add phone input with validation
    - Show validation errors
    - Normalize to E.164 on save
    - _Requirements: 4.1, 4.2, 4.4_
  - [x] 10.2 Add phone field to EditClient form
    - Add phone input with validation
    - Pre-populate existing phone
    - Normalize to E.164 on save
    - _Requirements: 4.3, 4.4_

- [x] 11. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All property-based tests are required for comprehensive validation
- Telnyx requires environment variables: TELNYX_API_KEY, TELNYX_MESSAGING_PROFILE_ID, TELNYX_FROM_NUMBER
- The existing `phone` field in customers table will be used (already in schema)
- Report links are intentionally public with unguessable tokens for customer convenience
