import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "..");
const tenantModules = [
  "customers.ts",
  "serviceLogs.ts",
  "chemicalUsage.ts",
  "notes.ts",
  "servicePhotos.ts",
  "workOrders.ts",
  "invoices.ts",
  "quotes.ts",
  "communications.ts",
  "serviceReports.ts",
  "sync.ts",
];

describe("tenant authorization adoption", () => {
  it("routes every customer-facing Convex domain through the shared authorization boundary", () => {
    for (const moduleName of tenantModules) {
      const source = readFileSync(resolve(root, "convex", moduleName), "utf8");

      expect(source, moduleName).toContain('from "./authorization"');
    }
  });

  it("does not allow tenant checks to drift back to raw customer creator comparisons", () => {
    for (const moduleName of tenantModules) {
      const source = readFileSync(resolve(root, "convex", moduleName), "utf8");

      expect(source, moduleName).not.toMatch(/customer\.created_by\s*(?:===|!==)/);
      expect(source, moduleName).not.toMatch(/\.created_by\s*(?:===|!==)\s*(?:identity\.email|args\.user_email)/);
    }
  });
});
