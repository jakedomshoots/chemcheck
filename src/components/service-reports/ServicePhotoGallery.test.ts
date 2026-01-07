/**
 * Property-Based Tests for ServicePhotoGallery Component
 * 
 * These tests validate the correctness properties defined in the design document
 * using fast-check for property-based testing.
 * 
 * Feature: customer-service-reports
 * Property 2: Photo gallery grouping
 * Validates: Requirements 1.2, 1.3
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { groupPhotosByCategory, ServicePhoto } from './ServicePhotoGallery';

// ============================================================================
// Generators for Property-Based Testing
// ============================================================================

/**
 * Generator for photo IDs (unique identifiers)
 */
const photoIdArb = fc.uuid();

/**
 * Generator for photo URLs
 */
const photoUrlArb = fc.webUrl();

/**
 * Generator for photo categories
 */
const photoCategoryArb: fc.Arbitrary<'before' | 'after'> = fc.constantFrom('before', 'after');

/**
 * Generator for ISO 8601 timestamps
 */
const timestampArb = fc.integer({ min: 1577836800000, max: 1924905600000 }) // 2020-01-01 to 2030-12-31
  .map(ts => new Date(ts).toISOString());

/**
 * Generator for a single ServicePhoto
 */
const servicePhotoArb: fc.Arbitrary<ServicePhoto> = fc.record({
  id: photoIdArb,
  url: photoUrlArb,
  category: photoCategoryArb,
  timestamp: timestampArb,
});

/**
 * Generator for an array of ServicePhotos with unique IDs
 */
const servicePhotosArb = fc.array(servicePhotoArb, { minLength: 0, maxLength: 20 })
  .map(photos => {
    // Ensure unique IDs
    const seen = new Set<string>();
    return photos.filter(photo => {
      if (seen.has(photo.id)) return false;
      seen.add(photo.id);
      return true;
    });
  });

/**
 * Generator for photos with guaranteed before and after photos
 */
const mixedPhotosArb = fc.tuple(
  fc.array(servicePhotoArb.map(p => ({ ...p, category: 'before' as const })), { minLength: 1, maxLength: 10 }),
  fc.array(servicePhotoArb.map(p => ({ ...p, category: 'after' as const })), { minLength: 1, maxLength: 10 })
).map(([before, after]) => {
  // Ensure unique IDs across both arrays
  const allPhotos = [...before, ...after];
  const seen = new Set<string>();
  return allPhotos.filter(photo => {
    if (seen.has(photo.id)) return false;
    seen.add(photo.id);
    return true;
  });
});

// ============================================================================
// Property-Based Tests
// ============================================================================

describe('ServicePhotoGallery', () => {
  /**
   * Property 2: Photo gallery grouping
   * 
   * For any set of photos with mixed categories, the PhotoGallery SHALL render
   * all photos grouped by category (before photos together, after photos together)
   * with each group clearly labeled.
   * 
   * **Validates: Requirements 1.2, 1.3**
   */
  describe('Property 2: Photo gallery grouping', () => {
    it('all before photos are grouped together', () => {
      fc.assert(
        fc.property(
          servicePhotosArb,
          (photos) => {
            const grouped = groupPhotosByCategory(photos);
            
            // All photos in the before group should have category 'before'
            for (const photo of grouped.before) {
              expect(photo.category).toBe('before');
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('all after photos are grouped together', () => {
      fc.assert(
        fc.property(
          servicePhotosArb,
          (photos) => {
            const grouped = groupPhotosByCategory(photos);
            
            // All photos in the after group should have category 'after'
            for (const photo of grouped.after) {
              expect(photo.category).toBe('after');
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('total photo count is preserved after grouping', () => {
      fc.assert(
        fc.property(
          servicePhotosArb,
          (photos) => {
            const grouped = groupPhotosByCategory(photos);
            
            // Total count should match
            const totalGrouped = grouped.before.length + grouped.after.length;
            expect(totalGrouped).toBe(photos.length);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('no photos are lost during grouping', () => {
      fc.assert(
        fc.property(
          servicePhotosArb,
          (photos) => {
            const grouped = groupPhotosByCategory(photos);
            
            // Every original photo should be in exactly one group
            const allGroupedIds = new Set([
              ...grouped.before.map(p => p.id),
              ...grouped.after.map(p => p.id),
            ]);
            
            for (const photo of photos) {
              expect(allGroupedIds.has(photo.id)).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('no duplicate photos in grouped output', () => {
      fc.assert(
        fc.property(
          servicePhotosArb,
          (photos) => {
            const grouped = groupPhotosByCategory(photos);
            
            // Check for duplicates in before group
            const beforeIds = grouped.before.map(p => p.id);
            expect(new Set(beforeIds).size).toBe(beforeIds.length);
            
            // Check for duplicates in after group
            const afterIds = grouped.after.map(p => p.id);
            expect(new Set(afterIds).size).toBe(afterIds.length);
            
            // Check no photo appears in both groups
            const beforeSet = new Set(beforeIds);
            for (const id of afterIds) {
              expect(beforeSet.has(id)).toBe(false);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('before photo count matches original before photos', () => {
      fc.assert(
        fc.property(
          servicePhotosArb,
          (photos) => {
            const grouped = groupPhotosByCategory(photos);
            
            const originalBeforeCount = photos.filter(p => p.category === 'before').length;
            expect(grouped.before.length).toBe(originalBeforeCount);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('after photo count matches original after photos', () => {
      fc.assert(
        fc.property(
          servicePhotosArb,
          (photos) => {
            const grouped = groupPhotosByCategory(photos);
            
            const originalAfterCount = photos.filter(p => p.category === 'after').length;
            expect(grouped.after.length).toBe(originalAfterCount);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('handles empty photo array', () => {
      const grouped = groupPhotosByCategory([]);
      
      expect(grouped.before).toHaveLength(0);
      expect(grouped.after).toHaveLength(0);
    });

    it('handles photos with only before category', () => {
      fc.assert(
        fc.property(
          fc.array(servicePhotoArb.map(p => ({ ...p, category: 'before' as const })), { minLength: 1, maxLength: 10 }),
          (photos) => {
            // Ensure unique IDs
            const seen = new Set<string>();
            const uniquePhotos = photos.filter(photo => {
              if (seen.has(photo.id)) return false;
              seen.add(photo.id);
              return true;
            });
            
            const grouped = groupPhotosByCategory(uniquePhotos);
            
            expect(grouped.before.length).toBe(uniquePhotos.length);
            expect(grouped.after.length).toBe(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('handles photos with only after category', () => {
      fc.assert(
        fc.property(
          fc.array(servicePhotoArb.map(p => ({ ...p, category: 'after' as const })), { minLength: 1, maxLength: 10 }),
          (photos) => {
            // Ensure unique IDs
            const seen = new Set<string>();
            const uniquePhotos = photos.filter(photo => {
              if (seen.has(photo.id)) return false;
              seen.add(photo.id);
              return true;
            });
            
            const grouped = groupPhotosByCategory(uniquePhotos);
            
            expect(grouped.before.length).toBe(0);
            expect(grouped.after.length).toBe(uniquePhotos.length);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('correctly groups mixed before and after photos', () => {
      fc.assert(
        fc.property(
          mixedPhotosArb,
          (photos) => {
            const grouped = groupPhotosByCategory(photos);
            
            // Should have both before and after photos
            const hasBeforePhotos = photos.some(p => p.category === 'before');
            const hasAfterPhotos = photos.some(p => p.category === 'after');
            
            if (hasBeforePhotos) {
              expect(grouped.before.length).toBeGreaterThan(0);
            }
            if (hasAfterPhotos) {
              expect(grouped.after.length).toBeGreaterThan(0);
            }
            
            // Verify correct categorization
            for (const photo of grouped.before) {
              expect(photo.category).toBe('before');
            }
            for (const photo of grouped.after) {
              expect(photo.category).toBe('after');
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('photo data integrity is preserved after grouping', () => {
      fc.assert(
        fc.property(
          servicePhotosArb,
          (photos) => {
            const grouped = groupPhotosByCategory(photos);
            
            // Create a map of original photos by ID
            const originalMap = new Map(photos.map(p => [p.id, p]));
            
            // Verify all grouped photos match their originals
            for (const photo of [...grouped.before, ...grouped.after]) {
              const original = originalMap.get(photo.id);
              expect(original).toBeDefined();
              expect(photo.url).toBe(original!.url);
              expect(photo.category).toBe(original!.category);
              expect(photo.timestamp).toBe(original!.timestamp);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
