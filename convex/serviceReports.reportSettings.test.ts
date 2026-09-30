import { describe, expect, it } from "vitest";
import {
  DEFAULT_BUSINESS_NAME,
  DEFAULT_REPORT_SETTINGS,
  applyReportSettings,
  resolveReportSettings,
  type PublicReport,
} from "./serviceReports";

function fullReport(settings: Partial<PublicReport["settings"]> = {}): PublicReport {
  return {
    businessName: "Pool Co",
    serviceDate: "2026-01-05",
    technicianName: "Pool Co",
    customerName: "Jane Doe",
    chemicalReadings: { ph: "good", chlorine: "low", alkalinity: "good", stabilizer: "high", salt: 3200 },
    notes: "Backwashed the filter.",
    overallStatus: "needs_attention",
    photos: {
      before: [{ id: "p1", category: "before", timestamp: "2026-01-05T10:00:00Z", url: "https://x/1" }],
      after: [{ id: "p2", category: "after", timestamp: "2026-01-05T10:30:00Z", url: "https://x/2" }],
    },
    serviceDuration: 1800000,
    startTime: "2026-01-05T10:00:00Z",
    endTime: "2026-01-05T10:30:00Z",
    settings: { ...DEFAULT_REPORT_SETTINGS, ...settings },
  };
}

const SHAPE_KEYS = [
  "businessName", "serviceDate", "technicianName", "customerName", "chemicalReadings", "notes",
  "overallStatus", "photos", "serviceDuration", "startTime", "endTime", "settings",
].sort();

describe("report_settings enforcement", () => {
  it("shows everything by default and keeps the response shape", () => {
    const result = applyReportSettings(fullReport());
    expect(result).toEqual(fullReport());
    expect(Object.keys(result).sort()).toEqual(SHAPE_KEYS);
  });

  it("defaults missing settings to visible", () => {
    expect(resolveReportSettings(undefined)).toEqual(DEFAULT_REPORT_SETTINGS);
    expect(resolveReportSettings({ show_photos: false })).toEqual({ ...DEFAULT_REPORT_SETTINGS, show_photos: false });
  });

  it("omits chemical readings when show_chemical_readings is false", () => {
    const result = applyReportSettings(fullReport({ show_chemical_readings: false }));
    expect(result.chemicalReadings).toBeNull();
    expect(result.notes).toBe("Backwashed the filter.");
  });

  it("omits photos when show_photos is false but keeps the photos object", () => {
    const result = applyReportSettings(fullReport({ show_photos: false }));
    expect(result.photos).toEqual({ before: [], after: [] });
  });

  it("omits notes when show_service_notes is false", () => {
    expect(applyReportSettings(fullReport({ show_service_notes: false })).notes).toBeNull();
  });

  it("omits the technician name when show_technician_name is false", () => {
    expect(applyReportSettings(fullReport({ show_technician_name: false })).technicianName).toBe("");
  });

  it("omits duration and times when show_service_duration is false", () => {
    const result = applyReportSettings(fullReport({ show_service_duration: false }));
    expect(result.serviceDuration).toBeNull();
    expect(result.startTime).toBeNull();
    expect(result.endTime).toBeNull();
  });

  it("omits the overall status when show_overall_status is false", () => {
    expect(applyReportSettings(fullReport({ show_overall_status: false })).overallStatus).toBeNull();
  });

  it("uses a neutral business-name fallback", () => {
    expect(DEFAULT_BUSINESS_NAME).toBe("Your pool service provider");
  });
});
