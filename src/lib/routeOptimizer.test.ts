import { describe, expect, it, vi } from "vitest";

vi.mock("./monitoring", () => ({
  monitoring: {
    recordMetric: vi.fn(),
    reportError: vi.fn(),
  },
}));

import { RouteOptimizer, routeOptimizer } from "./routeOptimizer";
import type { ProviderLocation, RouteProvider, TravelEstimate } from "./routeProvider";

describe("routeOptimizer", () => {
  it("supports app customer shape and normalized day names", async () => {
    const customers = [
      {
        _id: 1,
        full_name: "Alpha Pool",
        address: "100 Main St, Los Angeles, CA 90001",
        service_day: "thur",
      },
      {
        _id: 2,
        full_name: "Bravo Pool",
        address: "200 Broadway, Los Angeles, CA 90012",
        service_day: "Thursday",
      },
    ];

    const route = await routeOptimizer.optimizeRoute(customers, "2026-02-12");

    expect(route.stops).toHaveLength(2);
    expect(route.stops.map((stop) => stop.customer.name).sort()).toEqual(["Alpha Pool", "Bravo Pool"]);
  });

  it("treats YYYY-MM-DD as a local calendar date for day matching", async () => {
    const customers = [
      {
        _id: 3,
        full_name: "Thursday Customer",
        address: "300 Ocean Ave, Santa Monica, CA 90401",
        service_day: "Thursday",
      },
    ];

    const route = await routeOptimizer.optimizeRoute(customers, "2026-02-12");
    expect(route.stops).toHaveLength(1);
  });

  it("is deterministic for identical input and includes service duration in total time", async () => {
    const customers = [
      {
        _id: 4,
        full_name: "North Stop",
        address: "111 Pine St, Los Angeles, CA 90013",
        service_day: "Friday",
        estimatedDuration: 45,
      },
      {
        _id: 5,
        full_name: "South Stop",
        address: "222 Sunset Blvd, Los Angeles, CA 90026",
        service_day: "Friday",
        estimatedDuration: 30,
      },
    ];

    const routeOne = await routeOptimizer.optimizeRoute(customers, "2026-02-13");
    const routeTwo = await routeOptimizer.optimizeRoute(customers, "2026-02-13");

    expect(routeOne.totalDistance).toBe(routeTwo.totalDistance);
    expect(routeOne.stops.map((stop) => stop.customer.id)).toEqual(routeTwo.stops.map((stop) => stop.customer.id));
    expect(routeOne.totalTime).toBeGreaterThanOrEqual(75);
  });

  it("uses a conservative default duration when none is provided", async () => {
    const customers = [
      {
        _id: 6,
        full_name: "Same Place A",
        address: "500 Shared St, Los Angeles, CA 90021",
        service_day: "Monday",
      },
      {
        _id: 7,
        full_name: "Same Place B",
        address: "500 Shared St, Los Angeles, CA 90021",
        service_day: "Monday",
      },
    ];

    const route = await routeOptimizer.optimizeRoute(customers, "2026-02-16");
    expect(route.stops).toHaveLength(2);
    expect(route.totalTime).toBe(30);
  });

  it("accepts duration_ms source fields and converts them to minutes", async () => {
    const customers = [
      {
        _id: 8,
        full_name: "Duration MS Customer",
        address: "700 Time Ave, Los Angeles, CA 90011",
        service_day: "Tuesday",
        duration_ms: 12 * 60 * 1000,
      },
    ];

    const route = await routeOptimizer.optimizeRoute(customers, "2026-02-17");
    expect(route.stops).toHaveLength(1);
    expect(route.totalTime).toBe(12);
  });

  it("keeps customers with non-numeric synced identifiers", async () => {
    const customers = [
      {
        _id: "convex-customer-abc",
        full_name: "Synced Pool",
        address: "800 Sync Way, Los Angeles, CA 90012",
        service_day: "Tuesday",
      },
    ];

    const route = await routeOptimizer.optimizeRoute(customers, "2026-02-17");

    expect(route.stops).toHaveLength(1);
    expect(route.stops[0]?.customer.id).toBe("convex-customer-abc");
    expect(route.stops[0]?.customer.name).toBe("Synced Pool");
  });

  it("does not fabricate coordinates, distances or drive times without a map provider", async () => {
    const customers = [
      { _id: 20, full_name: "Second Saved", address: "2 B St, Town, CA 90001", service_day: "Monday", sort_order: 2 },
      { _id: 21, full_name: "First Saved", address: "1 A St, Town, CA 90001", service_day: "Monday", sort_order: 1 },
      { _id: 22, full_name: "Unordered", address: "3 C St, Town, CA 90001", service_day: "Monday" },
    ];
    const route = await routeOptimizer.optimizeRoute(customers, "2026-02-16");
    expect(route.optimizationMethod).toBe("saved-order");
    expect(route.travelDataSource).toBe("none");
    expect(route.stops.map((stop) => stop.customer.name)).toEqual(["First Saved", "Second Saved", "Unordered"]);
    for (const stop of route.stops) {
      expect(stop.customer.location).toBeUndefined();
      expect(stop.travelTime).toBeNull();
      expect(stop.distance).toBeNull();
      expect(stop.arrivalTime).toBeNull();
    }
    expect(route.totalDistance).toBeNull();
    expect(route.totalTravelTime).toBeNull();
  });

  it("uses stored real coordinates for straight-line distances only (no drive time, saved order kept)", async () => {
    const customers = [
      { _id: 30, full_name: "Far", address: "far", service_day: "Monday", sort_order: 1, latitude: 34.3, longitude: -118.0 },
      { _id: 31, full_name: "Near", address: "near", service_day: "Monday", sort_order: 2, latitude: 34.01, longitude: -118.0 },
    ];
    const route = await routeOptimizer.optimizeRoute(customers, "2026-02-16", {
      startLocation: { latitude: 34.0, longitude: -118.0, address: "shop" },
    });
    expect(route.travelDataSource).toBe("straight-line");
    expect(route.optimizationMethod).toBe("saved-order");
    expect(route.stops.map((s) => s.customer.name)).toEqual(["Far", "Near"]);
    expect(route.stops[0].distance).toBeCloseTo(20.7, 0);
    expect(route.stops.every((s) => s.travelTime === null)).toBe(true);
    expect(route.stops[0].travelSource).toBe("straight-line");
  });

  it("orders by live road times when a map provider is configured", async () => {
    const coords: Record<string, [number, number]> = {
      "far st": [34.3, -118.0],
      "near st": [34.01, -118.0],
      "mid st": [34.1, -118.0],
    };
    const provider: RouteProvider = {
      name: "proxy",
      async geocode(address: string): Promise<ProviderLocation> {
        const c = coords[address.toLowerCase()];
        if (!c) throw new Error("not found");
        return { latitude: c[0], longitude: c[1], address, source: "remote" };
      },
      async estimateTravel(from: ProviderLocation, to: ProviderLocation): Promise<TravelEstimate> {
        const miles = Math.abs(to.latitude - from.latitude) * 69;
        return { distance: miles, duration: miles * 2, source: "remote", provider: "proxy" };
      },
    };
    const optimizer = new RouteOptimizer();
    optimizer.setRouteProvider(provider);
    const route = await optimizer.optimizeRoute([
      { _id: 40, full_name: "Far", address: "Far St", service_day: "Monday" },
      { _id: 41, full_name: "Near", address: "Near St", service_day: "Monday" },
      { _id: 42, full_name: "Mid", address: "Mid St", service_day: "Monday" },
    ], "2026-02-16", { startLocation: { latitude: 34.0, longitude: -118.0, address: "shop" } });
    expect(route.travelDataSource).toBe("road");
    expect(route.optimizationMethod).toBe("nearest-neighbor");
    expect(route.stops.map((s) => s.customer.name)).toEqual(["Near", "Mid", "Far"]);
    expect(route.stops[0].travelTime).toBeCloseTo(0.01 * 69 * 2, 5);
    expect(route.stops[0].arrivalTime).not.toBeNull();
  });

  it("keeps saved order and hides travel when a provider cannot locate an address", async () => {
    const provider: RouteProvider = {
      name: "proxy",
      async geocode(address: string): Promise<ProviderLocation> {
        if (address === "Unknown Rd") throw new Error("not found");
        return { latitude: 34.1, longitude: -118.1, address, source: "remote" };
      },
      async estimateTravel(): Promise<TravelEstimate> {
        return { distance: 1, duration: 2, source: "remote" };
      },
    };
    const optimizer = new RouteOptimizer();
    optimizer.setRouteProvider(provider);
    const route = await optimizer.optimizeRoute([
      { _id: 50, full_name: "A", address: "Known Rd", service_day: "Monday", sort_order: 1 },
      { _id: 51, full_name: "B", address: "Unknown Rd", service_day: "Monday", sort_order: 2 },
    ], "2026-02-16");
    expect(route.optimizationMethod).toBe("saved-order");
    expect(route.travelDataSource).toBe("none");
    expect(route.stops[1].customer.location).toBeUndefined();
    expect(route.warnings?.join(" ")).toMatch(/could not be located/i);
  });
});
