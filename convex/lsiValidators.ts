import { v } from "convex/values";

export const stripScanAnalysisVersionValidator = v.union(
  v.literal("aquachek-select-v2"),
  v.literal("aquachek-select-v3"),
  v.literal("aquachek-select-v4"),
);

export const stripScanPadConfidenceValidator = v.object({
  totalHardness: v.number(),
  totalChlorine: v.number(),
  freeChlorine: v.number(),
  ph: v.number(),
  totalAlkalinity: v.number(),
  cyanuricAcid: v.number(),
});

export const stripScanQualityValidator = v.object({
  backgroundLightness: v.number(),
  backgroundNeutrality: v.number(),
  lightingUniformity: v.number(),
  framing: v.number(),
});

/* -------------------------------------------------------------------------- */
/* Reading sanity limits (server-side mirror of src/lib/validation.ts)         */
/* -------------------------------------------------------------------------- */

export interface ReadingSanityLimit {
  min: number;
  max: number;
  label: string;
  unit: string;
}

/**
 * Hard limits for numeric readings. A value outside these bounds cannot be a
 * real measurement and is rejected by every write path (direct mutations and,
 * once wired, offline sync) so bad data never reaches the table.
 */
export const READING_SANITY_LIMITS = {
  ph_value: { min: 0, max: 14, label: "pH", unit: "" },
  chlorine_value: { min: 0, max: 50, label: "Free chlorine", unit: "ppm" },
  alkalinity_value: { min: 0, max: 1000, label: "Total alkalinity", unit: "ppm" },
  stabilizer_value: { min: 0, max: 500, label: "Stabilizer (CYA)", unit: "ppm" },
  hardness_value: { min: 0, max: 2000, label: "Calcium hardness", unit: "ppm" },
  salt: { min: 0, max: 20000, label: "Salt", unit: "ppm" },
  water_temperature: { min: 32, max: 120, label: "Water temperature", unit: "°F" },
} as const satisfies Record<string, ReadingSanityLimit>;

export type ReadingSanityField = keyof typeof READING_SANITY_LIMITS;

export type ReadingSanityInput = Partial<Record<ReadingSanityField, number | null | undefined>>;

function describe(value: number, limit: ReadingSanityLimit): string {
  return limit.unit ? `${value} ${limit.unit}` : String(value);
}

/**
 * Returns the list of hard-invalid reading messages for the given fields.
 * Fields that are absent, null or undefined are skipped so partial updates
 * only validate what they change.
 */
export function findInvalidReadings(data: ReadingSanityInput): string[] {
  const problems: string[] = [];
  for (const field of Object.keys(READING_SANITY_LIMITS) as ReadingSanityField[]) {
    const value = data[field];
    if (value === null || value === undefined) continue;
    const limit = READING_SANITY_LIMITS[field];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      problems.push(`${limit.label} must be a number`);
      continue;
    }
    if (value < limit.min || value > limit.max) {
      problems.push(
        `${limit.label} ${describe(value, limit)} is outside the possible range (${describe(limit.min, limit)} to ${describe(limit.max, limit)})`,
      );
    }
  }
  return problems;
}

/**
 * Throws when any provided reading is hard-invalid. Shared by
 * serviceLogs.create / serviceLogs.update and available to sync.ts.
 */
export function assertReadingSanity(data: ReadingSanityInput): void {
  const problems = findInvalidReadings(data);
  if (problems.length > 0) {
    throw new Error(`Invalid readings: ${problems.join("; ")}`);
  }
}
