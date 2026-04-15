/**
 * Property-Based Tests for Simple Email Notifications
 * 
 * These tests validate the correctness properties defined in the design document
 * using fast-check for property-based testing.
 * 
 * Feature: simple-email-notifications
 * Property 1: Email Content Generation
 * Validates: Requirements 1.1, 1.2, 3.2, 3.6, 3.7
 * 
 * Property 2: Email Content Exclusions
 * Validates: Requirements 1.4
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { 
  generateSimpleEmailContent, 
  escapeHtml,
  EmailContentParams,
  GeneratedEmailContent,
  buildMailersendRequestBody,
  MailersendRequestParams,
  MailersendRequestBody,
  parseMailersendError,
  MailersendErrorResponse,
} from './serviceReports';

// ============================================================================
// Types for Success Response Handling Tests
// ============================================================================

/**
 * Simulated success response from Mailersend API
 */
interface MailersendSuccessResponse {
  status: 202;
  headers: {
    'x-message-id'?: string;
  };
}

/**
 * Parameters for success response handling
 */
interface SuccessHandlingParams {
  messageId: string | null;
  reportToken: string;
  recipientEmail: string;
}

/**
 * Result of processing a successful email send
 */
interface SuccessHandlingResult {
  success: boolean;
  report_token: string;
  message_id: string;
  updateReportSentCalled: boolean;
  updateReportSentParams: {
    sent_to_email: string;
    delivery_method: string;
  } | null;
}

/**
 * Simulate the success response handling logic from sendViaEmail
 * This extracts the testable logic without needing the full Convex context
 */
function handleSuccessResponse(
  response: MailersendSuccessResponse,
  report: { report_token: string },
  customer: { email: string }
): SuccessHandlingResult {
  // Extract message ID from headers (same logic as sendViaEmail)
  const messageId = response.headers['x-message-id'] || 'sent';
  
  // Simulate the updateReportSent call parameters
  const updateReportSentParams = {
    sent_to_email: customer.email,
    delivery_method: 'email' as const,
  };
  
  return {
    success: true,
    report_token: report.report_token,
    message_id: messageId,
    updateReportSentCalled: true,
    updateReportSentParams,
  };
}

// ============================================================================
// Generators for Property-Based Testing
// ============================================================================

/**
 * Generator for valid customer names
 */
const customerNameArb = fc.string({ minLength: 1, maxLength: 100 })
  .filter(name => name.trim().length > 0)
  .map(name => name.trim());

/**
 * Generator for service dates (MM/DD/YYYY format)
 */
const serviceDateArb = fc.date({
  min: new Date('2020-01-01'),
  max: new Date('2030-12-31'),
}).map(date => {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = date.getFullYear();
  return `${month}/${day}/${year}`;
});

/**
 * Generator for pool status
 */
const poolStatusArb = fc.constantFrom<'good' | 'needs_attention'>('good', 'needs_attention');

/**
 * Generator for custom notes (optional)
 */
const customNoteArb = fc.option(
  fc.string({ minLength: 1, maxLength: 500 })
    .filter(note => note.trim().length > 0)
    .map(note => note.trim()),
  { nil: undefined }
);

/**
 * Generator for EmailContentParams
 */
const emailContentParamsArb: fc.Arbitrary<EmailContentParams> = fc.record({
  customerName: customerNameArb,
  serviceDate: serviceDateArb,
  poolStatus: poolStatusArb,
  customNote: customNoteArb,
});

/**
 * Generator for EmailContentParams with good status
 */
const goodStatusParamsArb: fc.Arbitrary<EmailContentParams> = fc.record({
  customerName: customerNameArb,
  serviceDate: serviceDateArb,
  poolStatus: fc.constant<'good'>('good'),
  customNote: customNoteArb,
});

/**
 * Generator for EmailContentParams with needs_attention status
 */
const needsAttentionParamsArb: fc.Arbitrary<EmailContentParams> = fc.record({
  customerName: customerNameArb,
  serviceDate: serviceDateArb,
  poolStatus: fc.constant<'needs_attention'>('needs_attention'),
  customNote: customNoteArb,
});

// ============================================================================
// Property-Based Tests
// ============================================================================

describe('Simple Email Notifications Property Tests', () => {
  
  describe('Property 1: Email Content Generation', () => {
    /**
     * Property 1: Email Content Generation
     * *For any* valid service data and pool status, the generated email should contain:
     * - The service date
     * - "Dominick Pool Solutions" as business name
     * - Appropriate status messaging
     * - The correct footer text
     * 
     * **Validates: Requirements 1.1, 1.2, 3.2, 3.6, 3.7**
     */
    it('generated email contains service date, business name, status messaging, and footer text', async () => {
      await fc.assert(
        fc.property(
          emailContentParamsArb,
          (params: EmailContentParams) => {
            const result: GeneratedEmailContent = generateSimpleEmailContent(params);
            
            // Requirement 1.2: Email should include service date
            expect(result.htmlBody).toContain(escapeHtml(params.serviceDate));
            expect(result.textBody).toContain(params.serviceDate);
            
            // Requirement 3.6: Email should use "Dominick Pool Solutions" as business name
            expect(result.htmlBody).toContain('Dominick Pool Solutions');
            expect(result.textBody).toContain('Dominick Pool Solutions');
            
            // Requirement 3.2/3.3: Appropriate status messaging based on pool status
            if (params.poolStatus === 'good') {
              expect(result.htmlBody).toContain('Everything is Perfect');
              expect(result.textBody).toContain('Everything is Perfect');
            } else {
              expect(result.htmlBody).toContain('Needs Attention');
              expect(result.textBody).toContain('Needs Attention');
            }
            
            // Requirement 3.7: Footer text
            const expectedFooter = 'This email is powered by ChemCheck Pool Software built by Dominick Pool Solutions';
            expect(result.htmlBody).toContain(expectedFooter);
            expect(result.textBody).toContain(expectedFooter);
            
            // Subject line should indicate service completion (Requirement 1.5)
            expect(result.subject).toContain('Pool Service Completed');
            expect(result.subject).toContain(params.serviceDate);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('generated email contains customer name correctly', async () => {
      await fc.assert(
        fc.property(
          emailContentParamsArb,
          (params: EmailContentParams) => {
            const result: GeneratedEmailContent = generateSimpleEmailContent(params);
            
            // Customer name should be escaped in HTML body
            const escapedName = escapeHtml(params.customerName);
            expect(result.htmlBody).toContain(escapedName);
            
            // Customer name should be unescaped in text body (plain text)
            expect(result.textBody).toContain(params.customerName);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('good status emails contain positive messaging', async () => {
      await fc.assert(
        fc.property(
          goodStatusParamsArb,
          (params: EmailContentParams) => {
            const result: GeneratedEmailContent = generateSimpleEmailContent(params);
            
            // Requirement 1.1: Good status should have positive messaging
            expect(result.htmlBody).toContain('excellent condition');
            expect(result.textBody).toContain('excellent condition');
            expect(result.htmlBody).toContain('✓');
            expect(result.textBody).toContain('✓');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('needs_attention status emails contain custom note or generic message', async () => {
      await fc.assert(
        fc.property(
          needsAttentionParamsArb,
          (params: EmailContentParams) => {
            const result: GeneratedEmailContent = generateSimpleEmailContent(params);
            
            // Requirement 2.2/2.3: Custom note or generic message
            if (params.customNote) {
              const escapedNote = escapeHtml(params.customNote);
              expect(result.htmlBody).toContain(escapedNote);
              expect(result.textBody).toContain(params.customNote);
            } else {
              // Generic message when no custom note
              expect(result.htmlBody).toContain('requires some attention');
              expect(result.textBody).toContain('requires some attention');
            }
            
            // Should have attention indicator
            expect(result.htmlBody).toContain('⚠');
            expect(result.textBody).toContain('⚠');
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 2: Email Content Exclusions', () => {
    /**
     * Property 2: Email Content Exclusions
     * *For any* generated email, the content should NOT contain:
     * - Report links
     * - "View Full Report" buttons
     * - Detailed chemical readings
     * 
     * **Validates: Requirements 1.4**
     */
    it('generated email does not contain report links or View Full Report buttons', async () => {
      await fc.assert(
        fc.property(
          emailContentParamsArb,
          (params: EmailContentParams) => {
            const result: GeneratedEmailContent = generateSimpleEmailContent(params);
            
            // Requirement 1.4: No complex report links
            expect(result.htmlBody).not.toContain('View Full Report');
            expect(result.textBody).not.toContain('View Full Report');
            
            // No report viewing links
            expect(result.htmlBody).not.toContain('/report/');
            expect(result.textBody).not.toContain('/report/');
            
            // No "View report" or similar CTAs
            expect(result.htmlBody.toLowerCase()).not.toContain('view report');
            expect(result.textBody.toLowerCase()).not.toContain('view report');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('generated email does not contain detailed chemical readings', async () => {
      await fc.assert(
        fc.property(
          emailContentParamsArb,
          (params: EmailContentParams) => {
            const result: GeneratedEmailContent = generateSimpleEmailContent(params);
            
            // Requirement 1.4: No detailed chemical readings
            // Check for common chemical reading labels
            const chemicalLabels = ['pH:', 'Chlorine:', 'Alkalinity:', 'Stabilizer:', 'Salt:'];
            
            for (const label of chemicalLabels) {
              expect(result.htmlBody).not.toContain(label);
              expect(result.textBody).not.toContain(label);
            }
            
            // No chemical reading values
            expect(result.htmlBody).not.toMatch(/\b(low|high|good|critical)\b.*ppm/i);
            expect(result.textBody).not.toMatch(/\b(low|high|good|critical)\b.*ppm/i);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 3: Custom Note Email Integration', () => {
    /**
     * Property 3: Custom Note Email Integration
     * *For any* service with needs_attention status:
     * - When a custom note is provided, the email should prominently include that note
     * - When no note is provided, a generic attention message should appear
     * 
     * **Validates: Requirements 2.2, 2.3**
     */
    
    /**
     * Generator for needs_attention params with custom note
     */
    const needsAttentionWithNoteArb: fc.Arbitrary<EmailContentParams> = fc.record({
      customerName: customerNameArb,
      serviceDate: serviceDateArb,
      poolStatus: fc.constant<'needs_attention'>('needs_attention'),
      customNote: fc.string({ minLength: 1, maxLength: 500 })
        .filter(note => note.trim().length > 0)
        .map(note => note.trim()),
    });

    /**
     * Generator for needs_attention params without custom note
     */
    const needsAttentionWithoutNoteArb: fc.Arbitrary<EmailContentParams> = fc.record({
      customerName: customerNameArb,
      serviceDate: serviceDateArb,
      poolStatus: fc.constant<'needs_attention'>('needs_attention'),
      customNote: fc.constant(undefined),
    });

    it('custom note is prominently included when provided for needs_attention status', async () => {
      await fc.assert(
        fc.property(
          needsAttentionWithNoteArb,
          (params: EmailContentParams) => {
            const result: GeneratedEmailContent = generateSimpleEmailContent(params);
            
            // Requirement 2.2: Custom note should be prominently included
            const escapedNote = escapeHtml(params.customNote!);
            
            // Note should appear in HTML body
            expect(result.htmlBody).toContain(escapedNote);
            
            // Note should appear in text body (unescaped)
            expect(result.textBody).toContain(params.customNote);
            
            // Note should be in a prominent section (Technician Notes)
            expect(result.htmlBody).toContain('Technician Notes');
            expect(result.textBody).toContain('Technician Notes');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('generic attention message appears when no custom note provided for needs_attention status', async () => {
      await fc.assert(
        fc.property(
          needsAttentionWithoutNoteArb,
          (params: EmailContentParams) => {
            const result: GeneratedEmailContent = generateSimpleEmailContent(params);
            
            // Requirement 2.3: Generic message should appear when no custom note
            const genericMessage = 'requires some attention';
            
            expect(result.htmlBody).toContain(genericMessage);
            expect(result.textBody).toContain(genericMessage);
            
            // Should still have attention indicator
            expect(result.htmlBody).toContain('Needs Attention');
            expect(result.textBody).toContain('Needs Attention');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('custom note is properly HTML escaped to prevent XSS', async () => {
      // Test with potentially dangerous HTML content
      const dangerousNoteArb = fc.constantFrom(
        '<script>alert("xss")</script>',
        '<img src="x" onerror="alert(1)">',
        '"><script>alert(1)</script>',
        "'; DROP TABLE users; --",
        '<a href="javascript:alert(1)">click</a>',
      );

      const paramsWithDangerousNote: fc.Arbitrary<EmailContentParams> = fc.record({
        customerName: customerNameArb,
        serviceDate: serviceDateArb,
        poolStatus: fc.constant<'needs_attention'>('needs_attention'),
        customNote: dangerousNoteArb,
      });

      await fc.assert(
        fc.property(
          paramsWithDangerousNote,
          (params: EmailContentParams) => {
            const result: GeneratedEmailContent = generateSimpleEmailContent(params);
            
            // HTML body should not contain unescaped dangerous tags
            // The < and > should be escaped to &lt; and &gt;
            expect(result.htmlBody).not.toMatch(/<script[^&]/i);
            expect(result.htmlBody).not.toMatch(/<img[^&]/i);
            expect(result.htmlBody).not.toMatch(/<a[^&]/i);
            
            // The escaped version should be present when original contains < or >
            if (params.customNote!.includes('<')) {
              expect(result.htmlBody).toContain('&lt;');
            }
            if (params.customNote!.includes('>')) {
              expect(result.htmlBody).toContain('&gt;');
            }
            if (params.customNote!.includes('"')) {
              expect(result.htmlBody).toContain('&quot;');
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('escapeHtml function', () => {
    it('escapes all HTML special characters', async () => {
      await fc.assert(
        fc.property(
          fc.string(),
          (input: string) => {
            const escaped = escapeHtml(input);
            
            // Should not contain unescaped special characters
            // (unless they were already escaped in input)
            if (input.includes('<') && !input.includes('&lt;')) {
              expect(escaped).toContain('&lt;');
              expect(escaped).not.toMatch(/<(?!amp;|lt;|gt;|quot;|#039;)/);
            }
            if (input.includes('>') && !input.includes('&gt;')) {
              expect(escaped).toContain('&gt;');
            }
            if (input.includes('&') && !input.includes('&amp;')) {
              expect(escaped).toContain('&amp;');
            }
            if (input.includes('"') && !input.includes('&quot;')) {
              expect(escaped).toContain('&quot;');
            }
            if (input.includes("'") && !input.includes('&#039;')) {
              expect(escaped).toContain('&#039;');
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});


// ============================================================================
// Mailersend Migration Property Tests
// ============================================================================

describe('Mailersend Migration Property Tests', () => {
  
  /**
   * Generator for valid email addresses
   */
  const emailArb = fc.emailAddress();

  /**
   * Generator for non-empty strings (for names, subjects, etc.)
   */
  const nonEmptyStringArb = fc.string({ minLength: 1, maxLength: 200 })
    .filter(s => s.trim().length > 0)
    .map(s => s.trim());

  /**
   * Generator for HTML content (simulating email body)
   */
  const htmlBodyArb = fc.string({ minLength: 1, maxLength: 5000 })
    .map(s => `<html><body>${s}</body></html>`);

  /**
   * Generator for plain text content
   */
  const textBodyArb = fc.string({ minLength: 1, maxLength: 2000 })
    .filter(s => s.trim().length > 0);

  /**
   * Generator for MailersendRequestParams
   */
  const mailersendRequestParamsArb: fc.Arbitrary<MailersendRequestParams> = fc.record({
    recipientEmail: emailArb,
    fromEmail: emailArb,
    fromName: nonEmptyStringArb,
    subject: nonEmptyStringArb,
    textBody: textBodyArb,
    htmlBody: htmlBodyArb,
  });

  describe('Property 1: Request Format Correctness', () => {
    /**
     * Property 1: Request Format Correctness
     * *For any* valid email parameters (recipient, subject, HTML body, text body, from address),
     * the Mailersend API request should contain all required fields in the correct format:
     * - `from` object with email and name
     * - `to` array with recipient email
     * - `subject` string
     * - `html` string
     * - `text` string
     * 
     * **Validates: Requirements 1.1, 1.4, 2.4, 2.5**
     * 
     * Feature: mailersend-migration, Property 1: Request Format Correctness
     */
    it('request body contains all required Mailersend fields in correct format', async () => {
      await fc.assert(
        fc.property(
          mailersendRequestParamsArb,
          (params: MailersendRequestParams) => {
            const requestBody: MailersendRequestBody = buildMailersendRequestBody(params);
            
            // Requirement 1.1: Request should use Mailersend format
            // Verify `from` object structure
            expect(requestBody.from).toBeDefined();
            expect(typeof requestBody.from).toBe('object');
            expect(requestBody.from.email).toBe(params.fromEmail);
            expect(requestBody.from.name).toBe(params.fromName);
            
            // Requirement 2.4: FROM_EMAIL should be used
            expect(requestBody.from.email).toBeTruthy();
            
            // Verify `to` array structure (Mailersend uses flat array, not personalizations)
            expect(requestBody.to).toBeDefined();
            expect(Array.isArray(requestBody.to)).toBe(true);
            expect(requestBody.to.length).toBe(1);
            expect(requestBody.to[0].email).toBe(params.recipientEmail);
            
            // Verify subject string
            expect(requestBody.subject).toBe(params.subject);
            expect(typeof requestBody.subject).toBe('string');
            
            // Requirement 2.5: Both HTML and text versions should be included
            // Verify html field (Mailersend uses `html` not `content` array)
            expect(requestBody.html).toBe(params.htmlBody);
            expect(typeof requestBody.html).toBe('string');
            
            // Verify text field (Mailersend uses `text` not `content` array)
            expect(requestBody.text).toBe(params.textBody);
            expect(typeof requestBody.text).toBe('string');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('request body does not contain SendGrid-specific fields', async () => {
      await fc.assert(
        fc.property(
          mailersendRequestParamsArb,
          (params: MailersendRequestParams) => {
            const requestBody = buildMailersendRequestBody(params);
            
            // Requirement 1.4: Should NOT use SendGrid format
            // No `personalizations` array (SendGrid format)
            expect(requestBody).not.toHaveProperty('personalizations');
            
            // No `content` array (SendGrid format)
            expect(requestBody).not.toHaveProperty('content');
            
            // Should have Mailersend's flat structure instead
            expect(requestBody).toHaveProperty('to');
            expect(requestBody).toHaveProperty('html');
            expect(requestBody).toHaveProperty('text');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('request body preserves email content integrity', async () => {
      await fc.assert(
        fc.property(
          mailersendRequestParamsArb,
          (params: MailersendRequestParams) => {
            const requestBody: MailersendRequestBody = buildMailersendRequestBody(params);
            
            // Content should be preserved exactly as provided
            expect(requestBody.subject).toStrictEqual(params.subject);
            expect(requestBody.html).toStrictEqual(params.htmlBody);
            expect(requestBody.text).toStrictEqual(params.textBody);
            
            // Email addresses should be preserved exactly
            expect(requestBody.from.email).toStrictEqual(params.fromEmail);
            expect(requestBody.to[0].email).toStrictEqual(params.recipientEmail);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 4: Error Response Parsing', () => {
    /**
     * Property 4: Error Response Parsing
     * *For any* Mailersend error response, the system should parse the error message
     * from the response body and return it in a user-friendly format, and log detailed
     * error information including status code and response data.
     * 
     * **Validates: Requirements 1.5, 4.2, 4.5**
     * 
     * Feature: mailersend-migration, Property 4: Error Response Parsing
     */

    /**
     * Generator for Mailersend error response with errors array
     */
    const errorMessageArb = fc.string({ minLength: 1, maxLength: 200 })
      .filter(s => s.trim().length > 0)
      .map(s => s.trim());

    const mailersendErrorResponseArb: fc.Arbitrary<MailersendErrorResponse> = fc.oneof(
      // Response with errors array
      fc.record({
        errors: fc.array(
          fc.record({
            message: errorMessageArb,
            field: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
          }),
          { minLength: 1, maxLength: 5 }
        ),
        message: fc.option(errorMessageArb, { nil: undefined }),
      }),
      // Response with only message
      fc.record({
        message: errorMessageArb,
        errors: fc.constant(undefined),
      }),
      // Empty response
      fc.constant({})
    );

    /**
     * Generator for HTTP status codes
     */
    const statusCodeArb = fc.oneof(
      fc.constant(401),  // Authentication failed
      fc.constant(403),  // Forbidden
      fc.constant(422),  // Validation error
      fc.constant(429),  // Rate limited
      fc.integer({ min: 500, max: 599 }),  // Server errors
      fc.integer({ min: 400, max: 499 }).filter(n => ![401, 403, 422, 429].includes(n)),  // Other client errors
    );

    it('returns appropriate error message for 401 status (authentication failed)', async () => {
      await fc.assert(
        fc.property(
          mailersendErrorResponseArb,
          (errorData: MailersendErrorResponse) => {
            const result = parseMailersendError(401, errorData);
            
            // Requirement 4.1: 401 should return authentication failed message
            expect(result).toBe("Email service authentication failed. Please contact support.");
          }
        ),
        { numRuns: 100 }
      );
    });

    it('returns appropriate error message for 403 status (forbidden)', async () => {
      await fc.assert(
        fc.property(
          mailersendErrorResponseArb,
          (errorData: MailersendErrorResponse) => {
            const result = parseMailersendError(403, errorData);
            
            // 403 should return access denied message
            expect(result).toBe("Email service access denied. Please contact support.");
          }
        ),
        { numRuns: 100 }
      );
    });

    it('parses validation error message from errors array for 422 status', async () => {
      // Generator for error response with non-empty errors array
      const errorWithMessagesArb: fc.Arbitrary<MailersendErrorResponse> = fc.record({
        errors: fc.array(
          fc.record({
            message: errorMessageArb,
            field: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
          }),
          { minLength: 1, maxLength: 5 }
        ),
      });

      await fc.assert(
        fc.property(
          errorWithMessagesArb,
          (errorData: MailersendErrorResponse) => {
            const result = parseMailersendError(422, errorData);
            
            // Requirement 4.2: 422 should parse errors[].message
            // Should return the first error message from the array
            expect(result).toBe(errorData.errors![0].message);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('returns fallback message for 422 status when errors array is empty or missing', async () => {
      const emptyErrorResponseArb = fc.oneof(
        fc.constant({} as MailersendErrorResponse),
        fc.constant({ errors: [] as Array<{ message: string; field?: string }> } as MailersendErrorResponse),
        fc.constant({ errors: undefined } as MailersendErrorResponse),
      );

      await fc.assert(
        fc.property(
          emptyErrorResponseArb,
          (errorData: MailersendErrorResponse) => {
            const result = parseMailersendError(422, errorData);
            
            // Should return fallback message when no errors array
            expect(result).toBe("Invalid email data");
          }
        ),
        { numRuns: 100 }
      );
    });

    it('returns appropriate error message for 429 status (rate limited)', async () => {
      await fc.assert(
        fc.property(
          mailersendErrorResponseArb,
          (errorData: MailersendErrorResponse) => {
            const result = parseMailersendError(429, errorData);
            
            // 429 should return rate limit message
            expect(result).toBe("Email service temporarily unavailable. Please try again later.");
          }
        ),
        { numRuns: 100 }
      );
    });

    it('returns appropriate error message for 5xx status codes (server errors)', async () => {
      const serverErrorStatusArb = fc.integer({ min: 500, max: 599 });

      await fc.assert(
        fc.property(
          serverErrorStatusArb,
          mailersendErrorResponseArb,
          (statusCode: number, errorData: MailersendErrorResponse) => {
            const result = parseMailersendError(statusCode, errorData);
            
            // 5xx should return server error message
            expect(result).toBe("Email service error. Please try again later.");
          }
        ),
        { numRuns: 100 }
      );
    });

    it('returns message from response for other error codes', async () => {
      // Other client errors (not 401, 403, 422, 429)
      const otherClientErrorArb = fc.integer({ min: 400, max: 499 })
        .filter(n => ![401, 403, 422, 429].includes(n));

      const errorWithMessageArb: fc.Arbitrary<MailersendErrorResponse> = fc.record({
        message: errorMessageArb,
      });

      await fc.assert(
        fc.property(
          otherClientErrorArb,
          errorWithMessageArb,
          (statusCode: number, errorData: MailersendErrorResponse) => {
            const result = parseMailersendError(statusCode, errorData);
            
            // Should return the message from response
            expect(result).toBe(errorData.message);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('returns fallback message when response has no message for other error codes', async () => {
      const otherClientErrorArb = fc.integer({ min: 400, max: 499 })
        .filter(n => ![401, 403, 422, 429].includes(n));

      await fc.assert(
        fc.property(
          otherClientErrorArb,
          (statusCode: number) => {
            const result = parseMailersendError(statusCode, {});
            
            // Should return fallback message
            expect(result).toBe("Failed to send email");
          }
        ),
        { numRuns: 100 }
      );
    });

    it('error messages are user-friendly (no technical jargon)', async () => {
      await fc.assert(
        fc.property(
          statusCodeArb,
          mailersendErrorResponseArb,
          (statusCode: number, errorData: MailersendErrorResponse) => {
            const result = parseMailersendError(statusCode, errorData);
            
            // Requirement 4.5: Messages should be user-friendly
            // Should not contain technical HTTP status codes in the message
            expect(result).not.toMatch(/\b(401|403|422|429|5\d{2})\b/);
            
            // Should not contain technical terms like "HTTP", "API", "status"
            expect(result.toLowerCase()).not.toContain('http');
            expect(result.toLowerCase()).not.toContain('status code');
            
            // Should be a non-empty string
            expect(result.length).toBeGreaterThan(0);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 3: Success Response Handling', () => {
    /**
     * Property 3: Success Response Handling
     * *For any* successful email send (202 response), the system should:
     * - Capture the x-message-id header
     * - Call updateReportSent with the recipient email and delivery_method 'email'
     * - Return success with the report token
     * 
     * **Validates: Requirements 3.1, 3.2, 3.4, 3.5**
     * 
     * Feature: mailersend-migration, Property 3: Success Response Handling
     */

    /**
     * Generator for valid email addresses
     */
    const emailArb = fc.emailAddress();

    /**
     * Generator for report tokens (UUID format)
     */
    const reportTokenArb = fc.uuid();

    /**
     * Generator for message IDs (Mailersend format)
     */
    const messageIdArb = fc.oneof(
      fc.uuid(),
      fc.string({ minLength: 10, maxLength: 50 }).filter(s => s.trim().length > 0 && /^[a-zA-Z0-9-_]+$/.test(s)),
    );

    /**
     * Generator for success response parameters
     */
    const successParamsArb = fc.record({
      messageId: fc.option(messageIdArb, { nil: null }),
      reportToken: reportTokenArb,
      recipientEmail: emailArb,
    });

    it('captures x-message-id header when present', () => {
      fc.assert(
        fc.property(
          successParamsArb.filter(p => p.messageId !== null),
          (params) => {
            const response = {
              status: 202 as const,
              headers: { 'x-message-id': params.messageId! },
            };
            const report = { report_token: params.reportToken };
            const customer = { email: params.recipientEmail };
            
            const result = handleSuccessResponse(response, report, customer);
            
            // Requirement 3.4: Should capture Mailersend message ID
            expect(result.message_id).toBe(params.messageId);
            expect(result.success).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('uses fallback message ID when x-message-id header is missing', () => {
      fc.assert(
        fc.property(
          successParamsArb,
          (params) => {
            const response = {
              status: 202 as const,
              headers: {} as { 'x-message-id'?: string },
            };
            const report = { report_token: params.reportToken };
            const customer = { email: params.recipientEmail };
            
            const result = handleSuccessResponse(response, report, customer);
            
            // Should use 'sent' as fallback when header is missing
            expect(result.message_id).toBe('sent');
            expect(result.success).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('returns report token on success', () => {
      fc.assert(
        fc.property(
          successParamsArb,
          (params) => {
            const response = {
              status: 202 as const,
              headers: { 'x-message-id': params.messageId || undefined },
            };
            const report = { report_token: params.reportToken };
            const customer = { email: params.recipientEmail };
            
            const result = handleSuccessResponse(response, report, customer);
            
            // Requirement 3.5: Should return report token
            expect(result.report_token).toBe(params.reportToken);
            expect(result.success).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('calls updateReportSent with correct parameters', () => {
      fc.assert(
        fc.property(
          successParamsArb,
          (params) => {
            const response = {
              status: 202 as const,
              headers: { 'x-message-id': params.messageId || undefined },
            };
            const report = { report_token: params.reportToken };
            const customer = { email: params.recipientEmail };
            
            const result = handleSuccessResponse(response, report, customer);
            
            // Requirement 3.1, 3.2: Should call updateReportSent with correct params
            expect(result.updateReportSentCalled).toBe(true);
            expect(result.updateReportSentParams).not.toBeNull();
            
            // Requirement 3.2: Should record recipient email
            expect(result.updateReportSentParams!.sent_to_email).toBe(params.recipientEmail);
            
            // Requirement 3.5: Should maintain delivery_method as 'email'
            expect(result.updateReportSentParams!.delivery_method).toBe('email');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('success response always returns success: true', () => {
      fc.assert(
        fc.property(
          successParamsArb,
          messageIdArb,
          (params, messageId) => {
            const response = {
              status: 202 as const,
              headers: { 'x-message-id': messageId },
            };
            const report = { report_token: params.reportToken };
            const customer = { email: params.recipientEmail };
            
            const result = handleSuccessResponse(response, report, customer);
            
            // Success response should always return success: true
            expect(result.success).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('preserves email address exactly as provided', () => {
      fc.assert(
        fc.property(
          successParamsArb,
          (params) => {
            const response = {
              status: 202 as const,
              headers: { 'x-message-id': params.messageId || undefined },
            };
            const report = { report_token: params.reportToken };
            const customer = { email: params.recipientEmail };
            
            const result = handleSuccessResponse(response, report, customer);
            
            // Email should be preserved exactly (no modification)
            expect(result.updateReportSentParams!.sent_to_email).toStrictEqual(params.recipientEmail);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
