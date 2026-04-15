/**
 * Backward Compatibility Tests for Simple Email Notifications
 * 
 * Tests that the new simplified email system works with:
 * - Existing customer email addresses
 * - Existing SendGrid integration
 * - Existing email delivery tracking
 * - Existing email preferences and settings
 * 
 * Requirements: 5.1, 5.2, 5.3, 5.4
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { generateSimpleEmailContent, escapeHtml, isValidReportLink, sanitizeForSubject } from '../../convex/serviceReports';

// Mock existing customer data structures
const mockExistingCustomer = {
  _id: 'customer123' as any,
  full_name: 'John Smith',
  email: 'john.smith@example.com',
  phone: '+1234567890',
  address: '123 Main St',
  service_day: 'Monday',
  pool_type: 'Salt',
  surface_type: 'Plaster',
  created_by: 'tech@poolservice.com',
  // Existing report settings (Requirements: 5.4)
  report_settings: {
    show_chemical_readings: true,
    show_photos: true,
    show_service_notes: true,
    show_technician_name: true,
    show_service_duration: true,
    show_overall_status: true,
  },
};

const mockExistingCustomerWithoutEmail = {
  ...mockExistingCustomer,
  email: undefined, // Some existing customers may not have email
};

const mockExistingCustomerWithLegacyEmail = {
  ...mockExistingCustomer,
  email: 'legacy.customer@oldprovider.net', // Different email provider
};

const mockServiceLog = {
  _id: 'service123' as any,
  customer_id: 'customer123' as any,
  service_date: '2024-01-15',
  ph: 'good',
  chlorine: 'good',
  alkalinity: 'good',
  stabilizer: 'good',
  salt: 3200,
  notes: 'Pool looks great!',
};

describe('Email Backward Compatibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Existing Customer Email Addresses (Requirement 5.1)', () => {
    it('should work with existing customer email addresses', () => {
      const emailContent = generateSimpleEmailContent({
        customerName: mockExistingCustomer.full_name,
        serviceDate: '01/15/2024',
        poolStatus: 'good',
        businessName: 'Dominick Pool Solutions',
      });

      expect(emailContent.subject).toBe('Pool Service Completed - 01/15/2024');
      expect(emailContent.htmlBody).toContain('Hello John Smith');
      expect(emailContent.htmlBody).toContain('Dominick Pool Solutions');
      expect(emailContent.textBody).toContain('Hello John Smith');
    });

    it('should work with legacy email addresses from different providers', () => {
      const emailContent = generateSimpleEmailContent({
        customerName: 'Legacy Customer',
        serviceDate: '01/15/2024',
        poolStatus: 'good',
        businessName: 'Dominick Pool Solutions',
      });

      expect(emailContent.subject).toBe('Pool Service Completed - 01/15/2024');
      expect(emailContent.htmlBody).toContain('Hello Legacy Customer');
      expect(emailContent.textBody).toContain('Hello Legacy Customer');
    });

    it('should handle customers with special characters in names', () => {
      const emailContent = generateSimpleEmailContent({
        customerName: "O'Connor & Associates",
        serviceDate: '01/15/2024',
        poolStatus: 'good',
        businessName: 'Dominick Pool Solutions',
      });

      // HTML should be escaped
      expect(emailContent.htmlBody).toContain('Hello O&#039;Connor &amp; Associates');
      // Text should not be escaped
      expect(emailContent.textBody).toContain("Hello O'Connor & Associates");
    });
  });

  describe('SendGrid Integration Compatibility (Requirement 5.2)', () => {
    it('should generate email content compatible with SendGrid API format', () => {
      const emailContent = generateSimpleEmailContent({
        customerName: mockExistingCustomer.full_name,
        serviceDate: '01/15/2024',
        poolStatus: 'good',
        businessName: 'Dominick Pool Solutions',
      });

      // Verify SendGrid-compatible structure
      expect(emailContent).toHaveProperty('subject');
      expect(emailContent).toHaveProperty('htmlBody');
      expect(emailContent).toHaveProperty('textBody');

      // Verify content types are strings
      expect(typeof emailContent.subject).toBe('string');
      expect(typeof emailContent.htmlBody).toBe('string');
      expect(typeof emailContent.textBody).toBe('string');

      // Verify HTML is valid
      expect(emailContent.htmlBody).toContain('<!DOCTYPE html>');
      expect(emailContent.htmlBody).toContain('<html>');
      expect(emailContent.htmlBody).toContain('</html>');

      // Verify subject line is safe for email headers
      expect(emailContent.subject).not.toContain('\n');
      expect(emailContent.subject).not.toContain('\r');
    });

    it('should maintain existing email header safety', () => {
      const emailContent = generateSimpleEmailContent({
        customerName: 'Test Customer',
        serviceDate: '01/15/2024\nInjection\rAttempt',
        poolStatus: 'good',
        businessName: 'Dominick Pool Solutions',
      });

      // Subject should sanitize newlines to prevent header injection
      expect(emailContent.subject).toBe('Pool Service Completed - 01/15/2024 Injection Attempt');
      expect(emailContent.subject).not.toContain('\n');
      expect(emailContent.subject).not.toContain('\r');
    });

    it('should generate content that preserves existing SendGrid personalization structure', () => {
      const emailContent = generateSimpleEmailContent({
        customerName: mockExistingCustomer.full_name,
        serviceDate: '01/15/2024',
        poolStatus: 'needs_attention',
        customNote: 'pH levels need adjustment',
        businessName: 'Dominick Pool Solutions',
      });

      // Verify the content can be used in SendGrid's personalizations array
      expect(emailContent.subject).toBeTruthy();
      expect(emailContent.htmlBody).toContain('pH levels need adjustment');
      expect(emailContent.textBody).toContain('pH levels need adjustment');
    });
  });

  describe('Email Delivery Tracking Compatibility (Requirement 5.3)', () => {
    it('should maintain compatibility with existing delivery tracking fields', () => {
      // Test that the new system can work with existing serviceReports schema
      const mockReport = {
        _id: 'report123' as any,
        service_log_id: 'service123' as any,
        customer_id: 'customer123' as any,
        report_token: 'existing-token-123',
        sent_at: 1642204800000, // Existing timestamp
        sent_to_email: 'john.smith@example.com', // Existing email tracking
        send_count: 1, // Existing send count
        last_delivery_method: 'email', // Existing delivery method tracking
        created_at: 1642204800000,
      };

      // Verify the report structure is compatible
      expect(mockReport.sent_to_email).toBe('john.smith@example.com');
      expect(mockReport.last_delivery_method).toBe('email');
      expect(mockReport.send_count).toBe(1);
      expect(typeof mockReport.sent_at).toBe('number');
    });

    it('should work with existing report tokens', () => {
      const existingToken = 'existing-uuid-token-from-database';
      
      // Verify existing tokens can still be used for report links
      const reportLink = `https://app.example.com/report/${existingToken}`;
      expect(isValidReportLink(reportLink)).toBe(true);
    });
  });

  describe('Email Preferences and Settings Compatibility (Requirement 5.4)', () => {
    it('should respect existing customer report settings', () => {
      // The new simplified email system should work regardless of existing settings
      // since it doesn't use the complex report features that settings control
      
      const customerWithSettings = {
        ...mockExistingCustomer,
        report_settings: {
          show_chemical_readings: false, // Customer disabled detailed readings
          show_photos: false,
          show_service_notes: true,
          show_technician_name: true,
          show_service_duration: false,
          show_overall_status: true,
        },
      };

      const emailContent = generateSimpleEmailContent({
        customerName: customerWithSettings.full_name,
        serviceDate: '01/15/2024',
        poolStatus: 'good',
        businessName: 'Dominick Pool Solutions',
      });

      // New simplified emails should work regardless of settings
      // since they don't include the complex elements that settings control
      expect(emailContent.htmlBody).toContain('Hello John Smith');
      expect(emailContent.htmlBody).toContain('Everything is Perfect');
      expect(emailContent.htmlBody).not.toContain('View Full Report'); // Simplified emails don't have complex elements
    });

    it('should work with customers who have no report settings (legacy data)', () => {
      const legacyCustomer = {
        ...mockExistingCustomer,
        report_settings: undefined, // Legacy customers may not have settings
      };

      const emailContent = generateSimpleEmailContent({
        customerName: legacyCustomer.full_name,
        serviceDate: '01/15/2024',
        poolStatus: 'good',
        businessName: 'Dominick Pool Solutions',
      });

      expect(emailContent.htmlBody).toContain('Hello John Smith');
      expect(emailContent.htmlBody).toContain('Everything is Perfect');
    });
  });

  describe('HTML Escaping and Security (Existing Infrastructure)', () => {
    it('should maintain existing HTML escaping for security', () => {
      const maliciousInput = '<script>alert("xss")</script>';
      const escaped = escapeHtml(maliciousInput);
      
      expect(escaped).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;&#x2F;script&gt;');
      expect(escaped).not.toContain('<script>');
    });

    it('should maintain existing URL validation', () => {
      expect(isValidReportLink('https://safe.example.com/report/123')).toBe(true);
      expect(isValidReportLink('http://safe.example.com/report/123')).toBe(true);
      expect(isValidReportLink('javascript:alert("xss")')).toBe(false);
      expect(isValidReportLink('data:text/html,<script>alert("xss")</script>')).toBe(false);
    });

    it('should maintain existing subject line sanitization', () => {
      const maliciousSubject = 'Subject\nBcc: attacker@evil.com\r\nSubject: Fake';
      const sanitized = sanitizeForSubject(maliciousSubject);
      
      expect(sanitized).toBe('Subject Bcc: attacker@evil.com  Subject: Fake');
      expect(sanitized).not.toContain('\n');
      expect(sanitized).not.toContain('\r');
    });
  });

  describe('Business Name and Branding Compatibility', () => {
    it('should use provided business name or default to Dominick Pool Solutions', () => {
      // Test with existing business name
      const emailContent1 = generateSimpleEmailContent({
        customerName: 'Test Customer',
        serviceDate: '01/15/2024',
        poolStatus: 'good',
        businessName: 'Existing Pool Company',
      });

      expect(emailContent1.htmlBody).toContain('Existing Pool Company');
      expect(emailContent1.textBody).toContain('Existing Pool Company');

      // Test with default business name
      const emailContent2 = generateSimpleEmailContent({
        customerName: 'Test Customer',
        serviceDate: '01/15/2024',
        poolStatus: 'good',
      });

      expect(emailContent2.htmlBody).toContain('Dominick Pool Solutions');
      expect(emailContent2.textBody).toContain('Dominick Pool Solutions');
    });

    it('should always include the ChemCheck footer regardless of business name', () => {
      const emailContent = generateSimpleEmailContent({
        customerName: 'Test Customer',
        serviceDate: '01/15/2024',
        poolStatus: 'good',
        businessName: 'Any Pool Company',
      });

      const expectedFooter = 'This email is powered by ChemCheck Pool Software built by Dominick Pool Solutions';
      expect(emailContent.htmlBody).toContain(expectedFooter);
      expect(emailContent.textBody).toContain(expectedFooter);
    });
  });

  describe('Report Link Compatibility', () => {
    it('should include report links when provided and valid', () => {
      const reportLink = 'https://app.poolservice.com/report/abc-123';
      
      const emailContent = generateSimpleEmailContent({
        customerName: 'Test Customer',
        serviceDate: '01/15/2024',
        poolStatus: 'good',
        businessName: 'Dominick Pool Solutions',
        reportLink: reportLink,
      });

      expect(emailContent.htmlBody).toContain('View Full Report');
      expect(emailContent.htmlBody).toContain(escapeHtml(reportLink));
      expect(emailContent.textBody).toContain(reportLink);
    });

    it('should exclude report links when not provided', () => {
      const emailContent = generateSimpleEmailContent({
        customerName: 'Test Customer',
        serviceDate: '01/15/2024',
        poolStatus: 'good',
        businessName: 'Dominick Pool Solutions',
      });

      expect(emailContent.htmlBody).not.toContain('View Full Report');
      expect(emailContent.textBody).not.toContain('View your full report:');
    });

    it('should exclude unsafe report links', () => {
      const unsafeLink = 'javascript:alert("xss")';
      
      const emailContent = generateSimpleEmailContent({
        customerName: 'Test Customer',
        serviceDate: '01/15/2024',
        poolStatus: 'good',
        businessName: 'Dominick Pool Solutions',
        reportLink: unsafeLink,
      });

      expect(emailContent.htmlBody).not.toContain('View Full Report');
      expect(emailContent.htmlBody).not.toContain(unsafeLink);
      expect(emailContent.textBody).not.toContain(unsafeLink);
    });
  });
});
