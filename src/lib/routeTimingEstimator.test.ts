import { describe, expect, it } from "vitest";
import {
  buildDriveTimeProfile,
  buildDurationProfile,
  calculateServiceTimingSummary,
  driveKey,
  estimateRouteFinishTime,
  parseWorkingHoursCapacity,
  resolveDriveMinutes,
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

  describe("observed drive time", () => {
    const segments = [
      { fromCustomerId: 1, toCustomerId: 2, durationMinutes: 10, distanceKm: 4 },
      { fromCustomerId: "1", toCustomerId: "2", durationMinutes: 14, distanceKm: null },
      { fromCustomerId: 1, toCustomerId: 2, durationMinutes: 12, distanceKm: 5 },
      { fromCustomerId: 2, toCustomerId: 1, durationMinutes: 30 },
      { fromCustomerId: 2, toCustomerId: 3, durationMinutes: 0 },
      { fromCustomerId: 3, toCustomerId: 4, durationMinutes: 9 * 60 },
    ];

    it("averages per directed pair and ignores implausible durations", () => {
      const profile = buildDriveTimeProfile(segments);
      expect(profile.get(driveKey(1, 2))).toEqual({ averageMinutes: 12, observations: 3, averageDistanceKm: 4.5 });
      expect(profile.get(driveKey(2, 1))).toEqual({ averageMinutes: 30, observations: 1, averageDistanceKm: null });
      expect(profile.has(driveKey(2, 3))).toBe(false);
      expect(profile.has(driveKey(3, 4))).toBe(false);
    });

    it("overrides the estimate only with at least three observations", () => {
      const profile = buildDriveTimeProfile(segments);
      expect(resolveDriveMinutes(1, 2, { estimate: 25, profile })).toEqual({ minutes: 12, source: "observed", observations: 3 });
      expect(resolveDriveMinutes(2, 1, { estimate: 25, profile })).toEqual({ minutes: 25, source: "estimate", observations: 0 });
      expect(resolveDriveMinutes(2, 1, { estimate: 25, profile, minObservations: 1 }).source).toBe("observed");
      expect(resolveDriveMinutes(7, 8, { profile })).toEqual({ minutes: 12, source: "fallback", observations: 0 });
      expect(resolveDriveMinutes(null, 8, { estimate: 6, profile })).toEqual({ minutes: 6, source: "estimate", observations: 0 });
      expect(resolveDriveMinutes(7, 8, { fallback: 9 })).toMatchObject({ minutes: 9, source: "fallback" });
    });

    it("estimates a finish time from service and drive legs", () => {
      const now = new Date("2026-06-08T15:00:00.000Z");
      const profile = buildDriveTimeProfile(segments);
      const estimate = estimateRouteFinishTime(
        [{ _id: 2, estimatedDuration: 20 }, { _id: 5 }],
        { now, driveProfile: profile, fromCustomerId: 1, driveFallback: 10, serviceFallback: 15 }
      );

      // service 20 + 15, drive 12 (observed 1->2) + 10 (fallback 2->5)
      expect(estimate).toMatchObject({
        pendingStops: 2,
        remainingServiceMinutes: 35,
        remainingDriveMinutes: 22,
        remainingMinutes: 57,
      });
      expect(estimate.finishAt?.toISOString()).toBe("2026-06-08T15:57:00.000Z");
    });

    it("returns no finish time when nothing is pending", () => {
      expect(estimateRouteFinishTime([])).toEqual({
        finishAt: null,
        remainingServiceMinutes: 0,
        remainingDriveMinutes: 0,
        remainingMinutes: 0,
        pendingStops: 0,
      });
      expect(estimateRouteFinishTime(null).finishAt).toBeNull();
    });
  });
});
