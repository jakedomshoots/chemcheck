/**
 * Free-text chemical quantity parser.
 *
 * Technicians log quantities as loose strings ("2 lbs", "12oz", "1/2 gal",
 * "3 tabs", "2 bags (40lb)"). This module turns those into a number plus a
 * canonical unit per chemical family so costs can be computed:
 *
 *   liquids -> gal      solids -> lb      tablets -> tabs
 *   bags    -> bags     count  -> each
 *
 * It is dependency-free and shared by the Convex backend and the web app.
 */

export type QuantityFamily = "liquid" | "solid" | "tabs" | "bags" | "each" | "unknown";

/** Canonical units, one per family. */
export type CanonicalUnit = "gal" | "lb" | "tabs" | "bags" | "each";

/** Units we accept on input. `oz` is weight unless the family is liquid. */
export type SourceUnit =
  | "fl_oz" | "gal" | "qt" | "pt" | "cup" | "l" | "ml"
  | "oz" | "lb" | "kg" | "g"
  | "tabs" | "bags" | "each";

export type AnyUnit = SourceUnit | CanonicalUnit;

export interface ParsedQuantity {
  /** The original text, untouched. */
  raw: string;
  /** Amount in the canonical unit for the family. */
  amount: number;
  unit: CanonicalUnit;
  family: Exclude<QuantityFamily, "unknown">;
  /** What the technician actually typed, before normalization. */
  source_amount: number;
  source_unit: SourceUnit;
  /** Package size when the text names one, e.g. "2 bags (40lb)" -> 40 lb. */
  package_size?: number;
  package_unit?: CanonicalUnit;
}

export interface ParseOptions {
  /** Chemical family hint. Resolves bare numbers and the `oz` ambiguity. */
  family?: QuantityFamily;
  /** Unit to assume when the text has none (overrides the family default). */
  defaultUnit?: SourceUnit;
}

export const UNIT_LABELS: Record<AnyUnit, string> = {
  fl_oz: "fl oz",
  gal: "gal",
  qt: "qt",
  pt: "pt",
  cup: "cup",
  l: "L",
  ml: "mL",
  oz: "oz",
  lb: "lb",
  kg: "kg",
  g: "g",
  tabs: "tabs",
  bags: "bags",
  each: "each",
};

export const CANONICAL_UNITS: CanonicalUnit[] = ["gal", "lb", "tabs", "bags", "each"];

const FAMILY_DEFAULT_UNIT: Record<Exclude<QuantityFamily, "unknown">, SourceUnit> = {
  liquid: "gal",
  solid: "lb",
  tabs: "tabs",
  bags: "bags",
  each: "each",
};

/** Gallons per unit of volume. */
const VOLUME_TO_GAL: Record<string, number> = {
  fl_oz: 1 / 128,
  gal: 1,
  qt: 1 / 4,
  pt: 1 / 8,
  cup: 1 / 16,
  l: 0.264172,
  ml: 0.000264172,
};

/** Pounds per unit of weight. */
const WEIGHT_TO_LB: Record<string, number> = {
  oz: 1 / 16,
  lb: 1,
  kg: 2.20462,
  g: 0.00220462,
};

/** Longest alias first so "fl oz" wins over "oz" and "lbs" over "lb". */
const UNIT_ALIASES: Array<[string, SourceUnit]> = [
  ["fluid ounces", "fl_oz"], ["fluid ounce", "fl_oz"], ["fl. oz.", "fl_oz"], ["fl. oz", "fl_oz"],
  ["fl.oz", "fl_oz"], ["fl oz", "fl_oz"], ["floz", "fl_oz"], ["fl", "fl_oz"],
  ["gallons", "gal"], ["gallon", "gal"], ["gals", "gal"], ["gal", "gal"], ["gl", "gal"],
  ["quarts", "qt"], ["quart", "qt"], ["qts", "qt"], ["qt", "qt"],
  ["pints", "pt"], ["pint", "pt"], ["pts", "pt"], ["pt", "pt"],
  ["cups", "cup"], ["cup", "cup"],
  ["liters", "l"], ["litres", "l"], ["liter", "l"], ["litre", "l"], ["ltr", "l"], ["l", "l"],
  ["milliliters", "ml"], ["millilitres", "ml"], ["ml", "ml"],
  ["ounces", "oz"], ["ounce", "oz"], ["ozs", "oz"], ["oz", "oz"],
  ["pounds", "lb"], ["pound", "lb"], ["lbs", "lb"], ["lb", "lb"],
  ["kilograms", "kg"], ["kilogram", "kg"], ["kgs", "kg"], ["kg", "kg"],
  ["grams", "g"], ["gram", "g"], ["g", "g"],
  ["tablets", "tabs"], ["tablet", "tabs"], ["tabs", "tabs"], ["tab", "tabs"],
  ["pucks", "tabs"], ["puck", "tabs"],
  ["bags", "bags"], ["bag", "bags"],
  ["pieces", "each"], ["piece", "each"], ["units", "each"], ["unit", "each"],
  ["each", "each"], ["ea", "each"], ["pcs", "each"], ["pc", "each"],
].sort((a, b) => b[0].length - a[0].length) as Array<[string, SourceUnit]>;

const NUMBER_WORDS: Record<string, number> = {
  half: 0.5, quarter: 0.25, a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10, dozen: 12,
};

const NUMBER_PATTERN = /^(\d+\s+\d+\s*\/\s*\d+|\d+\s*\/\s*\d+|\d*\.\d+|\d+)/;

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/** Parse "1 1/2", "1/2", "1.5", "2" or a number word. Returns [value, remaining]. */
function readNumber(text: string): [number, string] | null {
  const numeric = text.match(NUMBER_PATTERN);
  if (numeric) {
    const token = numeric[1];
    const rest = text.slice(numeric[0].length).trim();
    const mixed = token.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
    if (mixed) {
      const denominator = Number(mixed[3]);
      if (denominator === 0) return null;
      return [Number(mixed[1]) + Number(mixed[2]) / denominator, rest];
    }
    const fraction = token.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (fraction) {
      const denominator = Number(fraction[2]);
      if (denominator === 0) return null;
      return [Number(fraction[1]) / denominator, rest];
    }
    return [Number(token), rest];
  }
  const word = text.match(/^([a-z]+)\b/);
  if (word && word[1] in NUMBER_WORDS) {
    return [NUMBER_WORDS[word[1]], text.slice(word[0].length).trim()];
  }
  return null;
}

/** Match a unit alias at the start of `text`. Returns [unit, remaining]. */
function readUnit(text: string): [SourceUnit, string] | null {
  for (const [alias, unit] of UNIT_ALIASES) {
    if (!text.startsWith(alias)) continue;
    const after = text.slice(alias.length);
    // Require a word boundary so "gal" does not match "galvanized".
    if (after.length > 0 && /^[a-z]/.test(after)) continue;
    return [unit, after.replace(/^[.\s]+/, "").trim()];
  }
  return null;
}

export function isVolumeUnit(unit: AnyUnit): boolean {
  return unit in VOLUME_TO_GAL;
}

export function isWeightUnit(unit: AnyUnit): boolean {
  return unit in WEIGHT_TO_LB;
}

export function familyForUnit(unit: AnyUnit, hint?: QuantityFamily): Exclude<QuantityFamily, "unknown"> {
  if (unit === "oz") return hint === "liquid" ? "liquid" : "solid";
  if (isVolumeUnit(unit)) return "liquid";
  if (isWeightUnit(unit)) return "solid";
  if (unit === "tabs") return "tabs";
  if (unit === "bags") return "bags";
  return "each";
}

export function canonicalUnitForFamily(family: Exclude<QuantityFamily, "unknown">): CanonicalUnit {
  switch (family) {
    case "liquid": return "gal";
    case "solid": return "lb";
    case "tabs": return "tabs";
    case "bags": return "bags";
    default: return "each";
  }
}

/**
 * Convert between units of the same family. Returns null when the units
 * belong to different families (weight vs volume, bags vs tabs...).
 * `oz` is treated as fluid ounces when `hint` is "liquid".
 */
export function convertAmount(amount: number, from: AnyUnit, to: AnyUnit, hint?: QuantityFamily): number | null {
  if (!Number.isFinite(amount)) return null;
  const resolve = (unit: AnyUnit): AnyUnit => (unit === "oz" && hint === "liquid" ? "fl_oz" : unit);
  const source = resolve(from);
  const target = resolve(to);
  if (source === target) return round4(amount);
  if (isVolumeUnit(source) && isVolumeUnit(target)) {
    return round4((amount * VOLUME_TO_GAL[source]) / VOLUME_TO_GAL[target]);
  }
  if (isWeightUnit(source) && isWeightUnit(target)) {
    return round4((amount * WEIGHT_TO_LB[source]) / WEIGHT_TO_LB[target]);
  }
  return null;
}

/** Look for "(40lb)", "(40 lb)" or "40 lb bag" style package sizes in the trailing text. */
function readPackage(rest: string): { size: number; unit: CanonicalUnit } | null {
  const match =
    rest.match(/\(\s*(\d+(?:\.\d+)?)\s*([a-z.]+)\s*\)/) ||
    rest.match(/(\d+(?:\.\d+)?)\s*([a-z.]+)\s*bags?\b/);
  if (!match) return null;
  const unit = readUnit(match[2].replace(/\.$/, ""));
  if (!unit) return null;
  const family = familyForUnit(unit[0]);
  const canonical = canonicalUnitForFamily(family);
  const size = convertAmount(Number(match[1]), unit[0], canonical);
  if (size === null || size <= 0) return null;
  return { size, unit: canonical };
}

/**
 * Parse a free-text quantity. Returns null when nothing usable can be read;
 * the caller keeps the raw string in that case.
 */
export function parseQuantity(raw: string | null | undefined, options: ParseOptions = {}): ParsedQuantity | null {
  if (raw === null || raw === undefined) return null;
  const original = String(raw);
  let text = original
    .toLowerCase()
    .replace(/,/g, "")
    .replace(/#/g, " lb ")
    .replace(/[×*]/g, " x ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  // "approx 2 gal", "~2 gal", "about 2 gal"
  text = text.replace(/^(approx\.?|approximately|about|around|~)\s*/, "");

  const first = readNumber(text);
  if (!first) return null;
  let [amount, rest] = first;

  // Multiplier: "2 x 1 gal" / "2x1gal"
  let multiplied: number | null = null;
  const multiplier = rest.match(/^x\s*/);
  if (multiplier) {
    const second = readNumber(rest.slice(multiplier[0].length));
    if (second) {
      multiplied = second[0];
      amount *= second[0];
      rest = second[1];
    }
  }

  const unitMatch = readUnit(rest);
  let sourceUnit: SourceUnit | null = unitMatch ? unitMatch[0] : null;
  let remaining = unitMatch ? unitMatch[1] : rest;

  // "2 x 40 lb bags": a count of packages, each of the given size.
  if (multiplied !== null && sourceUnit && (isWeightUnit(sourceUnit) || isVolumeUnit(sourceUnit)) && /^bags?\b/.test(remaining)) {
    const packageFamily = familyForUnit(sourceUnit, options.family);
    const packageUnit = canonicalUnitForFamily(packageFamily);
    const packageSize = convertAmount(multiplied, sourceUnit, packageUnit, packageFamily);
    const count = amount / multiplied;
    const parsed: ParsedQuantity = {
      raw: original,
      amount: round4(count),
      unit: "bags",
      family: "bags",
      source_amount: round4(count),
      source_unit: "bags",
    };
    if (packageSize !== null && packageSize > 0) {
      parsed.package_size = packageSize;
      parsed.package_unit = packageUnit;
    }
    return parsed;
  }

  if (!sourceUnit) {
    // "2 x 40lb bags" style: the unit comes after a package size.
    const trailingBags = rest.match(/^(\d+(?:\.\d+)?)\s*(lb|lbs|oz|kg|gal|l)\s*bags?\b/);
    if (trailingBags) {
      sourceUnit = "bags";
      remaining = rest;
    } else if (options.defaultUnit) {
      sourceUnit = options.defaultUnit;
    } else if (options.family && options.family !== "unknown") {
      sourceUnit = FAMILY_DEFAULT_UNIT[options.family];
    } else {
      return null;
    }
  }

  if (!Number.isFinite(amount) || amount < 0) return null;

  const family = familyForUnit(sourceUnit, options.family);
  const unit = canonicalUnitForFamily(family);
  const normalized = convertAmount(amount, sourceUnit, unit, family);
  if (normalized === null) return null;

  const parsed: ParsedQuantity = {
    raw: original,
    amount: normalized,
    unit,
    family,
    source_amount: round4(amount),
    source_unit: sourceUnit,
  };

  const pkg = readPackage(remaining);
  if (pkg) {
    parsed.package_size = pkg.size;
    parsed.package_unit = pkg.unit;
  }
  return parsed;
}

/** "0.5 gal", "2 lb", "3 tabs" — compact display for tables and reports. */
export function formatAmount(amount: number, unit: AnyUnit): string {
  if (!Number.isFinite(amount)) return "";
  const rounded = Math.abs(amount) >= 100 ? Math.round(amount) : Math.round(amount * 100) / 100;
  return `${rounded} ${UNIT_LABELS[unit] ?? unit}`;
}

export function isCanonicalUnit(value: unknown): value is CanonicalUnit {
  return typeof value === "string" && (CANONICAL_UNITS as string[]).includes(value);
}

export function isSourceUnit(value: unknown): value is SourceUnit {
  return typeof value === "string" && UNIT_ALIASES.some(([, unit]) => unit === value);
}
