/**
 * Property-Based Tests for SMS Report Utilities
 * 
 * These tests validate the correctness properties defined in the design document
 * using fast-check for property-based testing.
 * 
 * Feature: customer-service-reports
 * Property 3: SMS message content completeness
 * Property 4: Report link uniqueness
 * Validates: Requirements 2.2, 2.3, 2.4
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  formatSmsMessage,
  generateReportToken,
  isValidReportToken,
  buildReportUrl,
  PoolStatus,
} from './smsReport';

// ============================================================================
// Generators for Property-Based Testing
// ============================================================================

/**
 * Generator for business names (non-empty strings)
 */
const businessNameArb = fc.string({ minLength: 1, maxLength: 50 })
  .filter(s => s.trim().length > 0);

/**
 * Generator for service dates in MM/DD/YYYY format
 */
const serviceDateArb = fc.tuple(
  fc.integer({ min: 1, max: 12 }),
  fc.integer({ min: 1, max: 28 }),
  fc.integer({ min: 2020, max: 2030 })
).map(([month, day, year]) => `${month}/${day}/${year}`);

/**
 * Generator for pool status
 */
const poolStatusArb: fc.Arbitrary<PoolStatus> = fc.constantFrom('good', 'needs_attention');

/**
 * Generator for base URLs
 */
const baseUrlArb = fc.constantFrom(
  'https://app.example.com',
  'https://chemcheck.app',
  'https://poolservice.io',
  'http://localhost:3000'
);

/**
 * Generator for valid report tokens (UUID v4)
 */
const validTokenArb = fc.uuid().filter(uuid => {
  // Ensure it's a valid UUID v4 format
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid);
});

// ============================================================================
// Property-Based Tests
// ============================================================================

describe('SMS Report Utilities', () => {
  /**
   * Property 3: SMS message content completeness
   * 
   * For any service log, the generated SMS message preview SHALL contain:
   * the business name, the service date, the overall pool status indicator,
   * and a valid report link URL.
   * 
   * **Validates: Requirements 2.2, 2.3**
   */
  describe('Property 3: SMS message content completeness', () => {
    it('SMS message contains business name (or truncated version)', () => {
      fc.assert(
        fc.property(
          businessNameArb,
          serviceDateArb,
          poolStatusArb,
          baseUrlArb,
          (businessName, serviceDate, status, baseUrl) => {
            const token = generateReportToken();
            const reportLink = buildReportUrl(baseUrl, token);
            const message = formatSmsMessage(businessName, serviceDate, status, reportLink);
            
            // Business name should be present (possibly truncated)
            if (businessName.length <= 30) {
              expect(message).toContain(businessName);
            } else {
              // Truncated version should be present
              expect(message).toContain(businessName.slice(0, 27));
              expect(message).toContain('...');
            }
          }
        ),
        { numRuns: 20 }
      );
    });

    it('SMS message contains service date', () => {
      fc.assert(
        fc.property(
          businessNameArb,
          serviceDateArb,
          poolStatusArb,
          baseUrlArb,
          (businessName, serviceDate, status, baseUrl) => {
            const token = generateReportToken();
            const reportLink = buildReportUrl(baseUrl, token);
            const message = formatSmsMessage(businessName, serviceDate, status, reportLink);
            
            expect(message).toContain(serviceDate);
          }
        ),
        { numRuns: 20 }
      );
    });

    it('SMS message contains pool status indicator', () => {
      fc.assert(
        fc.property(
          businessNameArb,
          serviceDateArb,
          poolStatusArb,
          baseUrlArb,
          (businessName, serviceDate, status, baseUrl) => {
            const token = generateReportToken();
            const reportLink = buildReportUrl(baseUrl, token);
            const message = formatSmsMessage(businessName, serviceDate, status, reportLink);
            
            // Uses ASCII characters for GSM-7 encoding compatibility
            if (status === 'good') {
              expect(message).toContain('OK');
            } else {
              expect(message).toContain('Needs Attention');
            }
          }
        ),
        { numRuns: 20 }
      );
    });

    it('SMS message contains report link', () => {
      fc.assert(
        fc.property(
          businessNameArb,
          serviceDateArb,
          poolStatusArb,
          baseUrlArb,
          (businessName, serviceDate, status, baseUrl) => {
            const token = generateReportToken();
            const reportLink = buildReportUrl(baseUrl, token);
            const message = formatSmsMessage(businessName, serviceDate, status, reportLink);
            
            expect(message).toContain(reportLink);
          }
        ),
        { numRuns: 20 }
      );
    });

    it('SMS message contains all required components together', () => {
      fc.assert(
        fc.property(
          businessNameArb,
          serviceDateArb,
          poolStatusArb,
          baseUrlArb,
          (businessName, serviceDate, status, baseUrl) => {
            const token = generateReportToken();
            const reportLink = buildReportUrl(baseUrl, token);
            const message = formatSmsMessage(businessName, serviceDate, status, reportLink);
            
            // All components must be present
            expect(message).toContain(serviceDate);
            expect(message).toContain(reportLink);
            expect(message).toMatch(/Pool Status:/);
            
            // Status indicator must be present (ASCII for GSM-7 encoding)
            const hasGoodStatus = message.includes('OK');
            const hasNeedsAttention = message.includes('Needs Attention');
            expect(hasGoodStatus || hasNeedsAttention).toBe(true);
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  /**
   * Property 4: Report link uniqueness
   * 
   * For any two distinct service logs, the generated report tokens
   * SHALL be unique (no collisions).
   * 
   * **Validates: Requirements 2.4**
   */
  describe('Property 4: Report link uniqueness', () => {
    it('generated tokens are unique across multiple generations', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 10, max: 50 }),
          (count) => {
            const tokens = new Set<string>();
            
            for (let i = 0; i < count; i++) {
              const token = generateReportToken();
              tokens.add(token);
            }
            
            // All tokens should be unique
            expect(tokens.size).toBe(count);
          }
        ),
        { numRuns: 20 }
      );
    });

    it('generated tokens are valid UUID v4 format', () => {
      fc.assert(
        fc.property(
          fc.constant(null),
          () => {
            const token = generateReportToken();
            
            // Should be valid UUID v4
            expect(isValidReportToken(token)).toBe(true);
            
            // Should be 36 characters
            expect(token).toHaveLength(36);
            
            // Should match UUID v4 pattern
            expect(token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
          }
        ),
        { numRuns: 20 }
      );
    });

    it('generated tokens are URL-safe', () => {
      fc.assert(
        fc.property(
          fc.constant(null),
          () => {
            const token = generateReportToken();
            
            // Should only contain URL-safe characters (alphanumeric and hyphens)
            expect(token).toMatch(/^[0-9a-f-]+$/i);
            
            // Should be usable in a URL without encoding
            const url = `https://example.com/report/${token}`;
            expect(encodeURIComponent(token)).toBe(token);
          }
        ),
        { numRuns: 20 }
      );
    });

    it('report URLs built from tokens are valid', () => {
      fc.assert(
        fc.property(
          baseUrlArb,
          (baseUrl) => {
            const token = generateReportToken();
            const reportUrl = buildReportUrl(baseUrl, token);
            
            // Should contain the base URL
            expect(reportUrl).toContain(baseUrl.replace(/\/$/, ''));
            
            // Should contain the token
            expect(reportUrl).toContain(token);
            
            // Should have correct path structure
            expect(reportUrl).toMatch(/\/report\/[0-9a-f-]+$/i);
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  describe('isValidReportToken', () => {
    it('returns true for valid UUID v4 tokens', () => {
      fc.assert(
        fc.property(
          fc.constant(null),
          () => {
            const token = generateReportToken();
            expect(isValidReportToken(token)).toBe(true);
          }
        ),
        { numRuns: 20 }
      );
    });

    it('returns false for invalid tokens', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(
            '',
            'not-a-uuid',
            '12345',
            'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
            '00000000-0000-0000-0000-000000000000', // Not v4 (version digit is 0)
          ),
          (invalidToken) => {
            expect(isValidReportToken(invalidToken)).toBe(false);
          }
        ),
        { numRuns: 5 }
      );
    });
  });

  describe('buildReportUrl', () => {
    it('handles base URLs with and without trailing slashes', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(
            'https://example.com',
            'https://example.com/',
          ),
          (baseUrl) => {
            const token = generateReportToken();
            const url = buildReportUrl(baseUrl, token);
            
            // Should not have double slashes
            expect(url).not.toContain('//report');
            
            // Should have correct format
            expect(url).toMatch(/^https:\/\/example\.com\/report\/[0-9a-f-]+$/i);
          }
        ),
        { numRuns: 10 }
      );
    });
  });
});


// ============================================================================
// Property 5: Report link reuse on re-send
// ============================================================================

/**
 * Property 5: Report link reuse on re-send
 * 
 * For any service log that has already been sent as a report, re-sending
 * SHALL use the same report_token (and thus the same URL) as the original send.
 * 
 * **Validates: Requirements 5.3**
 * 
 * Note: This test simulates the getOrCreateReport logic since the actual
 * Convex mutation requires runtime. The test validates that the logic
 * correctly returns existing tokens rather than generating new ones.
 */
describe('Property 5: Report link reuse on re-send', () => {
  /**
   * Simulates the getOrCreateReport logic for testing purposes
   * This mirrors the behavior in convex/serviceReports.ts
   */
  interface MockReport {
    service_log_id: string;
    report_token: string;
    sent_at?: number;
    send_count?: number;
  }

  class MockReportStore {
    private reports: Map<string, MockReport> = new Map();

    getOrCreateReport(serviceLogId: string): MockReport {
      // Check if report already exists for this service log
      const existing = this.reports.get(serviceLogId);
      
      if (existing) {
        // Return existing report (for re-send scenario)
        return existing;
      }

      // Generate new token and create report
      const newReport: MockReport = {
        service_log_id: serviceLogId,
        report_token: generateReportToken(),
      };
      
      this.reports.set(serviceLogId, newReport);
      return newReport;
    }

    markAsSent(serviceLogId: string, phone: string): void {
      const report = this.reports.get(serviceLogId);
      if (report) {
        report.sent_at = Date.now();
        report.send_count = (report.send_count || 0) + 1;
      }
    }

    getReport(serviceLogId: string): MockReport | undefined {
      return this.reports.get(serviceLogId);
    }
  }

  /**
   * Generator for service log IDs
   */
  const serviceLogIdArb = fc.uuid();

  it('re-sending a report returns the same token as the original send', () => {
    fc.assert(
      fc.property(
        serviceLogIdArb,
        (serviceLogId) => {
          const store = new MockReportStore();
          
          // First call - creates new report
          const firstReport = store.getOrCreateReport(serviceLogId);
          const originalToken = firstReport.report_token;
          
          // Simulate sending the report
          store.markAsSent(serviceLogId, '+15551234567');
          
          // Second call - should return same report with same token
          const secondReport = store.getOrCreateReport(serviceLogId);
          
          // Token should be identical
          expect(secondReport.report_token).toBe(originalToken);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('multiple re-sends always return the same token', () => {
    fc.assert(
      fc.property(
        serviceLogIdArb,
        fc.integer({ min: 2, max: 10 }),
        (serviceLogId, resendCount) => {
          const store = new MockReportStore();
          
          // First call - creates new report
          const firstReport = store.getOrCreateReport(serviceLogId);
          const originalToken = firstReport.report_token;
          
          // Multiple re-sends
          for (let i = 0; i < resendCount; i++) {
            store.markAsSent(serviceLogId, '+15551234567');
            const report = store.getOrCreateReport(serviceLogId);
            
            // Token should always be the same
            expect(report.report_token).toBe(originalToken);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('different service logs get different tokens', () => {
    fc.assert(
      fc.property(
        fc.array(serviceLogIdArb, { minLength: 2, maxLength: 10 }),
        (serviceLogIds) => {
          // Ensure unique service log IDs
          const uniqueIds = [...new Set(serviceLogIds)];
          if (uniqueIds.length < 2) return; // Skip if not enough unique IDs
          
          const store = new MockReportStore();
          const tokens = new Map<string, string>();
          
          // Create reports for each service log
          for (const id of uniqueIds) {
            const report = store.getOrCreateReport(id);
            tokens.set(id, report.report_token);
          }
          
          // All tokens should be unique
          const uniqueTokens = new Set(tokens.values());
          expect(uniqueTokens.size).toBe(uniqueIds.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('report URL remains stable across re-sends', () => {
    fc.assert(
      fc.property(
        serviceLogIdArb,
        baseUrlArb,
        (serviceLogId, baseUrl) => {
          const store = new MockReportStore();
          
          // First call - creates new report
          const firstReport = store.getOrCreateReport(serviceLogId);
          const originalUrl = buildReportUrl(baseUrl, firstReport.report_token);
          
          // Simulate sending
          store.markAsSent(serviceLogId, '+15551234567');
          
          // Re-send - should produce same URL
          const secondReport = store.getOrCreateReport(serviceLogId);
          const resendUrl = buildReportUrl(baseUrl, secondReport.report_token);
          
          expect(resendUrl).toBe(originalUrl);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('send count increments on each send but token stays the same', () => {
    fc.assert(
      fc.property(
        serviceLogIdArb,
        fc.integer({ min: 1, max: 5 }),
        (serviceLogId, sendCount) => {
          const store = new MockReportStore();
          
          // Create report
          const report = store.getOrCreateReport(serviceLogId);
          const originalToken = report.report_token;
          
          // Send multiple times
          for (let i = 0; i < sendCount; i++) {
            store.markAsSent(serviceLogId, '+15551234567');
          }
          
          // Get report again
          const finalReport = store.getReport(serviceLogId);
          
          // Token should be unchanged
          expect(finalReport?.report_token).toBe(originalToken);
          
          // Send count should match
          expect(finalReport?.send_count).toBe(sendCount);
        }
      ),
      { numRuns: 100 }
    );
  });
});
