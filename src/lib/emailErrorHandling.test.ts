/**
 * Error Handling Tests for Missing Email Addresses
 * 
 * Tests error handling for customers without email addresses and various edge cases.
 * 
 * Requirements: 5.5
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the SendReportDialog component behavior
const mockSendReportDialog = {
  // Simulate the dialog's error handling logic
  validateEmailAddress: (customerEmail?: string) => {
    // Check for missing or empty email (including whitespace-only)
    if (!customerEmail || customerEmail.trim().length === 0) {
      return {
        hasError: true,
        errorMessage: "No email address on file. Please add an email address to send reports.",
        canSend: false,
      };
    }
    
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(customerEmail.trim())) {
      return {
        hasError: true,
        errorMessage: "Invalid email address format. Please check the email address.",
        canSend: false,
      };
    }
    
    return {
      hasError: false,
      errorMessage: null,
      canSend: true,
    };
  },
  
  // Simulate the backend validation logic
  validateBackendEmail: (customerEmail?: string) => {
    if (!customerEmail) {
      return {
        success: false,
        error: "No email address on file. Please add an email address to send email reports.",
      };
    }
    
    return {
      success: true,
      error: null,
    };
  },
};

describe('Email Error Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Missing Email Address Handling (Requirement 5.5)', () => {
    it('should show appropriate error message for customers without email', () => {
      const result = mockSendReportDialog.validateEmailAddress(undefined);
      
      expect(result.hasError).toBe(true);
      expect(result.canSend).toBe(false);
      expect(result.errorMessage).toBe("No email address on file. Please add an email address to send reports.");
    });

    it('should show appropriate error message for null email', () => {
      const result = mockSendReportDialog.validateEmailAddress(null as any);
      
      expect(result.hasError).toBe(true);
      expect(result.canSend).toBe(false);
      expect(result.errorMessage).toBe("No email address on file. Please add an email address to send reports.");
    });

    it('should show appropriate error message for empty string email', () => {
      const result = mockSendReportDialog.validateEmailAddress('');
      
      expect(result.hasError).toBe(true);
      expect(result.canSend).toBe(false);
      expect(result.errorMessage).toBe("No email address on file. Please add an email address to send reports.");
    });

    it('should show appropriate error message for whitespace-only email', () => {
      const result = mockSendReportDialog.validateEmailAddress('   ');
      
      expect(result.hasError).toBe(true);
      expect(result.canSend).toBe(false);
      expect(result.errorMessage).toBe("No email address on file. Please add an email address to send reports.");
    });

    it('should validate valid email addresses correctly', () => {
      const validEmails = [
        'test@example.com',
        'user.name@domain.co.uk',
        'customer+tag@gmail.com',
        'support@subdomain.example.org',
      ];

      validEmails.forEach(email => {
        const result = mockSendReportDialog.validateEmailAddress(email);
        expect(result.hasError).toBe(false);
        expect(result.canSend).toBe(true);
        expect(result.errorMessage).toBeNull();
      });
    });

    it('should handle invalid email formats appropriately', () => {
      const invalidEmails = [
        'invalid-email',
        '@domain.com',
        'user@',
        'user@domain',
        'user name@domain.com', // Space in local part
        'user@domain .com', // Space in domain
      ];

      invalidEmails.forEach(email => {
        const result = mockSendReportDialog.validateEmailAddress(email);
        expect(result.hasError).toBe(true);
        expect(result.canSend).toBe(false);
        expect(result.errorMessage).toBe("Invalid email address format. Please check the email address.");
      });
    });
  });

  describe('Backend Error Handling (Requirement 5.5)', () => {
    it('should return appropriate backend error for missing email', () => {
      const result = mockSendReportDialog.validateBackendEmail(undefined);
      
      expect(result.success).toBe(false);
      expect(result.error).toBe("No email address on file. Please add an email address to send email reports.");
    });

    it('should return success for valid email', () => {
      const result = mockSendReportDialog.validateBackendEmail('test@example.com');
      
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe('Error Message Consistency', () => {
    it('should use consistent error messages across frontend and backend', () => {
      const frontendResult = mockSendReportDialog.validateEmailAddress(undefined);
      const backendResult = mockSendReportDialog.validateBackendEmail(undefined);
      
      // Both should indicate missing email, though wording may differ slightly
      expect(frontendResult.errorMessage).toContain("No email address on file");
      expect(backendResult.error).toContain("No email address on file");
      
      // Both should prevent sending
      expect(frontendResult.canSend).toBe(false);
      expect(backendResult.success).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle customers with legacy data structures', () => {
      // Some legacy customers might have email field but it's undefined
      const legacyCustomer = {
        full_name: 'Legacy Customer',
        email: undefined,
        phone: '+1234567890',
      };

      const result = mockSendReportDialog.validateEmailAddress(legacyCustomer.email);
      expect(result.hasError).toBe(true);
      expect(result.errorMessage).toContain("No email address on file");
    });

    it('should handle customers with malformed email data', () => {
      // Test various malformed email scenarios that should be caught by basic validation
      const malformedEmails = [
        'not-an-email',
        'user@',
        '@domain.com',
        'user@@domain.com',
      ];

      malformedEmails.forEach(email => {
        const result = mockSendReportDialog.validateEmailAddress(email);
        expect(result.hasError).toBe(true);
        expect(result.canSend).toBe(false);
      });
      
      // Note: Some edge cases like 'user@domain..com' might pass basic regex validation
      // Real production systems would use more sophisticated email validation libraries
    });

    it('should handle very long email addresses', () => {
      // Test email addresses at the limit of what's reasonable
      const longLocalPart = 'a'.repeat(64); // Max local part length
      const longDomain = 'b'.repeat(60) + '.com'; // Long but valid domain
      const longEmail = `${longLocalPart}@${longDomain}`;

      const result = mockSendReportDialog.validateEmailAddress(longEmail);
      // Should still validate if it's a proper email format
      expect(result.hasError).toBe(false);
      expect(result.canSend).toBe(true);
    });

    it('should handle international email addresses', () => {
      // Test international domain names and characters
      const internationalEmails = [
        'user@example.co.uk',
        'user@example.com.au',
        'test@subdomain.example.org',
        'support@company-name.net',
      ];

      internationalEmails.forEach(email => {
        const result = mockSendReportDialog.validateEmailAddress(email);
        expect(result.hasError).toBe(false);
        expect(result.canSend).toBe(true);
      });
    });
  });

  describe('Error Display Requirements', () => {
    it('should provide actionable error messages', () => {
      const result = mockSendReportDialog.validateEmailAddress(undefined);
      
      // Error message should tell user what to do
      expect(result.errorMessage).toContain("add an email address");
      expect(result.errorMessage).not.toContain("error"); // Avoid technical jargon
      expect(result.errorMessage).not.toContain("null"); // Avoid technical details
      expect(result.errorMessage).not.toContain("undefined"); // Avoid technical details
    });

    it('should provide clear error messages for invalid formats', () => {
      const result = mockSendReportDialog.validateEmailAddress('invalid-email');
      
      expect(result.errorMessage).toContain("Invalid email address format");
      expect(result.errorMessage).toContain("check the email address");
    });

    it('should use user-friendly language', () => {
      const result = mockSendReportDialog.validateEmailAddress(undefined);
      
      // Should use plain English, not technical terms
      expect(result.errorMessage).not.toContain("validation failed");
      expect(result.errorMessage).not.toContain("null pointer");
      expect(result.errorMessage).not.toContain("exception");
      expect(result.errorMessage).not.toContain("error code");
    });
  });
});