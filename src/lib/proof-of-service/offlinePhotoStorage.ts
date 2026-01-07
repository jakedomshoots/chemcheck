/**
 * IndexedDB wrapper for offline photo storage
 * Implements photo persistence for proof-of-service feature
 * Requirements: 6.1 - Offline photo capture and local storage
 */

import Dexie, { Table } from 'dexie';
import { OfflinePhotoRecord, CapturedPhoto, SyncStatus } from './types';

// ============================================
// Error Types
// ============================================

export class PhotoStorageError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'PhotoStorageError';
  }
}

// ============================================
// Database Schema
// ============================================

class OfflinePhotoDatabase extends Dexie {
  photos!: Table<OfflinePhotoRecord>;

  constructor() {
    super('proofOfServicePhotos');

    this.version(1).stores({
      photos: 'id, customerId, serviceLogId, syncStatus, createdAt, category, [customerId+serviceLogId], [customerId+category]',
    });
  }
}

// Singleton database instance
const db = new OfflinePhotoDatabase();

// ============================================
// Helper Functions
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

/**
 * Wraps an async operation with error handling
 */
async function withErrorHandling<T>(
  operation: string,
  fn: () => Promise<T>
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    // Handle specific Dexie/IndexedDB errors
    if (error instanceof Dexie.QuotaExceededError) {
      throw new PhotoStorageError(
        'Storage quota exceeded. Please delete some photos to free up space.',
        operation,
        error
      );
    }
    if (error instanceof Dexie.DatabaseClosedError) {
      throw new PhotoStorageError(
        'Database connection was closed unexpectedly. Please refresh the page.',
        operation,
        error
      );
    }
    if (error instanceof Dexie.AbortError) {
      throw new PhotoStorageError(
        'Database operation was aborted. Please try again.',
        operation,
        error
      );
    }
    // Re-throw with context for other errors
    throw new PhotoStorageError(
      `Failed to ${operation}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      operation,
      error
    );
  }
}

// ============================================
// Photo Storage Operations
// ============================================

/**
 * Save a captured photo to IndexedDB
 * @param photo - The captured photo with metadata
 * @param customerId - The customer ID associated with this photo
 * @param serviceLogId - Optional service log ID (null for new logs)
 * @returns The ID of the saved photo
 * @throws PhotoStorageError if the operation fails
 */
export async function savePhoto(
  photo: CapturedPhoto,
  customerId: string,
  serviceLogId: string | null = null
): Promise<string> {
  return withErrorHandling('save photo', async () => {
    const record: OfflinePhotoRecord = {
      id: photo.id || generateUUID(),
      customerId,
      serviceLogId,
      category: photo.category,
      dataUrl: photo.dataUrl,
      timestamp: photo.timestamp,
      latitude: photo.location?.latitude ?? null,
      longitude: photo.location?.longitude ?? null,
      accuracy: photo.location?.accuracy ?? null,
      syncStatus: 'pending',
      createdAt: Date.now(),
    };

    await db.photos.put(record);
    return record.id;
  });
}

/**
 * Get all photos for a customer
 * @param customerId - The customer ID to filter by
 * @returns Array of offline photo records
 * @throws PhotoStorageError if the operation fails
 */
export async function getPhotos(customerId: string): Promise<OfflinePhotoRecord[]> {
  return withErrorHandling('get photos', async () => {
    return db.photos.where('customerId').equals(customerId).toArray();
  });
}

/**
 * Get photos for a specific service log
 * @param serviceLogId - The service log ID to filter by
 * @returns Array of offline photo records
 * @throws PhotoStorageError if the operation fails
 */
export async function getPhotosByServiceLog(serviceLogId: string): Promise<OfflinePhotoRecord[]> {
  return withErrorHandling('get photos by service log', async () => {
    return db.photos.where('serviceLogId').equals(serviceLogId).toArray();
  });
}

/**
 * Get a single photo by ID
 * @param photoId - The photo ID
 * @returns The photo record or undefined
 * @throws PhotoStorageError if the operation fails
 */
export async function getPhotoById(photoId: string): Promise<OfflinePhotoRecord | undefined> {
  return withErrorHandling('get photo by ID', async () => {
    return db.photos.get(photoId);
  });
}

/**
 * Delete a photo from IndexedDB
 * @param photoId - The ID of the photo to delete
 * @throws PhotoStorageError if the operation fails
 */
export async function deletePhoto(photoId: string): Promise<void> {
  return withErrorHandling('delete photo', async () => {
    await db.photos.delete(photoId);
  });
}

/**
 * Delete all unlinked photos for a customer (photos with serviceLogId === null)
 * Used to clean up photos from abandoned/incomplete service log sessions
 * @param customerId - The customer ID
 * @throws PhotoStorageError if the operation fails
 */
export async function deleteUnlinkedPhotos(customerId: string): Promise<void> {
  return withErrorHandling('delete unlinked photos', async () => {
    await db.photos
      .where('customerId')
      .equals(customerId)
      .and((photo) => photo.serviceLogId === null)
      .delete();
  });
}

/**
 * Delete all photos for a customer
 * @param customerId - The customer ID
 * @throws PhotoStorageError if the operation fails
 */
export async function deletePhotosByCustomer(customerId: string): Promise<void> {
  return withErrorHandling('delete photos by customer', async () => {
    await db.photos.where('customerId').equals(customerId).delete();
  });
}

/**
 * Update the service log ID for photos (used when service log is created)
 * @param customerId - The customer ID
 * @param serviceLogId - The new service log ID
 * @throws PhotoStorageError if the operation fails
 */
export async function linkPhotosToServiceLog(
  customerId: string,
  serviceLogId: string
): Promise<void> {
  return withErrorHandling('link photos to service log', async () => {
    console.log('[linkPhotosToServiceLog] Starting - customerId:', customerId, 'serviceLogId:', serviceLogId);
    
    // Find all unlinked photos for this customer
    const unlinkedPhotos = await db.photos
      .where('customerId')
      .equals(customerId)
      .and((photo) => photo.serviceLogId === null)
      .toArray();
    
    console.log('[linkPhotosToServiceLog] Found', unlinkedPhotos.length, 'unlinked photos');
    
    // Update them with the service log ID
    const updateCount = await db.photos
      .where('customerId')
      .equals(customerId)
      .and((photo) => photo.serviceLogId === null)
      .modify({ serviceLogId });
    
    console.log('[linkPhotosToServiceLog] Updated', updateCount, 'photos');
  });
}

/**
 * Update sync status for a photo
 * @param photoId - The photo ID
 * @param status - The new sync status
 * @param error - Optional error message for failed status
 * @throws PhotoStorageError if the operation fails
 */
export async function updateSyncStatus(
  photoId: string,
  status: SyncStatus,
  error?: string
): Promise<void> {
  return withErrorHandling('update sync status', async () => {
    const update: Partial<OfflinePhotoRecord> = { syncStatus: status };
    if (error) {
      update.syncError = error;
    }
    await db.photos.update(photoId, update);
  });
}

/**
 * Get all photos pending sync
 * @returns Array of photos with 'pending' sync status
 * @throws PhotoStorageError if the operation fails
 */
export async function getPendingPhotos(): Promise<OfflinePhotoRecord[]> {
  return withErrorHandling('get pending photos', async () => {
    return db.photos.where('syncStatus').equals('pending').toArray();
  });
}

/**
 * Get count of photos by category for a customer
 * Optimized to count at database level without loading full photo data
 * @param customerId - The customer ID
 * @returns Object with before and after counts
 * @throws PhotoStorageError if the operation fails
 */
export async function getPhotoCounts(
  customerId: string
): Promise<{ before: number; after: number }> {
  return withErrorHandling('get photo counts', async () => {
    // Use compound index for efficient counting without loading data
    const [beforeCount, afterCount] = await Promise.all([
      db.photos
        .where('[customerId+category]')
        .equals([customerId, 'before'])
        .count(),
      db.photos
        .where('[customerId+category]')
        .equals([customerId, 'after'])
        .count(),
    ]);

    return {
      before: beforeCount,
      after: afterCount,
    };
  });
}

/**
 * Get total photo count for a customer (optimized)
 * @param customerId - The customer ID
 * @returns Total number of photos
 * @throws PhotoStorageError if the operation fails
 */
export async function getTotalPhotoCount(customerId: string): Promise<number> {
  return withErrorHandling('get total photo count', async () => {
    return db.photos.where('customerId').equals(customerId).count();
  });
}

/**
 * Convert an OfflinePhotoRecord back to a CapturedPhoto
 * @param record - The offline photo record
 * @returns The captured photo object
 */
export function recordToCapturedPhoto(record: OfflinePhotoRecord): CapturedPhoto {
  return {
    id: record.id,
    dataUrl: record.dataUrl,
    timestamp: record.timestamp,
    category: record.category,
    location:
      record.latitude !== null && record.longitude !== null
        ? {
            latitude: record.latitude,
            longitude: record.longitude,
            accuracy: record.accuracy ?? 0,
          }
        : null,
  };
}

/**
 * Clear all photos from the database (for testing/cleanup)
 * @throws PhotoStorageError if the operation fails
 */
export async function clearAllPhotos(): Promise<void> {
  return withErrorHandling('clear all photos', async () => {
    await db.photos.clear();
  });
}

/**
 * Check if the database is accessible
 * Useful for checking storage availability before operations
 * @returns true if database is accessible
 */
export async function isDatabaseAccessible(): Promise<boolean> {
  try {
    await db.photos.count();
    return true;
  } catch {
    return false;
  }
}

// Export the database instance for advanced operations
export { db as offlinePhotoDb };
