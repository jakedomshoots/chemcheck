/**
 * Application-wide error codes for structured error handling.
 * Used for programmatic error identification and i18n.
 */
export enum ErrorCode {
    VALIDATION_FAILED = 'VALIDATION_FAILED',
    INVALID_INPUT = 'INVALID_INPUT',
    MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',

    NOT_FOUND = 'NOT_FOUND',
    ALREADY_EXISTS = 'ALREADY_EXISTS',

    UNAUTHORIZED = 'UNAUTHORIZED',
    FORBIDDEN = 'FORBIDDEN',
    SESSION_EXPIRED = 'SESSION_EXPIRED',

    RATE_LIMITED = 'RATE_LIMITED',

    SYNC_FAILED = 'SYNC_FAILED',
    CONFLICT = 'CONFLICT',
    MIGRATION_FAILED = 'MIGRATION_FAILED',

    NETWORK_ERROR = 'NETWORK_ERROR',
    STORAGE_ERROR = 'STORAGE_ERROR',
    DATABASE_ERROR = 'DATABASE_ERROR',

    INTERNAL_ERROR = 'INTERNAL_ERROR',
    UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

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

export class SyncError extends AppError {
    constructor(message: string, metadata?: Record<string, unknown>) {
        super(ErrorCode.SYNC_FAILED, message, metadata);
        this.name = 'SyncError';
    }
}

export class NetworkError extends AppError {
    constructor(message = 'Network request failed', metadata?: Record<string, unknown>) {
        super(ErrorCode.NETWORK_ERROR, message, metadata);
        this.name = 'NetworkError';
    }
}

export function notFoundError(resource: string, id?: string | number): NotFoundError {
    return new NotFoundError(resource, id);
}

export function validationError(errors: string[]): ValidationError {
    return new ValidationError(errors);
}

export function rateLimitError(retryAfter: number, action?: string): RateLimitError {
    return new RateLimitError(retryAfter, action);
}

export function syncError(message: string, metadata?: Record<string, unknown>): SyncError {
    return new SyncError(message, metadata);
}

export function networkError(message?: string): NetworkError {
    return new NetworkError(message);
}

export function isAppError(error: unknown): error is AppError {
    return error instanceof AppError;
}

export function hasErrorCode(error: unknown, code: ErrorCode): boolean {
    return isAppError(error) && error.code === code;
}

export function getUserMessage(error: unknown): string {
    if (isAppError(error)) {
        return error.message;
    }
    if (error instanceof Error) {
        return error.message;
    }
    return 'An unexpected error occurred';
}

export function wrapError(error: unknown, fallbackCode = ErrorCode.UNKNOWN_ERROR): AppError {
    if (isAppError(error)) {
        return error;
    }
    if (error instanceof Error) {
        return new AppError(fallbackCode, error.message, { originalError: error.name });
    }
    return new AppError(fallbackCode, String(error));
}

export type Result<T, E = AppError> =
    | { success: true; data: T }
    | { success: false; error: E };

export function ok<T>(data: T): Result<T, never> {
    return { success: true, data };
}

export function err<E>(error: E): Result<never, E> {
    return { success: false, error };
}
