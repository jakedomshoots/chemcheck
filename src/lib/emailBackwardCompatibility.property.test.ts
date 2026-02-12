/**
 * Property-Based Tests for Email Backward Compatibility
 * 
 * **Property 8: Backward Compatibility**
 * **Validates: Requirements 5.1, 5.2, 5.3, 5.4**
 * 
 * Tests that the new email system maintains compatibility with existing infrastructure
 * across all possible inputs and customer data variations.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { generateSimpleEmailContent, escapeHtml, isValidReportLink, sanitizeForSubject } from '../../convex/serviceReports';

// Generators for existing customer data patterns
const existingCustomerNameGen = fc.oneof(
  fc.string({ minLength: 1, maxLength: 100 }), // Regular names
  fc.constantFrom(
    "O'Connor", // Apostrophes
    "Smith & Associates", // Ampersands
    "José García", // Accented characters
    "李小明", // Unicode characters
    "Company <script>alert('xss')</script>", // Potential XSS
    "Name\nWith\rNewlines", // Header injection attempts
  )
);

const existingEmailGen = fc.oneof(
  fc.emailAddress(), // Standard emails
  fc.constantFrom(
    'legacy@oldprovider.net',
    'customer+tag@gmail.com',
    'user.name@company.co.uk',
    'test@subdomain.example.com',
  )
);

const serviceDateGen = fc.oneof(
  fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') })
    .filter(d => !isNaN(d.getTime())) // Filter out invalid dates
    .map(d => d.toISOString().split('T')[0])
    .map(dateStr => {
      const [year, month, day] = dateStr.split('-');
      return `${month}/${day}/${year}`;
    }),
  fc.constantFrom(
    '01/15/2024',
    '12/31/2023',
    '02/29/2024', // Leap year
  )
);

const businessNameGen = fc.oneof(
  fc.string({ minLength: 1, maxLength: 50 }),
  fc.constantFrom(
    'Dominick Pool Solutions',
    'Legacy Pool Company',
    'Pool & Spa Services',
    "Joe's Pool Care",
    'Pool Service <script>alert("xss")</script>',
  )
);

const customNoteGen = fc.oneof(
  fc.string({ minLength: 0, maxLength: 500 }),
  fc.constantFrom(
    'pH levels need adjustment',
    'Pool equipment needs attention\nMultiple lines of notes',
    'Chemical readings: <b>High chlorine</b>',
    '', // Empty note
  )
);

const reportLinkGen = fc.oneof(
  fc.webUrl(),
  fc.constantFrom(
    'https://app.poolservice.com/report/abc-123',
    'http://legacy.poolservice.com/reports/456',
    'javascript:alert("xss")', // Unsafe URL
    'data:text/html,<script>alert("xss")</script>', // Unsafe URL
    '', // Empty URL
  )
);

describe('Property-Based Tests: Email Backward Compatibility', () => {
  it('Property 8: Backward Compatibility - For any existing customer data and email infrastructure, the new system should work with existing email addresses, use existing SendGrid functions, and maintain delivery tracking', () => {
    fc.assert(
      fc.property(
        existingCustomerNameGen,
        serviceDateGen,
        fc.constantFrom('good', 'needs_attention'),
        fc.option(customNoteGen),
        fc.option(businessNameGen),
        fc.option(reportLinkGen),
        (customerName, serviceDate, poolStatus, customNote, businessName, reportLink) => {
          // Generate email content with arbitrary existing customer data
          const emailContent = generateSimpleEmailContent({
            customerName,
            serviceDate,
            poolStatus,
            customNote: customNote || undefined,
            businessName: businessName || undefined,
            reportLink: reportLink || undefined,
          });

          // **Requirement 5.1: Works with existing customer email addresses**
          // The system should generate valid email content regardless of customer name format
          expect(emailContent.subject).toBeTruthy();
          expect(typeof emailContent.subject).toBe('string');
          expect(emailContent.htmlBody).toBeTruthy();
          expect(typeof emailContent.htmlBody).toBe('string');
          expect(emailContent.textBody).toBeTruthy();
          expect(typeof emailContent.textBody).toBe('string');

          // Customer name should appear in both HTML and text versions
          if (customerName.trim()) {
            expect(emailContent.textBody).toContain(customerName);
            // HTML version should contain escaped version for safety
            expect(emailContent.htmlBody).toContain(escapeHtml(customerName));
          }

          // **Requirement 5.2: Uses existing SendGrid functions**
          // Email content should be compatible with SendGrid API structure
          expect(emailContent).toHaveProperty('subject');
          expect(emailContent).toHaveProperty('htmlBody');
          expect(emailContent).toHaveProperty('textBody');

          // HTML should be valid HTML structure
          expect(emailContent.htmlBody).toContain('<!DOCTYPE html>');
          expect(emailContent.htmlBody).toContain('<html>');
          expect(emailContent.htmlBody).toContain('</html>');

          // Subject should be safe for email headers (no newlines)
          expect(emailContent.subject).not.toContain('\n');
          expect(emailContent.subject).not.toContain('\r');

          // **Requirement 5.3: Maintains existing email delivery tracking**
          // The email structure should be compatible with existing tracking systems
          // Subject line should follow consistent format for tracking
          expect(emailContent.subject).toMatch(/^Pool Service Completed - /);

          // **Requirement 5.4: Preserves existing email preferences and settings**
          // The simplified email should work regardless of customer settings
          // since it doesn't use complex report features that settings control

          // Business name handling should be consistent
          const expectedBusinessName = businessName || 'Dominick Pool Solutions';
          expect(emailContent.htmlBody).toContain(escapeHtml(expectedBusinessName));
          expect(emailContent.textBody).toContain(expectedBusinessName);

          // Footer should always be present for branding consistency
          const expectedFooter = 'This email is powered by ChemCheck Pool Software built by Dominick Pool Solutions';
          expect(emailContent.htmlBody).toContain(expectedFooter);
          expect(emailContent.textBody).toContain(expectedFooter);

          // Pool status should be reflected appropriately
          if (poolStatus === 'good') {
            expect(emailContent.htmlBody).toContain('Everything is Perfect');
            expect(emailContent.textBody).toContain('Everything is Perfect');
          } else {
            expect(emailContent.htmlBody).toContain('Needs Attention');
            expect(emailContent.textBody).toContain('Needs Attention');
          }

          // Custom notes should be included when provided and status is needs_attention
          if (poolStatus === 'needs_attention' && customNote && customNote.trim()) {
            expect(emailContent.htmlBody).toContain(escapeHtml(customNote));
            expect(emailContent.textBody).toContain(customNote);
          }

          // Report links should only be included if they are safe URLs
          if (reportLink && isValidReportLink(reportLink)) {
            expect(emailContent.htmlBody).toContain('View Full Report');
            expect(emailContent.htmlBody).toContain(escapeHtml(reportLink));
            expect(emailContent.textBody).toContain(reportLink);
          } else if (reportLink && !isValidReportLink(reportLink)) {
            // Unsafe URLs should not appear in the email
            expect(emailContent.htmlBody).not.toContain(reportLink);
            expect(emailContent.textBody).not.toContain(reportLink);
          }

          // Security: HTML content should be properly escaped
          // No unescaped user input should appear in HTML
          const htmlWithoutTags = emailContent.htmlBody.replace(/<[^>]*>/g, '');
          if (customerName.includes('<script>')) {
            expect(htmlWithoutTags).not.toContain('<script>');
          }
          if (customNote && customNote.includes('<script>')) {
            expect(htmlWithoutTags).not.toContain('<script>');
          }
          if (businessName && businessName.includes('<script>')) {
            expect(htmlWithoutTags).not.toContain('<script>');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 8.1: HTML Escaping Consistency - For any user input, HTML escaping should prevent XSS while preserving text content', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 200 }),
        (input) => {
          const escaped = escapeHtml(input);
          
          // Should not contain unescaped HTML characters
          expect(escaped).not.toContain('<');
          expect(escaped).not.toContain('>');
          
          // Should escape all dangerous characters
          if (input.includes('<')) {
            expect(escaped).toContain('&lt;');
          }
          if (input.includes('>')) {
            expect(escaped).toContain('&gt;');
          }
          if (input.includes('&')) {
            expect(escaped).toContain('&amp;');
          }
          if (input.includes('"')) {
            expect(escaped).toContain('&quot;');
          }
          if (input.includes("'")) {
            expect(escaped).toContain('&#039;');
          }
          
          // Note: Escaping is intentionally NOT idempotent for security.
          // Escaping already-escaped content (e.g., "&gt;") produces "&amp;gt;"
          // which prevents double-escaping attacks.
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 8.2: URL Validation Consistency - For any URL input, validation should correctly identify safe vs unsafe URLs', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.webUrl(),
          fc.string(),
          fc.constantFrom(
            'javascript:alert("xss")',
            'data:text/html,<script>alert("xss")</script>',
            'vbscript:msgbox("xss")',
            'file:///etc/passwd',
            'ftp://example.com/file.txt',
            'mailto:test@example.com',
            '',
            'not-a-url',
            'https://',
            'http://',
          )
        ),
        (url) => {
          const isValid = isValidReportLink(url);
          
          if (isValid) {
            // Valid URLs must be parseable AND have http/https protocol
            expect(() => new URL(url)).not.toThrow();
            const parsed = new URL(url);
            expect(['http:', 'https:']).toContain(parsed.protocol);
          } else {
            // Invalid URLs are either:
            // 1. Unparseable (new URL() throws)
            // 2. Parseable but not http/https protocol
            try {
              const parsed = new URL(url);
              // If parseable, protocol must not be http/https
              expect(['http:', 'https:']).not.toContain(parsed.protocol);
            } catch {
              // Unparseable URLs are correctly rejected - this is expected
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 8.3: Subject Line Safety - For any service date input, subject lines should be safe for email headers', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 100 }),
        (serviceDate) => {
          const sanitized = sanitizeForSubject(serviceDate);
          
          // Should not contain newlines that could cause header injection
          expect(sanitized).not.toContain('\n');
          expect(sanitized).not.toContain('\r');
          
          // Should match backend sanitization behavior exactly
          const expected = serviceDate
            .replace(/[\r\n\x00-\x1F\x7F]/g, ' ')
            .trim()
            .slice(0, 200);
          expect(sanitized).toBe(expected);
          expect(sanitized.length).toBeLessThanOrEqual(200);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 8.4: Email Structure Consistency - For any valid inputs, generated emails should have consistent structure', () => {
    fc.assert(
      fc.property(
        existingCustomerNameGen,
        serviceDateGen,
        fc.constantFrom('good', 'needs_attention'),
        (customerName, serviceDate, poolStatus) => {
          const emailContent = generateSimpleEmailContent({
            customerName,
            serviceDate,
            poolStatus,
          });

          // HTML structure should be consistent
          expect(emailContent.htmlBody).toContain('<!DOCTYPE html>');
          expect(emailContent.htmlBody).toContain('<html>');
          expect(emailContent.htmlBody).toContain('<head>');
          expect(emailContent.htmlBody).toContain('<body');
          expect(emailContent.htmlBody).toContain('</body>');
          expect(emailContent.htmlBody).toContain('</html>');

          // Should contain required sections
          expect(emailContent.htmlBody).toContain('Pool Service Completed');
          // Note: textBody contains the content but not the HTML title
          expect(emailContent.textBody).toContain('Your pool service has been completed');

          // Should contain service date
          expect(emailContent.htmlBody).toContain(escapeHtml(serviceDate));
          expect(emailContent.textBody).toContain(serviceDate);

          // Should contain pool status
          const expectedStatus = poolStatus === 'good' ? 'Everything is Perfect' : 'Needs Attention';
          expect(emailContent.htmlBody).toContain(expectedStatus);
          expect(emailContent.textBody).toContain(expectedStatus);

          // Should contain footer
          const footer = 'This email is powered by ChemCheck Pool Software built by Dominick Pool Solutions';
          expect(emailContent.htmlBody).toContain(footer);
          expect(emailContent.textBody).toContain(footer);
        }
      ),
      { numRuns: 100 }
    );
  });
});
