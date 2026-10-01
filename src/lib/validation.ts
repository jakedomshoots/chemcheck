import { z } from 'zod';

const scanScoreSchema = z.number().min(0).max(1);
const stripScanPadConfidenceSchema = z.object({
  totalHardness: scanScoreSchema,
  totalChlorine: scanScoreSchema,
  freeChlorine: scanScoreSchema,
  ph: scanScoreSchema,
  totalAlkalinity: scanScoreSchema,
  cyanuricAcid: scanScoreSchema,
});
const stripScanQualitySchema = z.object({
  backgroundLightness: scanScoreSchema,
  backgroundNeutrality: scanScoreSchema,
  lightingUniformity: scanScoreSchema,
  framing: scanScoreSchema,
});

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
  pool_id: z.number().min(1, 'Invalid pool ID').optional(),

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

  ph: z.enum(['good', 'low', 'high', 'critical']),
  chlorine: z.enum(['good', 'low', 'high', 'critical']),
  alkalinity: z.enum(['good', 'low', 'high', 'critical']),
  stabilizer: z.enum(['good', 'low', 'high', 'critical']),

  ph_value: z.number()
    .min(0, 'pH value must be positive')
    .max(14, 'pH value must be at most 14')
    .optional(),
  chlorine_value: z.number()
    .min(0, 'Chlorine value must be positive')
    .max(50, 'Chlorine value seems unrealistic (max 50 ppm)')
    .optional(),
  total_chlorine_value: z.number().min(0).max(10).optional(),
  total_bromine_value: z.number().min(0).max(20).optional(),
  strip_scan_method: z.literal('aquachek_select_photo').optional(),
  strip_scan_confidence: z.enum(['low', 'medium', 'high']).optional(),
  strip_scan_analysis_version: z.enum(['aquachek-select-v2', 'aquachek-select-v3', 'aquachek-select-v4']).optional(),
  strip_scan_pad_confidence: stripScanPadConfidenceSchema.optional(),
  strip_scan_quality: stripScanQualitySchema.optional(),
  lsi_calculation_version: z.enum(['aquachek-epa-v1', 'lsi-v1']).optional(),
  alkalinity_value: z.number()
    .min(0, 'Alkalinity value must be positive')
    .max(1000, 'Alkalinity value seems unrealistic (max 1000 ppm)')
    .optional(),
  stabilizer_value: z.number()
    .min(0, 'Stabilizer value must be positive')
    .max(500, 'Stabilizer value seems unrealistic (max 500 ppm)')
    .optional(),

  hardness_value: z.number()
    .min(0, 'Hardness cannot be negative')
    .max(2000, 'Hardness seems unrealistic (max 2,000 ppm)')
    .optional(),
  hardness_source: z.enum(['aquachek_total', 'calcium']).optional(),
  water_temperature: z.number()
    .min(32, 'Water temperature must be at least 32°F')
    .max(120, 'Water temperature must be at most 120°F')
    .optional(),
  water_temperature_source: z.enum(['measured', 'assumed']).optional(),
  tds_value: z.number()
    .min(1, 'TDS must be greater than zero')
    .max(20000, 'TDS seems unrealistic (max 20,000 ppm)')
    .optional(),
  tds_source: z.enum(['measured', 'assumed']).optional(),

  salt: z.number()
    .min(0, 'Salt level must be positive')
    .max(20000, 'Salt level seems unrealistic (max 20,000 ppm)')
    .optional(),

  start_time: z.string().optional(),
  end_time: z.string().optional(),
  duration_ms: z.number().min(0).optional(),

  service_type: z.string().optional(),
}).superRefine((data, context) => {
  const hasStripScanData = [
    data.strip_scan_method,
    data.strip_scan_confidence,
    data.strip_scan_analysis_version,
    data.strip_scan_pad_confidence,
    data.strip_scan_quality,
  ].some((value) => value !== undefined);
  if (
    hasStripScanData
    && (!data.strip_scan_method || !data.strip_scan_confidence || !data.strip_scan_analysis_version || !data.strip_scan_pad_confidence || !data.strip_scan_quality || !data.lsi_calculation_version)
  ) {
    context.addIssue({
      code: 'custom',
      message: 'An AquaChek scan requires complete scan audit data',
      path: ['strip_scan_analysis_version'],
    });
  }
  if (
    data.lsi_calculation_version === 'lsi-v1'
    && !(
      Number.isFinite(data.ph_value)
      && Number.isFinite(data.alkalinity_value) && data.alkalinity_value! > 0
      && Number.isFinite(data.stabilizer_value)
      && Number.isFinite(data.hardness_value) && data.hardness_value! > 0
      && data.hardness_source === 'calcium'
      && Number.isFinite(data.water_temperature)
      && data.water_temperature_source === 'measured'
      && Number.isFinite(data.tds_value) && data.tds_value! > 0
      && data.tds_source === 'measured'
    )
  ) {
    context.addIssue({
      code: 'custom',
      message: 'lsi-v1 requires measured pH, alkalinity, CYA, calcium hardness, water temperature, and TDS',
      path: ['lsi_calculation_version'],
    });
  }
  if (data.hardness_value !== undefined && !data.hardness_source) {
    context.addIssue({
      code: 'custom',
      message: 'Hardness value requires a hardness source',
      path: ['hardness_source'],
    });
  }
  if (data.hardness_source && data.hardness_value === undefined) {
    context.addIssue({
      code: 'custom',
      message: 'Hardness source requires a hardness reading',
      path: ['hardness_value'],
    });
  }
  if (data.water_temperature !== undefined && !data.water_temperature_source) {
    context.addIssue({
      code: 'custom',
      message: 'Water temperature reading requires a source',
      path: ['water_temperature_source'],
    });
  }
  if (data.water_temperature_source && data.water_temperature === undefined) {
    context.addIssue({
      code: 'custom',
      message: 'Water temperature source requires a temperature reading',
      path: ['water_temperature_source'],
    });
  }
  if (data.tds_value !== undefined && !data.tds_source) {
    context.addIssue({
      code: 'custom',
      message: 'TDS reading requires a source',
      path: ['tds_source'],
    });
  }
  if (data.tds_source && data.tds_value === undefined) {
    context.addIssue({
      code: 'custom',
      message: 'TDS source requires a TDS reading',
      path: ['tds_source'],
    });
  }
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

/* -------------------------------------------------------------------------- */
/* Reading sanity checks                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Numeric readings a service log can carry. Values are plain numbers; strings
 * and blanks are treated as "not entered" by {@link checkReadingSanity}.
 */
export interface SanityReadings {
  ph_value?: number | null;
  chlorine_value?: number | null;
  alkalinity_value?: number | null;
  stabilizer_value?: number | null;
  hardness_value?: number | null;
  salt?: number | null;
  water_temperature?: number | null;
}

export type SanityReadingKey = keyof SanityReadings;

export interface ReadingLimit {
  min: number;
  max: number;
  label: string;
  unit: string;
}

/**
 * Hard limits: a reading outside these bounds cannot be a real measurement
 * (or the kit cannot produce it) and is rejected outright. Mirrored server
 * side in convex/lsiValidators.ts.
 */
export const READING_HARD_LIMITS: Record<SanityReadingKey, ReadingLimit> = {
  ph_value: { min: 0, max: 14, label: 'pH', unit: '' },
  chlorine_value: { min: 0, max: 50, label: 'Free chlorine', unit: 'ppm' },
  alkalinity_value: { min: 0, max: 1000, label: 'Total alkalinity', unit: 'ppm' },
  stabilizer_value: { min: 0, max: 500, label: 'Stabilizer (CYA)', unit: 'ppm' },
  hardness_value: { min: 0, max: 2000, label: 'Calcium hardness', unit: 'ppm' },
  salt: { min: 0, max: 20000, label: 'Salt', unit: 'ppm' },
  water_temperature: { min: 32, max: 120, label: 'Water temperature', unit: '°F' },
};

/**
 * Soft limits: the largest change versus the previous visit that does not
 * deserve a second look. Bigger jumps are usually a typo or a wrong kit.
 */
export const READING_JUMP_LIMITS: Partial<Record<SanityReadingKey, number>> = {
  ph_value: 1.0,
  chlorine_value: 8,
  alkalinity_value: 80,
  hardness_value: 200,
  salt: 1500,
};

export interface ReadingSanityIssue {
  field: SanityReadingKey;
  message: string;
}

export interface ReadingSanityResult {
  /** Hard-invalid readings. Saving must be blocked while this is non-empty. */
  errors: ReadingSanityIssue[];
  /** Double-check prompts. Saving may proceed once the technician confirms. */
  warnings: ReadingSanityIssue[];
  isValid: boolean;
}

const SANITY_KEYS: SanityReadingKey[] = [
  'ph_value', 'chlorine_value', 'alkalinity_value', 'stabilizer_value', 'hardness_value', 'salt', 'water_temperature',
];

function sanityNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function withUnit(value: number, limit: ReadingLimit): string {
  return limit.unit ? `${value} ${limit.unit}` : String(value);
}

/**
 * Checks this visit's readings for values that cannot be real (errors) and
 * values that deserve a second look before saving (warnings).
 *
 * @param readings  This visit's numeric readings.
 * @param previous  The most recent earlier visit for the same pool, if any.
 */
export function checkReadingSanity(
  readings: SanityReadings | Record<string, unknown>,
  previous?: SanityReadings | Record<string, unknown> | null,
): ReadingSanityResult {
  const errors: ReadingSanityIssue[] = [];
  const warnings: ReadingSanityIssue[] = [];
  const current = readings as Record<string, unknown>;
  const prior = (previous || {}) as Record<string, unknown>;

  for (const field of SANITY_KEYS) {
    const value = sanityNumber(current[field]);
    if (value === undefined) continue;
    const limit = READING_HARD_LIMITS[field];
    if (value < limit.min || value > limit.max) {
      errors.push({
        field,
        message: `${limit.label} ${withUnit(value, limit)} is outside the possible range (${withUnit(limit.min, limit)} to ${withUnit(limit.max, limit)}). Re-enter the reading.`,
      });
      continue;
    }

    const jump = READING_JUMP_LIMITS[field];
    const before = sanityNumber(prior[field]);
    if (jump !== undefined && before !== undefined) {
      const delta = Math.abs(value - before);
      if (delta > jump) {
        const direction = value > before ? 'up' : 'down';
        warnings.push({
          field,
          message: `${limit.label} moved ${direction} from ${withUnit(before, limit)} last visit to ${withUnit(value, limit)} (change of ${withUnit(Number(delta.toFixed(2)), limit)}). Double-check the reading before saving.`,
        });
      }
    }
  }

  const fc = sanityNumber(current.chlorine_value);
  const cya = sanityNumber(current.stabilizer_value);
  if (fc === 0 && cya !== undefined && cya > 100 && !errors.some((issue) => issue.field === 'stabilizer_value')) {
    warnings.push({
      field: 'chlorine_value',
      message: `Free chlorine 0 ppm with CYA ${cya} ppm is physically unlikely — high CYA usually bleaches the test. Confirm with a FAS-DPD test.`,
    });
  }

  return { errors, warnings, isValid: errors.length === 0 };
}
