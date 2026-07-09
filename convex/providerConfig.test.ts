import { afterEach, describe, expect, it } from "vitest";
import {
  getProviderConfigStatus,
  requireMailersendConfig,
  requireStripeConfig,
  requireTwilioConfig,
} from "./providerConfig";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("provider configuration", () => {
  it("reports missing production credentials without exposing values", () => {
    process.env = {};
    const status = getProviderConfigStatus();

    expect(status.stripe.ready).toBe(false);
    expect(status.mailersend.ready).toBe(false);
    expect(status.twilio.ready).toBe(false);
    expect(JSON.stringify(status)).not.toContain("sk_live_");
    expect(JSON.stringify(status)).not.toContain("whsec_");
  });

  it("requires complete, correctly shaped Stripe configuration", () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_valid";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_valid";
    process.env.APP_URL = "https://app.example.com";

    expect(requireStripeConfig().secretKey).toBe("sk_live_valid");
    expect(getProviderConfigStatus().stripe.ready).toBe(true);

    process.env.STRIPE_SECRET_KEY = "not-a-stripe-key";
    expect(() => requireStripeConfig()).toThrow(/valid STRIPE_SECRET_KEY/);
  });

  it("rejects unsafe messaging sender configuration", () => {
    process.env.MAILERSEND_API_KEY = "mlsn_valid";
    process.env.FROM_EMAIL = "reports@example.com";
    expect(() => requireMailersendConfig()).toThrow(/verified sender/);

    process.env.FROM_EMAIL = "reports@poolcompany.com";
    expect(requireMailersendConfig().fromEmail).toBe("reports@poolcompany.com");

    process.env.TWILIO_ACCOUNT_SID = "AC123";
    process.env.TWILIO_AUTH_TOKEN = "token";
    process.env.TWILIO_FROM_NUMBER = "5551234567";
    expect(() => requireTwilioConfig()).toThrow(/E.164/);

    process.env.TWILIO_FROM_NUMBER = "+15551234567";
    expect(requireTwilioConfig().fromNumber).toBe("+15551234567");
  });
});
