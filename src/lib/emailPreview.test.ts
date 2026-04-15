/**
 * Property-Based Tests for Email Preview Accuracy
 * 
 * These tests validate that the frontend email preview generation
 * produces identical output to the backend email generation.
 * 
 * Feature: simple-email-notifications
 * Property 6: Email Preview Accuracy
 * Validates: Requirements 4.4
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { 
  generateSimpleEmailContent as frontendGenerate, 
  escapeHtml as frontendEscapeHtml,
  EmailContentParams 
} from './emailPreview';
import { 
  generateSimpleEmailContent as backendGenerate, 
  escapeHtml as backendEscapeHtml 
} from '../../convex/serviceReports';

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

// ============================================================================
// Property-Based Tests
// ============================================================================

describe('Email Preview Accuracy Property Tests', () => {
  
  describe('Property 6: Email Preview Accuracy', () => {
    /**
     * Property 6: Email Preview Accuracy
     * *For any* email generation parameters, the preview content should match
     * exactly what would be sent in the actual email.
     * 
     * **Validates: Requirements 4.4**
     */
    
    it('frontend and backend escapeHtml produce identical output', async () => {
      await fc.assert(
        fc.property(
          fc.string(),
          (input: string) => {
            const frontendResult = frontendEscapeHtml(input);
            const backendResult = backendEscapeHtml(input);
            
            expect(frontendResult).toBe(backendResult);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('frontend and backend generateSimpleEmailContent produce identical subject lines', async () => {
      await fc.assert(
        fc.property(
          emailContentParamsArb,
          (params: EmailContentParams) => {
            const frontendResult = frontendGenerate(params);
            const backendResult = backendGenerate(params);
            
            // Subject lines must be identical
            expect(frontendResult.subject).toBe(backendResult.subject);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('frontend and backend generateSimpleEmailContent produce identical HTML bodies', async () => {
      await fc.assert(
        fc.property(
          emailContentParamsArb,
          (params: EmailContentParams) => {
            const frontendResult = frontendGenerate(params);
            const backendResult = backendGenerate(params);
            
            // HTML bodies must be identical
            expect(frontendResult.htmlBody).toBe(backendResult.htmlBody);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('frontend and backend generateSimpleEmailContent produce identical text bodies', async () => {
      await fc.assert(
        fc.property(
          emailContentParamsArb,
          (params: EmailContentParams) => {
            const frontendResult = frontendGenerate(params);
            const backendResult = backendGenerate(params);
            
            // Text bodies must be identical
            expect(frontendResult.textBody).toBe(backendResult.textBody);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('preview matches actual email for good status', async () => {
      const goodStatusParamsArb: fc.Arbitrary<EmailContentParams> = fc.record({
        customerName: customerNameArb,
        serviceDate: serviceDateArb,
        poolStatus: fc.constant<'good'>('good'),
        customNote: fc.constant(undefined),
      });

      await fc.assert(
        fc.property(
          goodStatusParamsArb,
          (params: EmailContentParams) => {
            const frontendResult = frontendGenerate(params);
            const backendResult = backendGenerate(params);
            
            // All fields must match exactly
            expect(frontendResult.subject).toBe(backendResult.subject);
            expect(frontendResult.htmlBody).toBe(backendResult.htmlBody);
            expect(frontendResult.textBody).toBe(backendResult.textBody);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('preview matches actual email for needs_attention status with custom note', async () => {
      const needsAttentionWithNoteArb: fc.Arbitrary<EmailContentParams> = fc.record({
        customerName: customerNameArb,
        serviceDate: serviceDateArb,
        poolStatus: fc.constant<'needs_attention'>('needs_attention'),
        customNote: fc.string({ minLength: 1, maxLength: 500 })
          .filter(note => note.trim().length > 0)
          .map(note => note.trim()),
      });

      await fc.assert(
        fc.property(
          needsAttentionWithNoteArb,
          (params: EmailContentParams) => {
            const frontendResult = frontendGenerate(params);
            const backendResult = backendGenerate(params);
            
            // All fields must match exactly
            expect(frontendResult.subject).toBe(backendResult.subject);
            expect(frontendResult.htmlBody).toBe(backendResult.htmlBody);
            expect(frontendResult.textBody).toBe(backendResult.textBody);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('preview matches actual email for needs_attention status without custom note', async () => {
      const needsAttentionWithoutNoteArb: fc.Arbitrary<EmailContentParams> = fc.record({
        customerName: customerNameArb,
        serviceDate: serviceDateArb,
        poolStatus: fc.constant<'needs_attention'>('needs_attention'),
        customNote: fc.constant(undefined),
      });

      await fc.assert(
        fc.property(
          needsAttentionWithoutNoteArb,
          (params: EmailContentParams) => {
            const frontendResult = frontendGenerate(params);
            const backendResult = backendGenerate(params);
            
            // All fields must match exactly
            expect(frontendResult.subject).toBe(backendResult.subject);
            expect(frontendResult.htmlBody).toBe(backendResult.htmlBody);
            expect(frontendResult.textBody).toBe(backendResult.textBody);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('preview handles special characters identically to backend', async () => {
      const specialCharsArb = fc.constantFrom(
        '<script>alert("xss")</script>',
        '<img src="x" onerror="alert(1)">',
        '&amp; &lt; &gt; &quot;',
        "O'Brien's Pool Service",
        'Test "quoted" text',
        'Line1\nLine2\nLine3',
      );

      const paramsWithSpecialChars: fc.Arbitrary<EmailContentParams> = fc.record({
        customerName: specialCharsArb,
        serviceDate: serviceDateArb,
        poolStatus: poolStatusArb,
        customNote: fc.option(specialCharsArb, { nil: undefined }),
      });

      await fc.assert(
        fc.property(
          paramsWithSpecialChars,
          (params: EmailContentParams) => {
            const frontendResult = frontendGenerate(params);
            const backendResult = backendGenerate(params);
            
            // All fields must match exactly even with special characters
            expect(frontendResult.subject).toBe(backendResult.subject);
            expect(frontendResult.htmlBody).toBe(backendResult.htmlBody);
            expect(frontendResult.textBody).toBe(backendResult.textBody);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
