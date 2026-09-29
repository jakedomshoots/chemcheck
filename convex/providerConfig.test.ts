import { afterEach, describe, expect, it } from "vitest";
import {
  getProviderConfigStatus,
  requireMailersendConfig,
  requireSquareOAuthConfig,
  requireSquarePlatformConfig,
  squareBaseUrl,
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

    expect(status.square.ready).toBe(false);
    expect(status.mailersend.ready).toBe(false);
    expect(status.twilio.ready).toBe(false);
    expect(status.square.missing).toContain("SQUARE_ACCESS_TOKEN");
    expect(status.square.missing).toContain("SQUARE_PLAN_VARIATION_BUSINESS_ANNUAL");
  });

  it("requires complete Square configuration and never exposes secret values", () => {
    process.env = {
      SQUARE_ENVIRONMENT: "production",
      SQUARE_APPLICATION_ID: "sq0idp-app",
      SQUARE_APPLICATION_SECRET: "sq0csp-secret-value",
      SQUARE_ACCESS_TOKEN: "EAAAplatform-secret-token",
      SQUARE_LOCATION_ID: "LOC1",
      SQUARE_WEBHOOK_SIGNATURE_KEY: "sigkey-secret",
      SQUARE_WEBHOOK_URL: "https://demo.convex.site/square/webhook",
      SQUARE_PLATFORM_MERCHANT_ID: "MERCHANT_PLATFORM",
      SQUARE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      SQUARE_PLAN_VARIATION_STARTER_MONTHLY: "V1",
      SQUARE_PLAN_VARIATION_STARTER_ANNUAL: "V2",
      SQUARE_PLAN_VARIATION_PROFESSIONAL_MONTHLY: "V3",
      SQUARE_PLAN_VARIATION_PROFESSIONAL_ANNUAL: "V4",
      SQUARE_PLAN_VARIATION_BUSINESS_MONTHLY: "V5",
      SQUARE_PLAN_VARIATION_BUSINESS_ANNUAL: "V6",
      APP_URL: "https://app.example.com",
    };
    const status = getProviderConfigStatus().square;
    expect(status.missing).toEqual([]);
    expect(status.ready).toBe(true);
    expect(status.mode).toBe("live");
    const serialized = JSON.stringify(getProviderConfigStatus());
    expect(serialized).not.toContain("sq0csp-secret-value");
    expect(serialized).not.toContain("EAAAplatform-secret-token");
    expect(serialized).not.toContain("sigkey-secret");

    expect(squareBaseUrl()).toBe("https://connect.squareup.com");
    expect(requireSquarePlatformConfig()).toEqual({
      accessToken: "EAAAplatform-secret-token",
      locationId: "LOC1",
      merchantId: "MERCHANT_PLATFORM",
    });
    expect(requireSquareOAuthConfig().applicationId).toBe("sq0idp-app");

    process.env.SQUARE_TOKEN_ENCRYPTION_KEY = "short";
    expect(getProviderConfigStatus().square.ready).toBe(false);

    delete process.env.SQUARE_ACCESS_TOKEN;
    expect(() => requireSquarePlatformConfig()).toThrow(/SQUARE_ACCESS_TOKEN/);
  });

  it("defaults to sandbox and blocks sandbox in the production deployment", () => {
    process.env = { SQUARE_APPLICATION_ID: "a", SQUARE_APPLICATION_SECRET: "b" };
    expect(squareBaseUrl()).toBe("https://connect.squareupsandbox.com");
    expect(requireSquareOAuthConfig().applicationSecret).toBe("b");
    process.env.CONVEX_DEPLOYMENT_ENV = "production";
    expect(() => requireSquareOAuthConfig()).toThrow(/sandbox/);
    process.env.SQUARE_ALLOW_SANDBOX = "true";
    expect(requireSquareOAuthConfig().applicationId).toBe("a");
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
