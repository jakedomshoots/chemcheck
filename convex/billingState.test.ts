import { describe, expect, it } from "vitest";
import {
  assertInvoiceTransition,
  canTransitionInvoice,
  initialInvoiceStatus,
  validatePaymentUrl,
} from "./invoices";
import { computeTotals, normalizeLineItems } from "./lineItems";
import {
  checkoutPaymentMismatch,
  invoiceSubscriptionId,
  planIdFromPriceId,
  resolvePeriod,
  resolvePlanId,
  shouldApplyEvent,
  statusAfterPaymentFailed,
  statusAfterPaymentSucceeded,
  subscriptionUpsertFields,
} from "./stripeSubscriptionState";
import { decideEventClaim, PROCESSING_LEASE_MS } from "./stripeEvents";
import { computeBackoffMultiplier, getRateLimit } from "./rateLimit";

describe("invoice state machine", () => {
  it("allows forward transitions and blocks leaving terminal states", () => {
    expect(canTransitionInvoice("draft", "sent")).toBe(true);
    expect(canTransitionInvoice("sent", "cancelled")).toBe(true);
    expect(canTransitionInvoice("paid", "draft")).toBe(false);
    expect(canTransitionInvoice("paid", "sent")).toBe(false);
    expect(canTransitionInvoice("cancelled", "draft")).toBe(false);
    expect(canTransitionInvoice("cancelled", "sent")).toBe(false);
    expect(() => assertInvoiceTransition("paid", "cancelled")).toThrow(/cannot move/);
  });

  it("only settles zero-total invoices that a paid deposit covers", () => {
    expect(initialInvoiceStatus(0, 0)).toBe("draft");
    expect(initialInvoiceStatus(0, 50)).toBe("paid");
    expect(initialInvoiceStatus(10, 50)).toBe("draft");
  });

  it("accepts only https Stripe payment links", () => {
    expect(validatePaymentUrl("https://checkout.stripe.com/c/pay/cs_test_1")).toContain("checkout.stripe.com");
    expect(() => validatePaymentUrl("https://evil.example/pay")).toThrow();
    expect(() => validatePaymentUrl("http://checkout.stripe.com/x")).toThrow();
    expect(() => validatePaymentUrl("https://stripe.com.evil.example/x")).toThrow();
    expect(() => validatePaymentUrl("javascript:alert(1)")).toThrow();
  });
});

describe("line item validation", () => {
  it("recomputes amounts server-side and ignores client amounts", () => {
    const items = normalizeLineItems([{ description: " Clean ", quantity: 2, unit_price: 50, amount: -9999 }]);
    expect(items).toEqual([{ description: "Clean", quantity: 2, unit_price: 50, amount: 100 }]);
    expect(computeTotals(items, 0.1, 30)).toEqual({ subtotal: 100, tax: 10, grossTotal: 110, depositApplied: 30, total: 80 });
  });

  it("rejects negative, non-finite and excessive values", () => {
    expect(() => normalizeLineItems([{ description: "x", quantity: -1, unit_price: 5 }])).toThrow(/quantity/);
    expect(() => normalizeLineItems([{ description: "x", quantity: 1, unit_price: -5 }])).toThrow(/unit price/);
    expect(() => normalizeLineItems([{ description: "x", quantity: Number.NaN, unit_price: 5 }])).toThrow();
    expect(() => normalizeLineItems([{ description: "x", quantity: 1, unit_price: Infinity }])).toThrow();
    expect(() => normalizeLineItems([])).toThrow(/At least one/);
    expect(() =>
      normalizeLineItems(Array.from({ length: 101 }, () => ({ description: "x", quantity: 1, unit_price: 1 })))
    ).toThrow(/maximum/);
  });

  it("never produces a negative total", () => {
    const items = normalizeLineItems([{ description: "x", quantity: 1, unit_price: 10 }]);
    expect(computeTotals(items, 0, 500).total).toBe(0);
  });
});

describe("stripe subscription webhook state", () => {
  const env = {
    STRIPE_STARTER_MONTHLY_PRICE_ID: "price_starter_m",
    STRIPE_PROFESSIONAL_YEARLY_PRICE_ID: "price_pro_y",
    STRIPE_BUSINESS_MONTHLY_PRICE_ID: "price_biz_m",
  };

  it("maps plan from the subscription price, falling back to metadata", () => {
    expect(planIdFromPriceId("price_pro_y", env)).toBe("professional");
    expect(planIdFromPriceId("price_unknown", env)).toBeUndefined();
    // Billing-portal upgrade: metadata still says starter but the price is business.
    expect(
      resolvePlanId({ metadata: { plan_id: "starter" }, items: { data: [{ price: { id: "price_biz_m" } }] } }, env)
    ).toBe("business");
    expect(resolvePlanId({ metadata: { plan_id: "professional" }, items: { data: [] } }, env)).toBe("professional");
    expect(resolvePlanId({ metadata: { plan_id: "bogus" } }, env)).toBeUndefined();
  });

  it("reads billing periods from items on newer API versions", () => {
    expect(resolvePeriod({ current_period_start: 10, current_period_end: 20 })).toEqual({ start: 10000, end: 20000 });
    expect(
      resolvePeriod({ items: { data: [{ current_period_start: 30, current_period_end: 40 }] } })
    ).toEqual({ start: 30000, end: 40000 });
    expect(resolvePeriod({})).toEqual({ start: undefined, end: undefined });
  });

  it("finds the subscription id on legacy and new invoice shapes", () => {
    expect(invoiceSubscriptionId({ subscription: "sub_1" })).toBe("sub_1");
    expect(invoiceSubscriptionId({ subscription: { id: "sub_2" } })).toBe("sub_2");
    expect(invoiceSubscriptionId({ parent: { subscription_details: { subscription: "sub_3" } } })).toBe("sub_3");
    expect(invoiceSubscriptionId({})).toBeUndefined();
  });

  it("ignores events older than the last applied one", () => {
    expect(shouldApplyEvent(undefined, 1000)).toBe(true);
    expect(shouldApplyEvent(2000, 1000)).toBe(false);
    expect(shouldApplyEvent(2000, 2000)).toBe(true);
    expect(shouldApplyEvent(2000, 3000)).toBe(true);
  });

  it("never resurrects canceled subscriptions on payment events", () => {
    expect(statusAfterPaymentSucceeded("canceled")).toBeNull();
    expect(statusAfterPaymentSucceeded("incomplete_expired")).toBeNull();
    expect(statusAfterPaymentSucceeded("trialing")).toBeNull();
    expect(statusAfterPaymentSucceeded("past_due")).toBe("active");
    expect(statusAfterPaymentFailed("canceled")).toBeNull();
    expect(statusAfterPaymentFailed("active")).toBe("past_due");
  });

  it("builds upsert fields without defaulting unknown plans to starter", () => {
    const fields = subscriptionUpsertFields(
      {
        id: "sub_1",
        customer: "cus_1",
        status: "active",
        cancel_at_period_end: false,
        metadata: { business_id: "b1", user_email: "o@x.test" },
        items: { data: [{ price: { id: "price_unknown" }, current_period_start: 1, current_period_end: 2 }] },
      },
      env
    );
    expect(fields).toMatchObject({
      stripe_subscription_id: "sub_1",
      stripe_customer_id: "cus_1",
      status: "active",
      plan_id: undefined,
      current_period_start: 1000,
      current_period_end: 2000,
    });
    expect(() => subscriptionUpsertFields({ id: "sub", status: "weird" }, env)).toThrow();
  });
});

describe("stripe checkout payment verification", () => {
  it("requires the exact USD amount due", () => {
    expect(checkoutPaymentMismatch(125.5, { amount_total: 12550, currency: "usd" })).toBeNull();
    expect(checkoutPaymentMismatch(125.5, { amount_total: 12550, currency: "USD" })).toBeNull();
    expect(checkoutPaymentMismatch(125.5, { amount_total: 100, currency: "usd" })).toBe("amount_mismatch");
    expect(checkoutPaymentMismatch(125.5, { amount_total: 12550, currency: "eur" })).toBe("currency_mismatch");
    expect(checkoutPaymentMismatch(125.5, { currency: "usd" })).toBe("amount_missing");
    expect(checkoutPaymentMismatch(0, { amount_total: 0, currency: "usd" })).toBe("no_amount_due");
  });
});

describe("stripe event claim", () => {
  it("claims new/failed/stale events and rejects duplicates and in-flight ones", () => {
    const now = 1_000_000;
    expect(decideEventClaim(null, now)).toBe("claim");
    expect(decideEventClaim({ status: "processed", updated_at: now }, now)).toBe("duplicate");
    expect(decideEventClaim({ status: "processing", updated_at: now - 1000 }, now)).toBe("in_progress");
    expect(decideEventClaim({ status: "processing", updated_at: now - PROCESSING_LEASE_MS - 1 }, now)).toBe("claim");
    expect(decideEventClaim({ status: "failed", updated_at: now }, now)).toBe("claim");
  });
});

describe("rate limit configuration", () => {
  it("honors env overrides and computes bounded backoff", () => {
    process.env.RATE_LIMIT_INVOICE_WRITE = "5:1000";
    try {
      expect(getRateLimit("invoice.write")).toEqual({ maxRequests: 5, windowMs: 1000 });
    } finally {
      delete process.env.RATE_LIMIT_INVOICE_WRITE;
    }
    expect(getRateLimit("invoice.write")).toEqual({ maxRequests: 60, windowMs: 60000 });
    expect(getRateLimit("unknown.action")).toEqual({ maxRequests: 100, windowMs: 60000 });
    expect(computeBackoffMultiplier(0)).toBe(1);
    expect(computeBackoffMultiplier(2)).toBe(4);
    expect(computeBackoffMultiplier(99)).toBe(32);
  });
});
