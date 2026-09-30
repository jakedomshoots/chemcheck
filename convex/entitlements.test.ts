import { describe, expect, it } from "vitest";
import {
  assertWriteAllowed,
  canAccessCustomerRecord,
  evaluateWriteEntitlement,
  normalizeEmail,
  resolveBusinessForEmail,
} from "./entitlements";
import { FakeDb, makeCtx, seedBusiness, seedCustomer, seedMember } from "./fakeConvexDb.testing";

const NOW = 1_800_000_000_000;

describe("evaluateWriteEntitlement", () => {
  it("allows when there is no subscription row", () => {
    expect(evaluateWriteEntitlement(null, NOW)).toEqual({ allowed: true });
    expect(evaluateWriteEntitlement(undefined, NOW)).toEqual({ allowed: true });
  });

  it("allows active, trialing and past_due subscriptions", () => {
    for (const status of ["active", "trialing", "past_due", "incomplete"]) {
      expect(evaluateWriteEntitlement({ status, current_period_end: NOW - 1 }, NOW).allowed).toBe(true);
    }
  });

  it("blocks unpaid and incomplete_expired subscriptions", () => {
    expect(evaluateWriteEntitlement({ status: "unpaid", current_period_end: NOW + 1 }, NOW).allowed).toBe(false);
    expect(evaluateWriteEntitlement({ status: "incomplete_expired", current_period_end: NOW + 1 }, NOW).allowed).toBe(false);
  });

  it("fails closed for an unrecognized subscription status", () => {
    expect(evaluateWriteEntitlement({ status: "paused", current_period_end: NOW + 1 }, NOW)).toEqual({
      allowed: false,
      reason: "subscription status is unrecognized",
    });
  });

  it("blocks canceled subscriptions only after the paid period has ended", () => {
    expect(evaluateWriteEntitlement({ status: "canceled", current_period_end: NOW + 1000 }, NOW).allowed).toBe(true);
    expect(evaluateWriteEntitlement({ status: "canceled", current_period_end: NOW - 1 }, NOW).allowed).toBe(false);
  });
});

describe("resolveBusinessForEmail (ownership first)", () => {
  it("returns the owned business even when a foreign active membership exists", async () => {
    const db = new FakeDb();
    const ctx = makeCtx(db);
    const attackerBiz = await seedBusiness(db, "attacker@example.com", "Attacker Co");
    const victimBiz = await seedBusiness(db, "victim@example.com", "Victim Co");
    // Simulate a hijack attempt: active membership row inserted first.
    await seedMember(db, attackerBiz, "victim@example.com");

    const resolved = await resolveBusinessForEmail(ctx, "victim@example.com");
    expect(resolved?._id).toBe(victimBiz);
  });

  it("returns the member business for a non-owner with an accepted membership", async () => {
    const db = new FakeDb();
    const ctx = makeCtx(db);
    const biz = await seedBusiness(db, "owner@example.com");
    await seedMember(db, biz, "tech@example.com");
    const resolved = await resolveBusinessForEmail(ctx, "tech@example.com");
    expect(resolved?._id).toBe(biz);
  });

  it("ignores pending (unaccepted) invites", async () => {
    const db = new FakeDb();
    const ctx = makeCtx(db);
    const biz = await seedBusiness(db, "owner@example.com");
    await seedMember(db, biz, "tech@example.com", { is_active: false, joined_at: undefined });
    expect(await resolveBusinessForEmail(ctx, "tech@example.com")).toBeNull();
  });

  it("matches owner email case-insensitively via normalization", async () => {
    const db = new FakeDb();
    const ctx = makeCtx(db);
    const biz = await seedBusiness(db, "owner@example.com");
    const resolved = await resolveBusinessForEmail(ctx, "  Owner@Example.com ");
    expect(resolved?._id).toBe(biz);
    expect(normalizeEmail("  Owner@Example.com ")).toBe("owner@example.com");
  });
});

describe("assertWriteAllowed", () => {
  it("allows when the business has no subscription row", async () => {
    const db = new FakeDb();
    const ctx = makeCtx(db);
    await seedBusiness(db, "owner@example.com");
    await expect(assertWriteAllowed(ctx as any, "owner@example.com")).resolves.toBeUndefined();
  });

  it("allows a user without any business", async () => {
    const ctx = makeCtx(new FakeDb());
    await expect(assertWriteAllowed(ctx as any, "solo@example.com")).resolves.toBeUndefined();
  });

  it("throws 'Subscription inactive' for an unpaid business subscription", async () => {
    const db = new FakeDb();
    const ctx = makeCtx(db);
    const biz = await seedBusiness(db, "owner@example.com");
    await db.insert("subscriptions", {
      business_id: biz,
      user_email: "owner@example.com",
      stripe_customer_id: "cus_1",
      stripe_subscription_id: "sub_1",
      plan_id: "starter",
      status: "unpaid",
      current_period_start: 0,
      current_period_end: 0,
      cancel_at_period_end: false,
      created_at: 0,
      updated_at: 0,
    });
    await expect(assertWriteAllowed(ctx as any, "owner@example.com")).rejects.toThrow(/^Subscription inactive:/);
    // Team members of that business are blocked too.
    await seedMember(db, biz, "tech@example.com");
    await expect(assertWriteAllowed(ctx as any, "tech@example.com")).rejects.toThrow(/^Subscription inactive:/);
  });

  it("falls back to legacy by_user_email subscription rows", async () => {
    const db = new FakeDb();
    const ctx = makeCtx(db);
    await seedBusiness(db, "owner@example.com");
    await db.insert("subscriptions", {
      user_email: "owner@example.com",
      stripe_customer_id: "cus_1",
      stripe_subscription_id: "sub_1",
      plan_id: "starter",
      status: "incomplete_expired",
      current_period_start: 0,
      current_period_end: 0,
      cancel_at_period_end: false,
      created_at: 0,
      updated_at: 0,
    });
    await expect(assertWriteAllowed(ctx as any, "owner@example.com")).rejects.toThrow(/Subscription inactive/);
  });

  it("allows an active subscription", async () => {
    const db = new FakeDb();
    const ctx = makeCtx(db);
    const biz = await seedBusiness(db, "owner@example.com");
    await db.insert("subscriptions", {
      business_id: biz,
      user_email: "owner@example.com",
      stripe_customer_id: "cus_1",
      stripe_subscription_id: "sub_1",
      plan_id: "starter",
      status: "active",
      current_period_start: 0,
      current_period_end: Date.now() + 100000,
      cancel_at_period_end: false,
      created_at: 0,
      updated_at: 0,
    });
    await expect(assertWriteAllowed(ctx as any, "owner@example.com")).resolves.toBeUndefined();
  });
});

describe("canAccessCustomerRecord (same business only)", () => {
  it("allows the creator", async () => {
    const db = new FakeDb();
    const ctx = makeCtx(db);
    const customerId = await seedCustomer(db, "solo@example.com");
    const customer = await db.get(customerId);
    expect(await canAccessCustomerRecord(ctx, customer as any, "solo@example.com")).toBe(true);
  });

  it("allows an active technician for a customer owned by the business owner", async () => {
    const db = new FakeDb();
    const ctx = makeCtx(db);
    const biz = await seedBusiness(db, "owner@example.com");
    await seedMember(db, biz, "tech@example.com");
    const customerId = await seedCustomer(db, "owner@example.com");
    const customer = await db.get(customerId);
    expect(await canAccessCustomerRecord(ctx, customer as any, "tech@example.com")).toBe(true);
  });

  it("allows by business_id match and for customers created by another active member", async () => {
    const db = new FakeDb();
    const ctx = makeCtx(db);
    const biz = await seedBusiness(db, "owner@example.com");
    await seedMember(db, biz, "tech@example.com");
    await seedMember(db, biz, "tech2@example.com");
    const byBusiness = await db.get(await seedCustomer(db, "someone@else.com", { business_id: biz }));
    const byMember = await db.get(await seedCustomer(db, "tech2@example.com"));
    expect(await canAccessCustomerRecord(ctx, byBusiness as any, "tech@example.com")).toBe(true);
    expect(await canAccessCustomerRecord(ctx, byMember as any, "owner@example.com")).toBe(true);
  });

  it("denies other tenants and pending invitees", async () => {
    const db = new FakeDb();
    const ctx = makeCtx(db);
    const biz = await seedBusiness(db, "owner@example.com");
    await seedBusiness(db, "other@example.com");
    await seedMember(db, biz, "pending@example.com", { is_active: false, joined_at: undefined });
    const customer = await db.get(await seedCustomer(db, "owner@example.com", { business_id: biz }));
    expect(await canAccessCustomerRecord(ctx, customer as any, "other@example.com")).toBe(false);
    expect(await canAccessCustomerRecord(ctx, customer as any, "pending@example.com")).toBe(false);
    expect(await canAccessCustomerRecord(ctx, customer as any, "stranger@example.com")).toBe(false);
  });
});
