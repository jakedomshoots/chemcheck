/**
 * Photo capture utilities for Proof of Service feature
 * Implements photo metadata types, validation, geolocation, timestamp utilities,
 * and image compression/optimization
 * Requirements: 1.2, 1.3, 1.4, 2.1, 2.2
 */

import {
  CapturedPhoto,
  GeoLocation,
  ImageCompressionOptions,
  ImageCompressionResult,
  DEFAULT_COMPRESSION_OPTIONS
} from './types';

// ============================================
// Image Compression Utilities
// ============================================

/**
 * Calculate the size in bytes of a base64 data URL
 * @param dataUrl - Base64 encoded data URL
 * @returns Size in bytes
 */
export function getDataUrlSize(dataUrl: string): number {
  // Remove data URL prefix to get pure base64
  const base64 = dataUrl.split(',')[1];
  if (!base64) {
    // Fallback to string length for malformed data URLs
    return dataUrl.length * 2; // UTF-16 estimation
  }

  // Each base64 character represents 6 bits, so 4 characters = 3 bytes
  // Subtract padding characters (=) from the calculation
  const padding = (base64.match(/=/g) || []).length;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/**
 * Load an image from a data URL
 * @param dataUrl - Base64 encoded image
 * @returns Promise resolving to HTMLImageElement
 */
function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = dataUrl;
  });
}

/**
 * Get EXIF orientation from a data URL (1-8, or 1 if not found)
 * Handles the common JPEG EXIF orientation tag
 * @param dataUrl - Base64 encoded JPEG image
 * @returns Orientation value (1-8)
 */
function getExifOrientation(dataUrl: string): number {
  try {
    // Get base64 data
    const base64 = dataUrl.split(',')[1];
    if (!base64) return 1;

    // Decode base64 to binary
    const binary = atob(base64);
    const view = new DataView(new ArrayBuffer(binary.length));
    for (let i = 0; i < binary.length; i++) {
      view.setUint8(i, binary.charCodeAt(i));
    }

    // Check for JPEG SOI marker
    if (view.getUint16(0, false) !== 0xFFD8) return 1;

    let offset = 2;
    while (offset < view.byteLength) {
      const marker = view.getUint16(offset, false);
      offset += 2;

      // APP1 marker (contains EXIF)
      if (marker === 0xFFE1) {
        const length = view.getUint16(offset, false);
        offset += 2;

        // Check for "Exif\0\0" signature
        const exifSignature = String.fromCharCode(
          view.getUint8(offset),
          view.getUint8(offset + 1),
          view.getUint8(offset + 2),
          view.getUint8(offset + 3)
        );
        if (exifSignature !== 'Exif') return 1;

        offset += 6; // Skip "Exif\0\0"

        // TIFF header
        const tiffOffset = offset;
        const littleEndian = view.getUint16(offset, false) === 0x4949;
        offset += 4; // Skip byte order and 0x002A

        const ifdOffset = view.getUint32(offset, littleEndian);
        offset = tiffOffset + ifdOffset;

        // IFD0 entries
        const numEntries = view.getUint16(offset, littleEndian);
        offset += 2;

        for (let i = 0; i < numEntries; i++) {
          const tag = view.getUint16(offset, littleEndian);
          if (tag === 0x0112) { // Orientation tag
            const orientation = view.getUint16(offset + 8, littleEndian);
            return orientation >= 1 && orientation <= 8 ? orientation : 1;
          }
          offset += 12;
        }
        return 1;
      } else if ((marker & 0xFF00) === 0xFF00) {
        // Skip other markers
        const length = view.getUint16(offset, false);
        offset += length;
      } else {
        break;
      }
    }
    return 1;
  } catch {
    return 1; // Default orientation on error
  }
}

/**
 * Calculate dimensions maintaining aspect ratio within constraints
 * @param width - Original width
 * @param height - Original height
 * @param maxWidth - Maximum width constraint
 * @param maxHeight - Maximum height constraint
 * @returns Object with new width and height
 */
function calculateDimensions(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number
): { width: number; height: number } {
  // If image is smaller than constraints, keep original size
  if (width <= maxWidth && height <= maxHeight) {
    return { width, height };
  }

  // Calculate scale factor to fit within constraints
  // Clamp to 1 to prevent upscaling of small images
  const widthRatio = maxWidth / width;
  const heightRatio = maxHeight / height;
  const scale = Math.min(1, widthRatio, heightRatio);

  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

/**
 * Apply EXIF orientation transform to canvas context
 * @param ctx - Canvas 2D context
 * @param width - Canvas width
 * @param height - Canvas height
 * @param orientation - EXIF orientation (1-8)
 */
function applyOrientation(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  orientation: number
): void {
  switch (orientation) {
    case 2: ctx.transform(-1, 0, 0, 1, width, 0); break;           // Flip horizontal
    case 3: ctx.transform(-1, 0, 0, -1, width, height); break;     // Rotate 180
    case 4: ctx.transform(1, 0, 0, -1, 0, height); break;          // Flip vertical
    case 5: ctx.transform(0, 1, 1, 0, 0, 0); break;                // Transpose
    case 6: ctx.transform(0, 1, -1, 0, height, 0); break;          // Rotate 90 CW
    case 7: ctx.transform(0, -1, -1, 0, height, width); break;     // Transverse
    case 8: ctx.transform(0, -1, 1, 0, 0, width); break;           // Rotate 90 CCW
    default: break;                                                 // Normal (1)
  }
}

/**
 * Compress and optimize an image for storage and upload
 * Handles EXIF orientation, resizing, and quality adjustment
 * 
 * @param dataUrl - Base64 encoded source image
 * @param options - Compression options (partial, merged with defaults)
 * @returns Promise resolving to compression result with stats
 */
export async function compressImage(
  dataUrl: string,
  options: Partial<ImageCompressionOptions> = {}
): Promise<ImageCompressionResult> {
  const opts = { ...DEFAULT_COMPRESSION_OPTIONS, ...options };
  const originalSize = getDataUrlSize(dataUrl);

  // Load the image
  const img = await loadImage(dataUrl);

  // Get EXIF orientation for JPEGs
  const orientation = opts.preserveExif ? getExifOrientation(dataUrl) : 1;

  // Determine if we need to swap width/height based on orientation
  const swapDimensions = orientation >= 5 && orientation <= 8;
  const sourceWidth = swapDimensions ? img.height : img.width;
  const sourceHeight = swapDimensions ? img.width : img.height;

  // Calculate target dimensions
  const { width, height } = calculateDimensions(
    sourceWidth,
    sourceHeight,
    opts.maxWidth,
    opts.maxHeight
  );

  // Create canvas for compression
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }

  // Apply orientation transform if needed
  if (orientation > 1) {
    applyOrientation(ctx, width, height, orientation);
  }

  // Enable image smoothing for better quality when scaling
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Draw image with correct dimensions based on orientation
  const drawWidth = swapDimensions ? height : width;
  const drawHeight = swapDimensions ? width : height;
  ctx.drawImage(img, 0, 0, drawWidth, drawHeight);

  // Convert to compressed format
  const mimeType = opts.format === 'webp' ? 'image/webp' : 'image/jpeg';
  const compressedDataUrl = canvas.toDataURL(mimeType, opts.quality);
  const compressedSize = getDataUrlSize(compressedDataUrl);

  return {
    dataUrl: compressedDataUrl,
    originalSize,
    compressedSize,
    compressionRatio: compressedSize / originalSize,
    width,
    height,
  };
}

/**
 * Adaptively compress an image to meet a target size
 * Iteratively adjusts quality until target is reached
 * 
 * @param dataUrl - Base64 encoded source image
 * @param targetSizeBytes - Target file size in bytes
 * @param options - Base compression options
 * @returns Promise resolving to compression result
 */
export async function compressToTargetSize(
  dataUrl: string,
  targetSizeBytes: number,
  options: Partial<ImageCompressionOptions> = {}
): Promise<ImageCompressionResult> {
  let currentQuality = options.quality ?? DEFAULT_COMPRESSION_OPTIONS.quality;
  const minQuality = 0.3;
  const qualityStep = 0.1;

  let result = await compressImage(dataUrl, { ...options, quality: currentQuality });

  // Iteratively reduce quality until target size is reached
  while (result.compressedSize > targetSizeBytes && currentQuality > minQuality) {
    currentQuality -= qualityStep;
    result = await compressImage(dataUrl, { ...options, quality: currentQuality });
  }

  return result;
}

/**
 * Generate a thumbnail from an image
 * @param dataUrl - Base64 encoded source image
 * @param maxSize - Maximum dimension (width or height)
 * @returns Promise resolving to thumbnail data URL
 */
export async function generateThumbnail(
  dataUrl: string,
  maxSize: number = 200
): Promise<string> {
  const result = await compressImage(dataUrl, {
    maxWidth: maxSize,
    maxHeight: maxSize,
    quality: 0.7,
    format: 'jpeg',
    preserveExif: true,
  });
  return result.dataUrl;
}

/**
 * Format file size for display
 * @param bytes - Size in bytes
 * @returns Formatted string (e.g., "1.5 MB")
 */
export function formatFileSize(bytes: number): string {
  if (bytes <= 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), units.length - 1);

  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${units[i]}`;
}

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
