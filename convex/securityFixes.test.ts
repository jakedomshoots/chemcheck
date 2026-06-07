import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "..");

function source(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

function blockBetween(contents: string, start: string, end: string): string {
  const startIndex = contents.indexOf(start);
  const endIndex = contents.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return contents.slice(startIndex, endIndex);
}

describe("security regression boundaries", () => {
  it("authorizes sendReport before internal report creation", () => {
    const contents = source("convex/serviceReports.ts");
    const sendReport = blockBetween(contents, "export const sendReport", "});\n\n/**\n * Internal query");

    const authIndex = sendReport.indexOf("ctx.auth.getUserIdentity");
    const ownershipIndex = sendReport.indexOf("verifyServiceLogOwnership");
    const internalLookupIndex = sendReport.indexOf("getServiceLogWithCustomer");
    const internalCreateIndex = sendReport.indexOf("getOrCreateReportInternal");

    expect(authIndex).toBeGreaterThanOrEqual(0);
    expect(ownershipIndex).toBeGreaterThan(authIndex);
    expect(ownershipIndex).toBeLessThan(internalLookupIndex);
    expect(ownershipIndex).toBeLessThan(internalCreateIndex);
  });

  it("keeps service-log migration helpers internal-only", () => {
    const contents = source("convex/migrations.ts");

    expect(contents).toMatch(/export const backfillServiceLogCreatedByBatch = internalMutation/);
    expect(contents).toMatch(/export const countServiceLogsWithCreatedBy = internalQuery/);
  });

  it("does not fail open unauthenticated photo upload when production env is missing", () => {
    const contents = source("convex/servicePhotos.ts");

    expect(contents).toContain('process.env.CHEMCHECK_ALLOW_UNAUTH_PHOTO_UPLOAD === "true"');
    expect(contents).not.toMatch(/CHEMCHECK_ALLOW_UNAUTH_PHOTO_UPLOAD[\s\S]+?\|\|[\s\S]+?runtimeEnv !== "production"/);
    expect(contents).toMatch(/CHEMCHECK_ALLOW_UNAUTH_PHOTO_UPLOAD[\s\S]+?&&[\s\S]+?runtimeEnv !== "production"/);
  });

  it("always consumes a server-side public report limiter key", () => {
    const contents = source("convex/serviceReports.ts");

    expect(contents).toContain("PUBLIC_REPORT_ACCESS_RATE_LIMIT_KEY");
    expect(contents).not.toContain("Without IP, we can't rate limit effectively");
    expect(contents).not.toMatch(/if\s*\(\s*args\.ip_address\s*\)\s*{\s*await ctx\.runMutation/);
  });

  it("requires authentication for rate-limit status telemetry", () => {
    const contents = source("convex/rateLimit.ts");
    const statusQuery = blockBetween(contents, "export const getRateLimitStatus", "});\n\n/**\n * Cleanup");
    const violationQuery = blockBetween(contents, "export const getViolationHistory", "});\n\n/**\n * Backward-compatible");

    expect(statusQuery).toContain("ctx.auth.getUserIdentity");
    expect(statusQuery).toContain("identity.email");
    expect(statusQuery).not.toContain("args.userId");
    expect(violationQuery).toContain("ctx.auth.getUserIdentity");
    expect(violationQuery).toContain("identity.email");
    expect(violationQuery).not.toContain("args.userId");
  });

  it("enforces write roles before tenant customer and work-order mutations", () => {
    const customers = source("convex/customers.ts");
    const workOrders = source("convex/workOrders.ts");

    expect(customers).toContain("assertBusinessRole");
    expect(blockBetween(customers, "export const update", "// Delete a customer")).toContain("assertBusinessRole");
    expect(blockBetween(customers, "export const remove", "});")).toContain("assertBusinessRole");
    expect(workOrders).toContain("assertBusinessRole");
    expect(blockBetween(workOrders, "export const update", "export const complete")).toContain("assertBusinessRole");
    expect(blockBetween(workOrders, "export const complete", "export const remove")).toContain("assertBusinessRole");
  });

  it("uses configured app origins instead of caller-provided link origins", () => {
    const payments = source("convex/payments.ts");
    const invoices = source("convex/invoices.ts");
    const reports = source("convex/serviceReports.ts");

    expect(payments).not.toContain("if (trimmedArg) return trimmedArg");
    expect(invoices).not.toContain("const trimmedBase = (args.base_url || \"\").trim()");
    expect(reports).not.toContain("return normalizedClientBase || normalizedEnvBase || null");
  });
});
