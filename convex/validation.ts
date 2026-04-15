/**
 * Server-side validation utilities for Convex mutations
 * 
 * SECURITY: These validations run server-side and cannot be bypassed.
 * Frontend validation (Zod) provides UX, this provides security.
 */

// ============================================
// String Sanitization
// ============================================

/**
 * Sanitize a string by trimming whitespace and limiting length
 * Prevents excessively long strings that could cause DoS
 */
export function sanitizeString(value: string, maxLength: number = 1000): string {
    if (typeof value !== 'string') {
        throw new Error('Expected string value');
    }
    return value.trim().slice(0, maxLength);
}

/**
 * Remove potentially dangerous characters from strings
 * Strips null bytes and other control characters that could cause issues
 */
export function stripDangerousChars(value: string): string {
    // Remove null bytes, control characters (except newlines/tabs which may be intentional)
    return value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * Comprehensive string sanitization for user input
 * Combines trimming, length limiting, and dangerous character removal
 */
export function sanitizeUserInput(value: string | undefined | null, maxLength: number = 1000): string {
    if (value === undefined || value === null) {
        return '';
    }
    if (typeof value !== 'string') {
        throw new Error('Expected string value');
    }
    return stripDangerousChars(sanitizeString(value, maxLength));
}

// ============================================
// Validation Functions
// ============================================

/**
 * Validate a required string field
 */
export function validateRequiredString(
    value: string | undefined | null,
    fieldName: string,
    minLength: number = 1,
    maxLength: number = 1000
): string {
    if (value === undefined || value === null) {
        throw new Error(`${fieldName} is required`);
    }

    const sanitized = sanitizeUserInput(value, maxLength);

    if (sanitized.length < minLength) {
        throw new Error(`${fieldName} must be at least ${minLength} characters`);
    }

    return sanitized;
}

/**
 * Validate an optional string field
 */
export function validateOptionalString(
    value: string | undefined | null,
    fieldName: string,
    maxLength: number = 1000
): string | undefined {
    if (value === undefined || value === null || value === '') {
        return undefined;
    }

    return sanitizeUserInput(value, maxLength);
}

/**
 * Validate phone number format
 * Accepts various formats, normalizes to digits with optional leading +
 */
export function validatePhone(value: string | undefined | null): string | undefined {
    if (value === undefined || value === null || value === '') {
        return undefined;
    }

    // Remove all non-digit characters except leading +
    const normalized = value.replace(/[^\d+]/g, '');

    // Basic validation: should have at least 7 digits
    const digitCount = normalized.replace(/\+/g, '').length;
    if (digitCount < 7) {
        throw new Error('Phone number must have at least 7 digits');
    }
    if (digitCount > 15) {
        throw new Error('Phone number must not exceed 15 digits');
    }

    return normalized;
}

/**
 * Validate email format
 */
const RESERVED_EMAIL_DOMAINS = new Set([
    'example.com',
    'example.net',
    'example.org',
    'test.com',
    'localhost',
    'localdomain',
]);

const RESERVED_EMAIL_TLDS = new Set([
    'example',
    'invalid',
    'localhost',
    'test',
]);

export function isDeliverableEmailForReports(email: string): boolean {
    const normalized = email.trim().toLowerCase();
    const parts = normalized.split('@');
    if (parts.length !== 2) return false;
    const domain = parts[1];
    if (!domain) return false;

    if (RESERVED_EMAIL_DOMAINS.has(domain)) {
        return false;
    }

    const tld = domain.split('.').pop();
    if (!tld) return false;

    return !RESERVED_EMAIL_TLDS.has(tld);
}

export function validateEmail(value: string | undefined | null): string | undefined {
    if (value === undefined || value === null || value === '') {
        return undefined;
    }

    const sanitized = sanitizeUserInput(value, 254); // RFC 5321 max email length

    // Basic email validation regex
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(sanitized)) {
        throw new Error('Invalid email format');
    }

    const normalizedEmail = sanitized.toLowerCase();
    if (!isDeliverableEmailForReports(normalizedEmail)) {
        throw new Error('Please use a real customer email address (placeholder domains like example.com are not allowed)');
    }

    return normalizedEmail;
}

/**
 * Validate a value is one of allowed options (enum validation)
 */
export function validateEnum<T extends string>(
    value: string | undefined | null,
    allowedValues: readonly T[],
    fieldName: string,
    required: boolean = true
): T | undefined {
    if (value === undefined || value === null || value === '') {
        if (required) {
            throw new Error(`${fieldName} is required`);
        }
        return undefined;
    }

    const sanitized = sanitizeUserInput(value, 50);

    if (!allowedValues.includes(sanitized as T)) {
        throw new Error(`${fieldName} must be one of: ${allowedValues.join(', ')}`);
    }

    return sanitized as T;
}

/**
 * Validate a positive number
 */
export function validatePositiveNumber(
    value: number | undefined | null,
    fieldName: string,
    required: boolean = false,
    min: number = 0,
    max: number = Number.MAX_SAFE_INTEGER
): number | undefined {
    if (value === undefined || value === null) {
        if (required) {
            throw new Error(`${fieldName} is required`);
        }
        return undefined;
    }

    if (typeof value !== 'number' || isNaN(value)) {
        throw new Error(`${fieldName} must be a valid number`);
    }

    if (value < min) {
        throw new Error(`${fieldName} must be at least ${min}`);
    }

    if (value > max) {
        throw new Error(`${fieldName} must not exceed ${max}`);
    }

    return value;
}

// ============================================
// Domain-Specific Validators
// ============================================

// Allowed values for enum fields
export const SERVICE_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
export const POOL_TYPES = ['Salt', 'Chlorine'] as const;
export const SURFACE_TYPES = ['Plaster', 'Vinyl', 'Fiberglass', 'Tile'] as const;
export const SERVICE_STATUSES = ['completed', 'pending', 'cancelled', 'rescheduled'] as const;
export const READING_LEVELS = ['good', 'low', 'high'] as const;
export const NOTE_CATEGORIES = ['General', 'Customer', 'Equipment', 'Reminder', 'Chemical', 'Billing'] as const;
export const PRIORITY_LEVELS = ['low', 'medium', 'high'] as const;

export type ServiceDay = typeof SERVICE_DAYS[number];
export type PoolType = typeof POOL_TYPES[number];
export type SurfaceType = typeof SURFACE_TYPES[number];
export type ServiceStatus = typeof SERVICE_STATUSES[number];
export type ReadingLevel = typeof READING_LEVELS[number];
export type NoteCategory = typeof NOTE_CATEGORIES[number];
export type PriorityLevel = typeof PRIORITY_LEVELS[number];

/**
 * Validate customer creation/update data
 */
export interface ValidatedCustomerData {
    full_name: string;
    address: string;
    phone?: string;
    email?: string;
    gate_code?: string;
    service_day: ServiceDay;
    pool_gallons?: number;
    pool_type: PoolType;
    surface_type: SurfaceType;
    sort_order?: number;
}

export function validateCustomerCreate(data: {
    full_name?: string;
    address?: string;
    phone?: string;
    email?: string;
    gate_code?: string;
    service_day?: string;
    pool_gallons?: number;
    pool_type?: string;
    surface_type?: string;
    sort_order?: number;
}): ValidatedCustomerData {
    return {
        full_name: validateRequiredString(data.full_name, 'Full name', 2, 200),
        address: validateRequiredString(data.address, 'Address', 5, 500),
        phone: validatePhone(data.phone),
        email: validateEmail(data.email),
        gate_code: validateOptionalString(data.gate_code, 'Gate code', 50),
        service_day: validateEnum(data.service_day, SERVICE_DAYS, 'Service day', true)!,
        pool_gallons: validatePositiveNumber(data.pool_gallons, 'Pool gallons', false, 100, 1000000),
        pool_type: validateEnum(data.pool_type, POOL_TYPES, 'Pool type', true)!,
        surface_type: validateEnum(data.surface_type, SURFACE_TYPES, 'Surface type', true)!,
        sort_order: validatePositiveNumber(data.sort_order, 'Sort order', false, 0, 10000),
    };
}

/**
 * Validate customer update data (all fields optional)
 */
export function validateCustomerUpdate(data: {
    full_name?: string;
    address?: string;
    phone?: string;
    email?: string;
    gate_code?: string;
    service_day?: string;
    pool_gallons?: number;
    pool_type?: string;
    surface_type?: string;
    sort_order?: number;
}): Partial<ValidatedCustomerData> {
    const result: Partial<ValidatedCustomerData> = {};

    if (data.full_name !== undefined) {
        result.full_name = validateRequiredString(data.full_name, 'Full name', 2, 200);
    }
    if (data.address !== undefined) {
        result.address = validateRequiredString(data.address, 'Address', 5, 500);
    }
    if (data.phone !== undefined) {
        result.phone = validatePhone(data.phone);
    }
    if (data.email !== undefined) {
        result.email = validateEmail(data.email);
    }
    if (data.gate_code !== undefined) {
        result.gate_code = validateOptionalString(data.gate_code, 'Gate code', 50);
    }
    if (data.service_day !== undefined) {
        result.service_day = validateEnum(data.service_day, SERVICE_DAYS, 'Service day', true);
    }
    if (data.pool_gallons !== undefined) {
        result.pool_gallons = validatePositiveNumber(data.pool_gallons, 'Pool gallons', false, 100, 1000000);
    }
    if (data.pool_type !== undefined) {
        result.pool_type = validateEnum(data.pool_type, POOL_TYPES, 'Pool type', true);
    }
    if (data.surface_type !== undefined) {
        result.surface_type = validateEnum(data.surface_type, SURFACE_TYPES, 'Surface type', true);
    }
    if (data.sort_order !== undefined) {
        result.sort_order = validatePositiveNumber(data.sort_order, 'Sort order', false, 0, 10000);
    }

    return result;
}

/**
 * Validate service log data
 */
export interface ValidatedServiceLogData {
    customer_id: any; // Convex ID type
    service_date: string;
    status: ServiceStatus;
    notes?: string;
    ph?: ReadingLevel;
    chlorine?: ReadingLevel;
    alkalinity?: ReadingLevel;
    stabilizer?: ReadingLevel;
    salt?: number;
    start_time?: string;
    end_time?: string;
    duration_ms?: number;
}

export function validateServiceLogCreate(data: {
    customer_id: any;
    service_date?: string;
    status?: string;
    notes?: string;
    ph?: string;
    chlorine?: string;
    alkalinity?: string;
    stabilizer?: string;
    salt?: number;
    start_time?: string;
    end_time?: string;
    duration_ms?: number;
}): ValidatedServiceLogData {
    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!data.service_date || !dateRegex.test(data.service_date)) {
        throw new Error('Service date must be in YYYY-MM-DD format');
    }

    return {
        customer_id: data.customer_id,
        service_date: data.service_date,
        status: validateEnum(data.status, SERVICE_STATUSES, 'Status', true)!,
        notes: validateOptionalString(data.notes, 'Notes', 5000),
        ph: validateEnum(data.ph, READING_LEVELS, 'pH', false),
        chlorine: validateEnum(data.chlorine, READING_LEVELS, 'Chlorine', false),
        alkalinity: validateEnum(data.alkalinity, READING_LEVELS, 'Alkalinity', false),
        stabilizer: validateEnum(data.stabilizer, READING_LEVELS, 'Stabilizer', false),
        salt: validatePositiveNumber(data.salt, 'Salt level', false, 0, 10000),
        start_time: validateOptionalString(data.start_time, 'Start time', 20),
        end_time: validateOptionalString(data.end_time, 'End time', 20),
        duration_ms: validatePositiveNumber(data.duration_ms, 'Duration', false, 0, 86400000), // Max 24 hours
    };
}

/**
 * Validate note data
 */
export interface ValidatedNoteData {
    customer_id?: any;
    title: string;
    content: string;
    category: NoteCategory;
    priority: PriorityLevel;
    completed?: boolean;
    created_date?: string;
}

export function validateNoteCreate(data: {
    customer_id?: any;
    title?: string;
    content?: string;
    category?: string;
    priority?: string;
    completed?: boolean;
    created_date?: string;
}): ValidatedNoteData {
    return {
        customer_id: data.customer_id,
        title: validateRequiredString(data.title, 'Title', 1, 200),
        content: validateRequiredString(data.content, 'Content', 1, 10000),
        category: validateEnum(data.category, NOTE_CATEGORIES, 'Category', true)!,
        priority: validateEnum(data.priority, PRIORITY_LEVELS, 'Priority', true)!,
        completed: data.completed ?? false,
        created_date: validateOptionalString(data.created_date, 'Created date', 20),
    };
}

/**
 * Validate chemical usage data
 */
export interface ValidatedChemicalUsageData {
    customer_id: any;
    chemical_type: string;
    quantity: string;
    notes?: string;
    created_date?: string;
}

export function validateChemicalUsageCreate(data: {
    customer_id: any;
    chemical_type?: string;
    quantity?: string;
    notes?: string;
    created_date?: string;
}): ValidatedChemicalUsageData {
    return {
        customer_id: data.customer_id,
        chemical_type: validateRequiredString(data.chemical_type, 'Chemical type', 1, 100),
        quantity: validateRequiredString(data.quantity, 'Quantity', 1, 50),
        notes: validateOptionalString(data.notes, 'Notes', 1000),
        created_date: validateOptionalString(data.created_date, 'Created date', 20),
    };
}
