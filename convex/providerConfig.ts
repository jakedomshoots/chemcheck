/**
 * Server-side provider configuration and health checks.
 *
 * Provider credentials are intentionally read only from Convex environment
 * variables. They are never stored in the application database or returned
 * to the client. The public status query returns only redacted readiness
 * information so the Settings screen can tell an owner what still needs to
 * be configured.
 */

import { v } from "convex/values";
import { action, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { validateEmail, validatePhone } from "./validation";
import { getAccessContext } from "./access";

export type ProviderName = "square" | "mailersend" | "twilio";

type ProviderState = {
  configured: boolean;
  ready: boolean;
  mode?: "live" | "test" | "unknown";
  missing: string[];
  message: string;
};

function env(name: string): string {
  return (process.env[name] || "").trim();
}

/** Bound third-party requests so a provider outage cannot hold a Convex action open indefinitely. */
export async function fetchProvider(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 15_000,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: init.signal || controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function validHttpUrl(value: string): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ||
      (parsed.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname));
  } catch {
    return false;
  }
}

/** Pinned Square API version sent on every request (Square-Version header). */
export const SQUARE_API_VERSION = "2025-10-16";

export type SquareEnvironment = "production" | "sandbox";

/** SQUARE_ENVIRONMENT: "production" or "sandbox" (default). */
export function squareEnvironment(): SquareEnvironment {
  return env("SQUARE_ENVIRONMENT").toLowerCase() === "production" ? "production" : "sandbox";
}

export function squareBaseUrl(environment: SquareEnvironment = squareEnvironment()): string {
  return environment === "production" ? "https://connect.squareup.com" : "https://connect.squareupsandbox.com";
}

/** Env var names of the Square subscription plan VARIATION ids, per plan and interval. */
export const SQUARE_PLAN_VARIATION_ENV_VARS = {
  starter: { month: "SQUARE_PLAN_VARIATION_STARTER_MONTHLY", year: "SQUARE_PLAN_VARIATION_STARTER_ANNUAL" },
  professional: { month: "SQUARE_PLAN_VARIATION_PROFESSIONAL_MONTHLY", year: "SQUARE_PLAN_VARIATION_PROFESSIONAL_ANNUAL" },
  business: { month: "SQUARE_PLAN_VARIATION_BUSINESS_MONTHLY", year: "SQUARE_PLAN_VARIATION_BUSINESS_ANNUAL" },
} as const;

const SQUARE_REQUIRED_ENV = [
  "SQUARE_APPLICATION_ID",
  "SQUARE_APPLICATION_SECRET",
  "SQUARE_ACCESS_TOKEN",
  "SQUARE_LOCATION_ID",
  "SQUARE_WEBHOOK_SIGNATURE_KEY",
  "SQUARE_WEBHOOK_URL",
  "SQUARE_PLATFORM_MERCHANT_ID",
  "SQUARE_TOKEN_ENCRYPTION_KEY",
] as const;

function sandboxBlockedInProduction(): boolean {
  return squareEnvironment() === "sandbox"
    && env("CONVEX_DEPLOYMENT_ENV") === "production"
    && env("SQUARE_ALLOW_SANDBOX") !== "true";
}

function validEncryptionKey(value: string): boolean {
  try {
    return atob(value).length === 32;
  } catch {
    return false;
  }
}

function squareState(): ProviderState {
  const missing: string[] = [];
  for (const name of SQUARE_REQUIRED_ENV) {
    if (!env(name)) missing.push(name);
  }
  const webhookUrl = env("SQUARE_WEBHOOK_URL");
  if (webhookUrl && !validHttpUrl(webhookUrl)) missing.push("SQUARE_WEBHOOK_URL (must be https)");
  const encryptionKey = env("SQUARE_TOKEN_ENCRYPTION_KEY");
  if (encryptionKey && !validEncryptionKey(encryptionKey)) {
    missing.push("SQUARE_TOKEN_ENCRYPTION_KEY (must be 32 random bytes, base64)");
  }
  for (const intervals of Object.values(SQUARE_PLAN_VARIATION_ENV_VARS)) {
    for (const name of Object.values(intervals)) {
      if (!env(name)) missing.push(name);
    }
  }
  const appUrl = env("APP_URL");
  if (!appUrl) missing.push("APP_URL");
  else if (!validHttpUrl(appUrl)) missing.push("APP_URL (must be https)");
  if (sandboxBlockedInProduction()) missing.push("SQUARE_ENVIRONMENT (sandbox disabled in production)");

  const mode = squareEnvironment() === "production" ? "live" : "test";
  const configured = Boolean(env("SQUARE_APPLICATION_ID") || env("SQUARE_ACCESS_TOKEN"));
  const ready = missing.length === 0;
  return {
    configured,
    ready,
    mode,
    missing,
    message: ready
      ? `Square ${mode === "live" ? "production" : "sandbox"} is ready`
      : configured
        ? "Square is partially configured"
        : "Square is not configured",
  };
}

function mailersendState(): ProviderState {
  const apiKey = env("MAILERSEND_API_KEY");
  const fromEmail = env("FROM_EMAIL");
  const missing: string[] = [];

  if (!apiKey) missing.push("MAILERSEND_API_KEY");
  if (!fromEmail) missing.push("FROM_EMAIL");
  else {
    try {
      if (!validateEmail(fromEmail)) missing.push("FROM_EMAIL (invalid email)");
    } catch {
      missing.push("FROM_EMAIL (invalid email)");
    }
  }

  const ready = missing.length === 0;
  return {
    configured: Boolean(apiKey),
    ready,
    missing,
    message: ready ? "Mailersend email is ready" : "Mailersend email is not ready",
  };
}

function twilioState(): ProviderState {
  const sid = env("TWILIO_ACCOUNT_SID");
  const token = env("TWILIO_AUTH_TOKEN");
  const fromNumber = env("TWILIO_FROM_NUMBER");
  const missing: string[] = [];

  if (!sid) missing.push("TWILIO_ACCOUNT_SID");
  if (!token) missing.push("TWILIO_AUTH_TOKEN");
  if (!fromNumber) missing.push("TWILIO_FROM_NUMBER");
  else {
    try {
      if (!validatePhone(fromNumber) || !fromNumber.startsWith("+")) {
        missing.push("TWILIO_FROM_NUMBER (must be E.164)");
      }
    } catch {
      missing.push("TWILIO_FROM_NUMBER (invalid phone)");
    }
  }

  const ready = missing.length === 0;
  return {
    configured: Boolean(sid && token),
    ready,
    missing,
    message: ready ? "Twilio SMS is ready" : "Twilio SMS is not ready",
  };
}

export function getProviderConfigStatus() {
  return {
    square: squareState(),
    mailersend: mailersendState(),
    twilio: twilioState(),
    checked_at: Date.now(),
  };
}

/** Platform (ChemCheck owner) Square account used for subscription billing. */
export function requireSquarePlatformConfig(): { accessToken: string; locationId: string; merchantId: string } {
  const accessToken = env("SQUARE_ACCESS_TOKEN");
  const locationId = env("SQUARE_LOCATION_ID");
  const merchantId = env("SQUARE_PLATFORM_MERCHANT_ID");
  if (!accessToken || !locationId || !merchantId) {
    throw new Error("Square billing is not configured. Set SQUARE_ACCESS_TOKEN, SQUARE_LOCATION_ID and SQUARE_PLATFORM_MERCHANT_ID in Convex environment variables.");
  }
  if (sandboxBlockedInProduction()) {
    throw new Error("Square sandbox is disabled in the production deployment.");
  }
  return { accessToken, locationId, merchantId };
}

/** Square application credentials used for seller OAuth. */
export function requireSquareOAuthConfig(): { applicationId: string; applicationSecret: string; redirectUrl?: string } {
  const applicationId = env("SQUARE_APPLICATION_ID");
  const applicationSecret = env("SQUARE_APPLICATION_SECRET");
  if (!applicationId || !applicationSecret) {
    throw new Error("Square is not configured. Set SQUARE_APPLICATION_ID and SQUARE_APPLICATION_SECRET in Convex environment variables.");
  }
  if (sandboxBlockedInProduction()) {
    throw new Error("Square sandbox is disabled in the production deployment.");
  }
  return { applicationId, applicationSecret, redirectUrl: env("SQUARE_OAUTH_REDIRECT_URL") || undefined };
}

export function requireMailersendConfig(): { apiKey: string; fromEmail: string } {
  const apiKey = env("MAILERSEND_API_KEY");
  const fromEmail = env("FROM_EMAIL");
  if (!apiKey || !fromEmail) {
    throw new Error("Email provider is not configured. Set MAILERSEND_API_KEY and FROM_EMAIL in Convex environment variables.");
  }
  try {
    if (!validateEmail(fromEmail)) throw new Error("invalid");
  } catch {
    throw new Error("FROM_EMAIL must be a valid, verified sender address.");
  }
  return { apiKey, fromEmail };
}

export function requireTwilioConfig(): { accountSid: string; authToken: string; fromNumber: string } {
  const accountSid = env("TWILIO_ACCOUNT_SID");
  const authToken = env("TWILIO_AUTH_TOKEN");
  const fromNumber = env("TWILIO_FROM_NUMBER");
  if (!accountSid || !authToken || !fromNumber) {
    throw new Error("SMS provider is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER in Convex environment variables.");
  }
  try {
    if (!validatePhone(fromNumber) || !fromNumber.startsWith("+")) throw new Error("invalid");
  } catch {
    throw new Error("TWILIO_FROM_NUMBER must be an E.164 phone number (for example, +15551234567).");
  }
  return { accountSid, authToken, fromNumber };
}

async function providerRequest(provider: ProviderName): Promise<{ ok: boolean; message: string }> {
  if (provider === "square") {
    const { accessToken, locationId } = requireSquarePlatformConfig();
    const response = await fetchProvider(`${squareBaseUrl()}/v2/locations`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Square-Version": SQUARE_API_VERSION,
        "Content-Type": "application/json",
      },
    });
    if (!response.ok) return { ok: false, message: `Square rejected the platform access token (${response.status})` };
    const data: any = await response.json().catch(() => null);
    const locations: any[] = Array.isArray(data?.locations) ? data.locations : [];
    if (!locations.some((location) => location?.id === locationId)) {
      return { ok: false, message: "SQUARE_LOCATION_ID is not a location of the platform Square account" };
    }
    return { ok: true, message: "Square credentials are valid" };
  }

  if (provider === "mailersend") {
    const { apiKey } = requireMailersendConfig();
    const response = await fetchProvider("https://api.mailersend.com/v1/domains?limit=1", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) return { ok: false, message: `Mailersend rejected the credentials (${response.status})` };
    return { ok: true, message: "Mailersend credentials are valid" };
  }

  const { accountSid, authToken } = requireTwilioConfig();
  const response = await fetchProvider(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}.json`, {
    headers: { Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}` },
  });
  if (!response.ok) return { ok: false, message: `Twilio rejected the credentials (${response.status})` };
  return { ok: true, message: "Twilio credentials are valid" };
}

export const getStatus = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    return getProviderConfigStatus();
  },
});

/** Provider tests can make outbound requests, so only business owners/admins may run them. */
export const canManageProviders = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const { role } = await getAccessContext(ctx, args.email);
    return role === "owner" || role === "admin";
  },
});

export const test = action({
  args: { provider: v.union(v.literal("square"), v.literal("mailersend"), v.literal("twilio")) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    if (!identity.email) throw new Error("Authenticated account is missing an email address.");
    const canManage = await ctx.runQuery(internal.providerConfig.canManageProviders, {
      email: identity.email,
    });
    if (!canManage) throw new Error("Only business owners and admins can test provider connections.");
    try {
      return { provider: args.provider, ...(await providerRequest(args.provider)) };
    } catch (error) {
      return {
        provider: args.provider,
        ok: false,
        message: error instanceof Error ? error.message : "Provider configuration is invalid",
      };
    }
  },
});
