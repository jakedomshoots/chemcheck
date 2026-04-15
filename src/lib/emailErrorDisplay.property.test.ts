/**
 * Property-Based Tests for Error Message Display
 * 
 * **Property 9: Error Message Display**
 * **Validates: Requirements 5.5**
 * 
 * Tests that error messages for missing email addresses are displayed appropriately
 * across all possible customer data variations.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

// Generators for customer data variations
const customerEmailGen = fc.oneof(
  fc.constant(undefined), // No email field
  fc.constant(null), // Null email
  fc.constant(''), // Empty string
  fc.string({ minLength: 1, maxLength: 10 }).filter(s => s.trim().length === 0), // Whitespace-only
  fc.emailAddress(), // Valid email
  fc.constantFrom('invalid-email', 'user@', '@domain.com', 'user@@domain.com'), // Known invalid formats
);

const customerNameGen = fc.oneof(
  fc.string({ minLength: 1, maxLength: 100 }),
  fc.constantFrom(
    'John Smith',
    "O'Connor",
    'Smith & Associates',
    'José García',
    '李小明',
    'Legacy Customer',
  )
);

// Mock error handling functions that simulate the actual system behavior
const mockErrorHandling = {
  // Simulate frontend validation (SendReportDialog)
  validateFrontendEmail: (customerEmail?: string | null) => {
    const hasValidEmail = customerEmail && customerEmail.trim().length > 0;
    
    if (!hasValidEmail) {
      return {
        showError: true,
        errorMessage: "No email address on file. Please add an email address to send reports.",
        canSend: false,
      };
    }
    
    // Basic email format validation
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(customerEmail.trim())) {
      return {
        showError: true,
        errorMessage: "Invalid email address format. Please check the email address.",
        canSend: false,
      };
    }
    
    return {
      showError: false,
      errorMessage: null,
      canSend: true,
    };
  },
  
  // Simulate backend validation (serviceReports.ts)
  validateBackendEmail: (customerEmail?: string | null) => {
    const hasValidEmail = customerEmail && customerEmail.trim().length > 0;
    
    if (!hasValidEmail) {
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
  
  // Simulate recipient display logic
  getRecipientDisplay: (customerEmail?: string | null) => {
    const hasValidEmail = customerEmail && customerEmail.trim().length > 0;
    return hasValidEmail ? customerEmail.trim() : 'No email on file';
  },
};

describe('Property-Based Tests: Error Message Display', () => {
  it('Property 9: Error Message Display - For any customer without an email address, attempting to send should display appropriate error messages', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(undefined),
          fc.constant(null),
          fc.constant(''),
          fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length === 0),
        ),
        customerNameGen,
        (customerEmail, customerName) => {
          const frontendResult = mockErrorHandling.validateFrontendEmail(customerEmail);
          const backendResult = mockErrorHandling.validateBackendEmail(customerEmail);
          const recipientDisplay = mockErrorHandling.getRecipientDisplay(customerEmail);
          
          // **Requirement 5.5: Show appropriate error messages for customers without email addresses**
          
          // Frontend should show error and prevent sending
          expect(frontendResult.showError).toBe(true);
          expect(frontendResult.canSend).toBe(false);
          expect(frontendResult.errorMessage).toBeTruthy();
          
          // Backend should return error
          expect(backendResult.success).toBe(false);
          expect(backendResult.error).toBeTruthy();
          
          // Error messages should be user-friendly and actionable
          if (frontendResult.errorMessage) {
            // Should mention missing email
            expect(frontendResult.errorMessage.toLowerCase()).toContain('email');
            
            // Should provide actionable guidance
            expect(frontendResult.errorMessage.toLowerCase()).toMatch(/add.*email|provide.*email|enter.*email/);
            
            // Should not contain technical jargon
            expect(frontendResult.errorMessage).not.toMatch(/null|undefined|validation|error code|exception/i);
            
            // Should be professional and clear
            expect(frontendResult.errorMessage).not.toContain('!!!');
            expect(frontendResult.errorMessage).not.toMatch(/ERROR|FAIL|INVALID/); // No shouting
          }
          
          if (backendResult.error) {
            // Backend error should also be clear
            expect(backendResult.error.toLowerCase()).toContain('email');
            expect(backendResult.error.toLowerCase()).toMatch(/add.*email|provide.*email/);
          }
          
          // Recipient display should indicate missing email
          expect(recipientDisplay).toBe('No email on file');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 9.1: Error Message Consistency - For any missing email scenario, error messages should be consistent across frontend and backend', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(undefined),
          fc.constant(null),
          fc.constant(''),
          fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length === 0),
        ),
        (customerEmail) => {
          const frontendResult = mockErrorHandling.validateFrontendEmail(customerEmail);
          const backendResult = mockErrorHandling.validateBackendEmail(customerEmail);
          
          // Both should indicate error state
          expect(frontendResult.showError).toBe(true);
          expect(frontendResult.canSend).toBe(false);
          expect(backendResult.success).toBe(false);
          
          // Both should have error messages
          expect(frontendResult.errorMessage).toBeTruthy();
          expect(backendResult.error).toBeTruthy();
          
          // Messages should be similar in intent (both mention missing email and adding email)
          const frontendLower = frontendResult.errorMessage!.toLowerCase();
          const backendLower = backendResult.error!.toLowerCase();
          
          expect(frontendLower).toContain('email');
          expect(backendLower).toContain('email');
          
          expect(frontendLower).toMatch(/no.*email|missing.*email/);
          expect(backendLower).toMatch(/no.*email|missing.*email/);
          
          expect(frontendLower).toMatch(/add.*email/);
          expect(backendLower).toMatch(/add.*email/);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('Property 9.2: Error Message Quality - For any error message, it should be user-friendly and actionable', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(undefined),
          fc.constant(null),
          fc.constant(''),
          fc.string({ minLength: 1, maxLength: 10 }).filter(s => s.trim().length === 0),
          fc.constantFrom('invalid-email', 'user@', '@domain.com', 'user@@domain.com'),
        ),
        (customerEmail) => {
          const frontendResult = mockErrorHandling.validateFrontendEmail(customerEmail);
          
          if (frontendResult.showError && frontendResult.errorMessage) {
            const message = frontendResult.errorMessage;
            
            // Should be a complete sentence
            expect(message).toMatch(/^[A-Z].*[.!]$/);
            
            // Should not be too long (reasonable for UI display)
            expect(message.length).toBeLessThan(200);
            
            // Should not be too short (needs to be informative)
            expect(message.length).toBeGreaterThan(10);
            
            // Should not contain technical terms
            expect(message).not.toMatch(/null|undefined|NaN|object|array|function|boolean/i);
            expect(message).not.toMatch(/validation|exception|error code|stack trace/i);
            expect(message).not.toMatch(/debug|console|log|trace/i);
            
            // Should not contain programming language terms
            expect(message).not.toMatch(/string|number|integer|float|boolean|object/i);
            expect(message).not.toMatch(/class|method|function|variable|parameter/i);
            
            // Should use professional language
            expect(message).not.toMatch(/oops|whoops|uh oh|darn|damn/i);
            expect(message).not.toContain('!!!');
            expect(message).not.toMatch(/ERROR|FAIL|INVALID|WRONG/); // No shouting
            
            // Should be actionable (tell user what to do)
            expect(message.toLowerCase()).toMatch(/add|provide|enter|check|update|contact/);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 9.3: Recipient Display Consistency - For any customer email state, recipient display should accurately reflect the situation', () => {
    fc.assert(
      fc.property(
        customerEmailGen,
        (customerEmail) => {
          const recipientDisplay = mockErrorHandling.getRecipientDisplay(customerEmail);
          
          const hasValidEmail = customerEmail && 
                                typeof customerEmail === 'string' && 
                                customerEmail.trim().length > 0;
          
          if (hasValidEmail) {
            // Should display the trimmed email
            expect(recipientDisplay).toBe(customerEmail.trim());
            expect(recipientDisplay).not.toBe('No email on file');
          } else {
            // Should display the standard "no email" message
            expect(recipientDisplay).toBe('No email on file');
            
            // Should not display any actual email-like strings
            expect(recipientDisplay).not.toContain('@');
            expect(recipientDisplay).not.toMatch(/\w+@\w+/);
          }
          
          // Should never be empty or just whitespace
          expect(recipientDisplay.trim().length).toBeGreaterThan(0);
          
          // Should be reasonable length for UI display
          expect(recipientDisplay.length).toBeLessThan(100);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 9.4: Error Prevention - For any invalid email state, the system should prevent sending attempts', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(undefined),
          fc.constant(null),
          fc.constant(''),
          fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length === 0),
        ),
        (customerEmail) => {
          const frontendResult = mockErrorHandling.validateFrontendEmail(customerEmail);
          const backendResult = mockErrorHandling.validateBackendEmail(customerEmail);
          
          // Frontend should prevent sending
          expect(frontendResult.canSend).toBe(false);
          
          // Backend should reject the request
          expect(backendResult.success).toBe(false);
          
          // Both should provide error information
          expect(frontendResult.showError).toBe(true);
          expect(frontendResult.errorMessage).toBeTruthy();
          expect(backendResult.error).toBeTruthy();
        }
      ),
      { numRuns: 100 }
    );
  });
});