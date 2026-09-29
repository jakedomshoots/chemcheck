import { describe, expect, it } from "vitest";
import {
  assertInvoiceTransition,
  canTransitionInvoice,
  initialInvoiceStatus,
  validatePaymentUrl,
} from "./invoices";
import { computeTotals, normalizeLineItems } from "./lineItems";
import { paymentAmountMismatch, providerSettlementMismatch } from "./paymentMatching";
import {
  decideSubscriptionTarget,
  eventCreatedMs,
  mapSquareStatus,
  planIdFromVariationId,
  planPriceCents,
  shouldApplyEvent,
  statusAfterPaymentFailed,
  statusAfterPaymentSucceeded,
  subscriptionFieldsFromSquare,
  wouldResurrect,
} from "./squareSubscriptionState";
import { decideEventClaim, PROCESSING_LEASE_MS } from "./webhookEvents";
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

  it("accepts only https Square payment links", () => {
    expect(validatePaymentUrl("https://square.link/u/AbCd1234")).toContain("square.link");
    expect(validatePaymentUrl("https://sandbox.square.link/u/AbCd1234")).toContain("sandbox.square.link");
    expect(validatePaymentUrl("https://checkout.square.site/merchant/M1/checkout/X")).toContain("square.site");
    expect(() => validatePaymentUrl("https://evil.example/pay")).toThrow();
    expect(() => validatePaymentUrl("http://square.link/u/x")).toThrow();
    expect(() => validatePaymentUrl("https://square.link.evil.example/x")).toThrow();
    expect(() => validatePaymentUrl("https://checkout.stripe.com/c/pay/cs_test_1")).toThrow();
    expect(() => validatePaymentUrl("https://user:pw@square.link/u/x")).toThrow();
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

describe("square subscription webhook state", () => {
  const env = {
    SQUARE_PLAN_VARIATION_STARTER_MONTHLY: "VAR_STARTER_M",
    SQUARE_PLAN_VARIATION_PROFESSIONAL_ANNUAL: "VAR_PRO_Y",
    SQUARE_PLAN_VARIATION_BUSINESS_MONTHLY: "VAR_BIZ_M",
  };

  it("derives the plan only from env-configured plan variation ids", () => {
    expect(planIdFromVariationId("VAR_PRO_Y", env)).toBe("professional");
    expect(planIdFromVariationId("VAR_BIZ_M", env)).toBe("business");
    expect(planIdFromVariationId("VAR_UNKNOWN", env)).toBeUndefined();
    expect(planIdFromVariationId(undefined, env)).toBeUndefined();
    // An unset env var never matches an empty variation id.
    expect(planIdFromVariationId("", {})).toBeUndefined();
  });

  it("prices plans with the 20% annual discount", () => {
    expect(planPriceCents("starter", "month")).toBe(2900);
    expect(planPriceCents("professional", "month")).toBe(7900);
    expect(planPriceCents("business", "month")).toBe(14900);
    expect(planPriceCents("starter", "year")).toBe(27800);
    expect(planPriceCents("professional", "year")).toBe(75800);
    expect(planPriceCents("business", "year")).toBe(143000);
  });

  it("maps Square statuses onto the entitlement statuses planLimits expects", () => {
    expect(mapSquareStatus("ACTIVE")).toBe("active");
    expect(mapSquareStatus("PENDING")).toBe("trialing");
    expect(mapSquareStatus("PAUSED")).toBe("canceled");
    expect(mapSquareStatus("CANCELED")).toBe("canceled");
    expect(mapSquareStatus("DEACTIVATED")).toBe("canceled");
    expect(mapSquareStatus("WEIRD")).toBeUndefined();
  });

  it("builds upsert fields from a Square subscription without trusting metadata", () => {
    const fields = subscriptionFieldsFromSquare(
      {
        id: "sub_1",
        customer_id: "cust_1",
        plan_variation_id: "VAR_UNKNOWN",
        status: "ACTIVE",
        start_date: "2026-01-01",
        charged_through_date: "2026-02-01",
        metadata: { plan_id: "business" },
      },
      env
    );
    expect(fields).toMatchObject({
      square_subscription_id: "sub_1",
      square_customer_id: "cust_1",
      square_status: "ACTIVE",
      status: "active",
      plan_id: undefined,
      current_period_start: Date.parse("2026-01-01T00:00:00Z"),
      current_period_end: Date.parse("2026-02-01T00:00:00Z"),
      cancel_at_period_end: false,
    });
    expect(() => subscriptionFieldsFromSquare({ id: "sub", status: "weird" }, env)).toThrow();
    expect(() => subscriptionFieldsFromSquare({ status: "ACTIVE" }, env)).toThrow();
  });

  it("marks an ACTIVE subscription with a canceled_date as canceling at period end", () => {
    const fields = subscriptionFieldsFromSquare(
      { id: "sub_1", status: "ACTIVE", plan_variation_id: "VAR_STARTER_M", canceled_date: "2026-03-01" },
      env
    );
    expect(fields.plan_id).toBe("starter");
    expect(fields.cancel_at_period_end).toBe(true);
    expect(fields.current_period_end).toBe(Date.parse("2026-03-01T00:00:00Z"));
  });

  it("ignores events older than the last applied one", () => {
    expect(eventCreatedMs({ created_at: "2026-01-01T00:00:00Z" })).toBe(Date.parse("2026-01-01T00:00:00Z"));
    expect(eventCreatedMs({})).toBeUndefined();
    expect(shouldApplyEvent(undefined, 1000)).toBe(true);
    expect(shouldApplyEvent(2000, 1000)).toBe(false);
    expect(shouldApplyEvent(2000, 2000)).toBe(true);
    expect(shouldApplyEvent(2000, 3000)).toBe(true);
  });

  it("never resurrects canceled subscriptions", () => {
    expect(wouldResurrect("CANCELED", "ACTIVE")).toBe(true);
    expect(wouldResurrect("DEACTIVATED", "PENDING")).toBe(true);
    expect(wouldResurrect("CANCELED", "CANCELED")).toBe(false);
    // Paused subscriptions may legitimately resume.
    expect(wouldResurrect("PAUSED", "ACTIVE")).toBe(false);
    expect(wouldResurrect(undefined, "ACTIVE")).toBe(false);

    expect(statusAfterPaymentSucceeded("canceled")).toBeNull();
    expect(statusAfterPaymentSucceeded("incomplete_expired")).toBeNull();
    expect(statusAfterPaymentSucceeded("trialing")).toBeNull();
    expect(statusAfterPaymentSucceeded("past_due")).toBe("active");
    expect(statusAfterPaymentFailed("canceled")).toBeNull();
    expect(statusAfterPaymentFailed("active")).toBe("past_due");
  });

  it("keeps one row per business and never lets a late event for an old subscription win", () => {
    expect(decideSubscriptionTarget(null, { status: "active" })).toBe("insert");
    // Legacy Stripe row (any status) is taken over by an entitled Square subscription.
    expect(decideSubscriptionTarget({ status: "active" }, { status: "active", event_created: 5 })).toBe("replace");
    expect(decideSubscriptionTarget({ status: "active" }, { status: "canceled" })).toBe("skip");
    expect(decideSubscriptionTarget({ status: "canceled" }, { status: "canceled" })).toBe("replace");
    const current = { provider: "square", square_subscription_id: "sub_new", status: "active", last_event_created: 2000 };
    expect(decideSubscriptionTarget(current, { status: "active", event_created: 1000 })).toBe("skip");
    expect(decideSubscriptionTarget(current, { status: "canceled", event_created: 3000 })).toBe("skip");
    expect(decideSubscriptionTarget(current, { status: "active", event_created: 3000 })).toBe("replace");
  });
});

describe("provider payment verification", () => {
  it("requires the exact USD amount due in cents", () => {
    expect(paymentAmountMismatch(125.5, { amount_cents: 12550, currency: "USD" })).toBeNull();
    expect(paymentAmountMismatch(125.5, { amount_cents: 12550, currency: "usd" })).toBeNull();
    expect(paymentAmountMismatch(125.5, { amount_cents: 100, currency: "USD" })).toBe("amount_mismatch");
    expect(paymentAmountMismatch(125.5, { amount_cents: 12551, currency: "USD" })).toBe("amount_mismatch");
    expect(paymentAmountMismatch(125.5, { amount_cents: 12550, currency: "CAD" })).toBe("currency_mismatch");
    expect(paymentAmountMismatch(125.5, { currency: "USD" })).toBe("amount_missing");
    expect(paymentAmountMismatch(0, { amount_cents: 0, currency: "USD" })).toBe("no_amount_due");
  });

  it("settles only COMPLETED payments on the record's own merchant", () => {
    const expected = { merchantId: "MERCHANT_A", amount: 50 };
    const good = { merchant_id: "MERCHANT_A", status: "COMPLETED", amount_cents: 5000, currency: "USD" };
    expect(providerSettlementMismatch(expected, good)).toBeNull();
    expect(providerSettlementMismatch(expected, { ...good, status: "APPROVED" })).toBe("not_completed");
    expect(providerSettlementMismatch(expected, { ...good, merchant_id: "MERCHANT_B" })).toBe("merchant_mismatch");
    expect(providerSettlementMismatch({ amount: 50 }, good)).toBe("merchant_mismatch");
    expect(providerSettlementMismatch(expected, { ...good, amount_cents: 4999 })).toBe("amount_mismatch");
  });
});

describe("webhook event claim", () => {
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
