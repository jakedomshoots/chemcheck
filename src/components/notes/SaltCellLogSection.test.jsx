import { describe, expect, it } from "vitest";
import { getSaltCellDueStatus } from "./SaltCellLogSection";

describe("salt cell maintenance due status", () => {
  it("does not invent a next-cleaning date when none was recorded", () => {
    expect(getSaltCellDueStatus(undefined, "2026-07-09")).toBeNull();
  });

  it("makes overdue and approaching maintenance visible", () => {
    expect(getSaltCellDueStatus("2026-07-08", "2026-07-09")?.label).toBe("1d overdue");
    expect(getSaltCellDueStatus("2026-07-09", "2026-07-09")?.label).toBe("Due today");
    expect(getSaltCellDueStatus("2026-07-16", "2026-07-09")?.label).toBe("Due in 7d");
  });
});
