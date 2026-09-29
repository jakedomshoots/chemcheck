import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CONNECT_REQUIRED_MESSAGE,
  buildAccountCreateForm,
  buildAccountLinkForm,
  buildStripeHeaders,
  calculateApplicationFeeCents,
  checkoutPaymentMatches,
  connectFlagsFromAccount,
  deriveConnectState,
  parsePlatformFeeBps,
  planConnectWebhookEvent,
  platformFeeCentsFromEnv,
  requireChargeableAccount,
  verifyStripeSignature,
} from "./stripeConnect";
import { buildCheckoutSessionForm } from "./payments";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

function sign(payload: string, secret: string, timestamp: number) {
  const sig = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  return `t=${timestamp},v1=${sig}`;
}

describe("Stripe Connect headers", () => {
  it("adds Stripe-Account only for a valid connected account", () => {
    const platform = buildStripeHeaders({ secretKey: "sk_test_x", form: true });
    expect(platform["Stripe-Account"]).toBeUndefined();
    expect(platform["Content-Type"]).toBe("application/x-www-form-urlencoded");

    const connected = buildStripeHeaders({ secretKey: "sk_test_x", stripeAccountId: "acct_123ABC" });
    expect(connected["Stripe-Account"]).toBe("acct_123ABC");
    expect(connected.Authorization).toBe("Bearer sk_test_x");

    expect(() => buildStripeHeaders({ secretKey: "sk_test_x", stripeAccountId: "" })).toThrow();
    expect(() => buildStripeHeaders({ secretKey: "sk_test_x", stripeAccountId: "acct_1\nX-Evil: 1" })).toThrow();
  });
});

describe("platform fee", () => {
  it("parses basis points defensively and defaults to 0", () => {
    expect(parsePlatformFeeBps(undefined)).toBe(0);
    expect(parsePlatformFeeBps("")).toBe(0);
    expect(parsePlatformFeeBps("abc")).toBe(0);
    expect(parsePlatformFeeBps("-50")).toBe(0);
    expect(parsePlatformFeeBps("1.5")).toBe(0);
    expect(parsePlatformFeeBps(" 250 ")).toBe(250);
    expect(parsePlatformFeeBps("99999")).toBe(10_000);
  });

  it("rounds down and never exceeds the charge", () => {
    expect(calculateApplicationFeeCents(10_000, 0)).toBe(0);
    expect(calculateApplicationFeeCents(10_000, 250)).toBe(250);
    expect(calculateApplicationFeeCents(999, 100)).toBe(9);
    expect(calculateApplicationFeeCents(500, 10_000)).toBe(500);
    expect(calculateApplicationFeeCents(0, 250)).toBe(0);
  });

  it("reads PLATFORM_FEE_BPS from env", () => {
    delete process.env.PLATFORM_FEE_BPS;
    expect(platformFeeCentsFromEnv(10_000)).toBe(0);
    process.env.PLATFORM_FEE_BPS = "100";
    expect(platformFeeCentsFromEnv(10_000)).toBe(100);
  });
});

describe("form bodies", () => {
  it("builds an Express account with required capabilities and business metadata", () => {
    const form = buildAccountCreateForm({ businessId: "biz1", email: "owner@pool.co", businessName: "Blue Pools" });
    expect(form.get("type")).toBe("express");
    expect(form.get("email")).toBe("owner@pool.co");
    expect(form.get("capabilities[card_payments][requested]")).toBe("true");
    expect(form.get("capabilities[transfers][requested]")).toBe("true");
    expect(form.get("metadata[business_id]")).toBe("biz1");
  });

  it("builds onboarding account links back to Settings", () => {
    const form = buildAccountLinkForm({ accountId: "acct_1", baseUrl: "https://app.example.com" });
    expect(form.get("type")).toBe("account_onboarding");
    expect(form.get("account")).toBe("acct_1");
    expect(form.get("return_url")).toBe("https://app.example.com/settings?stripe_connect=return#integrations");
    expect(form.get("refresh_url")).toBe("https://app.example.com/settings?stripe_connect=refresh#integrations");
  });

  it("includes an application fee on checkout only when positive", () => {
    const base = {
      amountCents: 12_345,
      lineItemName: "Invoice",
      lineItemDescription: "Pool service",
      successUrl: "https://app/s",
      cancelUrl: "https://app/c",
      clientReferenceId: "inv1",
      metadata: { payment_type: "invoice", invoice_id: "inv1" },
    };
    const noFee = buildCheckoutSessionForm(base);
    expect(noFee.has("payment_intent_data[application_fee_amount]")).toBe(false);
    expect(noFee.get("line_items[0][price_data][unit_amount]")).toBe("12345");
    expect(noFee.get("metadata[invoice_id]")).toBe("inv1");

    const withFee = buildCheckoutSessionForm({ ...base, applicationFeeCents: 123 });
    expect(withFee.get("payment_intent_data[application_fee_amount]")).toBe("123");
  });
});

describe("account state", () => {
  it("derives connection state and requires charges_enabled to charge", () => {
    expect(deriveConnectState(null)).toBe("not_connected");
    expect(deriveConnectState({ stripe_account_id: "acct_1" })).toBe("onboarding_incomplete");
    expect(deriveConnectState({ stripe_account_id: "acct_1", stripe_charges_enabled: true })).toBe("active");

    expect(() => requireChargeableAccount(null)).toThrow(CONNECT_REQUIRED_MESSAGE);
    expect(() => requireChargeableAccount({ stripe_account_id: "acct_1", stripe_charges_enabled: false }))
      .toThrow(CONNECT_REQUIRED_MESSAGE);
    expect(requireChargeableAccount({ stripe_account_id: "acct_1", stripe_charges_enabled: true })).toBe("acct_1");

    expect(connectFlagsFromAccount({ charges_enabled: true, payouts_enabled: "yes" })).toEqual({
      charges_enabled: true,
      payouts_enabled: false,
      details_submitted: false,
    });
  });

  it("verifies paid amount and currency", () => {
    expect(checkoutPaymentMatches({ payment_status: "paid", amount_total: 500, currency: "usd" }, 500)).toEqual({ ok: true });
    expect(checkoutPaymentMatches({ payment_status: "unpaid", amount_total: 500, currency: "usd" }, 500).ok).toBe(false);
    expect(checkoutPaymentMatches({ payment_status: "paid", amount_total: 499, currency: "usd" }, 500)).toEqual({ ok: false, reason: "amount_mismatch" });
    expect(checkoutPaymentMatches({ payment_status: "paid", amount_total: 500, currency: "eur" }, 500)).toEqual({ ok: false, reason: "currency_mismatch" });
  });
});

describe("Connect webhook events", () => {
  it("maps account.updated to a status update", () => {
    const plan = planConnectWebhookEvent({
      type: "account.updated",
      account: "acct_9",
      data: { object: { id: "acct_9", charges_enabled: true, payouts_enabled: true, details_submitted: true, metadata: { business_id: "biz1" } } },
    });
    expect(plan).toEqual({
      kind: "account_status",
      account_id: "acct_9",
      business_id: "biz1",
      flags: { charges_enabled: true, payouts_enabled: true, details_submitted: true },
    });
    expect(planConnectWebhookEvent({
      type: "account.updated",
      account: "acct_other",
      data: { object: { id: "acct_9" } },
    })).toEqual({ kind: "ignore", reason: "account_mismatch" });
  });

  it("maps paid connected checkout sessions to invoice or deposit payments", () => {
    const invoicePlan = planConnectWebhookEvent({
      type: "checkout.session.completed",
      account: "acct_9",
      data: { object: { id: "cs_1", payment_status: "paid", payment_intent: "pi_1", amount_total: 100, currency: "usd", metadata: { payment_type: "invoice", invoice_id: "inv1" } } },
    });
    expect(invoicePlan).toMatchObject({
      kind: "checkout_paid",
      account_id: "acct_9",
      payment_type: "invoice",
      entity_id: "inv1",
      session_id: "cs_1",
      payment_intent_id: "pi_1",
    });

    const depositPlan = planConnectWebhookEvent({
      type: "checkout.session.async_payment_succeeded",
      account: "acct_9",
      data: { object: { id: "cs_2", payment_status: "paid", metadata: { payment_type: "quote_deposit", quote_id: "q1" } } },
    });
    expect(depositPlan).toMatchObject({ kind: "checkout_paid", payment_type: "quote_deposit", entity_id: "q1" });
  });

  it("ignores unpaid, platform-level, and unrecognized events", () => {
    const object = { id: "cs_1", payment_status: "paid", metadata: { payment_type: "invoice", invoice_id: "inv1" } };
    expect(planConnectWebhookEvent({ type: "checkout.session.completed", data: { object } }).kind).toBe("ignore");
    expect(planConnectWebhookEvent({
      type: "checkout.session.completed",
      account: "acct_9",
      data: { object: { ...object, payment_status: "unpaid" } },
    })).toEqual({ kind: "ignore", reason: "not_paid" });
    expect(planConnectWebhookEvent({
      type: "checkout.session.completed",
      account: "acct_9",
      data: { object: { ...object, metadata: { payment_type: "subscription" } } },
    }).kind).toBe("ignore");
    expect(planConnectWebhookEvent({ type: "payout.paid", account: "acct_9" }).kind).toBe("ignore");
  });
});

describe("Connect webhook signature", () => {
  const secret = "whsec_testsecret";
  const payload = JSON.stringify({ id: "evt_1", type: "account.updated" });
  const now = 1_800_000_000;

  it("accepts a valid signature and rejects tampering or stale timestamps", async () => {
    expect(await verifyStripeSignature(payload, sign(payload, secret, now), secret, now)).toBe(true);
    expect(await verifyStripeSignature(`${payload} `, sign(payload, secret, now), secret, now)).toBe(false);
    expect(await verifyStripeSignature(payload, sign(payload, "whsec_other", now), secret, now)).toBe(false);
    expect(await verifyStripeSignature(payload, sign(payload, secret, now - 3600), secret, now)).toBe(false);
    expect(await verifyStripeSignature(payload, "garbage", secret, now)).toBe(false);
  });
});

describe("payments never charge on the platform account", () => {
  it("creates invoice and deposit checkout sessions on the connected account", () => {
    const payments = readFileSync(resolve(__dirname, "payments.ts"), "utf8");
    const creates = payments.match(/await createStripeCheckoutSession\(\{[\s\S]*?\n\s*\}\);/g) || [];
    expect(creates.length).toBe(2);
    for (const call of creates) {
      expect(call).toContain("stripeAccountId,");
      expect(call).toContain("applicationFeeCents: platformFeeCentsFromEnv(amountCents)");
    }
    expect((payments.match(/requireChargeableAccount\(/g) || []).length).toBe(2);
  });
});
