/**
 * Photo Error Handling and Recovery Utilities
 * 
 * Provides comprehensive error handling, retry logic, and recovery
 * mechanisms for photo operations.
 */

// ============================================
// Error Types
// ============================================

export type PhotoErrorCode =
    | 'CAPTURE_FAILED'
    | 'COMPRESSION_FAILED'
    | 'STORAGE_FAILED'
    | 'SYNC_FAILED'
    | 'VALIDATION_FAILED'
    | 'QUOTA_EXCEEDED'
    | 'NETWORK_ERROR'
    | 'CORRUPTION_DETECTED'
    | 'PERMISSION_DENIED'
    | 'CAMERA_UNAVAILABLE'
    | 'UNKNOWN';

export interface PhotoError {
    code: PhotoErrorCode;
    message: string;
    recoverable: boolean;
    retryable: boolean;
    userMessage: string;
    details?: unknown;
    timestamp: string;
}

// ============================================
// Error Mappings
// ============================================

const ERROR_CONFIG: Record<PhotoErrorCode, { recoverable: boolean; retryable: boolean; userMessage: string }> = {
    CAPTURE_FAILED: {
        recoverable: true,
        retryable: true,
        userMessage: 'Failed to capture photo. Please try again.',
    },
    COMPRESSION_FAILED: {
        recoverable: true,
        retryable: true,
        userMessage: 'Failed to process photo. Please try again.',
    },
    STORAGE_FAILED: {
        recoverable: true,
        retryable: true,
        userMessage: 'Failed to save photo. Please try again.',
    },
    SYNC_FAILED: {
        recoverable: true,
        retryable: true,
        userMessage: 'Failed to sync photo. Will retry automatically.',
    },
    VALIDATION_FAILED: {
        recoverable: false,
        retryable: false,
        userMessage: 'Photo data is invalid. Please capture a new photo.',
    },
    QUOTA_EXCEEDED: {
        recoverable: true,
        retryable: false,
        userMessage: 'Storage is full. Please delete some photos to continue.',
    },
    NETWORK_ERROR: {
        recoverable: true,
        retryable: true,
        userMessage: 'Network error. Photo saved locally and will sync when online.',
    },
    CORRUPTION_DETECTED: {
        recoverable: false,
        retryable: false,
        userMessage: 'Photo appears to be corrupted. Please capture a new photo.',
    },
    PERMISSION_DENIED: {
        recoverable: false,
        retryable: false,
        userMessage: 'Camera permission denied. Please enable camera access in settings.',
    },
    CAMERA_UNAVAILABLE: {
        recoverable: false,
        retryable: false,
        userMessage: 'Camera is not available on this device.',
    },
    UNKNOWN: {
        recoverable: true,
        retryable: true,
        userMessage: 'An unexpected error occurred. Please try again.',
    },
};

// ============================================
// Error Factory
// ============================================

/**
 * Create a structured PhotoError from any error
 */
export function createPhotoError(
    code: PhotoErrorCode,
    message: string,
    details?: unknown
): PhotoError {
    const config = ERROR_CONFIG[code];
    return {
        code,
        message,
        recoverable: config.recoverable,
        retryable: config.retryable,
        userMessage: config.userMessage,
        details,
        timestamp: new Date().toISOString(),
    };
}

/**
 * Classify an unknown error into a PhotoError
 */
export function classifyError(error: unknown): PhotoError {
    // Handle DOMException for camera/media errors
    if (error instanceof DOMException) {
        if (error.name === 'NotAllowedError') {
            return createPhotoError('PERMISSION_DENIED', error.message, error);
        }
        if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
            return createPhotoError('CAMERA_UNAVAILABLE', error.message, error);
        }
        if (error.name === 'QuotaExceededError') {
            return createPhotoError('QUOTA_EXCEEDED', error.message, error);
        }
    }

    // Handle network errors
    if (error instanceof TypeError && error.message.includes('fetch')) {
        return createPhotoError('NETWORK_ERROR', error.message, error);
    }

    // Handle standard errors
    if (error instanceof Error) {
        const msg = error.message.toLowerCase();
        if (msg.includes('quota') || msg.includes('storage')) {
            return createPhotoError('QUOTA_EXCEEDED', error.message, error);
        }
        if (msg.includes('network') || msg.includes('offline')) {
            return createPhotoError('NETWORK_ERROR', error.message, error);
        }
        if (msg.includes('permission') || msg.includes('denied')) {
            return createPhotoError('PERMISSION_DENIED', error.message, error);
        }
        return createPhotoError('UNKNOWN', error.message, error);
    }

    return createPhotoError('UNKNOWN', String(error), error);
}

// ============================================
// Retry Utilities
// ============================================

export interface RetryOptions {
    maxAttempts: number;
    initialDelayMs: number;
    maxDelayMs: number;
    backoffMultiplier: number;
    shouldRetry?: (error: PhotoError, attempt: number) => boolean;
    onRetry?: (error: PhotoError, attempt: number) => void;
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
    maxAttempts: 3,
    initialDelayMs: 1000,
    maxDelayMs: 10000,
    backoffMultiplier: 2,
};

/**
 * Execute an async function with exponential backoff retry
 */
export async function withRetry<T>(
    fn: () => Promise<T>,
    options: Partial<RetryOptions> = {}
): Promise<T> {
    const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
    let lastError: PhotoError | null = null;
    let delay = opts.initialDelayMs;

    for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = classifyError(error);

            // Check if we should retry
            if (!lastError.retryable) {
                throw lastError;
            }

            if (opts.shouldRetry && !opts.shouldRetry(lastError, attempt)) {
                throw lastError;
            }

            // Don't retry on last attempt
            if (attempt >= opts.maxAttempts) {
                throw lastError;
            }

            // Call onRetry callback
            if (opts.onRetry) {
                opts.onRetry(lastError, attempt);
            }

            // Wait before retrying
            await sleep(delay);
            delay = Math.min(delay * opts.backoffMultiplier, opts.maxDelayMs);
        }
    }

    throw lastError || createPhotoError('UNKNOWN', 'Max retries exceeded');
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// Image Validation
// ============================================

/**
 * Validate that a data URL represents a valid image
 */
export async function validateImageDataUrl(dataUrl: string): Promise<{ valid: boolean; error?: string }> {
    // Check basic format
    if (!dataUrl || typeof dataUrl !== 'string') {
        return { valid: false, error: 'Data URL is empty or not a string' };
    }

    if (!dataUrl.startsWith('data:image/')) {
        return { valid: false, error: 'Not a valid image data URL' };
    }

    // Check minimum size (a valid JPEG should be at least ~100 bytes)
    const base64 = dataUrl.split(',')[1];
    if (!base64 || base64.length < 100) {
        return { valid: false, error: 'Image data is too small' };
    }

    // Try to load the image
    return new Promise((resolve) => {
        const img = new Image();
        let resolved = false;
        let timeoutId: ReturnType<typeof setTimeout>;

        const safeResolve = (result: { valid: boolean; error?: string }) => {
            if (!resolved) {
                resolved = true;
                clearTimeout(timeoutId);
                resolve(result);
            }
        };

        img.onload = () => {
            // Check minimum dimensions
            if (img.width < 10 || img.height < 10) {
                safeResolve({ valid: false, error: 'Image dimensions are too small' });
            } else {
                safeResolve({ valid: true });
            }
        };

        img.onerror = () => {
            safeResolve({ valid: false, error: 'Failed to decode image data' });
        };

        // Set a timeout for loading
        timeoutId = setTimeout(() => {
            safeResolve({ valid: false, error: 'Image load timeout' });
        }, 5000);

        img.src = dataUrl;
    });
}

/**
 * Check if image data appears corrupted
 */
export function detectCorruption(dataUrl: string): { corrupted: boolean; reason?: string } {
    if (!dataUrl) {
        return { corrupted: true, reason: 'Empty data URL' };
    }

    // Check for valid base64
    const base64Part = dataUrl.split(',')[1];
    if (!base64Part) {
        return { corrupted: true, reason: 'Missing base64 data' };
    }

    // Check for truncated data (base64 should be padded correctly)
    if (base64Part.length % 4 !== 0) {
        // This might indicate truncation
        return { corrupted: true, reason: 'Data appears truncated' };
    }

    // Check for common corruption patterns
    if (base64Part.includes('undefined') || base64Part.includes('null')) {
        return { corrupted: true, reason: 'Contains invalid data' };
    }

    return { corrupted: false };
}

// ============================================
// Recovery Utilities
// ============================================

export interface RecoveryResult {
    success: boolean;
    action: 'recovered' | 'fallback' | 'failed';
    message: string;
    data?: string;
}

/**
 * Attempt to recover a corrupted image
 * This is a best-effort operation
 */
export async function attemptImageRecovery(dataUrl: string): Promise<RecoveryResult> {
    // Check if already valid
    const validation = await validateImageDataUrl(dataUrl);
    if (validation.valid) {
        return {
            success: true,
            action: 'recovered',
            message: 'Image is valid',
            data: dataUrl,
        };
    }

    // Try to fix truncated base64
    const parts = dataUrl.split(',');
    if (parts.length === 2) {
        let base64 = parts[1];

        // Pad base64 if needed
        const padding = 4 - (base64.length % 4);
        if (padding < 4) {
            base64 += '='.repeat(padding);
            const fixedUrl = `${parts[0]},${base64}`;

            const retryValidation = await validateImageDataUrl(fixedUrl);
            if (retryValidation.valid) {
                return {
                    success: true,
                    action: 'recovered',
                    message: 'Fixed base64 padding',
                    data: fixedUrl,
                };
            }
        }
    }

    // Recovery failed
    return {
        success: false,
        action: 'failed',
        message: validation.error || 'Unable to recover image',
    };
}

// ============================================
// Error Logging
// ============================================

const ERROR_LOG_KEY = 'photo_error_log';
const MAX_ERROR_LOG_SIZE = 50;

export interface LoggedError extends PhotoError {
    id: string;
    operation?: string;
}

/**
 * Log a photo error for debugging
 */
export function logPhotoError(error: PhotoError, operation?: string): void {
    try {
        const logs = getErrorLog();
        const logEntry: LoggedError = {
            ...error,
            id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
            operation,
        };

        logs.unshift(logEntry);

        // Keep only recent errors
        if (logs.length > MAX_ERROR_LOG_SIZE) {
            logs.length = MAX_ERROR_LOG_SIZE;
        }

        localStorage.setItem(ERROR_LOG_KEY, JSON.stringify(logs));
    } catch {
        // Silently fail if localStorage is unavailable
        console.error('Failed to log photo error:', error);
    }
}

/**
 * Get the error log
 */
export function getErrorLog(): LoggedError[] {
    try {
        const stored = localStorage.getItem(ERROR_LOG_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch {
        return [];
    }
}

/**
 * Clear the error log
 */
export function clearErrorLog(): void {
    try {
        localStorage.removeItem(ERROR_LOG_KEY);
    } catch {
        // Ignore
    }
}
