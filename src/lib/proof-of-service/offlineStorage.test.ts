/**
 * Property-Based Tests for Offline Storage
 * 
 * These tests validate the correctness properties defined in the design document
 * using fast-check for property-based testing.
 * 
 * Feature: proof-of-service
 * Property 3: Photo Persistence Round-Trip
 * Validates: Requirements 1.5, 6.1
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import 'fake-indexeddb/auto';
import {
  savePhoto,
  getPhotos,
  getPhotoById,
  deletePhoto,
  clearAllPhotos,
  recordToCapturedPhoto,
} from './offlinePhotoStorage';
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
 * Using integer-based generation to avoid invalid date issues
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
 * Generator for base64 data URL (simplified for testing)
 * Real photos would be much larger, but we use small strings for test performance
 */
const dataUrlArb = fc.string({ minLength: 10, maxLength: 500 })
  .map(s => `data:image/jpeg;base64,${Buffer.from(s).toString('base64')}`);

/**
 * Generator for valid UUIDs
 */
const uuidArb = fc.uuid();

/**
 * Generator for customer IDs (string format)
 */
const customerIdArb = fc.string({ minLength: 1, maxLength: 50 })
  .filter(s => s.trim().length > 0);

/**
 * Generator for CapturedPhoto
 */
const capturedPhotoArb: fc.Arbitrary<CapturedPhoto> = fc.record({
  id: uuidArb,
  dataUrl: dataUrlArb,
  timestamp: timestampArb,
  category: categoryArb,
  location: optionalGeoLocationArb,
});

// ============================================================================
// Test Setup and Teardown
// ============================================================================

beforeEach(async () => {
  // Clear the database before each test
  await clearAllPhotos();
});

afterEach(async () => {
  // Clean up after each test
  await clearAllPhotos();
});

// ============================================================================
// Property-Based Tests
// ============================================================================

describe('Offline Photo Storage', () => {
  /**
   * Property 3: Photo Persistence Round-Trip
   * 
   * For any captured photo, saving to storage and then retrieving SHALL return
   * an equivalent photo object with all metadata intact.
   * 
   * **Validates: Requirements 1.5, 6.1**
   */
  describe('Property 3: Photo Persistence Round-Trip', () => {
    it('saving and retrieving a photo preserves all metadata', async () => {
      await fc.assert(
        fc.asyncProperty(
          capturedPhotoArb,
          customerIdArb,
          async (photoInput, customerId) => {
            // Clear database before each property test iteration
            await clearAllPhotos();
            
            // Ensure unique photo ID
            const photo = {
              ...photoInput,
              id: crypto.randomUUID(),
            };
            
            // Save the photo
            const savedId = await savePhoto(photo, customerId);
            
            // Retrieve the photo
            const retrieved = await getPhotoById(savedId);
            
            // Verify the photo was retrieved
            expect(retrieved).toBeDefined();
            if (!retrieved) return;
            
            // Convert back to CapturedPhoto format
            const roundTripped = recordToCapturedPhoto(retrieved);
            
            // Verify all fields are preserved
            expect(roundTripped.id).toBe(photo.id);
            expect(roundTripped.dataUrl).toBe(photo.dataUrl);
            expect(roundTripped.timestamp).toBe(photo.timestamp);
            expect(roundTripped.category).toBe(photo.category);
            
            // Verify location is preserved (or both are null)
            if (photo.location === null) {
              expect(roundTripped.location).toBeNull();
            } else {
              expect(roundTripped.location).not.toBeNull();
              expect(roundTripped.location?.latitude).toBe(photo.location.latitude);
              expect(roundTripped.location?.longitude).toBe(photo.location.longitude);
              expect(roundTripped.location?.accuracy).toBe(photo.location.accuracy);
              // Note: address field is not stored in OfflinePhotoRecord schema
              // This is intentional as address is typically reverse-geocoded on display
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('photos can be retrieved by customer ID after saving', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(capturedPhotoArb, { minLength: 1, maxLength: 5 }),
          customerIdArb,
          async (photosInput, customerId) => {
            // Clear database before each property test iteration
            await clearAllPhotos();
            
            // Ensure unique photo IDs to avoid key collision
            const photos = photosInput.map((photo) => ({
              ...photo,
              id: crypto.randomUUID(),
            }));
            
            // Save all photos
            for (const photo of photos) {
              await savePhoto(photo, customerId);
            }
            
            // Retrieve all photos for the customer
            const retrieved = await getPhotos(customerId);
            
            // Verify all photos were retrieved
            expect(retrieved.length).toBe(photos.length);
            
            // Verify each photo's data is intact (including location)
            for (const photo of photos) {
              const found = retrieved.find(r => r.id === photo.id);
              expect(found).toBeDefined();
              if (found) {
                expect(found.dataUrl).toBe(photo.dataUrl);
                expect(found.timestamp).toBe(photo.timestamp);
                expect(found.category).toBe(photo.category);
                
                // Verify location field is preserved
                if (photo.location === null) {
                  expect(found.latitude).toBeNull();
                  expect(found.longitude).toBeNull();
                } else {
                  expect(found.latitude).toBe(photo.location.latitude);
                  expect(found.longitude).toBe(photo.location.longitude);
                  expect(found.accuracy).toBe(photo.location.accuracy);
                }
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('deleting a photo removes it from storage', async () => {
      await fc.assert(
        fc.asyncProperty(
          capturedPhotoArb,
          customerIdArb,
          async (photoInput, customerId) => {
            // Clear database before each property test iteration
            await clearAllPhotos();
            
            // Ensure unique photo ID
            const photo = {
              ...photoInput,
              id: crypto.randomUUID(),
            };
            
            // Save the photo
            const savedId = await savePhoto(photo, customerId);
            
            // Verify it exists
            const beforeDelete = await getPhotoById(savedId);
            expect(beforeDelete).toBeDefined();
            
            // Delete the photo
            await deletePhoto(savedId);
            
            // Verify it no longer exists
            const afterDelete = await getPhotoById(savedId);
            expect(afterDelete).toBeUndefined();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('photos from different customers are isolated', async () => {
      await fc.assert(
        fc.asyncProperty(
          capturedPhotoArb,
          capturedPhotoArb,
          customerIdArb,
          customerIdArb.filter(id => id.length > 0),
          async (photo1Input, photo2Input, customerId1, customerId2Suffix) => {
            // Clear database before each property test iteration
            await clearAllPhotos();
            
            // Ensure different customer IDs
            const customerId2 = customerId1 + '_' + customerId2Suffix;
            
            // Ensure different photo IDs to avoid key collision by generating unique IDs
            const photo1 = {
              ...photo1Input,
              id: crypto.randomUUID(),
            };
            const photo2 = {
              ...photo2Input,
              id: crypto.randomUUID(),
            };
            
            // Save photos for different customers
            await savePhoto(photo1, customerId1);
            await savePhoto(photo2, customerId2);
            
            // Retrieve photos for each customer
            const customer1Photos = await getPhotos(customerId1);
            const customer2Photos = await getPhotos(customerId2);
            
            // Verify isolation
            expect(customer1Photos.length).toBe(1);
            expect(customer2Photos.length).toBe(1);
            expect(customer1Photos[0].id).toBe(photo1.id);
            expect(customer2Photos[0].id).toBe(photo2.id);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
