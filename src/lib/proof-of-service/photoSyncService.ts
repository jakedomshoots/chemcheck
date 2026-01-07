/**
 * Photo Sync Service for Proof of Service feature
 * Implements background sync for pending photos with retry logic
 * Requirements: 6.3 - Sync all proof-of-service data when connectivity is restored
 * Requirements: 6.4 - Indicate sync status for each service log
 */

import { Id } from '../../../convex/_generated/dataModel';
import {
  getPendingPhotos,
  updateSyncStatus,
  getPhotoById,
  deletePhoto as deleteLocalPhoto,
} from './offlinePhotoStorage';
import { OfflinePhotoRecord, SyncStatus } from './types';

// ============================================
// Types
// ============================================

export interface SyncResult {
  photoId: string;
  success: boolean;
  error?: string;
  convexPhotoId?: string;
}

export interface SyncProgress {
  total: number;
  completed: number;
  failed: number;
  inProgress: boolean;
}

export interface ConvexClient {
  mutation: (name: string, args: Record<string, unknown>) => Promise<unknown>;
}

export interface SyncServiceConfig {
  maxRetries: number;
  retryDelayMs: number;
  retryBackoffMultiplier: number;
  maxRetryDelayMs: number;
  deleteAfterSync: boolean;
}

const DEFAULT_CONFIG: SyncServiceConfig = {
  maxRetries: 3,
  retryDelayMs: 1000,
  retryBackoffMultiplier: 2,
  maxRetryDelayMs: 30000,
  deleteAfterSync: false, // Keep local copy by default
};

// ============================================
// Sync Service State
// ============================================

let syncInProgress = false;
let syncProgress: SyncProgress = {
  total: 0,
  completed: 0,
  failed: 0,
  inProgress: false,
};
let progressListeners: ((progress: SyncProgress) => void)[] = [];

// ============================================
// Progress Tracking
// ============================================

/**
 * Subscribe to sync progress updates
 * @param listener - Callback function to receive progress updates
 * @returns Unsubscribe function
 */
export function onSyncProgress(listener: (progress: SyncProgress) => void): () => void {
  progressListeners.push(listener);
  // Immediately notify with current progress
  listener(syncProgress);
  return () => {
    progressListeners = progressListeners.filter((l) => l !== listener);
  };
}

/**
 * Get current sync progress
 */
export function getSyncProgress(): SyncProgress {
  return { ...syncProgress };
}

function updateProgress(updates: Partial<SyncProgress>): void {
  syncProgress = { ...syncProgress, ...updates };
  progressListeners.forEach((listener) => listener(syncProgress));
}

// ============================================
// Helper Functions
// ============================================

/**
 * Convert base64 data URL to Blob for upload
 * @throws Error if dataUrl is malformed or contains invalid base64
 */
function dataUrlToBlob(dataUrl: string): Blob {
  // Validate input format
  if (!dataUrl || typeof dataUrl !== 'string') {
    throw new Error('Invalid data URL: input must be a non-empty string');
  }
  
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex === -1) {
    throw new Error('Invalid data URL: missing comma separator');
  }
  
  const header = dataUrl.substring(0, commaIndex);
  const base64Data = dataUrl.substring(commaIndex + 1);
  
  if (!base64Data) {
    throw new Error('Invalid data URL: missing base64 data');
  }
  
  // Extract MIME type
  const mimeMatch = header.match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  
  // Validate and decode base64
  let byteString: string;
  try {
    byteString = atob(base64Data);
  } catch {
    throw new Error('Invalid data URL: base64 data is corrupted or malformed');
  }
  
  const arrayBuffer = new ArrayBuffer(byteString.length);
  const uint8Array = new Uint8Array(arrayBuffer);
  
  for (let i = 0; i < byteString.length; i++) {
    uint8Array[i] = byteString.charCodeAt(i);
  }
  
  return new Blob([uint8Array], { type: mime });
}

/**
 * Calculate retry delay with exponential backoff
 */
function calculateRetryDelay(attempt: number, config: SyncServiceConfig): number {
  const delay = config.retryDelayMs * Math.pow(config.retryBackoffMultiplier, attempt);
  return Math.min(delay, config.maxRetryDelayMs);
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if the browser is online
 */
export function isOnline(): boolean {
  return typeof navigator !== 'undefined' ? navigator.onLine : true;
}

// ============================================
// Single Photo Sync
// ============================================

/**
 * Upload a single photo to Convex with retry logic
 */
async function uploadPhotoToConvex(
  photo: OfflinePhotoRecord,
  convexClient: ConvexClient,
  config: SyncServiceConfig
): Promise<SyncResult> {
  // Validate required fields
  if (!photo.serviceLogId) {
    return {
      photoId: photo.id,
      success: false,
      error: 'Photo has no associated service log ID',
    };
  }

  let lastError: string | undefined;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      // Check online status before attempting
      if (!isOnline()) {
        return {
          photoId: photo.id,
          success: false,
          error: 'Device is offline',
        };
      }

      // Step 1: Generate upload URL
      const uploadUrl = await convexClient.mutation(
        'servicePhotos:generateUploadUrl',
        {}
      ) as string;

      // Step 2: Upload the photo blob
      const blob = dataUrlToBlob(photo.dataUrl);
      const uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': blob.type },
        body: blob,
      });

      if (!uploadResponse.ok) {
        throw new Error(`Upload failed with status ${uploadResponse.status}`);
      }

      const { storageId } = await uploadResponse.json() as { storageId: string };

      // Step 3: Create the photo record in Convex
      const convexPhotoId = await convexClient.mutation('servicePhotos:uploadPhoto', {
        service_log_id: photo.serviceLogId as Id<'serviceLogs'>,
        customer_id: photo.customerId as Id<'customers'>,
        storage_id: storageId as Id<'_storage'>,
        category: photo.category,
        timestamp: photo.timestamp,
        latitude: photo.latitude ?? undefined,
        longitude: photo.longitude ?? undefined,
        accuracy: photo.accuracy ?? undefined,
      }) as string;

      // Success - update local status
      await updateSyncStatus(photo.id, 'synced');

      // Optionally delete local copy after successful sync
      if (config.deleteAfterSync) {
        await deleteLocalPhoto(photo.id);
      }

      return {
        photoId: photo.id,
        success: true,
        convexPhotoId,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Unknown error';
      
      // If we have more retries, wait and try again
      if (attempt < config.maxRetries) {
        const delay = calculateRetryDelay(attempt, config);
        await sleep(delay);
      }
    }
  }

  // All retries exhausted - mark as failed
  await updateSyncStatus(photo.id, 'failed', lastError);

  return {
    photoId: photo.id,
    success: false,
    error: lastError,
  };
}

// ============================================
// Batch Sync Operations
// ============================================

/**
 * Sync all pending photos to Convex
 * Requirements: 6.3 - Sync all proof-of-service data when connectivity is restored
 */
export async function syncPendingPhotos(
  convexClient: ConvexClient,
  config: Partial<SyncServiceConfig> = {}
): Promise<SyncResult[]> {
  // Prevent concurrent syncs
  if (syncInProgress) {
    return [];
  }

  // Check online status
  if (!isOnline()) {
    return [];
  }

  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  syncInProgress = true;

  try {
    // Get all pending photos
    const pendingPhotos = await getPendingPhotos();
    
    // Filter to only photos with service log IDs (can't sync without one)
    const syncablePhotos = pendingPhotos.filter((p) => p.serviceLogId !== null);

    updateProgress({
      total: syncablePhotos.length,
      completed: 0,
      failed: 0,
      inProgress: true,
    });

    const results: SyncResult[] = [];

    // Sync photos sequentially to avoid overwhelming the server
    for (const photo of syncablePhotos) {
      const result = await uploadPhotoToConvex(photo, convexClient, mergedConfig);
      results.push(result);

      if (result.success) {
        updateProgress({ completed: syncProgress.completed + 1 });
      } else {
        updateProgress({ failed: syncProgress.failed + 1 });
      }
    }

    return results;
  } finally {
    syncInProgress = false;
    updateProgress({ inProgress: false });
  }
}

/**
 * Retry syncing failed photos
 */
export async function retrySyncFailedPhotos(
  convexClient: ConvexClient,
  config: Partial<SyncServiceConfig> = {}
): Promise<SyncResult[]> {
  // Get all photos and filter for failed ones
  const pendingPhotos = await getPendingPhotos();
  
  // Reset failed photos to pending status
  for (const photo of pendingPhotos) {
    const fullPhoto = await getPhotoById(photo.id);
    if (fullPhoto?.syncStatus === 'failed') {
      await updateSyncStatus(photo.id, 'pending');
    }
  }

  // Now sync all pending (including the reset failed ones)
  return syncPendingPhotos(convexClient, config);
}

/**
 * Sync a single photo by ID
 */
export async function syncSinglePhoto(
  photoId: string,
  convexClient: ConvexClient,
  config: Partial<SyncServiceConfig> = {}
): Promise<SyncResult> {
  const photo = await getPhotoById(photoId);
  
  if (!photo) {
    return {
      photoId,
      success: false,
      error: 'Photo not found in local storage',
    };
  }

  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  return uploadPhotoToConvex(photo, convexClient, mergedConfig);
}

// ============================================
// Auto-Sync on Connectivity Change
// ============================================

let autoSyncEnabled = false;
let autoSyncConvexClient: ConvexClient | null = null;
let onlineListenerAttached = false;

function handleOnline(): void {
  if (autoSyncEnabled && autoSyncConvexClient) {
    syncPendingPhotos(autoSyncConvexClient).catch(console.error);
  }
}

/**
 * Enable automatic sync when device comes online
 * Requirements: 6.3 - Sync when connectivity is restored
 */
export function enableAutoSync(convexClient: ConvexClient): void {
  if (typeof window === 'undefined') return;
  
  // Update the client reference
  autoSyncConvexClient = convexClient;
  autoSyncEnabled = true;
  
  // Only add listener if not already attached (prevents duplicate listeners)
  if (!onlineListenerAttached) {
    window.addEventListener('online', handleOnline);
    onlineListenerAttached = true;
  }
  
  // If already online, trigger sync
  if (isOnline()) {
    syncPendingPhotos(convexClient).catch(console.error);
  }
}

/**
 * Disable automatic sync
 */
export function disableAutoSync(): void {
  if (typeof window === 'undefined') return;
  
  autoSyncEnabled = false;
  autoSyncConvexClient = null;
  
  if (onlineListenerAttached) {
    window.removeEventListener('online', handleOnline);
    onlineListenerAttached = false;
  }
}

/**
 * Check if auto-sync is enabled
 */
export function isAutoSyncEnabled(): boolean {
  return autoSyncEnabled;
}

// ============================================
// Sync Status Helpers
// ============================================

/**
 * Get aggregate sync status for a service log
 * Requirements: 6.4 - Indicate sync status for each service log
 */
export async function getServiceLogSyncStatus(
  serviceLogId: string
): Promise<SyncStatus> {
  const pendingPhotos = await getPendingPhotos();
  const serviceLogPhotos = pendingPhotos.filter(
    (p) => p.serviceLogId === serviceLogId
  );

  if (serviceLogPhotos.length === 0) {
    return 'synced';
  }

  const hasFailedPhotos = serviceLogPhotos.some((p) => p.syncStatus === 'failed');
  if (hasFailedPhotos) {
    return 'failed';
  }

  return 'pending';
}

/**
 * Get count of pending photos for a service log
 */
export async function getPendingPhotoCount(serviceLogId: string): Promise<number> {
  const pendingPhotos = await getPendingPhotos();
  return pendingPhotos.filter(
    (p) => p.serviceLogId === serviceLogId && p.syncStatus === 'pending'
  ).length;
}
