/**
 * Security Tests for Validation Module
 * 
 * Tests the validation and sanitization utilities to ensure
 * they properly protect against security vulnerabilities.
 */

import { describe, it, expect } from 'vitest';
import {
  isValidChemical,
  isValidReading,
  isValidCategory,
  validateNumeric,
  validatePoolGallons,
  validatePercentage,
  validateCorrelationStrength,
  validateStringLength,
  sanitizeId,
  escapeHtml,
  escapeCsvValue,
  validateArray,
  validateEvidence,
  isValidDateString,
  validateDateRange,
  validateServiceLog,
  validateServiceLogs,
  generateSecureId,
  calculateBoundedConfidence,
  VALID_CHEMICALS,
  VALID_READINGS,
  BOUNDS,
} from './validation';

describe('Validation Module - Security Tests', () => {
  describe('Chemical Validation (Prototype Pollution Prevention)', () => {
    it('should accept valid chemical names', () => {
      expect(isValidChemical('ph')).toBe(true);
      expect(isValidChemical('chlorine')).toBe(true);
      expect(isValidChemical('alkalinity')).toBe(true);
      expect(isValidChemical('stabilizer')).toBe(true);
    });

    it('should reject prototype pollution attempts', () => {
      expect(isValidChemical('__proto__')).toBe(false);
      expect(isValidChemical('constructor')).toBe(false);
      expect(isValidChemical('prototype')).toBe(false);
      expect(isValidChemical('hasOwnProperty')).toBe(false);
    });

    it('should reject invalid chemical names', () => {
      expect(isValidChemical('invalid')).toBe(false);
      expect(isValidChemical('')).toBe(false);
      expect(isValidChemical(null)).toBe(false);
      expect(isValidChemical(undefined)).toBe(false);
      expect(isValidChemical(123)).toBe(false);
    });
  });

  describe('Reading Validation', () => {
    it('should accept valid readings', () => {
      expect(isValidReading('good')).toBe(true);
      expect(isValidReading('low')).toBe(true);
      expect(isValidReading('high')).toBe(true);
      expect(isValidReading('critical')).toBe(true);
    });

    it('should reject invalid readings', () => {
      expect(isValidReading('invalid')).toBe(false);
      expect(isValidReading('')).toBe(false);
      expect(isValidReading(null)).toBe(false);
    });
  });

  describe('Numeric Validation (Bounds Checking)', () => {
    it('should validate pool gallons within bounds', () => {
      expect(validatePoolGallons(10000)).toBe(10000);
      expect(validatePoolGallons(100)).toBe(100);
      expect(validatePoolGallons(1000000)).toBe(1000000);
    });

    it('should reject pool gallons outside bounds', () => {
      expect(validatePoolGallons(50)).toBeNull(); // Below min
      expect(validatePoolGallons(2000000)).toBeNull(); // Above max
      expect(validatePoolGallons(-1000)).toBeNull(); // Negative
      expect(validatePoolGallons(Infinity)).toBeNull();
      expect(validatePoolGallons(NaN)).toBeNull();
      expect(validatePoolGallons(null)).toBeNull();
    });

    it('should validate percentages within bounds', () => {
      expect(validatePercentage(0)).toBe(0);
      expect(validatePercentage(50)).toBe(50);
      expect(validatePercentage(100)).toBe(100);
    });

    it('should reject percentages outside bounds', () => {
      expect(validatePercentage(-1)).toBeNull();
      expect(validatePercentage(101)).toBeNull();
      expect(validatePercentage(Infinity)).toBeNull();
    });

    it('should validate correlation strength within bounds', () => {
      expect(validateCorrelationStrength(0)).toBe(0);
      expect(validateCorrelationStrength(0.5)).toBe(0.5);
      expect(validateCorrelationStrength(1)).toBe(1);
    });

    it('should reject correlation strength outside bounds', () => {
      expect(validateCorrelationStrength(-0.1)).toBeNull();
      expect(validateCorrelationStrength(1.1)).toBeNull();
    });
  });

  describe('XSS Prevention (HTML Escaping)', () => {
    it('should escape HTML special characters', () => {
      expect(escapeHtml('<script>alert("xss")</script>')).toBe(
        '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
      );
    });

    it('should escape all dangerous characters', () => {
      expect(escapeHtml('&')).toBe('&amp;');
      expect(escapeHtml('<')).toBe('&lt;');
      expect(escapeHtml('>')).toBe('&gt;');
      expect(escapeHtml('"')).toBe('&quot;');
      expect(escapeHtml("'")).toBe('&#039;');
    });

    it('should handle null and undefined', () => {
      expect(escapeHtml(null)).toBe('');
      expect(escapeHtml(undefined)).toBe('');
    });

    it('should convert non-strings to strings', () => {
      expect(escapeHtml(123)).toBe('123');
      expect(escapeHtml(true)).toBe('true');
    });
  });

  describe('CSV Injection Prevention', () => {
    it('should escape formula injection attempts', () => {
      expect(escapeCsvValue('=SUM(A1:A10)')).toBe("'=SUM(A1:A10)");
      expect(escapeCsvValue('+1234567890')).toBe("'+1234567890");
      expect(escapeCsvValue('-1234567890')).toBe("'-1234567890");
      expect(escapeCsvValue('@SUM(A1)')).toBe("'@SUM(A1)");
    });

    it('should quote values with special characters', () => {
      expect(escapeCsvValue('hello,world')).toBe('"hello,world"');
      expect(escapeCsvValue('hello"world')).toBe('"hello""world"');
      expect(escapeCsvValue('hello\nworld')).toBe('"hello\nworld"');
    });

    it('should handle null and undefined', () => {
      expect(escapeCsvValue(null)).toBe('');
      expect(escapeCsvValue(undefined)).toBe('');
    });
  });

  describe('ID Sanitization (Injection Prevention)', () => {
    it('should sanitize IDs to alphanumeric + hyphens', () => {
      expect(sanitizeId('valid-id-123')).toBe('valid-id-123');
      expect(sanitizeId('UPPERCASE')).toBe('uppercase');
    });

    it('should remove dangerous characters', () => {
      expect(sanitizeId('id<script>')).toBe('idscript');
      expect(sanitizeId('id__proto__')).toBe('idproto'); // Underscores removed
      expect(sanitizeId('id/../../../etc/passwd')).toBe('idetcpasswd');
    });

    it('should return null for empty results', () => {
      expect(sanitizeId('!@#$%')).toBeNull();
      expect(sanitizeId('')).toBeNull();
    });
  });

  describe('Array Validation (DoS Prevention)', () => {
    it('should truncate arrays exceeding max size', () => {
      const largeArray = new Array(20000).fill('item');
      const result = validateArray(largeArray, 100);
      expect(result.length).toBe(100);
    });

    it('should return empty array for non-arrays', () => {
      expect(validateArray(null)).toEqual([]);
      expect(validateArray(undefined)).toEqual([]);
      expect(validateArray('string')).toEqual([]);
      expect(validateArray(123)).toEqual([]);
    });

    it('should return copy of valid arrays', () => {
      const original = [1, 2, 3];
      const result = validateArray(original);
      expect(result).toEqual([1, 2, 3]);
      expect(result).not.toBe(original); // Should be a copy
    });
  });

  describe('Evidence Validation', () => {
    it('should limit evidence to specified count', () => {
      const evidence = ['a', 'b', 'c', 'd', 'e', 'f'];
      expect(validateEvidence(evidence, 3)).toEqual(['a', 'b', 'c']);
    });

    it('should handle empty arrays', () => {
      expect(validateEvidence([])).toEqual([]);
    });
  });

  describe('Date Validation', () => {
    it('should accept valid date strings', () => {
      expect(isValidDateString('2024-01-15')).toBe(true);
      expect(isValidDateString('2024-01-15T10:30:00Z')).toBe(true);
    });

    it('should reject invalid date strings', () => {
      expect(isValidDateString('invalid')).toBe(false);
      expect(isValidDateString('')).toBe(false);
      expect(isValidDateString(null)).toBe(false);
      expect(isValidDateString(123)).toBe(false);
    });

    it('should validate date ranges', () => {
      expect(validateDateRange({ start: '2024-01-01', end: '2024-12-31' })).toBe(true);
      expect(validateDateRange({ start: '2024-01-01', end: '2024-01-01' })).toBe(true);
    });

    it('should reject invalid date ranges', () => {
      expect(validateDateRange({ start: '2024-12-31', end: '2024-01-01' })).toBe(false);
      expect(validateDateRange({ start: 'invalid', end: '2024-01-01' })).toBe(false);
    });
  });

  describe('Service Log Validation', () => {
    it('should accept valid service logs', () => {
      const validLog = {
        id: 1,
        service_date: '2024-01-15',
        ph: 'good',
        chlorine: 'low',
        alkalinity: 'high',
        stabilizer: 'critical',
      };
      expect(validateServiceLog(validLog)).toBe(true);
    });

    it('should reject invalid service logs', () => {
      expect(validateServiceLog(null)).toBe(false);
      expect(validateServiceLog({})).toBe(false);
      expect(validateServiceLog({ id: 1 })).toBe(false);
      expect(validateServiceLog({
        id: 1,
        service_date: '2024-01-15',
        ph: 'invalid', // Invalid reading
        chlorine: 'good',
        alkalinity: 'good',
        stabilizer: 'good',
      })).toBe(false);
    });

    it('should filter invalid logs from array', () => {
      const logs = [
        { id: 1, service_date: '2024-01-15', ph: 'good', chlorine: 'good', alkalinity: 'good', stabilizer: 'good' },
        { id: 2, service_date: '2024-01-16', ph: 'invalid', chlorine: 'good', alkalinity: 'good', stabilizer: 'good' },
        { id: 3, service_date: '2024-01-17', ph: 'low', chlorine: 'high', alkalinity: 'critical', stabilizer: 'good' },
      ];
      const result = validateServiceLogs(logs);
      expect(result.length).toBe(2);
      expect(result[0].id).toBe(1);
      expect(result[1].id).toBe(3);
    });
  });

  describe('Secure ID Generation', () => {
    it('should generate sanitized IDs', () => {
      const id = generateSecureId('test', 'part1', 'part2', 123);
      expect(id).toMatch(/^test-part1-part2-123-\d+$/);
    });

    it('should sanitize dangerous inputs', () => {
      const id = generateSecureId('test<script>', '../etc', 456);
      expect(id).not.toContain('<');
      expect(id).not.toContain('>');
      expect(id).not.toContain('/');
    });
  });

  describe('Bounded Confidence Calculation', () => {
    it('should calculate confidence within bounds', () => {
      expect(calculateBoundedConfidence(50, 20)).toBe(70);
      expect(calculateBoundedConfidence(50, 50)).toBe(95); // Capped at max
      expect(calculateBoundedConfidence(50, -60)).toBe(0); // Capped at 0
    });

    it('should respect custom max confidence', () => {
      expect(calculateBoundedConfidence(50, 100, 80)).toBe(80);
    });
  });
});
