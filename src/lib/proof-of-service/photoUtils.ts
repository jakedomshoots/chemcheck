/**
 * Photo capture utilities for Proof of Service feature
 * Implements photo metadata types, validation, geolocation, and timestamp utilities
 * Requirements: 1.2, 1.3, 1.4, 2.1, 2.2
 */

import { CapturedPhoto, GeoLocation } from './types';

// ============================================
// UUID Generation with Fallback
// ============================================

/**
 * Generate a UUID with fallback for older browsers
 * crypto.randomUUID() is not available in Safari < 15.4, Node.js < 16.7.0
 */
function generateUUID(): string {
  // Use crypto.randomUUID if available (modern browsers)
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  
  // Fallback implementation using crypto.getRandomValues
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    
    // Set version (4) and variant (RFC4122)
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  
  // Last resort fallback using Math.random (less secure but works everywhere)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ============================================
// Validation Types
// ============================================

export interface PhotoValidationResult {
  valid: boolean;
  errors: string[];
}

export interface TimestampValidationResult {
  valid: boolean;
  error?: string;
}

// ============================================
// Photo Metadata Validation
// ============================================

/**
 * Validates that a photo has all required metadata fields
 * Requirements: 2.1 - Photo_Log SHALL include: photo data, timestamp, latitude, longitude, accuracy, and category
 * 
 * @param photo - The captured photo to validate
 * @returns Validation result with any errors
 */
export function validatePhotoMetadata(photo: unknown): PhotoValidationResult {
  const errors: string[] = [];

  // Check if photo is an object
  if (!photo || typeof photo !== 'object') {
    return { valid: false, errors: ['Photo must be an object'] };
  }

  const p = photo as Record<string, unknown>;

  // Validate id - required, must be non-empty string
  if (typeof p.id !== 'string' || p.id.trim() === '') {
    errors.push('Photo must have a valid id');
  }

  // Validate dataUrl - required, must be non-empty string
  if (typeof p.dataUrl !== 'string' || p.dataUrl.trim() === '') {
    errors.push('Photo must have a valid dataUrl');
  }

  // Validate timestamp - required, must be valid ISO 8601 format
  if (typeof p.timestamp !== 'string') {
    errors.push('Photo must have a timestamp');
  } else if (!isValidISO8601(p.timestamp)) {
    errors.push('Photo timestamp must be in ISO 8601 format');
  }

  // Validate category - required, must be 'before' or 'after'
  if (p.category !== 'before' && p.category !== 'after') {
    errors.push('Photo category must be "before" or "after"');
  }

  // Validate location - must be present (can be null)
  if (!('location' in p)) {
    errors.push('Photo must have a location field (can be null)');
  } else if (p.location !== null) {
    // If location is provided, validate its structure
    const locationErrors = validateGeoLocation(p.location);
    errors.push(...locationErrors);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validates a GeoLocation object
 * @param location - The location to validate
 * @returns Array of error messages (empty if valid)
 */
export function validateGeoLocation(location: unknown): string[] {
  const errors: string[] = [];

  if (!location || typeof location !== 'object') {
    errors.push('Location must be an object');
    return errors;
  }

  const loc = location as Record<string, unknown>;

  // Validate latitude - required, must be number between -90 and 90
  if (typeof loc.latitude !== 'number' || isNaN(loc.latitude)) {
    errors.push('Location must have a valid latitude');
  } else if (loc.latitude < -90 || loc.latitude > 90) {
    errors.push('Latitude must be between -90 and 90');
  }

  // Validate longitude - required, must be number between -180 and 180
  if (typeof loc.longitude !== 'number' || isNaN(loc.longitude)) {
    errors.push('Location must have a valid longitude');
  } else if (loc.longitude < -180 || loc.longitude > 180) {
    errors.push('Longitude must be between -180 and 180');
  }

  // Validate accuracy - required, must be non-negative number
  if (typeof loc.accuracy !== 'number' || isNaN(loc.accuracy)) {
    errors.push('Location must have a valid accuracy');
  } else if (loc.accuracy < 0) {
    errors.push('Accuracy must be non-negative');
  }

  // Address is optional, but if present must be a string
  if ('address' in loc && loc.address !== undefined && typeof loc.address !== 'string') {
    errors.push('Location address must be a string if provided');
  }

  return errors;
}

// ============================================
// Timestamp Utilities
// ============================================

/**
 * Generates a timestamp in ISO 8601 format (UTC)
 * Requirements: 1.2 - System SHALL automatically attach a timestamp in ISO 8601 format
 * 
 * @returns Current timestamp in ISO 8601 format
 */
export function generateTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Validates that a timestamp is in valid ISO 8601 format
 * @param timestamp - The timestamp string to validate
 * @returns True if valid ISO 8601 format
 */
export function isValidISO8601(timestamp: string): boolean {
  if (typeof timestamp !== 'string' || timestamp.trim() === '') {
    return false;
  }

  // Try to parse the timestamp
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) {
    return false;
  }

  // Check that it's a valid ISO 8601 format by comparing round-trip
  // ISO 8601 formats include: 2024-01-15T10:30:00.000Z, 2024-01-15T10:30:00Z, etc.
  const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;
  return isoRegex.test(timestamp);
}

/**
 * Validates that a photo timestamp is within 24 hours of the service date
 * Requirements: 2.2 - System SHALL validate that the timestamp is within 24 hours of the service date
 * 
 * For YYYY-MM-DD format service dates, we use a timezone-aware validation window:
 * - The actual timezone range is UTC-12 (e.g., Baker Island) to UTC+14 (e.g., Line Islands, Kiribati)
 * - We use a symmetric 15-hour buffer (14h max offset + 1h for clock drift) for simplicity
 * - This is intentionally generous to avoid false rejections at timezone boundaries
 * 
 * This means:
 * - Photos can be taken up to 15 hours before midnight UTC of the service date
 * - Photos can be taken up to 15 hours after 23:59:59 UTC of the service date
 * - Total window: ~54 hours (15h before + 24h day + 15h after)
 * 
 * @param photoTimestamp - The photo's timestamp in ISO 8601 format
 * @param serviceDate - The service date (can be ISO 8601 or YYYY-MM-DD format)
 * @returns Validation result
 */
export function validateTimestampWithinRange(
  photoTimestamp: string,
  serviceDate: string
): TimestampValidationResult {
  // Validate photo timestamp format
  if (!isValidISO8601(photoTimestamp)) {
    return { valid: false, error: 'Photo timestamp is not in valid ISO 8601 format' };
  }

  const photoDateObj = new Date(photoTimestamp);

  // Parse service date - handle both ISO 8601 and YYYY-MM-DD formats
  if (serviceDate.includes('T')) {
    // Full ISO 8601 timestamp - use exact 24-hour window
    const serviceDateObj = new Date(serviceDate);
    if (isNaN(serviceDateObj.getTime())) {
      return { valid: false, error: 'Service date is not valid' };
    }
    
    const diffMs = Math.abs(photoDateObj.getTime() - serviceDateObj.getTime());
    const twentyFourHoursMs = 24 * 60 * 60 * 1000;

    if (diffMs > twentyFourHoursMs) {
      return {
        valid: false,
        error: `Photo timestamp is more than 24 hours from service date (difference: ${Math.round(diffMs / (60 * 60 * 1000))} hours)`,
      };
    }
  } else {
    // YYYY-MM-DD format - use timezone-aware window
    // Max timezone offset is UTC±14, plus 1 hour buffer = 15 hours
    const serviceDayStartUTC = new Date(serviceDate + 'T00:00:00.000Z');
    const serviceDayEndUTC = new Date(serviceDate + 'T23:59:59.999Z');
    
    if (isNaN(serviceDayStartUTC.getTime())) {
      return { valid: false, error: 'Service date is not valid' };
    }
    
    // 15 hours buffer for timezone differences (UTC-12 to UTC+14 range, plus 1h buffer)
    const timezoneBufferMs = 15 * 60 * 60 * 1000;
    const windowStart = serviceDayStartUTC.getTime() - timezoneBufferMs;
    const windowEnd = serviceDayEndUTC.getTime() + timezoneBufferMs;
    
    const photoTime = photoDateObj.getTime();
    
    if (photoTime < windowStart || photoTime > windowEnd) {
      return {
        valid: false,
        error: `Photo timestamp is outside the valid window for service date ${serviceDate}`,
      };
    }
  }

  return { valid: true };
}

// ============================================
// Geolocation Utilities
// ============================================

export interface GeolocationOptions {
  enableHighAccuracy?: boolean;
  timeout?: number;
  maximumAge?: number;
}

export interface GeolocationResult {
  success: boolean;
  location: GeoLocation | null;
  error?: string;
}

const DEFAULT_GEOLOCATION_OPTIONS: GeolocationOptions = {
  enableHighAccuracy: true,
  timeout: 10000,
  maximumAge: 60000,
};

/**
 * Gets the current device location with permission handling
 * Requirements: 1.3 - System SHALL request device location permission and attach GPS coordinates if granted
 * Requirements: 1.4 - IF location permission is denied THEN System SHALL still allow photo capture
 * 
 * @param options - Geolocation options
 * @returns Promise resolving to location result
 */
export async function getCurrentLocation(
  options: GeolocationOptions = {}
): Promise<GeolocationResult> {
  // Check if geolocation is available
  if (!navigator.geolocation) {
    return {
      success: false,
      location: null,
      error: 'Geolocation is not supported by this browser',
    };
  }

  const mergedOptions = { ...DEFAULT_GEOLOCATION_OPTIONS, ...options };

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      // Success callback
      (position) => {
        resolve({
          success: true,
          location: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
          },
        });
      },
      // Error callback
      (error) => {
        let errorMessage: string;
        switch (error.code) {
          case error.PERMISSION_DENIED:
            errorMessage = 'Location permission denied';
            break;
          case error.POSITION_UNAVAILABLE:
            errorMessage = 'Location information unavailable';
            break;
          case error.TIMEOUT:
            errorMessage = 'Location request timed out';
            break;
          default:
            errorMessage = 'Unknown location error';
        }
        resolve({
          success: false,
          location: null,
          error: errorMessage,
        });
      },
      {
        enableHighAccuracy: mergedOptions.enableHighAccuracy,
        timeout: mergedOptions.timeout,
        maximumAge: mergedOptions.maximumAge,
      }
    );
  });
}

/**
 * Creates a CapturedPhoto object with all required metadata
 * @param dataUrl - Base64 encoded image data
 * @param category - Photo category ('before' or 'after')
 * @param location - Optional geolocation data
 * @returns A complete CapturedPhoto object
 */
export function createCapturedPhoto(
  dataUrl: string,
  category: 'before' | 'after',
  location: GeoLocation | null = null
): CapturedPhoto {
  return {
    id: generateUUID(),
    dataUrl,
    timestamp: generateTimestamp(),
    category,
    location,
  };
}
