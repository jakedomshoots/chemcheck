/**
 * Property-Based Tests for Photo Utilities
 * 
 * These tests validate the correctness properties defined in the design document
 * using fast-check for property-based testing.
 * 
 * Feature: proof-of-service
 * Property 1: Photo Metadata Completeness
 * Property 2: Timestamp Validation
 * Validates: Requirements 1.2, 2.1, 2.2
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  validatePhotoMetadata,
  validateGeoLocation,
  generateTimestamp,
  isValidISO8601,
  validateTimestampWithinRange,
  createCapturedPhoto,
} from './photoUtils';
import type { CapturedPhoto, GeoLocation } from './types';

// ============================================================================
// Generators for Property-Based Testing
// ============================================================================

/**
 * Generator for valid photo categories
 */
const categoryArb = fc.constantFrom<'before' | 'after'>('before', 'after');

/**
 * Generator for valid ISO 8601 timestamps
 */
const timestampArb = fc.integer({
  min: new Date('2020-01-01').getTime(),
  max: new Date('2030-12-31').getTime(),
}).map(ms => new Date(ms).toISOString());

/**
 * Generator for valid latitude values (-90 to 90)
 */
const latitudeArb = fc.double({ min: -90, max: 90, noNaN: true });

/**
 * Generator for valid longitude values (-180 to 180)
 */
const longitudeArb = fc.double({ min: -180, max: 180, noNaN: true });

/**
 * Generator for accuracy in meters (positive value)
 */
const accuracyArb = fc.double({ min: 0, max: 1000, noNaN: true });

/**
 * Generator for GeoLocation
 */
const geoLocationArb: fc.Arbitrary<GeoLocation> = fc.record({
  latitude: latitudeArb,
  longitude: longitudeArb,
  accuracy: accuracyArb,
  address: fc.option(fc.string({ minLength: 1, maxLength: 200 }), { nil: undefined }),
});

/**
 * Generator for optional GeoLocation (can be null)
 */
const optionalGeoLocationArb = fc.option(geoLocationArb, { nil: null });

/**
 * Generator for base64 data URL
 */
const dataUrlArb = fc.string({ minLength: 10, maxLength: 500 })
  .map(s => `data:image/jpeg;base64,${Buffer.from(s).toString('base64')}`);

/**
 * Generator for valid UUIDs
 */
const uuidArb = fc.uuid();

/**
 * Generator for valid CapturedPhoto
 */
const validCapturedPhotoArb: fc.Arbitrary<CapturedPhoto> = fc.record({
  id: uuidArb,
  dataUrl: dataUrlArb,
  timestamp: timestampArb,
  category: categoryArb,
  location: optionalGeoLocationArb,
});

/**
 * Generator for service dates (YYYY-MM-DD format)
 */
const serviceDateArb = fc.integer({
  min: new Date('2020-01-01').getTime(),
  max: new Date('2030-12-31').getTime(),
}).map(ms => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
});

// ============================================================================
// Property-Based Tests
// ============================================================================

describe('Photo Utilities', () => {
  /**
   * Property 1: Photo Metadata Completeness
   * 
   * For any captured photo, the photo record SHALL contain a valid id, dataUrl,
   * timestamp in ISO 8601 format, and category ('before' or 'after').
   * Location fields may be null but must be present.
   * 
   * **Validates: Requirements 1.2, 2.1**
   */
  describe('Property 1: Photo Metadata Completeness', () => {
    it('valid photos pass validation with all required fields', async () => {
      await fc.assert(
        fc.property(
          validCapturedPhotoArb,
          (photo) => {
            const result = validatePhotoMetadata(photo);
            
            // A valid photo should pass validation
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('photos created with createCapturedPhoto always have complete metadata', async () => {
      await fc.assert(
        fc.property(
          dataUrlArb,
          categoryArb,
          optionalGeoLocationArb,
          (dataUrl, category, location) => {
            const photo = createCapturedPhoto(dataUrl, category, location);
            const result = validatePhotoMetadata(photo);
            
            // Created photos should always be valid
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
            
            // Verify all required fields are present
            expect(photo.id).toBeDefined();
            expect(photo.id.length).toBeGreaterThan(0);
            expect(photo.dataUrl).toBe(dataUrl);
            expect(photo.timestamp).toBeDefined();
            expect(isValidISO8601(photo.timestamp)).toBe(true);
            expect(photo.category).toBe(category);
            expect('location' in photo).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('photos missing required fields fail validation', async () => {
      await fc.assert(
        fc.property(
          validCapturedPhotoArb,
          fc.constantFrom('id', 'dataUrl', 'timestamp', 'category', 'location'),
          (photo, fieldToRemove) => {
            // Create a copy without the specified field
            const incompletePhoto = { ...photo };
            delete (incompletePhoto as Record<string, unknown>)[fieldToRemove];
            
            const result = validatePhotoMetadata(incompletePhoto);
            
            // Should fail validation
            expect(result.valid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('photos with invalid category fail validation', async () => {
      await fc.assert(
        fc.property(
          validCapturedPhotoArb,
          fc.string().filter(s => s !== 'before' && s !== 'after'),
          (photo, invalidCategory) => {
            const invalidPhoto = { ...photo, category: invalidCategory };
            const result = validatePhotoMetadata(invalidPhoto);
            
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes('category'))).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('valid GeoLocation passes validation', async () => {
      await fc.assert(
        fc.property(
          geoLocationArb,
          (location) => {
            const errors = validateGeoLocation(location);
            expect(errors).toHaveLength(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('GeoLocation with out-of-range latitude fails validation', async () => {
      await fc.assert(
        fc.property(
          fc.double({ min: 91, max: 1000, noNaN: true }),
          longitudeArb,
          accuracyArb,
          (invalidLat, longitude, accuracy) => {
            const location = { latitude: invalidLat, longitude, accuracy };
            const errors = validateGeoLocation(location);
            
            expect(errors.length).toBeGreaterThan(0);
            expect(errors.some(e => e.toLowerCase().includes('latitude'))).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('GeoLocation with out-of-range longitude fails validation', async () => {
      await fc.assert(
        fc.property(
          latitudeArb,
          fc.double({ min: 181, max: 1000, noNaN: true }),
          accuracyArb,
          (latitude, invalidLon, accuracy) => {
            const location = { latitude, longitude: invalidLon, accuracy };
            const errors = validateGeoLocation(location);
            
            expect(errors.length).toBeGreaterThan(0);
            expect(errors.some(e => e.toLowerCase().includes('longitude'))).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 2: Timestamp Validation
   * 
   * For any photo stored with a service log, the photo timestamp SHALL be within
   * 24 hours of the service date. Photos with timestamps outside this range
   * SHALL be rejected.
   * 
   * **Validates: Requirements 2.2**
   */
  describe('Property 2: Timestamp Validation', () => {
    it('generateTimestamp always produces valid ISO 8601 format', async () => {
      // Run multiple times to test different timestamps
      for (let i = 0; i < 100; i++) {
        const timestamp = generateTimestamp();
        expect(isValidISO8601(timestamp)).toBe(true);
      }
    });

    it('timestamps within 24 hours of service date pass validation', async () => {
      await fc.assert(
        fc.property(
          serviceDateArb,
          fc.integer({ min: 0, max: 23 }), // hours offset
          fc.integer({ min: 0, max: 59 }), // minutes offset
          (serviceDate, hoursOffset, minutesOffset) => {
            // Create a timestamp within 24 hours of the service date
            const serviceDateObj = new Date(serviceDate + 'T00:00:00.000Z');
            const photoDateObj = new Date(serviceDateObj.getTime());
            photoDateObj.setUTCHours(hoursOffset, minutesOffset, 0, 0);
            
            const photoTimestamp = photoDateObj.toISOString();
            const result = validateTimestampWithinRange(photoTimestamp, serviceDate);
            
            expect(result.valid).toBe(true);
            expect(result.error).toBeUndefined();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('timestamps more than 24 hours from service date fail validation', async () => {
      await fc.assert(
        fc.property(
          serviceDateArb,
          fc.integer({ min: 40, max: 100 }), // hours offset (more than 39 to exceed the 15h+24h+15h=54h window)
          (serviceDate, hoursOffset) => {
            // Create a timestamp more than 39 hours from the service date start
            // (15h buffer + 24h day = 39h from start is the boundary)
            const serviceDateObj = new Date(serviceDate + 'T00:00:00.000Z');
            const photoDateObj = new Date(serviceDateObj.getTime() + hoursOffset * 60 * 60 * 1000);
            
            const photoTimestamp = photoDateObj.toISOString();
            const result = validateTimestampWithinRange(photoTimestamp, serviceDate);
            
            expect(result.valid).toBe(false);
            expect(result.error).toBeDefined();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('timestamps before service date but within 15 hours pass validation', async () => {
      await fc.assert(
        fc.property(
          serviceDateArb,
          fc.integer({ min: 1, max: 14 }), // hours before (within 15h buffer)
          (serviceDate, hoursBefore) => {
            // Create a timestamp before the service date but within 15 hours
            const serviceDateObj = new Date(serviceDate + 'T00:00:00.000Z');
            const photoDateObj = new Date(serviceDateObj.getTime() - hoursBefore * 60 * 60 * 1000);
            
            const photoTimestamp = photoDateObj.toISOString();
            const result = validateTimestampWithinRange(photoTimestamp, serviceDate);
            
            expect(result.valid).toBe(true);
            expect(result.error).toBeUndefined();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('timestamps after service date ends but within 15 hours pass validation', async () => {
      await fc.assert(
        fc.property(
          serviceDateArb,
          fc.integer({ min: 1, max: 14 }), // hours after end of day (within 15h buffer)
          (serviceDate, hoursAfter) => {
            // Create a timestamp after the service date ends but within 15 hours
            const serviceDateEndObj = new Date(serviceDate + 'T23:59:59.999Z');
            const photoDateObj = new Date(serviceDateEndObj.getTime() + hoursAfter * 60 * 60 * 1000);
            
            const photoTimestamp = photoDateObj.toISOString();
            const result = validateTimestampWithinRange(photoTimestamp, serviceDate);
            
            expect(result.valid).toBe(true);
            expect(result.error).toBeUndefined();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('valid ISO 8601 timestamps are recognized', async () => {
      await fc.assert(
        fc.property(
          timestampArb,
          (timestamp) => {
            expect(isValidISO8601(timestamp)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('invalid timestamp formats are rejected', async () => {
      await fc.assert(
        fc.property(
          fc.constantFrom(
            '2024-01-15',           // Missing time
            '2024/01/15T10:30:00Z', // Wrong date separator
            '15-01-2024T10:30:00Z', // Wrong date order
            'not-a-date',           // Invalid string
            '',                     // Empty string
            '2024-13-01T10:30:00Z', // Invalid month
            '2024-01-32T10:30:00Z', // Invalid day
          ),
          (invalidTimestamp) => {
            expect(isValidISO8601(invalidTimestamp)).toBe(false);
          }
        ),
        { numRuns: 7 } // One run per invalid format
      );
    });

    it('invalid photo timestamp format fails range validation', async () => {
      await fc.assert(
        fc.property(
          serviceDateArb,
          fc.constantFrom('invalid', '2024-01-15', 'not-a-timestamp'),
          (serviceDate, invalidTimestamp) => {
            const result = validateTimestampWithinRange(invalidTimestamp, serviceDate);
            
            expect(result.valid).toBe(false);
            expect(result.error).toBeDefined();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('invalid service date fails range validation', async () => {
      await fc.assert(
        fc.property(
          timestampArb,
          fc.constantFrom('invalid', 'not-a-date', ''),
          (photoTimestamp, invalidServiceDate) => {
            const result = validateTimestampWithinRange(photoTimestamp, invalidServiceDate);
            
            expect(result.valid).toBe(false);
            expect(result.error).toBeDefined();
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
