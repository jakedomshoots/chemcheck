import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { cancelStripeBilling } from "./account";
import { shouldProbeStorage } from "./health";

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

describe("review hardening regressions", () => {
  it("team invites are pending until accepted and resolvers check ownership first", () => {
    const businesses = source("convex/businesses.ts");
    const invite = blockBetween(businesses, "export async function createPendingInvite", "export async function acceptPendingInvite");
    expect(invite).toContain("is_active: false");
    expect(invite).not.toContain("is_active: true");
    expect(businesses).toMatch(/export const acceptInvite = mutation/);
    expect(businesses).toMatch(/export const declineInvite = mutation/);
    expect(businesses).toMatch(/export const getPendingInvites = query/);

    const entitlements = source("convex/entitlements.ts");
    const resolver = blockBetween(entitlements, "export async function resolveBusinessForEmail", "export async function canAccessCustomerRecord");
    expect(resolver.indexOf("findOwnedBusiness")).toBeLessThan(resolver.indexOf("findActiveMembership"));
    for (const file of ["convex/workOrders.ts", "convex/skippedStops.ts", "convex/teamMembers.ts", "convex/subscriptions.ts"]) {
      expect(source(file)).toContain("resolveBusinessForEmail");
    }
    expect(blockBetween(businesses, "export const getCurrent = query", "});")).toContain("resolveBusinessForEmail");
  });

  it("outbound communications are rate limited, recipient-locked and HTML-escaped", () => {
    const communications = source("convex/communications.ts");
    const queue = blockBetween(communications, "export const queueServiceText", "export const updateStatus");
    expect(queue).toContain("enforceCommunicationRateLimit");
    expect(queue).toContain("assertRecipientMatchesCustomer");
    expect(queue).toContain("enforceMessageLength");
    expect(blockBetween(communications, "export const deliver = action", "export const deliverQueued")).toContain("consumeCommunicationQuota");
    expect(blockBetween(communications, "export const deliverQueued", "\n});")).toContain("consumeCommunicationQuota");
    const mailer = blockBetween(communications, "async function sendEmailViaMailersend", "async function deliverCommunication");
    expect(mailer).toContain("${escapeHtml(args.subject)}");
    expect(mailer).toContain("${escapeHtml(args.message)}");
    expect(mailer).not.toContain("${args.subject}");
    expect(mailer).not.toContain("${args.message}");

    const rateLimit = source("convex/rateLimit.ts");
    expect(rateLimit).toContain("'communications': { maxRequests: 30, windowMs: 3600000 }");
    expect(rateLimit).toContain("'communications.daily': { maxRequests: 200, windowMs: 86400000 }");

    const reports = source("convex/serviceReports.ts");
    const sendReport = blockBetween(reports, "export const sendReport = action", "export const getServiceLogWithCustomer");
    expect(sendReport).toContain("consumeCommunicationQuota");
    expect(sendReport).toContain('recipientMatchesCustomer("email", recipientEmailOverride, serviceLog.customer)');
    // Actions have no ctx.db; authorization goes through an internal query.
    expect(sendReport).toContain("internal.serviceReports.verifyServiceLogOwnershipInternal");
  });

  it("public report access takes no client-supplied IP/user agent and is keyed per token", () => {
    const reports = source("convex/serviceReports.ts");
    const args = blockBetween(reports, "export const getReportByToken = action({\n  args: {", "},");
    expect(args).toContain("token: v.string()");
    expect(args).not.toContain("ip_address");
    expect(args).not.toContain("user_agent");
    expect(reports).toContain("const REPORT_ACCESS_MAX_REQUESTS = 60;");
    expect(reports).toContain("const REPORT_ACCESS_WINDOW_MS = 60 * 60 * 1000;");
    const internalQuery = blockBetween(reports, "export const getReportByTokenInternal", "\n});");
    expect(internalQuery).toContain("applyReportSettings(fullReport)");
    expect(reports).not.toContain("Dominick Pool Solutions");
  });

  it("dangerous backfills are internal-only", () => {
    expect(source("convex/backfillCustomerBusinessId.ts")).toMatch(/export const run = internalMutation/);
    expect(source("convex/subscriptions.ts")).toMatch(/export const backfillBusinessId = internalMutation/);
    expect(source("convex/subscriptions.ts")).not.toMatch(/\bmutation\(/);
  });

  it("rate-limit cleanup uses the by_reset_time / by_expires_at indexes", () => {
    const cleanup = blockBetween(source("convex/rateLimit.ts"), "export const cleanupExpiredRateLimits", "export const getViolationHistory");
    expect(cleanup).toContain('.withIndex("by_reset_time"');
    expect(cleanup).toContain('.withIndex("by_expires_at"');
    expect(cleanup).not.toContain(".filter(");
  });

  it("subscription customer limit is bounded", () => {
    const checkLimit = blockBetween(source("convex/subscriptions.ts"), "export const checkLimit", "\n});");
    expect(checkLimit).not.toContain(".collect()");
    expect(checkLimit).toContain(".take(cap)");
  });

  it("entitlement gate is applied to work order, invoice and quote creation", () => {
    expect(blockBetween(source("convex/workOrders.ts"), "export const create = mutation", "export const update")).toContain("assertWriteAllowed");
    expect(blockBetween(source("convex/invoices.ts"), "export const createDraft = mutation", "export const backfillMissingNotesBatch")).toContain("assertWriteAllowed");
    expect(blockBetween(source("convex/quotes.ts"), "export const create = mutation", "export const updateStatus")).toContain("assertWriteAllowed");
  });

  it("GDPR export files are scheduled for deletion and export data is read via an internal query", () => {
    const account = source("convex/account.ts");
    expect(account).toContain("ctx.scheduler.runAfter(EXPORT_FILE_TTL_MS, internal.account.deleteExportFile, { storageId })");
    expect(account).toMatch(/export const deleteExportFile = internalMutation/);
    expect(blockBetween(account, "export const deleteExportFile", "\n});")).toContain("ctx.storage.delete(args.storageId)");
    expect(blockBetween(account, "export const exportUserData = action", "\n});")).toContain("internal.account.collectExportDataInternal");
    // Stripe teardown runs before the local deletion phases.
    const deletion = blockBetween(account, "export const deleteMyAccount = action", "\n});");
    expect(deletion.indexOf("cancelStripeBilling")).toBeLessThan(deletion.indexOf("const phases ="));
  });

  it("health probe is rate limited and only mints upload URLs with the probe token", () => {
    const health = source("convex/health.ts");
    const check = blockBetween(health, "export const check = action", "\n});");
    expect(check).toContain("internal.rateLimit.checkAndConsumeRateLimit");
    expect(check.indexOf("checkAndConsumeRateLimit")).toBeLessThan(check.indexOf("generateUploadUrl"));
    expect(check).toContain("process.env.HEALTH_PROBE_TOKEN");
    expect(shouldProbeStorage(undefined, undefined)).toBe(false);
    expect(shouldProbeStorage("abc", undefined)).toBe(false);
    expect(shouldProbeStorage(undefined, "abc")).toBe(false);
    expect(shouldProbeStorage("wrong", "abc")).toBe(false);
    expect(shouldProbeStorage("abc", "abc")).toBe(true);
  });
});

describe("cancelStripeBilling", () => {
  const rows = [
    { stripe_subscription_id: "sub_1", stripe_customer_id: "cus_1" },
    { stripe_subscription_id: "sub_2", stripe_customer_id: "cus_1" },
    { stripe_subscription_id: "sub_3", stripe_customer_id: "cus_2" },
  ];

  it("cancels every subscription then deletes each distinct customer", async () => {
    const calls: string[] = [];
    const result = await cancelStripeBilling(
      async () => rows,
      "owner@example.com",
      async (path) => { calls.push(path); },
      () => "sk_test_123"
    );
    expect(calls).toEqual(["/subscriptions/sub_1", "/subscriptions/sub_2", "/subscriptions/sub_3", "/customers/cus_1", "/customers/cus_2"]);
    expect(result).toEqual({
      attempted: true,
      canceledSubscriptions: ["sub_1", "sub_2", "sub_3"],
      deletedCustomers: ["cus_1", "cus_2"],
      failures: [],
    });
  });

  it("records failures without throwing and keeps going", async () => {
    const result = await cancelStripeBilling(
      async () => rows,
      "owner@example.com",
      async (path) => { if (path === "/subscriptions/sub_2") throw new Error("boom"); },
      () => "sk_test_123"
    );
    expect(result.canceledSubscriptions).toEqual(["sub_1", "sub_3"]);
    expect(result.deletedCustomers).toEqual(["cus_1", "cus_2"]);
    expect(result.failures).toEqual(["Subscription sub_2: boom"]);
  });

  it("reports when Stripe is not configured and skips when there are no rows", async () => {
    const unconfigured = await cancelStripeBilling(async () => rows, "o@e.com", async () => {}, () => { throw new Error("Stripe is not configured."); });
    expect(unconfigured.attempted).toBe(false);
    expect(unconfigured.failures).toEqual(["Stripe teardown skipped: Stripe is not configured."]);

    const none = await cancelStripeBilling(async () => [], "o@e.com", async () => { throw new Error("must not be called"); }, () => "sk_test_1");
    expect(none).toEqual({ attempted: false, canceledSubscriptions: [], deletedCustomers: [], failures: [] });
  });
});
