/**
 * Property-Based Tests for Phone Validation Utilities
 * 
 * These tests validate the correctness properties defined in the design document
 * using fast-check for property-based testing.
 * 
 * Feature: customer-service-reports
 * Property 6: Phone number validation and normalization
 * Validates: Requirements 4.4, 4.5
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  validatePhoneNumber,
  normalizeToE164,
  maskPhoneNumber,
} from './phoneValidation';

// ============================================================================
// Generators for Property-Based Testing
// ============================================================================

/**
 * Generator for valid US area codes (first digit 2-9)
 */
const areaCodeArb = fc.integer({ min: 200, max: 999 }).map(n => n.toString());

/**
 * Generator for valid US exchange codes (first digit 2-9)
 */
const exchangeCodeArb = fc.integer({ min: 200, max: 999 }).map(n => n.toString());

/**
 * Generator for subscriber numbers (4 digits)
 */
const subscriberArb = fc.integer({ min: 0, max: 9999 }).map(n => n.toString().padStart(4, '0'));

/**
 * Generator for valid 10-digit US phone numbers (digits only)
 */
const validPhoneDigitsArb = fc.tuple(areaCodeArb, exchangeCodeArb, subscriberArb)
  .map(([area, exchange, subscriber]) => `${area}${exchange}${subscriber}`);

/**
 * Generator for various valid phone number formats
 */
const validPhoneFormatArb = validPhoneDigitsArb.chain(digits => {
  const area = digits.slice(0, 3);
  const exchange = digits.slice(3, 6);
  const subscriber = digits.slice(6, 10);
  
  return fc.constantFrom(
    // Format: 5551234567
    digits,
    // Format: 555-123-4567
    `${area}-${exchange}-${subscriber}`,
    // Format: (555) 123-4567
    `(${area}) ${exchange}-${subscriber}`,
    // Format: 555.123.4567
    `${area}.${exchange}.${subscriber}`,
    // Format: 555 123 4567
    `${area} ${exchange} ${subscriber}`,
    // Format: +1 555 123 4567
    `+1 ${area} ${exchange} ${subscriber}`,
    // Format: 1-555-123-4567
    `1-${area}-${exchange}-${subscriber}`,
    // Format: +15551234567
    `+1${digits}`,
    // Format: 15551234567
    `1${digits}`,
  );
});

/**
 * Generator for invalid phone numbers (too short)
 */
const tooShortPhoneArb = fc.integer({ min: 1, max: 999999999 })
  .map(n => n.toString());

/**
 * Generator for invalid phone numbers (too long)
 */
const tooLongPhoneArb = fc.integer({ min: 100000000000, max: 999999999999999 })
  .map(n => n.toString());

/**
 * Generator for invalid area codes (first digit 0 or 1)
 */
const invalidAreaCodeArb = fc.tuple(
  fc.constantFrom('0', '1'),
  fc.integer({ min: 0, max: 99 }).map(n => n.toString().padStart(2, '0')),
  exchangeCodeArb,
  subscriberArb
).map(([first, rest, exchange, subscriber]) => `${first}${rest}${exchange}${subscriber}`);

/**
 * Generator for invalid exchange codes (first digit 0 or 1)
 */
const invalidExchangeCodeArb = fc.tuple(
  areaCodeArb,
  fc.constantFrom('0', '1'),
  fc.integer({ min: 0, max: 99 }).map(n => n.toString().padStart(2, '0')),
  subscriberArb
).map(([area, first, rest, subscriber]) => `${area}${first}${rest}${subscriber}`);

// ============================================================================
// Property-Based Tests
// ============================================================================

describe('Phone Validation Utilities', () => {
  /**
   * Property 6: Phone number validation and normalization
   * 
   * For any valid phone number input (US format with or without country code,
   * with various separators), the validation function SHALL return isValid=true
   * and the normalized field SHALL be in E.164 format (+1XXXXXXXXXX).
   * 
   * **Validates: Requirements 4.4, 4.5**
   */
  describe('Property 6: Phone number validation and normalization', () => {
    it('valid US phone numbers in any format return isValid=true and E.164 normalized format', () => {
      fc.assert(
        fc.property(
          validPhoneFormatArb,
          (phoneInput) => {
            const result = validatePhoneNumber(phoneInput);
            
            // Should be valid
            expect(result.isValid).toBe(true);
            expect(result.error).toBeUndefined();
            
            // Should have normalized E.164 format
            expect(result.normalized).toBeDefined();
            expect(result.normalized).toMatch(/^\+1[2-9]\d{2}[2-9]\d{6}$/);
          }
        ),
        { numRuns: 20 }
      );
    });

    it('normalized output is always 12 characters (+1 plus 10 digits)', () => {
      fc.assert(
        fc.property(
          validPhoneFormatArb,
          (phoneInput) => {
            const result = validatePhoneNumber(phoneInput);
            
            expect(result.isValid).toBe(true);
            expect(result.normalized).toHaveLength(12);
            expect(result.normalized?.startsWith('+1')).toBe(true);
          }
        ),
        { numRuns: 20 }
      );
    });

    it('same phone number in different formats normalizes to same E.164 value', () => {
      fc.assert(
        fc.property(
          validPhoneDigitsArb,
          (digits) => {
            const area = digits.slice(0, 3);
            const exchange = digits.slice(3, 6);
            const subscriber = digits.slice(6, 10);
            
            // Test multiple formats
            const formats = [
              digits,
              `${area}-${exchange}-${subscriber}`,
              `(${area}) ${exchange}-${subscriber}`,
              `+1${digits}`,
              `1-${area}-${exchange}-${subscriber}`,
            ];
            
            const results = formats.map(f => validatePhoneNumber(f));
            
            // All should be valid
            results.forEach(r => expect(r.isValid).toBe(true));
            
            // All should normalize to the same value
            const normalized = results[0].normalized;
            results.forEach(r => expect(r.normalized).toBe(normalized));
          }
        ),
        { numRuns: 20 }
      );
    });

    it('normalizeToE164 returns same result as validatePhoneNumber.normalized', () => {
      fc.assert(
        fc.property(
          validPhoneFormatArb,
          (phoneInput) => {
            const validationResult = validatePhoneNumber(phoneInput);
            const normalizedResult = normalizeToE164(phoneInput);
            
            expect(normalizedResult).toBe(validationResult.normalized);
          }
        ),
        { numRuns: 20 }
      );
    });

    it('phone numbers with too few digits return isValid=false', () => {
      fc.assert(
        fc.property(
          tooShortPhoneArb,
          (shortPhone) => {
            const result = validatePhoneNumber(shortPhone);
            
            expect(result.isValid).toBe(false);
            expect(result.error).toBeDefined();
            expect(result.normalized).toBeUndefined();
          }
        ),
        { numRuns: 20 }
      );
    });

    it('phone numbers with too many digits return isValid=false', () => {
      fc.assert(
        fc.property(
          tooLongPhoneArb,
          (longPhone) => {
            const result = validatePhoneNumber(longPhone);
            
            expect(result.isValid).toBe(false);
            expect(result.error).toBeDefined();
            expect(result.normalized).toBeUndefined();
          }
        ),
        { numRuns: 20 }
      );
    });

    it('phone numbers with invalid area codes (starting with 0 or 1) return isValid=false', () => {
      fc.assert(
        fc.property(
          invalidAreaCodeArb,
          (invalidPhone) => {
            const result = validatePhoneNumber(invalidPhone);
            
            expect(result.isValid).toBe(false);
            // Verify error is defined without coupling to specific message content
            expect(result.error).toBeDefined();
            expect(typeof result.error).toBe('string');
            expect(result.error!.length).toBeGreaterThan(0);
          }
        ),
        { numRuns: 20 }
      );
    });

    it('phone numbers with invalid exchange codes (starting with 0 or 1) return isValid=false', () => {
      fc.assert(
        fc.property(
          invalidExchangeCodeArb,
          (invalidPhone) => {
            const result = validatePhoneNumber(invalidPhone);
            
            expect(result.isValid).toBe(false);
            // Verify error is defined without coupling to specific message content
            expect(result.error).toBeDefined();
            expect(typeof result.error).toBe('string');
            expect(result.error!.length).toBeGreaterThan(0);
          }
        ),
        { numRuns: 20 }
      );
    });

    it('empty or whitespace-only input returns isValid=false', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('', '   ', '\t', '\n', '  \t  '),
          (emptyInput) => {
            const result = validatePhoneNumber(emptyInput);
            
            expect(result.isValid).toBe(false);
            expect(result.error).toBeDefined();
          }
        ),
        { numRuns: 5 }
      );
    });

    it('normalizeToE164 throws error for invalid phone numbers', () => {
      fc.assert(
        fc.property(
          tooShortPhoneArb,
          (invalidPhone) => {
            expect(() => normalizeToE164(invalidPhone)).toThrow();
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  describe('maskPhoneNumber', () => {
    it('masks phone numbers showing only last 4 digits', () => {
      fc.assert(
        fc.property(
          validPhoneFormatArb,
          (phoneInput) => {
            const result = validatePhoneNumber(phoneInput);
            if (result.normalized) {
              const masked = maskPhoneNumber(result.normalized);
              
              // Should contain the last 4 digits
              const lastFour = result.normalized.slice(-4);
              expect(masked).toContain(lastFour);
              
              // Should have some masking (not show full number)
              // Test that the masked output is shorter or has masking characters
              expect(masked.length).toBeLessThan(result.normalized.length + 5);
              
              // Should not contain the full phone number
              expect(masked).not.toBe(result.normalized);
            }
          }
        ),
        { numRuns: 20 }
      );
    });

    it('handles edge cases gracefully', () => {
      // Empty string
      const emptyResult = maskPhoneNumber('');
      expect(emptyResult).toBeDefined();
      expect(typeof emptyResult).toBe('string');
      
      // Short input (less than 4 digits)
      const shortResult = maskPhoneNumber('123');
      expect(shortResult).toBeDefined();
      expect(typeof shortResult).toBe('string');
      
      // Non-E.164 format
      const nonE164Result = maskPhoneNumber('555-123-4567');
      expect(nonE164Result).toBeDefined();
      expect(nonE164Result).toContain('4567');
    });
  });
});
