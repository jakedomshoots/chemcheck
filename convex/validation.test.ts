import { describe, expect, it } from "vitest";
import { validateLsiFields, validateLsiUpdate, validateServiceLogCreate } from "./validation";

describe("service log validation", () => {
  it("accepts critical chemical readings from the service log form", () => {
    const result = validateServiceLogCreate({
      customer_id: "customer-id",
      service_date: "2026-07-06",
      status: "completed",
      ph: "critical",
      chlorine: "critical",
      alkalinity: "good",
      stabilizer: "high",
    });

    expect(result.ph).toBe("critical");
    expect(result.chlorine).toBe("critical");
  });
});

describe("LSI service log validation", () => {
  it("accepts a complete strip scan with explicit assumptions", () => {
    expect(() => validateLsiFields({
      ph_value: 7.4,
      alkalinity_value: 120,
      stabilizer_value: 50,
      hardness_value: 250,
      hardness_source: "aquachek_total",
      water_temperature: 80,
      water_temperature_source: "assumed",
      tds_value: 3700,
      tds_source: "assumed",
      strip_scan_method: "aquachek_select_photo",
      strip_scan_confidence: "medium",
      strip_scan_analysis_version: "aquachek-select-v4",
      strip_scan_pad_confidence: {
        totalHardness: 0.8,
        totalChlorine: 0.7,
        freeChlorine: 0.8,
        ph: 0.9,
        totalAlkalinity: 0.9,
        cyanuricAcid: 0.8,
      },
      strip_scan_quality: {
        backgroundLightness: 0.9,
        backgroundNeutrality: 0.95,
        lightingUniformity: 0.92,
        framing: 0.9,
      },
      lsi_calculation_version: "aquachek-epa-v1",
    })).not.toThrow();
  });

  it("rejects provenance without its corresponding reading", () => {
    expect(() => validateLsiFields({ tds_source: "assumed" }, true))
      .toThrow("TDS source requires a TDS value");
  });

  it("rejects readings without their corresponding provenance source", () => {
    expect(() => validateLsiFields({
      hardness_value: 300,
      water_temperature: 84,
      tds_value: 1200,
    }, true)).toThrow(/requires a .*source/i);
  });

  it("rejects a strip scan method without its complete audit package", () => {
    expect(() => validateLsiFields({
      strip_scan_method: "aquachek_select_photo",
    }, true)).toThrow(/complete scan audit data/i);
  });

  it("rejects an out-of-range water temperature", () => {
    expect(() => validateLsiFields({ water_temperature: 180 }))
      .toThrow(/Water temperature/);
  });

  it("rejects out-of-range scan audit metrics", () => {
    expect(() => validateLsiFields({
      strip_scan_quality: {
        backgroundLightness: 0.9,
        backgroundNeutrality: 0.95,
        lightingUniformity: 1.4,
        framing: 0.9,
      },
    })).toThrow(/Lighting uniformity/);
  });

  it("rejects an incomplete v2 scan audit package", () => {
    expect(() => validateLsiFields({
      strip_scan_method: "aquachek_select_photo",
      strip_scan_analysis_version: "aquachek-select-v2",
      strip_scan_confidence: "medium",
    }, true)).toThrow(/complete scan audit data/);
  });

  it("validates partial updates against the complete stored scan record", () => {
    const storedScan = {
      strip_scan_method: "aquachek_select_photo" as const,
      strip_scan_confidence: "medium" as const,
      strip_scan_analysis_version: "aquachek-select-v3" as const,
      lsi_calculation_version: "aquachek-epa-v1" as const,
      strip_scan_pad_confidence: {
        totalHardness: 0.8,
        totalChlorine: 0.7,
        freeChlorine: 0.8,
        ph: 0.9,
        totalAlkalinity: 0.9,
        cyanuricAcid: 0.8,
      },
      strip_scan_quality: {
        backgroundLightness: 0.9,
        backgroundNeutrality: 0.95,
        lightingUniformity: 0.92,
        framing: 0.9,
      },
    };

    expect(() => validateLsiUpdate(storedScan, { strip_scan_confidence: "high" })).not.toThrow();
    expect(() => validateLsiUpdate({}, { strip_scan_analysis_version: "aquachek-select-v3" }))
      .toThrow(/complete scan audit data/);
  });
});
