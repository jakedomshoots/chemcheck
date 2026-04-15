/**
 * Property-Based Tests for Requirement Enforcement
 * 
 * These tests validate the correctness properties defined in the design document
 * using fast-check for property-based testing.
 * 
 * Feature: proof-of-service
 * Property 8: Requirement Enforcement
 * Validates: Requirements 5.2, 5.4
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  validateServiceCompletion,
  getEffectiveRequirements,
  formatValidationErrors,
  getValidationErrorMessage,
  hasAnyRequirements,
  getRequirementsSummary,
} from './requirementValidation';
import {
  ProofOfServiceSettings,
  ServiceCompletionData,
  ServiceTypeRequirement,
  DEFAULT_PROOF_OF_SERVICE_SETTINGS,
} from './types';

// ============================================================================
// Generators for Property-Based Testing
// ============================================================================

/**
 * Generator for service type names
 */
const serviceTypeArb = fc.constantFrom(
  'Regular Cleaning',
  'Chemical Balance',
  'Equipment Check',
  'Repair',
  'Opening',
  'Closing'
);

/**
 * Generator for photo counts (0 to 10)
 */
const photoCountArb = fc.integer({ min: 0, max: 10 });

/**
 * Generator for minimum photo requirements (0 to 5)
 */
const minPhotosArb = fc.integer({ min: 0, max: 5 });

/**
 * Generator for ServiceTypeRequirement
 */
const serviceTypeRequirementArb: fc.Arbitrary<ServiceTypeRequirement> = fc.record({
  service_type: serviceTypeArb,
  require_before_photos: fc.boolean(),
  require_after_photos: fc.boolean(),
  require_time_tracking: fc.boolean(),
  min_photos_before: minPhotosArb,
  min_photos_after: minPhotosArb,
});

/**
 * Generator for ProofOfServiceSettings
 */
const proofOfServiceSettingsArb: fc.Arbitrary<ProofOfServiceSettings> = fc.record({
  require_before_photos: fc.boolean(),
  require_after_photos: fc.boolean(),
  require_time_tracking: fc.boolean(),
  min_photos_before: minPhotosArb,
  min_photos_after: minPhotosArb,
  service_type_requirements: fc.option(
    fc.array(serviceTypeRequirementArb, { minLength: 0, maxLength: 5 }),
    { nil: undefined }
  ),
});

/**
 * Generator for ServiceCompletionData
 */
const serviceCompletionDataArb: fc.Arbitrary<ServiceCompletionData> = fc.record({
  beforePhotoCount: photoCountArb,
  afterPhotoCount: photoCountArb,
  serviceType: fc.option(serviceTypeArb, { nil: undefined }),
});

/**
 * Generator for settings that require before photos
 */
const settingsRequiringBeforePhotosArb: fc.Arbitrary<ProofOfServiceSettings> = 
  proofOfServiceSettingsArb.map(settings => ({
    ...settings,
    require_before_photos: true,
    min_photos_before: Math.max(1, settings.min_photos_before),
  }));

/**
 * Generator for settings that require after photos
 */
const settingsRequiringAfterPhotosArb: fc.Arbitrary<ProofOfServiceSettings> = 
  proofOfServiceSettingsArb.map(settings => ({
    ...settings,
    require_after_photos: true,
    min_photos_after: Math.max(1, settings.min_photos_after),
  }));

/**
 * Generator for settings that require time tracking
 */
const settingsRequiringTimeTrackingArb: fc.Arbitrary<ProofOfServiceSettings> = 
  proofOfServiceSettingsArb.map(settings => ({
    ...settings,
    require_time_tracking: true,
  }));

/**
 * Generator for completion data with insufficient before photos
 */
const dataWithInsufficientBeforePhotosArb = (minRequired: number): fc.Arbitrary<ServiceCompletionData> =>
  serviceCompletionDataArb.map(data => ({
    ...data,
    beforePhotoCount: Math.min(data.beforePhotoCount, minRequired - 1),
  }));

/**
 * Generator for completion data with insufficient after photos
 */
const dataWithInsufficientAfterPhotosArb = (minRequired: number): fc.Arbitrary<ServiceCompletionData> =>
  serviceCompletionDataArb.map(data => ({
    ...data,
    afterPhotoCount: Math.min(data.afterPhotoCount, minRequired - 1),
  }));

/**
 * Generator for completion data without time tracking
 */
const dataWithoutTimeTrackingArb: fc.Arbitrary<ServiceCompletionData> = 
  serviceCompletionDataArb;

// ============================================================================
// Property-Based Tests
// ============================================================================

describe('Requirement Enforcement', () => {
  /**
   * Property 8: Requirement Enforcement
   * 
   * For any service log where business settings require photos,
   * attempting to complete the service without photos SHALL be rejected
   * with an appropriate error message.
   * 
   * **Validates: Requirements 5.2, 5.4**
   */
  describe('Property 8: Requirement Enforcement', () => {
    it('rejects service completion when before photos are required but not provided', () => {
      fc.assert(
        fc.property(
          settingsRequiringBeforePhotosArb,
          fc.integer({ min: 1, max: 5 }),
          (settings, minRequired) => {
            const effectiveSettings = {
              ...settings,
              min_photos_before: minRequired,
            };
            
            // Data with fewer photos than required
            const data: ServiceCompletionData = {
              beforePhotoCount: minRequired - 1,
              afterPhotoCount: 10, // Plenty of after photos
            };
            
            const result = validateServiceCompletion(effectiveSettings, data);
            
            // Should be invalid
            expect(result.isValid).toBe(false);
            
            // Should have an error for before_photos
            const beforePhotoError = result.errors.find(e => e.field === 'before_photos');
            expect(beforePhotoError).toBeDefined();
            expect(beforePhotoError?.message).toBeTruthy();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('rejects service completion when after photos are required but not provided', () => {
      fc.assert(
        fc.property(
          settingsRequiringAfterPhotosArb,
          fc.integer({ min: 1, max: 5 }),
          (settings, minRequired) => {
            const effectiveSettings = {
              ...settings,
              min_photos_after: minRequired,
            };
            
            // Data with fewer photos than required
            const data: ServiceCompletionData = {
              beforePhotoCount: 10, // Plenty of before photos
              afterPhotoCount: minRequired - 1,
            };
            
            const result = validateServiceCompletion(effectiveSettings, data);
            
            // Should be invalid
            expect(result.isValid).toBe(false);
            
            // Should have an error for after_photos
            const afterPhotoError = result.errors.find(e => e.field === 'after_photos');
            expect(afterPhotoError).toBeDefined();
            expect(afterPhotoError?.message).toBeTruthy();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('time tracking requirement is disabled (always passes)', () => {
      fc.assert(
        fc.property(
          settingsRequiringTimeTrackingArb,
          (settings) => {
            // Data without time tracking
            const data: ServiceCompletionData = {
              beforePhotoCount: 10,
              afterPhotoCount: 10,
            };
            
            const result = validateServiceCompletion(settings, data);
            
            // Should be valid even with time tracking required (feature disabled)
            expect(result.isValid).toBe(true);
            
            // Should not have an error for time_tracking
            const timeError = result.errors.find(e => e.field === 'time_tracking');
            expect(timeError).toBeUndefined();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('accepts service completion when all requirements are met', () => {
      fc.assert(
        fc.property(
          proofOfServiceSettingsArb,
          (settings) => {
            // Data that meets all requirements
            const data: ServiceCompletionData = {
              beforePhotoCount: Math.max(10, settings.min_photos_before + 1),
              afterPhotoCount: Math.max(10, settings.min_photos_after + 1),
            };
            
            const result = validateServiceCompletion(settings, data);
            
            // Should be valid
            expect(result.isValid).toBe(true);
            expect(result.errors).toHaveLength(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('accepts service completion when no requirements are configured', () => {
      fc.assert(
        fc.property(
          serviceCompletionDataArb,
          (data) => {
            // No requirements
            const settings: ProofOfServiceSettings = {
              require_before_photos: false,
              require_after_photos: false,
              require_time_tracking: false,
              min_photos_before: 0,
              min_photos_after: 0,
            };
            
            const result = validateServiceCompletion(settings, data);
            
            // Should always be valid when no requirements
            expect(result.isValid).toBe(true);
            expect(result.errors).toHaveLength(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('returns appropriate error messages for each missing requirement', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 5 }),
          fc.integer({ min: 1, max: 5 }),
          (minBefore, minAfter) => {
            // Settings requiring everything (but time tracking is disabled)
            const settings: ProofOfServiceSettings = {
              require_before_photos: true,
              require_after_photos: true,
              require_time_tracking: true, // This will be ignored
              min_photos_before: minBefore,
              min_photos_after: minAfter,
            };
            
            // Data missing everything
            const data: ServiceCompletionData = {
              beforePhotoCount: 0,
              afterPhotoCount: 0,
            };
            
            const result = validateServiceCompletion(settings, data);
            
            // Should have 2 errors (not 3, since time tracking is disabled)
            expect(result.isValid).toBe(false);
            expect(result.errors.length).toBe(2);
            
            // Each error should have a message
            for (const error of result.errors) {
              expect(error.message).toBeTruthy();
              expect(typeof error.message).toBe('string');
              expect(error.message.length).toBeGreaterThan(0);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Service Type Specific Requirements', () => {
    it('uses service-type-specific requirements when available', () => {
      fc.assert(
        fc.property(
          proofOfServiceSettingsArb,
          serviceTypeRequirementArb,
          (baseSettings, typeReq) => {
            // Create settings with service-type-specific requirements
            const settings: ProofOfServiceSettings = {
              ...baseSettings,
              require_before_photos: false, // Default: no requirement
              service_type_requirements: [typeReq],
            };
            
            // Get effective requirements for the specific service type
            const effective = getEffectiveRequirements(settings, typeReq.service_type);
            
            // Should use the service-type-specific settings
            expect(effective.require_before_photos).toBe(typeReq.require_before_photos);
            expect(effective.require_after_photos).toBe(typeReq.require_after_photos);
            expect(effective.require_time_tracking).toBe(typeReq.require_time_tracking);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('falls back to default requirements when service type not found', () => {
      fc.assert(
        fc.property(
          proofOfServiceSettingsArb,
          serviceTypeRequirementArb,
          (baseSettings, typeReq) => {
            // Create settings with service-type-specific requirements
            const settings: ProofOfServiceSettings = {
              ...baseSettings,
              service_type_requirements: [typeReq],
            };
            
            // Get effective requirements for a different service type
            const effective = getEffectiveRequirements(settings, 'NonExistentType');
            
            // Should use the base settings
            expect(effective.require_before_photos).toBe(baseSettings.require_before_photos);
            expect(effective.require_after_photos).toBe(baseSettings.require_after_photos);
            expect(effective.require_time_tracking).toBe(baseSettings.require_time_tracking);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Error Message Formatting', () => {
    it('formatValidationErrors returns array of messages', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 5 }),
          fc.integer({ min: 1, max: 5 }),
          (minBefore, minAfter) => {
            const settings: ProofOfServiceSettings = {
              require_before_photos: true,
              require_after_photos: true,
              require_time_tracking: true,
              min_photos_before: minBefore,
              min_photos_after: minAfter,
            };
            
            const data: ServiceCompletionData = {
              beforePhotoCount: 0,
              afterPhotoCount: 0,
              hasStartTime: false,
              hasEndTime: false,
            };
            
            const result = validateServiceCompletion(settings, data);
            const messages = formatValidationErrors(result.errors);
            
            expect(Array.isArray(messages)).toBe(true);
            expect(messages.length).toBe(result.errors.length);
            
            for (const msg of messages) {
              expect(typeof msg).toBe('string');
              expect(msg.length).toBeGreaterThan(0);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('getValidationErrorMessage returns null for valid results', () => {
      fc.assert(
        fc.property(
          proofOfServiceSettingsArb,
          (settings) => {
            const data: ServiceCompletionData = {
              beforePhotoCount: Math.max(10, settings.min_photos_before + 1),
              afterPhotoCount: Math.max(10, settings.min_photos_after + 1),
            };
            
            const result = validateServiceCompletion(settings, data);
            const message = getValidationErrorMessage(result);
            
            expect(message).toBeNull();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('getValidationErrorMessage returns non-null for invalid results', () => {
      fc.assert(
        fc.property(
          settingsRequiringBeforePhotosArb,
          (settings) => {
            const data: ServiceCompletionData = {
              beforePhotoCount: 0,
              afterPhotoCount: 10,
            };
            
            const result = validateServiceCompletion(settings, data);
            const message = getValidationErrorMessage(result);
            
            expect(message).not.toBeNull();
            expect(typeof message).toBe('string');
            expect(message!.length).toBeGreaterThan(0);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Helper Functions', () => {
    it('hasAnyRequirements returns true when any requirement is enabled', () => {
      fc.assert(
        fc.property(
          proofOfServiceSettingsArb,
          (settings) => {
            const hasReqs = hasAnyRequirements(settings);
            // Time tracking is no longer considered in hasAnyRequirements
            const expected = 
              settings.require_before_photos ||
              settings.require_after_photos;
            
            expect(hasReqs).toBe(expected);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('hasAnyRequirements returns false for undefined settings', () => {
      expect(hasAnyRequirements(undefined)).toBe(false);
    });

    it('getRequirementsSummary returns array of requirement descriptions', () => {
      fc.assert(
        fc.property(
          proofOfServiceSettingsArb,
          (settings) => {
            const summary = getRequirementsSummary(settings);
            
            expect(Array.isArray(summary)).toBe(true);
            
            // Count expected items (time tracking is disabled, so don't count it)
            let expectedCount = 0;
            if (settings.require_before_photos) expectedCount++;
            if (settings.require_after_photos) expectedCount++;
            // Time tracking is disabled: if (settings.require_time_tracking) expectedCount++;
            
            expect(summary.length).toBe(expectedCount);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Default Settings', () => {
    it('DEFAULT_PROOF_OF_SERVICE_SETTINGS has no requirements enabled', () => {
      expect(DEFAULT_PROOF_OF_SERVICE_SETTINGS.require_before_photos).toBe(false);
      expect(DEFAULT_PROOF_OF_SERVICE_SETTINGS.require_after_photos).toBe(false);
      expect(DEFAULT_PROOF_OF_SERVICE_SETTINGS.require_time_tracking).toBe(false);
      expect(DEFAULT_PROOF_OF_SERVICE_SETTINGS.min_photos_before).toBe(0);
      expect(DEFAULT_PROOF_OF_SERVICE_SETTINGS.min_photos_after).toBe(0);
    });

    it('getEffectiveRequirements returns defaults for undefined settings', () => {
      const effective = getEffectiveRequirements(undefined);
      
      expect(effective).toEqual(DEFAULT_PROOF_OF_SERVICE_SETTINGS);
    });
  });
});
