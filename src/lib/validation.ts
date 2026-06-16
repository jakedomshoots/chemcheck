import { z } from 'zod';

/**
 * Sanitize HTML to prevent XSS attacks
 */
export function sanitizeHtml(input: string): string {
  return input
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Sanitize and trim string input
 */
export function sanitizeString(input: string): string {
  return sanitizeHtml(input.trim());
}

export const customerSchema = z.object({
  full_name: z.string()
    .min(1, 'Name is required')
    .max(100, 'Name must be less than 100 characters')
    .transform(sanitizeString),

  address: z.string()
    .min(1, 'Address is required')
    .max(500, 'Address must be less than 500 characters')
    .transform(sanitizeString),

  phone: z.string()
    .optional()
    .transform(val => val ? sanitizeString(val) : undefined)
    .refine((val: string | undefined) => !val || /^[\d\s\-\(\)\+\.]{10,20}$/.test(val), {
      message: 'Invalid phone number format'
    }),

  email: z.string()
    .optional()
    .transform(val => val ? sanitizeString(val) : undefined)
    .refine((val: string | undefined) => !val || z.string().email().safeParse(val).success, {
      message: 'Invalid email format'
    }),

  gate_code: z.string()
    .max(50, 'Gate code must be less than 50 characters')
    .optional()
    .transform(val => val ? sanitizeString(val) : undefined),

  service_day: z.enum(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']),

  pool_gallons: z.number()
    .min(0, 'Pool gallons must be positive')
    .max(1000000, 'Pool gallons seems unrealistic')
    .optional(),

  pool_type: z.enum(['Salt', 'Chlorine']),

  surface_type: z.enum(['Plaster', 'Vinyl', 'Fiberglass', 'Tile']),

  sort_order: z.number()
    .min(0, 'Sort order must be positive')
    .optional(),
});

export const serviceLogSchema = z.object({
  customer_id: z.number().min(1, 'Customer ID is required'),

  service_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Service date must be in YYYY-MM-DD format')
    .refine(date => {
      const parsed = new Date(date);
      return !isNaN(parsed.getTime()) && parsed <= new Date();
    }, 'Invalid or future service date'),

  status: z.enum(['completed', 'pending', 'cancelled', 'rescheduled']),

  notes: z.string()
    .optional()
    .transform(val => val ? sanitizeString(val) : undefined)
    .refine((val: string | undefined) => !val || val.length <= 2000, {
      message: 'Notes must be less than 2000 characters'
    }),

  ph: z.enum(['good', 'low', 'high']),
  chlorine: z.enum(['good', 'low', 'high']),
  alkalinity: z.enum(['good', 'low', 'high']),
  stabilizer: z.enum(['good', 'low', 'high']),

  ph_value: z.number()
    .min(0, 'pH value must be positive')
    .max(14, 'pH value must be at most 14')
    .optional(),
  chlorine_value: z.number()
    .min(0, 'Chlorine value must be positive')
    .max(100, 'Chlorine value seems unrealistic (max 100 ppm)')
    .optional(),
  alkalinity_value: z.number()
    .min(0, 'Alkalinity value must be positive')
    .max(1000, 'Alkalinity value seems unrealistic (max 1000 ppm)')
    .optional(),
  stabilizer_value: z.number()
    .min(0, 'Stabilizer value must be positive')
    .max(1000, 'Stabilizer value seems unrealistic (max 1000 ppm)')
    .optional(),

  salt: z.number()
    .min(0, 'Salt level must be positive')
    .max(10000, 'Salt level seems unrealistic (max 10,000 ppm)')
    .optional(),

  start_time: z.string().optional(),
  end_time: z.string().optional(),
  duration_ms: z.number().min(0).optional(),

  service_type: z.string().optional(),
});

export const chemicalUsageSchema = z.object({
  customer_id: z.number().min(1, 'Customer ID is required'),

  chemical_type: z.string()
    .min(1, 'Chemical type is required')
    .max(100, 'Chemical type must be less than 100 characters')
    .transform(sanitizeString),

  quantity: z.string()
    .min(1, 'Quantity is required')
    .max(50, 'Quantity must be less than 50 characters')
    .transform(sanitizeString),

  notes: z.string()
    .optional()
    .transform(val => val ? sanitizeString(val) : undefined)
    .refine((val: string | undefined) => !val || val.length <= 1000, {
      message: 'Notes must be less than 1000 characters'
    }),

  created_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
    .optional(),
});

export const noteSchema = z.object({
  title: z.string()
    .min(1, 'Title is required')
    .max(200, 'Title must be less than 200 characters')
    .transform(sanitizeString),

  content: z.string()
    .min(1, 'Content is required')
    .max(5000, 'Content must be less than 5000 characters')
    .transform(sanitizeString),

  category: z.enum(['General', 'Customer', 'Equipment', 'Reminder', 'Chemical', 'Billing']),

  customer_id: z.number()
    .min(1, 'Invalid customer ID')
    .optional(),

  priority: z.enum(['low', 'medium', 'high']),

  completed: z.boolean().optional(),

  created_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
    .optional(),
});

export type ValidationResult<T> = {
  success: true;
  data: T;
} | {
  success: false;
  errors: string[];
};

export function validateCustomer(data: unknown): ValidationResult<z.infer<typeof customerSchema>> {
  const result = customerSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    errors: result.error.errors.map(err => `${err.path.join('.')}: ${err.message}`)
  };
}

export function validateServiceLog(data: unknown): ValidationResult<z.infer<typeof serviceLogSchema>> {
  const result = serviceLogSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    errors: result.error.errors.map(err => `${err.path.join('.')}: ${err.message}`)
  };
}

export function validateChemicalUsage(data: unknown): ValidationResult<z.infer<typeof chemicalUsageSchema>> {
  const result = chemicalUsageSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    errors: result.error.errors.map(err => `${err.path.join('.')}: ${err.message}`)
  };
}

export function validateNote(data: unknown): ValidationResult<z.infer<typeof noteSchema>> {
  const result = noteSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    errors: result.error.errors.map(err => `${err.path.join('.')}: ${err.message}`)
  };
}

const RATE_LIMITS = {
  customers: { maxPerHour: 50, maxTotal: 1000 },
  serviceLogs: { maxPerHour: 200, maxTotal: 10000 },
  chemicalUsage: { maxPerHour: 100, maxTotal: 5000 },
  notes: { maxPerHour: 100, maxTotal: 2000 },
};

export function checkRateLimit(table: keyof typeof RATE_LIMITS): { allowed: boolean; reason?: string } {
  const limits = RATE_LIMITS[table];
  const now = Date.now();
  const hourAgo = now - (60 * 60 * 1000);

  const recentKey = `rateLimit_${table}_recent`;
  const totalKey = `rateLimit_${table}_total`;

  try {
    const recent = JSON.parse(localStorage.getItem(recentKey) || '[]') as number[];
    const total = parseInt(localStorage.getItem(totalKey) || '0');

    const recentFiltered = recent.filter(timestamp => timestamp > hourAgo);

    if (recentFiltered.length >= limits.maxPerHour) {
      return { allowed: false, reason: `Rate limit exceeded: max ${limits.maxPerHour} ${table} per hour` };
    }

    if (total >= limits.maxTotal) {
      return { allowed: false, reason: `Storage limit exceeded: max ${limits.maxTotal} ${table} total` };
    }

    recentFiltered.push(now);
    localStorage.setItem(recentKey, JSON.stringify(recentFiltered));
    localStorage.setItem(totalKey, (total + 1).toString());

    return { allowed: true };
  } catch (error) {
    console.error('Rate limit check failed:', error);
    return { allowed: true };
  }
}
