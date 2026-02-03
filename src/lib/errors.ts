/**
 * Centralized Error Handling Module
 * 
 * Provides typed error classes and utilities for consistent
 * error handling across the application.
 */

// ============================================
// Error Codes
// ============================================

/**
 * Application-wide error codes for structured error handling.
 * Used for programmatic error identification and i18n.
 */
export enum ErrorCode {
    // Validation errors
    VALIDATION_FAILED = 'VALIDATION_FAILED',
    INVALID_INPUT = 'INVALID_INPUT',
    MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',

    // Resource errors
    NOT_FOUND = 'NOT_FOUND',
    ALREADY_EXISTS = 'ALREADY_EXISTS',

    // Auth errors
    UNAUTHORIZED = 'UNAUTHORIZED',
    FORBIDDEN = 'FORBIDDEN',
    SESSION_EXPIRED = 'SESSION_EXPIRED',

    // Rate limiting
    RATE_LIMITED = 'RATE_LIMITED',

    // Sync errors
    SYNC_FAILED = 'SYNC_FAILED',
    CONFLICT = 'CONFLICT',
    MIGRATION_FAILED = 'MIGRATION_FAILED',

    // Infrastructure errors
    NETWORK_ERROR = 'NETWORK_ERROR',
    STORAGE_ERROR = 'STORAGE_ERROR',
    DATABASE_ERROR = 'DATABASE_ERROR',

    // Generic
    INTERNAL_ERROR = 'INTERNAL_ERROR',
    UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

// ============================================
// Custom Error Classes
// ============================================

/**
 * Base application error with error code and metadata.
 * 
 * @example
 * throw new AppError(ErrorCode.NOT_FOUND, 'Customer not found', { customerId: 123 });
 */
export class AppError extends Error {
    readonly code: ErrorCode;
    readonly metadata?: Record<string, unknown>;
    readonly timestamp: number;
    readonly isOperational: boolean;

    constructor(
        code: ErrorCode,
        message: string,
        metadata?: Record<string, unknown>,
        isOperational = true
    ) {
        super(message);
        this.name = 'AppError';
        this.code = code;
        this.metadata = metadata;
        this.timestamp = Date.now();
        this.isOperational = isOperational;

        // Maintain proper stack trace in V8 engines
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, AppError);
        }
    }

    /**
     * Create a serializable representation of the error.
     */
    toJSON(): Record<string, unknown> {
        return {
            name: this.name,
            code: this.code,
            message: this.message,
            metadata: this.metadata,
            timestamp: this.timestamp,
        };
    }
}

/**
 * Validation error with field-level error details.
 */
export class ValidationError extends AppError {
    readonly errors: string[];

    constructor(errors: string[], metadata?: Record<string, unknown>) {
        super(
            ErrorCode.VALIDATION_FAILED,
            `Validation failed: ${errors.join(', ')}`,
            metadata
        );
        this.name = 'ValidationError';
        this.errors = errors;
    }
}

/**
 * Not found error for missing resources.
 */
export class NotFoundError extends AppError {
    constructor(resource: string, id?: string | number) {
        super(
            ErrorCode.NOT_FOUND,
            id ? `${resource} with id ${id} not found` : `${resource} not found`,
            { resource, id }
        );
        this.name = 'NotFoundError';
    }
}

/**
 * Rate limit error with retry information.
 */
export class RateLimitError extends AppError {
    readonly retryAfter: number;

    constructor(retryAfter: number, action?: string) {
        super(
            ErrorCode.RATE_LIMITED,
            `Rate limit exceeded${action ? ` for ${action}` : ''}. Retry after ${retryAfter} seconds.`,
            { retryAfter, action }
        );
        this.name = 'RateLimitError';
        this.retryAfter = retryAfter;
    }
}

/**
 * Sync error for data synchronization failures.
 */
export class SyncError extends AppError {
    constructor(message: string, metadata?: Record<string, unknown>) {
        super(ErrorCode.SYNC_FAILED, message, metadata);
        this.name = 'SyncError';
    }
}

/**
 * Network error for connectivity issues.
 */
export class NetworkError extends AppError {
    constructor(message = 'Network request failed', metadata?: Record<string, unknown>) {
        super(ErrorCode.NETWORK_ERROR, message, metadata);
        this.name = 'NetworkError';
    }
}

// ============================================
// Error Factory Functions
// ============================================

/**
 * Create a not found error for a resource.
 */
export function notFoundError(resource: string, id?: string | number): NotFoundError {
    return new NotFoundError(resource, id);
}

/**
 * Create a validation error from an array of error messages.
 */
export function validationError(errors: string[]): ValidationError {
    return new ValidationError(errors);
}

/**
 * Create a rate limit error with retry information.
 */
export function rateLimitError(retryAfter: number, action?: string): RateLimitError {
    return new RateLimitError(retryAfter, action);
}

/**
 * Create a sync error with optional metadata.
 */
export function syncError(message: string, metadata?: Record<string, unknown>): SyncError {
    return new SyncError(message, metadata);
}

/**
 * Create a network error.
 */
export function networkError(message?: string): NetworkError {
    return new NetworkError(message);
}

// ============================================
// Error Handling Utilities
// ============================================

/**
 * Type guard to check if an error is an AppError.
 */
export function isAppError(error: unknown): error is AppError {
    return error instanceof AppError;
}

/**
 * Type guard to check if an error has a specific error code.
 */
export function hasErrorCode(error: unknown, code: ErrorCode): boolean {
    return isAppError(error) && error.code === code;
}

/**
 * Extract a user-friendly message from any error.
 */
export function getUserMessage(error: unknown): string {
    if (isAppError(error)) {
        return error.message;
    }
    if (error instanceof Error) {
        return error.message;
    }
    return 'An unexpected error occurred';
}

/**
 * Wrap an unknown error in an AppError.
 */
export function wrapError(error: unknown, fallbackCode = ErrorCode.UNKNOWN_ERROR): AppError {
    if (isAppError(error)) {
        return error;
    }
    if (error instanceof Error) {
        return new AppError(fallbackCode, error.message, { originalError: error.name });
    }
    return new AppError(fallbackCode, String(error));
}

/**
 * Create error result type for functions that return Result<T, E>.
 */
export type Result<T, E = AppError> =
    | { success: true; data: T }
    | { success: false; error: E };

/**
 * Create a success result.
 */
export function ok<T>(data: T): Result<T, never> {
    return { success: true, data };
}

/**
 * Create an error result.
 */
export function err<E>(error: E): Result<never, E> {
    return { success: false, error };
}
