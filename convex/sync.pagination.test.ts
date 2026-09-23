import { describe, expect, it } from "vitest";
import { getNextSyncTable } from "./sync";

describe("getNextSyncTable", () => {
  it("starts with customers for a fresh cursor", () => {
    expect(getNextSyncTable({})).toBe("customers");
  });

  it("advances exactly one table after prior tables are exhausted", () => {
    expect(getNextSyncTable({ customers: null })).toBe("pools");
    expect(getNextSyncTable({ customers: null, pools: null })).toBe("equipment");
    expect(
      getNextSyncTable({
        customers: null,
        pools: null,
        equipment: null,
        serviceLogs: null,
      })
    ).toBe("chemicalUsage");
  });

  it("keeps paging the active table while it has a cursor", () => {
    expect(
      getNextSyncTable({
        customers: null,
        pools: "cursor-pools-2",
      })
    ).toBe("pools");
  });

  it("returns null only when every table is exhausted", () => {
    expect(
      getNextSyncTable({
        customers: null,
        pools: null,
        equipment: null,
        serviceLogs: null,
        chemicalUsage: null,
        notes: null,
        saltCellLogs: null,
      })
    ).toBeNull();
  });
});
