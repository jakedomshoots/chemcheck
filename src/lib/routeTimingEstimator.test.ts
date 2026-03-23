import { describe, expect, it } from "vitest";
import {
  buildDurationProfile,
  calculateServiceTimingSummary,
  parseWorkingHoursCapacity,
  resolveServiceDurationMinutes,
} from "./routeTimingEstimator";

describe("routeTimingEstimator", () => {
  it("prefers explicit duration over history and fallback", () => {
    const result = resolveServiceDurationMinutes(
      { estimatedDuration: 22 },
      { customerMedian: 18, fallback: 15 }
    );
    expect(result).toBe(22);
  });

  it("uses customer historical median when explicit missing", () => {
    const result = resolveServiceDurationMinutes({}, { customerMedian: 17, fallback: 15 });
    expect(result).toBe(17);
  });

  it("uses fallback 15 when no explicit or history", () => {
    const result = resolveServiceDurationMinutes({}, { customerMedian: null, fallback: 15 });
    expect(result).toBe(15);
  });

  it("builds customer duration medians from valid history", () => {
    const profile = buildDurationProfile([
      { customer_id: 7, duration_ms: 12 * 60 * 1000 },
      { customer_id: 7, duration_ms: 18 * 60 * 1000 },
      { customer_id: 7, duration_ms: 99 }, // invalid (too short)
      { customer_id: 9, duration_ms: 20 * 60 * 1000 },
    ]);

    expect(profile.customerMedianById.get(7)).toBe(15);
    expect(profile.customerMedianById.get(9)).toBe(20);
  });

  it("calculates service-only totals and time per pool", () => {
    const summary = calculateServiceTimingSummary(
      [{ _id: 1, estimatedDuration: 20 }, { _id: 2, estimatedDuration: 10 }],
      { fallback: 15 }
    );

    expect(summary.stopsAssigned).toBe(2);
    expect(summary.totalServiceMinutes).toBe(30);
    expect(summary.timePerPoolMinutes).toBe(15);
  });

  it("returns null capacity for invalid working hours", () => {
    expect(parseWorkingHoursCapacity("17:00", "08:00", 15)).toBeNull();
    expect(parseWorkingHoursCapacity("08:00", "08:00", 15)).toBeNull();
  });

  it("calculates capacity from working-hours and time-per-pool", () => {
    expect(parseWorkingHoursCapacity("08:00", "17:00", 15)).toBe(36);
  });
});
