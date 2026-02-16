import { describe, expect, it } from "vitest";
import { normalizeTaxRateInput } from "./taxRate";

describe("normalizeTaxRateInput", () => {
  it("accepts decimal input", () => {
    expect(normalizeTaxRateInput(0.0825)).toBeCloseTo(0.0825, 8);
  });

  it("accepts percent input", () => {
    expect(normalizeTaxRateInput(8.25)).toBeCloseTo(0.0825, 8);
  });

  it("clamps negative and invalid values", () => {
    expect(normalizeTaxRateInput(-5)).toBe(0);
    expect(normalizeTaxRateInput(Number.NaN)).toBe(0);
  });

  it("caps at 100%", () => {
    expect(normalizeTaxRateInput(125)).toBe(1);
  });
});
