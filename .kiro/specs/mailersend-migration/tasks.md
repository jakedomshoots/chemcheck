# Implementation Plan: Mailersend Migration

## Overview

Migrate the email sending functionality from SendGrid to Mailersend by updating the `sendViaEmail` helper function in `convex/serviceReports.ts` and updating the documentation.

## Tasks

- [x] 1. Update sendViaEmail function to use Mailersend API
  - [x] 1.1 Replace SendGrid API endpoint with Mailersend endpoint
    - Change URL from `https://api.sendgrid.com/v3/mail/send` to `https://api.mailersend.com/v1/email`
    - Update environment variable from `SENDGRID_API_KEY` to `MAILERSEND_API_KEY`
    - _Requirements: 1.1, 1.2_
  - [x] 1.2 Update request body format for Mailersend
    - Change from SendGrid's `personalizations` format to Mailersend's flat `to` array
    - Change from `content` array to separate `html` and `text` fields
    - _Requirements: 1.4, 2.5_
  - [x] 1.3 Write property test for request format
    - **Property 1: Request Format Correctness**
    - **Validates: Requirements 1.1, 1.4, 2.4, 2.5**

- [x] 2. Update error handling for Mailersend responses
  - [x] 2.1 Update error response parsing
    - Parse Mailersend error format (`errors[].message`)
    - Map HTTP status codes to user-friendly messages (401, 422, 429, 5xx)
    - Update console.error logging to reference Mailersend
    - _Requirements: 1.5, 4.1, 4.2, 4.5_
  - [x] 2.2 Write property test for error handling
    - **Property 4: Error Response Parsing**
    - **Validates: Requirements 1.5, 4.2, 4.5**

- [x] 3. Verify success response handling
  - [x] 3.1 Confirm x-message-id header extraction works with Mailersend
    - Mailersend uses same `x-message-id` header as SendGrid
    - Verify updateReportSent is called with correct parameters
    - _Requirements: 3.1, 3.2, 3.4, 3.5_
  - [x] 3.2 Write property test for success handling
    - **Property 3: Success Response Handling**
    - **Validates: Requirements 3.1, 3.2, 3.4, 3.5**

- [x] 4. Update configuration and documentation
  - [x] 4.1 Update EMAIL_SETUP.md documentation
    - Replace SendGrid instructions with Mailersend setup
    - Update environment variable names
    - Add Mailersend-specific configuration notes
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_
  - [x] 4.2 Update .env.example with new variable names
    - Replace `SENDGRID_API_KEY` with `MAILERSEND_API_KEY`
    - _Requirements: 5.2_

- [x] 5. Checkpoint - Verify implementation
  - Ensure all tests pass, ask the user if questions arise.
  - Test email sending manually with Mailersend API key

## Notes

- All tasks including property tests are required for comprehensive coverage
- The email content generation (`generateSimpleEmailContent`) remains unchanged
- The `FROM_EMAIL` environment variable is reused (no change needed)
- Mailersend requires domain verification similar to SendGrid
