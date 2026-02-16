import { describe, expect, it, vi } from "vitest";

vi.mock("./monitoring", () => ({
  monitoring: {
    recordMetric: vi.fn(),
    reportError: vi.fn(),
  },
}));

import { routeOptimizer } from "./routeOptimizer";

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
});
