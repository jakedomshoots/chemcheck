/**
 * Types for Proof of Service feature
 * Defines interfaces for photo capture, time tracking, and offline storage
 */

// ============================================
// Photo Types
// ============================================

export interface GeoLocation {
  latitude: number;
  longitude: number;
  accuracy: number;          // meters
  address?: string;          // reverse geocoded address
}

export interface CapturedPhoto {
  id: string;
  dataUrl: string;           // Base64 encoded image
  timestamp: string;         // ISO 8601 format
  category: 'before' | 'after';
  location: GeoLocation | null;
}

// ============================================
// Image Compression Types
// ============================================

export interface ImageCompressionOptions {
  quality: number;           // 0.1-1.0, default 0.85
  maxWidth: number;          // Max width in pixels, default 1920
  maxHeight: number;         // Max height in pixels, default 1080
  format: 'jpeg' | 'webp';   // Output format, default 'jpeg'
  preserveExif: boolean;     // Keep EXIF metadata, default true
}

export interface ImageCompressionResult {
  dataUrl: string;           // Compressed image as base64
  originalSize: number;      // Original size in bytes
  compressedSize: number;    // Compressed size in bytes
  compressionRatio: number;  // Ratio of compression (0-1)
  width: number;             // Final width
  height: number;            // Final height
}

export const DEFAULT_COMPRESSION_OPTIONS: ImageCompressionOptions = {
  quality: 0.85,
  maxWidth: 1920,
  maxHeight: 1080,
  format: 'jpeg',
  preserveExif: true,
};

export interface OfflinePhotoRecord {
  id: string;                    // UUID
  customerId: string;
  serviceLogId: string | null;   // null until service log created
  category: 'before' | 'after';
  dataUrl: string;               // Base64 image data
  timestamp: string;             // ISO 8601
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  syncStatus: 'pending' | 'synced' | 'failed';
  syncError?: string;
  createdAt: number;
}

// ============================================
// Time Tracking Types
// ============================================

export interface TimeTrackerState {
  startTime: string | null;   // ISO 8601 UTC
  endTime: string | null;     // ISO 8601 UTC
  duration: number | null;    // milliseconds
  isTracking: boolean;
}

export interface StoredTimeState {
  customerId: string;
  startTime: string;           // ISO 8601 UTC
  endTime: string | null;
  lastUpdated: number;         // timestamp for cleanup
}

// ============================================
// Sync Types
// ============================================

export type SyncStatus = 'synced' | 'pending' | 'failed';

export interface PendingSyncItem {
  id: string;
  type: 'photo' | 'timeState';
  data: OfflinePhotoRecord | StoredTimeState;
}

// ============================================
// Proof-of-Service Requirements Types
// Requirements 5.1, 5.3
// ============================================

/**
 * Per-service-type proof-of-service requirements
 * Allows different requirements for different service types (Requirement 5.3)
 */
export interface ServiceTypeRequirement {
  service_type: string;
  require_before_photos: boolean;
  require_after_photos: boolean;
  require_time_tracking: boolean;
  min_photos_before: number;
  min_photos_after: number;
}

/**
 * Business-level proof-of-service settings
 * Configurable requirements for documentation standards (Requirement 5.1)
 */
export interface ProofOfServiceSettings {
  require_before_photos: boolean;
  require_after_photos: boolean;
  require_time_tracking: boolean;
  min_photos_before: number;
  min_photos_after: number;
  service_type_requirements?: ServiceTypeRequirement[];
}

/**
 * Default proof-of-service settings when none are configured
 */
export const DEFAULT_PROOF_OF_SERVICE_SETTINGS: ProofOfServiceSettings = {
  require_before_photos: false,
  require_after_photos: false,
  require_time_tracking: false,
  min_photos_before: 0,
  min_photos_after: 0,
  service_type_requirements: [],
};

/**
 * Validate and sanitize photo count values
 * Ensures values are non-negative integers within reasonable bounds
 * @param value - The value to validate
 * @param maxValue - Maximum allowed value (default: 100)
 * @returns Sanitized non-negative integer
 */
export function sanitizePhotoCount(value: number, maxValue: number = 100): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  // Round to integer and clamp to max
  return Math.min(Math.floor(value), maxValue);
}

/**
 * Validate ProofOfServiceSettings and return sanitized version
 * @param settings - Settings to validate
 * @returns Sanitized settings with valid photo counts
 */
export function sanitizeProofOfServiceSettings(
  settings: ProofOfServiceSettings
): ProofOfServiceSettings {
  return {
    ...settings,
    min_photos_before: sanitizePhotoCount(settings.min_photos_before),
    min_photos_after: sanitizePhotoCount(settings.min_photos_after),
    service_type_requirements: settings.service_type_requirements?.map(req => ({
      ...req,
      min_photos_before: sanitizePhotoCount(req.min_photos_before),
      min_photos_after: sanitizePhotoCount(req.min_photos_after),
    })),
  };
}

/**
 * Service completion data for validation
 */
export interface ServiceCompletionData {
  beforePhotoCount: number;
  afterPhotoCount: number;
  serviceType?: string;
}

/**
 * Validation error for missing requirements
 */
export interface RequirementValidationError {
  field: 'before_photos' | 'after_photos' | 'time_tracking';
  message: string;
  required: number | boolean;
  actual: number | boolean;
}

/**
 * Result of requirement validation
 */
export interface RequirementValidationResult {
  isValid: boolean;
  errors: RequirementValidationError[];
}
