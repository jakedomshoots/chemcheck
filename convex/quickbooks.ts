/**
 * QuickBooks Online: OAuth2 connection lifecycle.
 *
 * Config comes only from Convex environment variables:
 *   QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_REDIRECT_URI,
 *   QBO_ENVIRONMENT ('sandbox' | 'production'), SITE_URL (app origin for the
 *   post-callback redirect), and optionally QBO_TOKEN_ENCRYPTION_KEY (any
 *   long secret; tokens are sealed with AES-GCM when set) and
 *   QBO_STATE_SECRET (HMAC key for the OAuth state; defaults to the client
 *   secret).
 *
 * Tokens are never returned to clients and never logged.
 */
/// <reference types="node" />
import { v } from "convex/values";
import { action, httpAction, internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { fetchProvider } from "./providerConfig";
import { findActiveMembership, normalizeEmail, resolveBusinessForEmail } from "./entitlements";

type DbCtx = Pick<MutationCtx | QueryCtx, "db">;

export type QboEnvironment = "sandbox" | "production";

export interface QboConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  environment: QboEnvironment;
  stateSecret: string;
  encryptionKey?: string;
  siteUrl: string;
}

export const QBO_AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
export const QBO_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
export const QBO_REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";
export const QBO_SCOPE = "com.intuit.quickbooks.accounting";
export const STATE_TTL_MS = 10 * 60 * 1000;
const MANAGER_ROLES = new Set(["owner", "admin"]);

function env(name: string, source: Record<string, string | undefined> = process.env): string {
  return (source[name] || "").trim();
}

export function readQboConfig(source: Record<string, string | undefined> = process.env): { config: QboConfig | null; missing: string[] } {
  const missing: string[] = [];
  const clientId = env("QBO_CLIENT_ID", source);
  const clientSecret = env("QBO_CLIENT_SECRET", source);
  const redirectUri = env("QBO_REDIRECT_URI", source);
  const environmentRaw = (env("QBO_ENVIRONMENT", source) || "sandbox").toLowerCase();
  const siteUrl = (env("SITE_URL", source) || env("APP_URL", source)).replace(/\/+$/, "");
  if (!clientId) missing.push("QBO_CLIENT_ID");
  if (!clientSecret) missing.push("QBO_CLIENT_SECRET");
  if (!redirectUri) missing.push("QBO_REDIRECT_URI");
  else {
    try {
      const parsed = new URL(redirectUri);
      if (parsed.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(parsed.hostname)) {
        missing.push("QBO_REDIRECT_URI (must be https)");
      }
    } catch {
      missing.push("QBO_REDIRECT_URI (invalid URL)");
    }
  }
  if (environmentRaw !== "sandbox" && environmentRaw !== "production") missing.push("QBO_ENVIRONMENT (sandbox|production)");
  if (!siteUrl) missing.push("SITE_URL");
  if (missing.length > 0) return { config: null, missing };
  return {
    config: {
      clientId,
      clientSecret,
      redirectUri,
      environment: environmentRaw as QboEnvironment,
      stateSecret: env("QBO_STATE_SECRET", source) || clientSecret,
      encryptionKey: env("QBO_TOKEN_ENCRYPTION_KEY", source) || undefined,
      siteUrl,
    },
    missing,
  };
}

export function requireQboConfig(): QboConfig {
  const { config, missing } = readQboConfig();
  if (!config) throw new Error(`QuickBooks is not configured. Missing: ${missing.join(", ")}.`);
  return config;
}

export function qboApiBase(environment: QboEnvironment): string {
  return environment === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
}

export function qboCompanyUrl(environment: QboEnvironment): string {
  return environment === "production"
    ? "https://app.qbo.intuit.com/app/homepage"
    : "https://app.sandbox.qbo.intuit.com/app/homepage";
}

// ============================================
// Encoding + crypto helpers (Web Crypto; works in Convex and Node tests)
// ============================================

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export interface OAuthState {
  /** business id */
  b: string;
  /** connecting user's email */
  e: string;
  /** nonce */
  n: string;
  /** expiry (ms) */
  x: number;
}

/** state = base64url(payload).base64url(HMAC-SHA256(payload)) — bound to business + user, short-lived. */
export async function signState(payload: OAuthState, secret: string): Promise<string> {
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(body)));
  return `${body}.${toBase64Url(signature)}`;
}

export async function verifyState(state: string | null | undefined, secret: string, now = Date.now()): Promise<OAuthState | null> {
  if (!state || typeof state !== "string") return null;
  const parts = state.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  try {
    const key = await hmacKey(secret);
    const valid = await crypto.subtle.verify("HMAC", key, fromBase64Url(parts[1]), encoder.encode(parts[0]));
    if (!valid) return null;
    const payload = JSON.parse(decoder.decode(fromBase64Url(parts[0]))) as OAuthState;
    if (!payload || typeof payload.b !== "string" || typeof payload.e !== "string" || typeof payload.x !== "number") return null;
    if (payload.x < now) return null;
    return payload;
  } catch {
    return null;
  }
}

async function aesKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return await crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/** Seal a token for storage. Without an encryption key the value is tagged but stored as-is. */
export async function sealSecret(plain: string, encryptionKey?: string): Promise<string> {
  if (!encryptionKey) return `plain:${plain}`;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await aesKey(encryptionKey);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(plain)));
  return `v1:${toBase64Url(iv)}:${toBase64Url(ciphertext)}`;
}

export async function openSecret(sealed: string, encryptionKey?: string): Promise<string> {
  if (sealed.startsWith("plain:")) return sealed.slice("plain:".length);
  if (!sealed.startsWith("v1:")) throw new Error("Unrecognized sealed token format.");
  if (!encryptionKey) throw new Error("QBO_TOKEN_ENCRYPTION_KEY is required to read the stored QuickBooks tokens.");
  const [, ivText, ctText] = sealed.split(":");
  const key = await aesKey(encryptionKey);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64Url(ivText) }, key, fromBase64Url(ctText));
  return decoder.decode(plain);
}

// ============================================
// Intuit OAuth endpoints
// ============================================

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  x_refresh_token_expires_in: number;
}

function basicAuth(config: QboConfig): string {
  return `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`;
}

async function tokenRequest(config: QboConfig, form: URLSearchParams): Promise<TokenResponse> {
  const response = await fetchProvider(QBO_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuth(config),
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  let data: any = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok || !data?.access_token || !data?.refresh_token) {
    // Never include the response body: it could echo tokens.
    const reason = typeof data?.error === "string" ? data.error : `HTTP ${response.status}`;
    throw new Error(`QuickBooks token request failed (${reason}).`);
  }
  return {
    access_token: String(data.access_token),
    refresh_token: String(data.refresh_token),
    expires_in: Number(data.expires_in) || 3600,
    x_refresh_token_expires_in: Number(data.x_refresh_token_expires_in) || 100 * 24 * 3600,
  };
}

export async function exchangeCodeForTokens(config: QboConfig, code: string): Promise<TokenResponse> {
  const form = new URLSearchParams();
  form.set("grant_type", "authorization_code");
  form.set("code", code);
  form.set("redirect_uri", config.redirectUri);
  return await tokenRequest(config, form);
}

export async function refreshAccessToken(config: QboConfig, refreshToken: string): Promise<TokenResponse> {
  const form = new URLSearchParams();
  form.set("grant_type", "refresh_token");
  form.set("refresh_token", refreshToken);
  return await tokenRequest(config, form);
}

export async function revokeToken(config: QboConfig, token: string): Promise<boolean> {
  try {
    const response = await fetchProvider(QBO_REVOKE_URL, {
      method: "POST",
      headers: { Authorization: basicAuth(config), Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function buildAuthorizeUrl(config: QboConfig, state: string): string {
  const url = new URL(QBO_AUTH_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", QBO_SCOPE);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

/** Where the browser lands after the OAuth callback: the Integrations section of Settings. */
export function buildSettingsRedirect(siteUrl: string, result: { ok: boolean; error?: string }): string {
  const url = new URL("/settings", siteUrl || "https://app.chemcheck.app");
  url.searchParams.set("section", "integrations");
  url.searchParams.set("quickbooks", result.ok ? "connected" : "error");
  if (!result.ok && result.error) url.searchParams.set("reason", result.error.slice(0, 120));
  return url.toString();
}

/** Owner or admin of the caller's business, or null. */
export async function managedBusinessFor(ctx: DbCtx, email: string): Promise<Doc<"businesses"> | null> {
  const business = await resolveBusinessForEmail(ctx, email);
  if (!business) return null;
  if (normalizeEmail(business.owner_email) === normalizeEmail(email)) return business;
  const membership = await findActiveMembership(ctx, email, business._id);
  return membership && MANAGER_ROLES.has(String(membership.role)) ? business : null;
}

export async function findConnectionForBusiness(ctx: DbCtx, businessId: Id<"businesses">): Promise<Doc<"quickbooksConnections"> | null> {
  return await ctx.db
    .query("quickbooksConnections")
    .withIndex("by_business", (q) => q.eq("business_id", businessId))
    .first();
}

// ============================================
// Internal plumbing (actions have no ctx.db)
// ============================================

export const canManageQuickBooks = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const business = await managedBusinessFor(ctx, args.email);
    return business ? { business_id: business._id } : null;
  },
});

/** Full connection row INCLUDING sealed tokens. Internal only; never expose through a public function. */
export const getConnectionInternal = internalQuery({
  args: { business_id: v.id("businesses") },
  handler: async (ctx, args) => await findConnectionForBusiness(ctx, args.business_id),
});

export const storeConnection = internalMutation({
  args: {
    business_id: v.id("businesses"),
    realm_id: v.string(),
    access_token: v.string(),
    refresh_token: v.string(),
    access_expires_at: v.number(),
    refresh_expires_at: v.number(),
    environment: v.string(),
    connected_by: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await findConnectionForBusiness(ctx, args.business_id);
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        realm_id: args.realm_id,
        access_token: args.access_token,
        refresh_token: args.refresh_token,
        access_expires_at: args.access_expires_at,
        refresh_expires_at: args.refresh_expires_at,
        environment: args.environment,
        connected_by: args.connected_by,
        connected_at: now,
        last_error: undefined,
        // Links belong to a realm; a different company invalidates them.
        default_item_id: existing.realm_id === args.realm_id ? existing.default_item_id : undefined,
      });
      if (existing.realm_id !== args.realm_id) {
        const links = await ctx.db
          .query("quickbooksLinks")
          .withIndex("by_business_and_entity", (q) => q.eq("business_id", args.business_id))
          .take(2000);
        for (const link of links) await ctx.db.delete(link._id);
      }
      return existing._id;
    }
    return await ctx.db.insert("quickbooksConnections", {
      business_id: args.business_id,
      realm_id: args.realm_id,
      access_token: args.access_token,
      refresh_token: args.refresh_token,
      access_expires_at: args.access_expires_at,
      refresh_expires_at: args.refresh_expires_at,
      environment: args.environment,
      connected_by: args.connected_by,
      connected_at: now,
    });
  },
});

export const updateTokens = internalMutation({
  args: {
    connection_id: v.id("quickbooksConnections"),
    access_token: v.string(),
    refresh_token: v.string(),
    access_expires_at: v.number(),
    refresh_expires_at: v.number(),
  },
  handler: async (ctx, args) => {
    const { connection_id, ...fields } = args;
    await ctx.db.patch(connection_id, { ...fields, last_error: undefined });
  },
});

export const recordConnectionState = internalMutation({
  args: {
    connection_id: v.id("quickbooksConnections"),
    last_error: v.optional(v.string()),
    last_sync_at: v.optional(v.number()),
    default_item_id: v.optional(v.string()),
    clear_error: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = {};
    if (args.clear_error) patch.last_error = undefined;
    if (args.last_error !== undefined) patch.last_error = args.last_error.slice(0, 500);
    if (args.last_sync_at !== undefined) patch.last_sync_at = args.last_sync_at;
    if (args.default_item_id !== undefined) patch.default_item_id = args.default_item_id;
    await ctx.db.patch(args.connection_id, patch);
  },
});

export const deleteConnection = internalMutation({
  args: { business_id: v.id("businesses") },
  handler: async (ctx, args) => {
    const existing = await findConnectionForBusiness(ctx, args.business_id);
    if (existing) await ctx.db.delete(existing._id);
    return Boolean(existing);
  },
});

// ============================================
// Public API
// ============================================

export const getStatus = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) throw new Error("Not authenticated");
    const { config, missing } = readQboConfig();
    const business = await resolveBusinessForEmail(ctx, identity.email);
    const managed = business ? await managedBusinessFor(ctx, identity.email) : null;
    const connection = business ? await findConnectionForBusiness(ctx, business._id) : null;

    const counts = { customer: 0, invoice: 0, payment: 0 };
    if (business && connection) {
      for (const entity of ["customer", "invoice", "payment"] as const) {
        const links = await ctx.db
          .query("quickbooksLinks")
          .withIndex("by_business_and_entity", (q) => q.eq("business_id", business._id).eq("entity_type", entity))
          .take(1000);
        counts[entity] = links.length;
      }
    }

    const environment = (connection?.environment as QboEnvironment | undefined) ?? config?.environment ?? "sandbox";
    return {
      configured: Boolean(config),
      missing,
      can_manage: Boolean(managed),
      connected: Boolean(connection),
      realm_id: connection?.realm_id ?? null,
      environment,
      connected_at: connection?.connected_at ?? null,
      connected_by: connection?.connected_by ?? null,
      last_sync_at: connection?.last_sync_at ?? null,
      last_error: connection?.last_error ?? null,
      refresh_expires_at: connection?.refresh_expires_at ?? null,
      auto_sync: business?.settings?.quickbooks_auto_sync !== false,
      company_url: qboCompanyUrl(environment),
      counts,
    };
  },
});

export const getAuthorizeUrl = action({
  args: {},
  handler: async (ctx): Promise<{ url: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) throw new Error("Not authenticated");
    const config = requireQboConfig();
    const managed: { business_id: Id<"businesses"> } | null = await ctx.runQuery(internal.quickbooks.canManageQuickBooks, { email: identity.email });
    if (!managed) throw new Error("Only business owners and admins can connect QuickBooks.");
    const state = await signState(
      { b: String(managed.business_id), e: normalizeEmail(identity.email), n: crypto.randomUUID(), x: Date.now() + STATE_TTL_MS },
      config.stateSecret,
    );
    return { url: buildAuthorizeUrl(config, state) };
  },
});

/** Exchange the OAuth code and persist sealed tokens. Called only from the HTTP callback route. */
export const handleCallback = internalAction({
  args: {
    code: v.optional(v.string()),
    state: v.optional(v.string()),
    realm_id: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ ok: boolean; error?: string }> => {
    const { config } = readQboConfig();
    if (!config) return { ok: false, error: "not_configured" };
    if (args.error) return { ok: false, error: args.error === "access_denied" ? "access_denied" : "provider_error" };
    const state = await verifyState(args.state, config.stateSecret);
    if (!state) return { ok: false, error: "invalid_state" };
    if (!args.code || !args.realm_id) return { ok: false, error: "missing_code" };
    try {
      const tokens = await exchangeCodeForTokens(config, args.code);
      const now = Date.now();
      await ctx.runMutation(internal.quickbooks.storeConnection, {
        business_id: state.b as Id<"businesses">,
        realm_id: args.realm_id,
        access_token: await sealSecret(tokens.access_token, config.encryptionKey),
        refresh_token: await sealSecret(tokens.refresh_token, config.encryptionKey),
        access_expires_at: now + tokens.expires_in * 1000,
        refresh_expires_at: now + tokens.x_refresh_token_expires_in * 1000,
        environment: config.environment,
        connected_by: state.e,
      });
      return { ok: true };
    } catch (error) {
      console.error("[quickbooks] callback failed", error instanceof Error ? error.message : "unknown error");
      return { ok: false, error: "token_exchange_failed" };
    }
  },
});

/** GET /quickbooks/callback — Intuit redirects here with code, state and realmId. */
export const quickbooksCallback = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const result: { ok: boolean; error?: string } = await ctx.runAction(internal.quickbooks.handleCallback, {
    code: url.searchParams.get("code") ?? undefined,
    state: url.searchParams.get("state") ?? undefined,
    realm_id: url.searchParams.get("realmId") ?? undefined,
    error: url.searchParams.get("error") ?? undefined,
  });
  const { config } = readQboConfig();
  return Response.redirect(buildSettingsRedirect(config?.siteUrl ?? (process.env.SITE_URL || process.env.APP_URL || ""), result), 302);
});

/** Refresh the access token (also used by the sync client when a token is near expiry). */
export const refresh = action({
  args: {},
  handler: async (ctx): Promise<{ ok: boolean; access_expires_at?: number; error?: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) throw new Error("Not authenticated");
    const managed: { business_id: Id<"businesses"> } | null = await ctx.runQuery(internal.quickbooks.canManageQuickBooks, { email: identity.email });
    if (!managed) throw new Error("Only business owners and admins can manage QuickBooks.");
    const config = requireQboConfig();
    const connection: Doc<"quickbooksConnections"> | null = await ctx.runQuery(internal.quickbooks.getConnectionInternal, { business_id: managed.business_id });
    if (!connection) return { ok: false, error: "QuickBooks is not connected." };
    try {
      const refreshed = await refreshConnectionTokens(ctx, config, connection);
      return { ok: true, access_expires_at: refreshed.access_expires_at };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Refresh failed";
      await ctx.runMutation(internal.quickbooks.recordConnectionState, { connection_id: connection._id, last_error: message });
      return { ok: false, error: message };
    }
  },
});

/** Refresh + persist tokens for a connection. Returns the plaintext access token for immediate use. */
export async function refreshConnectionTokens(
  ctx: { runMutation: (ref: any, args: any) => Promise<any> },
  config: QboConfig,
  connection: Doc<"quickbooksConnections">,
): Promise<{ access_token: string; access_expires_at: number }> {
  const refreshToken = await openSecret(connection.refresh_token, config.encryptionKey);
  const tokens = await refreshAccessToken(config, refreshToken);
  const now = Date.now();
  const accessExpiresAt = now + tokens.expires_in * 1000;
  await ctx.runMutation(internal.quickbooks.updateTokens, {
    connection_id: connection._id,
    access_token: await sealSecret(tokens.access_token, config.encryptionKey),
    refresh_token: await sealSecret(tokens.refresh_token, config.encryptionKey),
    access_expires_at: accessExpiresAt,
    refresh_expires_at: now + tokens.x_refresh_token_expires_in * 1000,
  });
  return { access_token: tokens.access_token, access_expires_at: accessExpiresAt };
}

export const disconnect = action({
  args: {},
  handler: async (ctx): Promise<{ ok: boolean }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) throw new Error("Not authenticated");
    const managed: { business_id: Id<"businesses"> } | null = await ctx.runQuery(internal.quickbooks.canManageQuickBooks, { email: identity.email });
    if (!managed) throw new Error("Only business owners and admins can disconnect QuickBooks.");
    const connection: Doc<"quickbooksConnections"> | null = await ctx.runQuery(internal.quickbooks.getConnectionInternal, { business_id: managed.business_id });
    if (connection) {
      const { config } = readQboConfig();
      if (config) {
        try {
          await revokeToken(config, await openSecret(connection.refresh_token, config.encryptionKey));
        } catch {
          // Best effort: the row is removed regardless so the app forgets the tokens.
        }
      }
      await ctx.runMutation(internal.quickbooks.deleteConnection, { business_id: managed.business_id });
    }
    return { ok: true };
  },
});
