import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CONNECT_REQUIRED_MESSAGE,
  buildAuthorizeUrl,
  buildPaymentLinkBody,
  computeSquareSignature,
  constantTimeEqual,
  decryptSecret,
  encryptSecret,
  generateStateToken,
  isSquareHostedUrl,
  isWellFormedState,
  maskMerchantId,
  parsePaymentLinkResponse,
  parseTokenResponse,
  selectSquareLocation,
  sellerOAuthScopes,
  shouldRefreshToken,
  squareHeaders,
  validateOAuthState,
  verifySquareSignature,
  REFRESH_WINDOW_MS,
} from "./squareApi";
import {
  calculateApplicationFeeCents,
  parsePlatformFeeBps,
  platformFeeCentsFromEnv,
} from "./paymentMatching";
import { planSquareWebhookEvent } from "./squareWebhook";
import { deriveSquareConnectState } from "./squareConnect";
import { isReusablePaymentLink, paymentLinkIdempotencyKey } from "./payments";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("Square webhook signature", () => {
  const key = "test-signature-key";
  const url = "https://example.convex.site/square/webhook";
  const body = JSON.stringify({ event_id: "evt_1", type: "payment.updated" });
  // Known vector: base64(HMAC-SHA256(key, url + body)).
  const expected = "WN5aP0Elu4nX2oF5G+YveRabbPTxsIZUyl6M/KftLr8=";

  it("matches the known vector and node's HMAC", async () => {
    expect(await computeSquareSignature(body, key, url)).toBe(expected);
    expect(createHmac("sha256", key).update(url + body).digest("base64")).toBe(expected);
  });

  it("accepts a valid signature and rejects tampering, other URLs, other keys and garbage", async () => {
    expect(await verifySquareSignature(body, expected, key, url)).toBe(true);
    expect(await verifySquareSignature(`${body} `, expected, key, url)).toBe(false);
    expect(await verifySquareSignature(body, expected, key, `${url}/`)).toBe(false);
    expect(await verifySquareSignature(body, expected, "other-key", url)).toBe(false);
    expect(await verifySquareSignature(body, "garbage", key, url)).toBe(false);
    expect(await verifySquareSignature(body, null, key, url)).toBe(false);
    expect(await verifySquareSignature(body, expected, "", url)).toBe(false);
  });

  it("compares in constant time over equal lengths only", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
  });
});

describe("Square API headers", () => {
  it("pins the Square-Version and rejects header injection", () => {
    const headers = squareHeaders("EAAAtoken");
    expect(headers.Authorization).toBe("Bearer EAAAtoken");
    expect(headers["Square-Version"]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(squareHeaders("secret", "Client").Authorization).toBe("Client secret");
    expect(squareHeaders().Authorization).toBeUndefined();
    expect(() => squareHeaders("tok\r\nX-Evil: 1")).toThrow();
    expect(() => squareHeaders("")).toThrow();
  });
});

describe("token encryption at rest", () => {
  const key = Buffer.alloc(32, 3).toString("base64");

  it("round-trips with AES-GCM and uses a fresh IV each time", async () => {
    const a = await encryptSecret("EAAA-access-token", key);
    const b = await encryptSecret("EAAA-access-token", key);
    expect(a).not.toContain("EAAA-access-token");
    expect(a).not.toBe(b);
    expect(await decryptSecret(a, key)).toBe("EAAA-access-token");
  });

  it("rejects a wrong key, tampering and a missing key", async () => {
    const encrypted = await encryptSecret("secret", key);
    await expect(decryptSecret(encrypted, Buffer.alloc(32, 4).toString("base64"))).rejects.toThrow();
    const [p, iv, data] = encrypted.split(":");
    const tampered = `${p}:${iv}:${data.slice(0, -4)}AAAA`;
    await expect(decryptSecret(tampered, key)).rejects.toThrow();
    await expect(encryptSecret("secret", "")).rejects.toThrow(/SQUARE_TOKEN_ENCRYPTION_KEY/);
    await expect(encryptSecret("secret", Buffer.alloc(16).toString("base64"))).rejects.toThrow();
  });
});

describe("seller OAuth", () => {
  it("creates unguessable single-use states and validates expiry", () => {
    const a = generateStateToken();
    expect(isWellFormedState(a)).toBe(true);
    expect(a).not.toBe(generateStateToken());
    expect(isWellFormedState("../../etc")).toBe(false);
    expect(isWellFormedState(undefined)).toBe(false);

    const now = 1_000_000;
    expect(validateOAuthState(null, now)).toEqual({ ok: false, reason: "unknown_state" });
    expect(validateOAuthState({ expires_at: now }, now)).toEqual({ ok: false, reason: "expired_state" });
    expect(validateOAuthState({ expires_at: now + 1 }, now)).toEqual({ ok: true });
  });

  it("builds the authorize URL with the required scopes and state", () => {
    const url = buildAuthorizeUrl({
      baseUrl: "https://connect.squareupsandbox.com",
      applicationId: "sandbox-sq0idb-app",
      state: "abc123",
      scopes: sellerOAuthScopes(false),
    });
    expect(url.startsWith("https://connect.squareupsandbox.com/oauth2/authorize?")).toBe(true);
    expect(url).toContain("client_id=sandbox-sq0idb-app");
    expect(url).toContain("scope=MERCHANT_PROFILE_READ+PAYMENTS_READ+PAYMENTS_WRITE+ORDERS_READ+ORDERS_WRITE");
    expect(url).toContain("session=false");
    expect(url).toContain("state=abc123");
    expect(url).not.toContain("redirect_uri");
    expect(sellerOAuthScopes(true)).toContain("PAYMENTS_WRITE_ADDITIONAL_RECIPIENTS");
    expect(buildAuthorizeUrl({
      baseUrl: "https://x",
      applicationId: "a",
      state: "s",
      scopes: ["A"],
      redirectUrl: "https://d.convex.site/square/oauth/callback",
    })).toContain("redirect_uri=https%3A%2F%2Fd.convex.site%2Fsquare%2Foauth%2Fcallback");
  });

  it("decides when to refresh tokens", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(shouldRefreshToken(now + 30 * 86_400_000, now, REFRESH_WINDOW_MS)).toBe(false);
    expect(shouldRefreshToken(now + 6 * 86_400_000, now, REFRESH_WINDOW_MS)).toBe(true);
    expect(shouldRefreshToken(now - 1, now, 0)).toBe(true);
    expect(shouldRefreshToken(now + 10, now, 0)).toBe(false);
    expect(shouldRefreshToken(undefined, now, 0)).toBe(true);
  });

  it("parses token responses strictly", () => {
    expect(parseTokenResponse({
      access_token: "EAAA1",
      refresh_token: "EQAA1",
      merchant_id: "M1",
      expires_at: "2026-02-01T00:00:00Z",
    })).toEqual({ access_token: "EAAA1", refresh_token: "EQAA1", merchant_id: "M1", expires_at: Date.parse("2026-02-01T00:00:00Z") });
    expect(() => parseTokenResponse({ access_token: "x", expires_at: "2026-02-01T00:00:00Z" })).toThrow();
    expect(() => parseTokenResponse({ access_token: "x", merchant_id: "M", expires_at: "nope" })).toThrow();
  });

  it("selects an active USD card-processing location, preferring the main one", () => {
    expect(selectSquareLocation([
      { id: "L0", status: "INACTIVE", capabilities: ["CREDIT_CARD_PROCESSING"] },
      { id: "L1", name: "Warehouse", status: "ACTIVE", capabilities: [] },
      { id: "L2", name: "Canada", status: "ACTIVE", currency: "CAD", capabilities: ["CREDIT_CARD_PROCESSING"] },
      { id: "L3", name: "Main St", status: "ACTIVE", currency: "USD", capabilities: ["CREDIT_CARD_PROCESSING"] },
    ])).toEqual({ id: "L3", name: "Main St" });
    expect(selectSquareLocation([])).toBeNull();
    expect(selectSquareLocation(undefined)).toBeNull();
  });

  it("derives a redacted connection state", () => {
    const now = 1000;
    expect(deriveSquareConnectState(null, now)).toBe("not_connected");
    expect(deriveSquareConnectState({ expires_at: 5000 }, now)).toBe("needs_reconnect");
    expect(deriveSquareConnectState({ expires_at: 500, location_id: "L" }, now)).toBe("needs_reconnect");
    expect(deriveSquareConnectState({ expires_at: 5000, location_id: "L" }, now)).toBe("connected");
    expect(maskMerchantId("MLABCDEFGH1234")).toBe("****1234");
    expect(maskMerchantId(undefined)).toBeNull();
  });
});

describe("platform fee", () => {
  it("parses basis points defensively and defaults to 0", () => {
    expect(parsePlatformFeeBps(undefined)).toBe(0);
    expect(parsePlatformFeeBps("abc")).toBe(0);
    expect(parsePlatformFeeBps("-50")).toBe(0);
    expect(parsePlatformFeeBps("1.5")).toBe(0);
    expect(parsePlatformFeeBps(" 250 ")).toBe(250);
    expect(parsePlatformFeeBps("99999")).toBe(10_000);
    expect(calculateApplicationFeeCents(999, 100)).toBe(9);
    expect(calculateApplicationFeeCents(500, 10_000)).toBe(500);
    delete process.env.PLATFORM_FEE_BPS;
    expect(platformFeeCentsFromEnv(10_000)).toBe(0);
    process.env.PLATFORM_FEE_BPS = "100";
    expect(platformFeeCentsFromEnv(10_000)).toBe(100);
  });
});

describe("payment links", () => {
  const base = {
    idempotencyKey: "invoice:inv1:12345:M1",
    name: "Invoice 1",
    amountCents: 12_345,
    locationId: "LOC1",
    redirectUrl: "https://app.example.com/workorders?square_payment=invoice_success&invoice_id=inv1",
    paymentNote: "chemcheck:invoice:inv1",
  };

  it("builds a USD quick-pay link and adds the app fee only when positive", () => {
    const noFee = buildPaymentLinkBody(base);
    expect(noFee.quick_pay).toEqual({ name: "Invoice 1", price_money: { amount: 12_345, currency: "USD" }, location_id: "LOC1" });
    expect(noFee.checkout_options.app_fee_money).toBeUndefined();
    expect(noFee.payment_note).toBe("chemcheck:invoice:inv1");
    expect(noFee.idempotency_key).toBe("invoice:inv1:12345:M1");

    const withFee = buildPaymentLinkBody({ ...base, appFeeCents: 123, buyerEmail: "a@b.co" });
    expect(withFee.checkout_options.app_fee_money).toEqual({ amount: 123, currency: "USD" });
    expect(withFee.pre_populated_data).toEqual({ buyer_email: "a@b.co" });

    const subscription = buildPaymentLinkBody({ ...base, subscriptionPlanVariationId: "VAR1" });
    expect(subscription.checkout_options.subscription_plan_id).toBe("VAR1");

    expect(() => buildPaymentLinkBody({ ...base, amountCents: 0 })).toThrow();
    expect(() => buildPaymentLinkBody({ ...base, amountCents: 1.5 })).toThrow();
  });

  it("requires id, order and https url in the response", () => {
    expect(parsePaymentLinkResponse({ payment_link: { id: "PL1", url: "https://square.link/u/x", order_id: "O1" } }))
      .toEqual({ id: "PL1", url: "https://square.link/u/x", order_id: "O1" });
    expect(() => parsePaymentLinkResponse({ payment_link: { id: "PL1", url: "https://square.link/u/x" } })).toThrow();
    expect(() => parsePaymentLinkResponse({ payment_link: { id: "PL1", url: "javascript:x", order_id: "O" } })).toThrow();
  });

  it("reuses a stored link only for the same merchant and amount", () => {
    const stored = { link_id: "PL1", order_id: "O1", url: "https://square.link/u/x", merchant_id: "M1", amount_cents: 5000 };
    expect(isReusablePaymentLink(stored, { merchantId: "M1", amountCents: 5000 })).toBe(true);
    expect(isReusablePaymentLink(stored, { merchantId: "M2", amountCents: 5000 })).toBe(false);
    expect(isReusablePaymentLink(stored, { merchantId: "M1", amountCents: 5001 })).toBe(false);
    expect(isReusablePaymentLink({ ...stored, url: "https://checkout.stripe.com/x" }, { merchantId: "M1", amountCents: 5000 })).toBe(false);
    expect(isReusablePaymentLink({}, { merchantId: "M1", amountCents: 5000 })).toBe(false);
    expect(isSquareHostedUrl("https://square.link.evil.com/u")).toBe(false);
  });

  it("derives deterministic idempotency keys per record, amount and merchant", () => {
    expect(paymentLinkIdempotencyKey("invoice", "inv1", 500, "M1")).toBe("invoice:inv1:500:M1");
    expect(paymentLinkIdempotencyKey("deposit", "q1", 500, "M1")).not.toBe(paymentLinkIdempotencyKey("invoice", "q1", 500, "M1"));
  });
});

describe("Square webhook routing", () => {
  const payment = (status: string, extra: Record<string, any> = {}) => ({
    id: "PAY1",
    status,
    order_id: "ORDER1",
    location_id: "LOC1",
    amount_money: { amount: 5000, currency: "USD" },
    ...extra,
  });

  it("routes completed seller payments to settlement with the event's merchant", () => {
    const plan = planSquareWebhookEvent({
      type: "payment.updated",
      merchant_id: "SELLER1",
      data: { object: { payment: payment("COMPLETED") } },
    }, "PLATFORM");
    expect(plan).toMatchObject({
      kind: "payment_completed",
      merchant_id: "SELLER1",
      payment: { payment_id: "PAY1", order_id: "ORDER1", amount_cents: 5000, currency: "USD", status: "COMPLETED" },
    });
  });

  it("ignores incomplete payments, payments without an order and events without a merchant", () => {
    expect(planSquareWebhookEvent({ type: "payment.created", merchant_id: "S", data: { object: { payment: payment("APPROVED") } } }, "P"))
      .toEqual({ kind: "ignore", reason: "not_completed" });
    expect(planSquareWebhookEvent({ type: "payment.updated", merchant_id: "S", data: { object: { payment: payment("COMPLETED", { order_id: undefined }) } } }, "P"))
      .toEqual({ kind: "ignore", reason: "missing_order" });
    expect(planSquareWebhookEvent({ type: "payment.updated", data: { object: { payment: payment("COMPLETED") } } }, "P").kind)
      .toBe("ignore");
  });

  it("applies subscription and subscription-invoice events only from the platform merchant", () => {
    const subEvent = { type: "subscription.updated", data: { object: { subscription: { id: "SUB1", status: "ACTIVE" } } } };
    expect(planSquareWebhookEvent({ ...subEvent, merchant_id: "PLATFORM" }, "PLATFORM")).toMatchObject({ kind: "subscription" });
    expect(planSquareWebhookEvent({ ...subEvent, merchant_id: "SELLER1" }, "PLATFORM"))
      .toEqual({ kind: "ignore", reason: "not_platform_merchant" });
    expect(planSquareWebhookEvent({ ...subEvent, merchant_id: "PLATFORM" }, undefined).kind).toBe("ignore");

    const invoice = { subscription_id: "SUB1", id: "INV1" };
    expect(planSquareWebhookEvent({ type: "invoice.payment_made", merchant_id: "PLATFORM", data: { object: { invoice } } }, "PLATFORM"))
      .toMatchObject({ kind: "subscription_invoice", outcome: "paid", subscription_id: "SUB1" });
    expect(planSquareWebhookEvent({ type: "invoice.scheduled_charge_failed", merchant_id: "PLATFORM", data: { object: { invoice } } }, "PLATFORM"))
      .toMatchObject({ kind: "subscription_invoice", outcome: "failed" });
    expect(planSquareWebhookEvent({ type: "invoice.payment_made", merchant_id: "PLATFORM", data: { object: { invoice: { id: "X" } } } }, "PLATFORM").kind)
      .toBe("ignore");
  });

  it("forgets sellers on oauth.authorization.revoked and ignores unknown events", () => {
    expect(planSquareWebhookEvent({ type: "oauth.authorization.revoked", merchant_id: "SELLER1" }, "P"))
      .toEqual({ kind: "seller_revoked", merchant_id: "SELLER1" });
    expect(planSquareWebhookEvent({ type: "refund.created", merchant_id: "SELLER1" }, "P").kind).toBe("ignore");
  });
});

describe("customer payments never charge on the platform account", () => {
  it("creates invoice and deposit links only with the connected seller's credentials", () => {
    const payments = readFileSync(resolve(__dirname, "payments.ts"), "utf8");
    expect(payments).not.toMatch(/requireSquarePlatformConfig|SQUARE_ACCESS_TOKEN|SQUARE_LOCATION_ID/);
    const creates = payments.match(/await createSellerPaymentLink\(\{[\s\S]*?\n\s*\}\);/g) || [];
    expect(creates.length).toBe(2);
    for (const call of creates) expect(call).toContain("seller,");
    expect(payments).toContain("appFeeCents: platformFeeCentsFromEnv(args.amountCents)");
    expect(payments).toContain("token: args.seller.accessToken");
    expect((payments.match(/requireSellerCredentials\(ctx, (invoice|quote)\.created_by\)/g) || []).length).toBe(4);
    expect(CONNECT_REQUIRED_MESSAGE).toBe("Connect your Square account in Settings to accept card payments");
  });
});
