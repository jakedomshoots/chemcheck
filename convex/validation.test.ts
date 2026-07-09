import { describe, expect, it } from "vitest";
import { validateServiceLogCreate } from "./validation";

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
