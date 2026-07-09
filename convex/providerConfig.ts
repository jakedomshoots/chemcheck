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

export type ProviderName = "stripe" | "mailersend" | "twilio";

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

function stripeState(): ProviderState {
  const key = env("STRIPE_SECRET_KEY");
  const webhookSecret = env("STRIPE_WEBHOOK_SECRET");
  const appUrl = env("APP_URL");
  const missing: string[] = [];

  if (!key) missing.push("STRIPE_SECRET_KEY");
  else if (!/^sk_(live|test)_[A-Za-z0-9]+$/.test(key)) missing.push("STRIPE_SECRET_KEY (invalid format)");
  else if (key.startsWith("sk_test_") && env("CONVEX_DEPLOYMENT_ENV") === "production" && env("STRIPE_ALLOW_TEST_MODE") !== "true") {
    missing.push("STRIPE_SECRET_KEY (test key disabled in production)");
  }
  if (!webhookSecret) missing.push("STRIPE_WEBHOOK_SECRET");
  else if (!/^whsec_[A-Za-z0-9]+$/.test(webhookSecret)) missing.push("STRIPE_WEBHOOK_SECRET (invalid format)");
  if (!appUrl) missing.push("APP_URL");
  else if (!validHttpUrl(appUrl)) missing.push("APP_URL (must be https)");

  const mode = key.startsWith("sk_live_") ? "live" : key.startsWith("sk_test_") ? "test" : "unknown";
  const configured = Boolean(key);
  const ready = missing.length === 0;
  return {
    configured,
    ready,
    mode,
    missing,
    message: ready
      ? `Stripe ${mode} mode is ready`
      : configured
        ? "Stripe is partially configured"
        : "Stripe is not configured",
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
    stripe: stripeState(),
    mailersend: mailersendState(),
    twilio: twilioState(),
    checked_at: Date.now(),
  };
}

export function requireStripeConfig(): { secretKey: string; webhookSecret?: string } {
  const key = env("STRIPE_SECRET_KEY");
  if (!/^sk_(live|test)_[A-Za-z0-9]+$/.test(key)) {
    throw new Error("Stripe is not configured. Set a valid STRIPE_SECRET_KEY in Convex environment variables.");
  }
  if (key.startsWith("sk_test_") && env("CONVEX_DEPLOYMENT_ENV") === "production" && env("STRIPE_ALLOW_TEST_MODE") !== "true") {
    throw new Error("Test Stripe keys are disabled in the production deployment.");
  }
  return {
    secretKey: key,
    webhookSecret: env("STRIPE_WEBHOOK_SECRET") || undefined,
  };
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
  if (provider === "stripe") {
    const { secretKey } = requireStripeConfig();
    const response = await fetchProvider("https://api.stripe.com/v1/account", {
      headers: { Authorization: `Bearer ${secretKey}` },
    });
    if (!response.ok) return { ok: false, message: `Stripe rejected the credentials (${response.status})` };
    return { ok: true, message: "Stripe credentials are valid" };
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
    const ownerBusiness = await ctx.db
      .query("businesses")
      .withIndex("by_owner_email", (q) => q.eq("owner_email", args.email))
      .first();
    if (ownerBusiness) return true;

    const membership = await ctx.db
      .query("team_members")
      .withIndex("by_user_email", (q) => q.eq("user_email", args.email))
      .filter((q) => q.eq(q.field("is_active"), true))
      .first();
    return membership?.role === "owner" || membership?.role === "admin";
  },
});

export const test = action({
  args: { provider: v.union(v.literal("stripe"), v.literal("mailersend"), v.literal("twilio")) },
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
