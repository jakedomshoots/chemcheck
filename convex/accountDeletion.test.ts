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

describe("account deletion privacy regressions", () => {
  it("runs a resumable tenant phase for every business owned by the account", () => {
    const contents = source("convex/account.ts");

    expect(contents).toContain('if (args.phase === "tenant")');
    expect(contents).toContain('const phases = ["customers", "tenant", "general", "rateLimits"]');

    const tenant = blockBetween(contents, "async function deleteTenantBatch", "async function fetchNextCustomer");
    expect(tenant).toContain('source: "business"');
    const customerStages = blockBetween(contents, "function nextCustomerStage", "async function processCustomerStage");
    for (const table of ["pools", "equipment", "workOrders", "invoices", "quotes", "communications"]) {
      expect(customerStages).toContain(`"${table}"`);
    }
  });

  it("deletes report dependents and storage files before deleting their metadata", () => {
    const contents = source("convex/account.ts");
    const tenant = blockBetween(contents, "async function processCustomerStage", "async function deleteGeneralBatch");

    expect(tenant).toContain('.query("serviceReports")');
    expect(tenant).toContain('.query("reportAccessLogs")');

    const storageDelete = tenant.indexOf("await ctx.storage.delete(photo.storage_id)");
    const photoDelete = tenant.indexOf("await ctx.db.delete(photo._id)");
    expect(storageDelete).toBeGreaterThanOrEqual(0);
    expect(photoDelete).toBeGreaterThan(storageDelete);
    expect(tenant.slice(storageDelete, photoDelete)).not.toContain("catch");
  });

  it("removes business subscriptions and memberships before deleting owned businesses", () => {
    const contents = source("convex/account.ts");
    const general = blockBetween(contents, "async function deleteGeneralBatch", "async function deleteRateLimitsBatch");

    expect(general).toContain('state.stage === "subscriptions"');
    expect(general).toContain('state.stage === "team_members_owned"');
    expect(general).toContain('.withIndex("by_business"');

    const subscriptionDelete = general.indexOf('state.stage === "subscriptions"');
    const membershipDelete = general.indexOf('state.stage === "team_members_owned"');
    const businessDelete = general.indexOf('state.stage === "businesses"');
    expect(subscriptionDelete).toBeLessThan(businessDelete);
    expect(membershipDelete).toBeLessThan(businessDelete);
  });
});
