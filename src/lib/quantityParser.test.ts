import { describe, expect, it } from "vitest";
import { convertAmount, familyForUnit, formatAmount, isCanonicalUnit, parseQuantity } from "./quantityParser";

describe("parseQuantity", () => {
  it("parses weights into pounds", () => {
    expect(parseQuantity("2 lbs")).toMatchObject({ amount: 2, unit: "lb", family: "solid", source_amount: 2, source_unit: "lb", raw: "2 lbs" });
    expect(parseQuantity("12oz")).toMatchObject({ amount: 0.75, unit: "lb", source_unit: "oz" });
    expect(parseQuantity("1 kg")).toMatchObject({ amount: 2.2046, unit: "lb" });
    expect(parseQuantity("500 g")).toMatchObject({ amount: 1.1023, unit: "lb" });
    expect(parseQuantity("3#")).toMatchObject({ amount: 3, unit: "lb" });
  });

  it("parses volumes into gallons", () => {
    expect(parseQuantity("1.5 gal")).toMatchObject({ amount: 1.5, unit: "gal", family: "liquid" });
    expect(parseQuantity("1/2 gal")).toMatchObject({ amount: 0.5, unit: "gal" });
    expect(parseQuantity("1 1/2 gallons")).toMatchObject({ amount: 1.5, unit: "gal" });
    expect(parseQuantity("32 fl oz")).toMatchObject({ amount: 0.25, unit: "gal", source_unit: "fl_oz" });
    expect(parseQuantity("2 quarts")).toMatchObject({ amount: 0.5, unit: "gal" });
    expect(parseQuantity("1 pint")).toMatchObject({ amount: 0.125, unit: "gal" });
    expect(parseQuantity("1 L")).toMatchObject({ amount: 0.2642, unit: "gal" });
  });

  it("treats oz as fluid ounces for liquids and weight otherwise", () => {
    expect(parseQuantity("12 oz", { family: "liquid" })).toMatchObject({ amount: 0.0938, unit: "gal", family: "liquid" });
    expect(parseQuantity("12 oz", { family: "solid" })).toMatchObject({ amount: 0.75, unit: "lb", family: "solid" });
    expect(parseQuantity("12 oz")).toMatchObject({ unit: "lb" });
  });

  it("parses tablets and counts", () => {
    expect(parseQuantity("3 tabs")).toMatchObject({ amount: 3, unit: "tabs", family: "tabs" });
    expect(parseQuantity("1 tablet")).toMatchObject({ amount: 1, unit: "tabs" });
    expect(parseQuantity("2 pucks")).toMatchObject({ amount: 2, unit: "tabs" });
    expect(parseQuantity("4 each")).toMatchObject({ amount: 4, unit: "each", family: "each" });
  });

  it("parses bags with a package size", () => {
    const parsed = parseQuantity("2 bags (40lb)");
    expect(parsed).toMatchObject({ amount: 2, unit: "bags", family: "bags", package_size: 40, package_unit: "lb" });
    expect(parseQuantity("1 bag")).toMatchObject({ amount: 1, unit: "bags" });
    expect(parseQuantity("2 x 40 lb bags")).toMatchObject({ amount: 2, unit: "bags", package_size: 40 });
  });

  it("handles multipliers, number words and noise", () => {
    expect(parseQuantity("2 x 1 gal")).toMatchObject({ amount: 2, unit: "gal" });
    expect(parseQuantity("2x1gal")).toMatchObject({ amount: 2, unit: "gal" });
    expect(parseQuantity("half gal")).toMatchObject({ amount: 0.5, unit: "gal" });
    expect(parseQuantity("~2 gal")).toMatchObject({ amount: 2, unit: "gal" });
    expect(parseQuantity("About 1.5 Gallons of acid")).toMatchObject({ amount: 1.5, unit: "gal" });
    expect(parseQuantity("  2 LBS  ")).toMatchObject({ amount: 2, unit: "lb" });
    expect(parseQuantity("1,000 ml")).toMatchObject({ amount: 0.2642, unit: "gal" });
  });

  it("uses the family hint for bare numbers", () => {
    expect(parseQuantity("2", { family: "tabs" })).toMatchObject({ amount: 2, unit: "tabs" });
    expect(parseQuantity("2", { family: "liquid" })).toMatchObject({ amount: 2, unit: "gal" });
    expect(parseQuantity("2", { family: "solid" })).toMatchObject({ amount: 2, unit: "lb" });
    expect(parseQuantity("2", { defaultUnit: "fl_oz" })).toMatchObject({ amount: 0.0156, unit: "gal" });
  });

  it("returns null for unparseable input", () => {
    expect(parseQuantity("")).toBeNull();
    expect(parseQuantity("   ")).toBeNull();
    expect(parseQuantity(null)).toBeNull();
    expect(parseQuantity(undefined)).toBeNull();
    expect(parseQuantity("a bunch")).toBeNull();
    expect(parseQuantity("2")).toBeNull();
    expect(parseQuantity("2 galvanized")).toBeNull();
    expect(parseQuantity("1/0 gal")).toBeNull();
    expect(parseQuantity("-2 lb")).toBeNull();
  });

  it("keeps the raw string", () => {
    expect(parseQuantity("2 Lbs")?.raw).toBe("2 Lbs");
  });
});

describe("convertAmount", () => {
  it("converts within a family and refuses across families", () => {
    expect(convertAmount(128, "fl_oz", "gal")).toBe(1);
    expect(convertAmount(1, "gal", "fl_oz")).toBe(128);
    expect(convertAmount(16, "oz", "lb")).toBe(1);
    expect(convertAmount(1, "lb", "oz")).toBe(16);
    expect(convertAmount(1, "oz", "gal")).toBeNull();
    expect(convertAmount(1, "oz", "gal", "liquid")).toBe(0.0078);
    expect(convertAmount(1, "tabs", "lb")).toBeNull();
    expect(convertAmount(3, "tabs", "tabs")).toBe(3);
    expect(convertAmount(Number.NaN, "lb", "lb")).toBeNull();
  });
});

describe("helpers", () => {
  it("maps units to families", () => {
    expect(familyForUnit("gal")).toBe("liquid");
    expect(familyForUnit("kg")).toBe("solid");
    expect(familyForUnit("oz", "liquid")).toBe("liquid");
    expect(familyForUnit("bags")).toBe("bags");
    expect(familyForUnit("each")).toBe("each");
  });

  it("formats amounts compactly", () => {
    expect(formatAmount(0.5, "gal")).toBe("0.5 gal");
    expect(formatAmount(2.456, "lb")).toBe("2.46 lb");
    expect(formatAmount(120.4, "tabs")).toBe("120 tabs");
    expect(formatAmount(Number.NaN, "lb")).toBe("");
  });

  it("recognizes canonical units", () => {
    expect(isCanonicalUnit("gal")).toBe(true);
    expect(isCanonicalUnit("fl_oz")).toBe(false);
    expect(isCanonicalUnit(3)).toBe(false);
  });
});
