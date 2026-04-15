import { describe, expect, it } from "vitest";
import { normalizeTaxRate } from "./tax";

describe("normalizeTaxRate", () => {
  it("supports decimal and percent forms", () => {
    expect(normalizeTaxRate(0.0825)).toBeCloseTo(0.0825, 8);
    expect(normalizeTaxRate(8.25)).toBeCloseTo(0.0825, 8);
  });

  it("clamps range", () => {
    expect(normalizeTaxRate(-1)).toBe(0);
    expect(normalizeTaxRate(250)).toBe(1);
  });
});
