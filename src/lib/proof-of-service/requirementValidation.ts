/**
 * Requirement Validation for Proof of Service
 * 
 * Validates service completion against business-configured requirements.
 * Requirements 5.2, 5.4
 * 
 * Note: Time tracking validation has been removed. The require_time_tracking
 * setting is preserved in types for backward compatibility but is not enforced.
 */

import {
  ProofOfServiceSettings,
  ServiceCompletionData,
  RequirementValidationError,
  RequirementValidationResult,
  DEFAULT_PROOF_OF_SERVICE_SETTINGS,
} from './types';

/**
 * Gets the effective requirements for a service type.
 * If service-type-specific requirements exist, use those; otherwise use defaults.
 * Requirement 5.3
 */
export function getEffectiveRequirements(
  settings: ProofOfServiceSettings | undefined,
  serviceType?: string
): ProofOfServiceSettings {
  if (!settings) {
    return DEFAULT_PROOF_OF_SERVICE_SETTINGS;
  }

  // Check for service-type-specific requirements
  if (serviceType && settings.service_type_requirements?.length) {
    const typeRequirement = settings.service_type_requirements.find(
      (req) => req.service_type === serviceType
    );
    
    if (typeRequirement) {
      return {
        require_before_photos: typeRequirement.require_before_photos,
        require_after_photos: typeRequirement.require_after_photos,
        require_time_tracking: typeRequirement.require_time_tracking,
        min_photos_before: typeRequirement.min_photos_before,
        min_photos_after: typeRequirement.min_photos_after,
      };
    }
  }

  // Return default business-level requirements
  return settings;
}

/**
 * Validates service completion data against proof-of-service requirements.
 * Returns validation result with any errors.
 * Requirements 5.2, 5.4
 */
export function validateServiceCompletion(
  settings: ProofOfServiceSettings | undefined,
  data: ServiceCompletionData
): RequirementValidationResult {
  const errors: RequirementValidationError[] = [];
  const effectiveSettings = getEffectiveRequirements(settings, data.serviceType);

  // Validate before photos requirement
  if (effectiveSettings.require_before_photos) {
    const minRequired = effectiveSettings.min_photos_before || 1;
    if (data.beforePhotoCount < minRequired) {
      errors.push({
        field: 'before_photos',
        message: minRequired === 1
          ? 'At least one before photo is required'
          : `At least ${minRequired} before photos are required`,
        required: minRequired,
        actual: data.beforePhotoCount,
      });
    }
  }

  // Validate after photos requirement
  if (effectiveSettings.require_after_photos) {
    const minRequired = effectiveSettings.min_photos_after || 1;
    if (data.afterPhotoCount < minRequired) {
      errors.push({
        field: 'after_photos',
        message: minRequired === 1
          ? 'At least one after photo is required'
          : `At least ${minRequired} after photos are required`,
        required: minRequired,
        actual: data.afterPhotoCount,
      });
    }
  }

  // Note: Time tracking validation has been removed.
  // The require_time_tracking setting is ignored for validation purposes.

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Formats validation errors into user-friendly messages.
 * Requirement 5.4
 */
export function formatValidationErrors(errors: RequirementValidationError[]): string[] {
  return errors.map((error) => error.message);
}

/**
 * Gets a single combined error message for display.
 * Requirement 5.4
 */
export function getValidationErrorMessage(result: RequirementValidationResult): string | null {
  if (result.isValid) {
    return null;
  }

  const messages = formatValidationErrors(result.errors);
  
  if (messages.length === 1) {
    return messages[0];
  }

  return `Missing requirements: ${messages.join(', ')}`;
}

/**
 * Checks if any proof-of-service requirements are enabled.
 * Note: Time tracking is excluded as it's no longer enforced.
 */
export function hasAnyRequirements(settings: ProofOfServiceSettings | undefined): boolean {
  if (!settings) {
    return false;
  }

  return (
    settings.require_before_photos ||
    settings.require_after_photos
  );
}

/**
 * Gets a summary of what's required for service completion.
 */
export function getRequirementsSummary(
  settings: ProofOfServiceSettings | undefined,
  serviceType?: string
): string[] {
  const effectiveSettings = getEffectiveRequirements(settings, serviceType);
  const requirements: string[] = [];

  if (effectiveSettings.require_before_photos) {
    const min = effectiveSettings.min_photos_before || 1;
    requirements.push(min === 1 ? '1 before photo' : `${min} before photos`);
  }

  if (effectiveSettings.require_after_photos) {
    const min = effectiveSettings.min_photos_after || 1;
    requirements.push(min === 1 ? '1 after photo' : `${min} after photos`);
  }

  // Note: Time tracking is no longer shown in requirements as it's not enforced

  return requirements;
}
