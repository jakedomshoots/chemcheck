/**
 * Square seller OAuth for pool-company customer payments.
 *
 * Each pool company connects ITS OWN Square seller account through Square
 * OAuth. Invoice and quote-deposit payment links are created on that seller's
 * account with the seller's OAuth access token, so the money lands directly in
 * the pool company's Square balance, never in the ChemCheck platform account.
 * The platform may take an optional app fee (PLATFORM_FEE_BPS).
 *
 * Security:
 * - OAuth `state` is random, single-use, expires after 10 minutes and is bound
 *   server-side to the business and the owner/admin who started the flow.
 * - Tokens are encrypted at rest (AES-256-GCM, SQUARE_TOKEN_ENCRYPTION_KEY) in
 *   the internal-only `squareSellerAccounts` table; no public query returns them.
 * - Merchant and location ids are only ever read from that table (written by
 *   the OAuth callback). Clients never supply them.
 * - Only business owners/admins can connect or disconnect.
 */

import { v } from "convex/values";
import {
  type ActionCtx,
  action,
  httpAction,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { requireSquareOAuthConfig } from "./providerConfig";
import { getAccessContext, resolveBusinessForUser } from "./access";
import { enforceRateLimit } from "./rateLimit";
import { appBaseUrl, parsePlatformFeeBps } from "./paymentMatching";
import { scopesNeedReconnect } from "./ticketLogic";
import {
  CONNECT_REQUIRED_MESSAGE,
  ON_DEMAND_REFRESH_WINDOW_MS,
  OAUTH_STATE_TTL_MS,
  REFRESH_WINDOW_MS,
  buildAuthorizeUrl,
  decryptSecret,
  encryptSecret,
  generateStateToken,
  isWellFormedState,
  maskMerchantId,
  parseTokenResponse,
  selectSquareLocation,
  sellerOAuthScopes,
  shouldRefreshToken,
  squareBaseUrl,
  squareRequest,
  validateOAuthState,
} from "./squareApi";

const MANAGER_ROLES = new Set(["owner", "admin"]);
const MANAGE_DENIED = "Only business owners and admins can manage Square payments.";

export function settingsReturnUrl(result: "return" | "error", reason?: string): string {
  const params = new URLSearchParams({ square_connect: result });
  if (reason) params.set("reason", reason);
  return `${appBaseUrl()}/settings?${params.toString()}#integrations`;
}

async function requireManager(ctx: any, email: string) {
  const access = await getAccessContext(ctx, email);
  if (!access.business) throw new Error("No business found for this account.");
  if (!access.role || !MANAGER_ROLES.has(access.role)) throw new Error(MANAGE_DENIED);
  return access;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type SquareConnectState = "not_connected" | "connected" | "needs_reconnect";

export function deriveSquareConnectState(
  account: { expires_at?: number; location_id?: string; last_refresh_error?: string } | null | undefined,
  now: number,
): SquareConnectState {
  if (!account) return "not_connected";
  if (!account.location_id) return "needs_reconnect";
  if (typeof account.expires_at === "number" && account.expires_at <= now) return "needs_reconnect";
  return "connected";
}

/**
 * Work tickets need the Customers/Invoices scopes. Connections made before
 * those scopes were requested must reconnect (a new OAuth grant); everything
 * else about them keeps working.
 */
export function connectionNeedsReconnect(
  account: { expires_at?: number; location_id?: string; scopes?: string } | null | undefined,
  now: number,
): boolean {
  if (!account) return false;
  return deriveSquareConnectState(account, now) === "needs_reconnect" || scopesNeedReconnect(account.scopes);
}

/** Redacted connection status. Never returns tokens. */
export const getSquareConnectStatus = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) return null;
    const access = await getAccessContext(ctx, identity.email);
    if (!access.business) return null;
    const account = await ctx.db
      .query("squareSellerAccounts")
      .withIndex("by_business", (q) => q.eq("business_id", access.business._id))
      .first();
    const now = Date.now();
    const state = deriveSquareConnectState(account, now);
    return {
      state,
      connected: Boolean(account),
      // Additive: true when the stored grant lacks a scope work tickets need.
      needs_reconnect: connectionNeedsReconnect(account, now),
      merchant_id: maskMerchantId(account?.merchant_id),
      location_name: account?.location_name ?? null,
      updated_at: account?.updated_at ?? null,
      can_manage: Boolean(access.role && MANAGER_ROLES.has(access.role)),
    };
  },
});

/** Starts Square OAuth: returns the Square authorize URL with a fresh single-use state. */
export const createAuthorizeUrl = mutation({
  args: {},
  handler: async (ctx): Promise<{ url: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    if (!identity.email) throw new Error("Authenticated account is missing an email address.");
    await enforceRateLimit(ctx, identity.email, "square.connect");
    const access = await requireManager(ctx, identity.email);
    const { applicationId, redirectUrl } = requireSquareOAuthConfig();
    if (!process.env.SQUARE_TOKEN_ENCRYPTION_KEY) {
      throw new Error("Square is not fully configured (SQUARE_TOKEN_ENCRYPTION_KEY is missing).");
    }

    const now = Date.now();
    const state = generateStateToken();
    await ctx.db.insert("squareOAuthStates", {
      state,
      business_id: access.business._id,
      user_email: identity.email,
      expires_at: now + OAUTH_STATE_TTL_MS,
      created_at: now,
    });

    return {
      url: buildAuthorizeUrl({
        baseUrl: squareBaseUrl(),
        applicationId,
        state,
        redirectUrl,
        scopes: sellerOAuthScopes(parsePlatformFeeBps(process.env.PLATFORM_FEE_BPS) > 0),
      }),
    };
  },
});

/** Re-checks the connection: refreshes the token if needed and re-reads the location. */
export const refreshConnection = action({
  args: {},
  handler: async (ctx): Promise<{ state: SquareConnectState }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) throw new Error("Not authenticated");
    await ctx.runMutation(internal.squareConnect.consumeRateLimit, { user_email: identity.email, action: "square.connect" });
    const businessId = await ctx.runQuery(internal.squareConnect.getManagedBusinessId, { user_email: identity.email });
    const account = await ctx.runQuery(internal.squareConnect.getSellerAccountByBusiness, { business_id: businessId });
    if (!account) return { state: "not_connected" };
    const accessToken = await ensureFreshToken(ctx, account, 0, true);
    const locations = await squareRequest("/v2/locations", { method: "GET", token: accessToken });
    const location = selectSquareLocation(locations?.locations);
    await ctx.runMutation(internal.squareConnect.updateLocation, {
      business_id: businessId,
      merchant_id: account.merchant_id,
      location_id: location?.id,
      location_name: location?.name,
    });
    return { state: location ? "connected" : "needs_reconnect" };
  },
});

/** Disconnects Square: revokes the app's access for the merchant and deletes stored tokens. */
export const disconnect = action({
  args: {},
  handler: async (ctx): Promise<{ disconnected: boolean }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) throw new Error("Not authenticated");
    await ctx.runMutation(internal.squareConnect.consumeRateLimit, { user_email: identity.email, action: "square.connect" });
    const businessId = await ctx.runQuery(internal.squareConnect.getManagedBusinessId, { user_email: identity.email });
    const account = await ctx.runQuery(internal.squareConnect.getSellerAccountByBusiness, { business_id: businessId });
    if (!account) return { disconnected: false };
    try {
      const { applicationId, applicationSecret } = requireSquareOAuthConfig();
      await squareRequest("/oauth2/revoke", {
        method: "POST",
        token: applicationSecret,
        scheme: "Client",
        body: { client_id: applicationId, merchant_id: account.merchant_id },
      });
    } catch (error) {
      // Still forget the tokens locally; the seller can also revoke in Square.
      console.error("[Square Connect] Revoke failed", error instanceof Error ? error.message : String(error));
    }
    await ctx.runMutation(internal.squareConnect.deleteSellerAccount, { business_id: businessId });
    return { disconnected: true };
  },
});

// ---------------------------------------------------------------------------
// Internal functions
// ---------------------------------------------------------------------------

export const consumeRateLimit = internalMutation({
  args: { user_email: v.string(), action: v.string() },
  handler: async (ctx, args) => {
    await enforceRateLimit(ctx, args.user_email, args.action);
  },
});

export const getManagedBusinessId = internalQuery({
  args: { user_email: v.string() },
  handler: async (ctx, args): Promise<Id<"businesses">> => {
    const access = await requireManager(ctx, args.user_email);
    return access.business._id;
  },
});

/** INTERNAL ONLY: returns encrypted tokens. */
export const getSellerAccountByBusiness = internalQuery({
  args: { business_id: v.id("businesses") },
  handler: async (ctx, args) => await ctx.db
    .query("squareSellerAccounts")
    .withIndex("by_business", (q) => q.eq("business_id", args.business_id))
    .first(),
});

/** Business whose tenant key (invoice/quote `created_by`) is `user_email`. */
export const getBusinessIdForTenant = internalQuery({
  args: { user_email: v.string() },
  handler: async (ctx, args): Promise<Id<"businesses"> | null> => {
    const business = await resolveBusinessForUser(ctx, args.user_email);
    return business ? business._id : null;
  },
});

export const consumeOAuthState = internalMutation({
  args: { state: v.string() },
  handler: async (ctx, args): Promise<
    { ok: true; business_id: Id<"businesses">; user_email: string } | { ok: false; reason: string }
  > => {
    if (!isWellFormedState(args.state)) return { ok: false, reason: "invalid_state" };
    const row = await ctx.db
      .query("squareOAuthStates")
      .withIndex("by_state", (q) => q.eq("state", args.state))
      .first();
    const validation = validateOAuthState(row, Date.now());
    // Single use: delete whether or not it is still valid.
    if (row) await ctx.db.delete(row._id);
    if (!validation.ok) return validation;
    // The starter must still manage this business.
    const access = await getAccessContext(ctx, row!.user_email);
    if (!access.business || String(access.business._id) !== String(row!.business_id)
      || !access.role || !MANAGER_ROLES.has(access.role)) {
      return { ok: false, reason: "not_authorized" };
    }
    return { ok: true, business_id: row!.business_id, user_email: row!.user_email };
  },
});

export const storeSellerAccount = internalMutation({
  args: {
    business_id: v.id("businesses"),
    merchant_id: v.string(),
    access_token_enc: v.string(),
    refresh_token_enc: v.string(),
    expires_at: v.number(),
    location_id: v.optional(v.string()),
    location_name: v.optional(v.string()),
    scopes: v.optional(v.string()),
    connected_by: v.string(),
  },
  handler: async (ctx, args): Promise<{ ok: boolean; reason?: string }> => {
    const otherBusiness = await ctx.db
      .query("squareSellerAccounts")
      .withIndex("by_merchant", (q) => q.eq("merchant_id", args.merchant_id))
      .collect();
    if (otherBusiness.some((row) => String(row.business_id) !== String(args.business_id))) {
      return { ok: false, reason: "merchant_in_use" };
    }
    const existing = await ctx.db
      .query("squareSellerAccounts")
      .withIndex("by_business", (q) => q.eq("business_id", args.business_id))
      .first();
    const now = Date.now();
    const fields = {
      merchant_id: args.merchant_id,
      access_token_enc: args.access_token_enc,
      refresh_token_enc: args.refresh_token_enc,
      expires_at: args.expires_at,
      location_id: args.location_id,
      location_name: args.location_name,
      scopes: args.scopes,
      connected_by: args.connected_by,
      last_refresh_error: undefined,
      updated_at: now,
    };
    if (existing) await ctx.db.patch(existing._id, fields);
    else await ctx.db.insert("squareSellerAccounts", { business_id: args.business_id, ...fields, created_at: now });
    return { ok: true };
  },
});

export const updateSellerTokens = internalMutation({
  args: {
    business_id: v.id("businesses"),
    merchant_id: v.string(),
    access_token_enc: v.string(),
    refresh_token_enc: v.optional(v.string()),
    expires_at: v.number(),
  },
  handler: async (ctx, args) => {
    const account = await ctx.db
      .query("squareSellerAccounts")
      .withIndex("by_business", (q) => q.eq("business_id", args.business_id))
      .first();
    if (!account || account.merchant_id !== args.merchant_id) return false;
    await ctx.db.patch(account._id, {
      access_token_enc: args.access_token_enc,
      refresh_token_enc: args.refresh_token_enc ?? account.refresh_token_enc,
      expires_at: args.expires_at,
      last_refresh_error: undefined,
      updated_at: Date.now(),
    });
    return true;
  },
});

export const recordRefreshError = internalMutation({
  args: { business_id: v.id("businesses"), error: v.string() },
  handler: async (ctx, args) => {
    const account = await ctx.db
      .query("squareSellerAccounts")
      .withIndex("by_business", (q) => q.eq("business_id", args.business_id))
      .first();
    if (account) await ctx.db.patch(account._id, { last_refresh_error: args.error.slice(0, 300), updated_at: Date.now() });
  },
});

export const updateLocation = internalMutation({
  args: {
    business_id: v.id("businesses"),
    merchant_id: v.string(),
    location_id: v.optional(v.string()),
    location_name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const account = await ctx.db
      .query("squareSellerAccounts")
      .withIndex("by_business", (q) => q.eq("business_id", args.business_id))
      .first();
    if (!account || account.merchant_id !== args.merchant_id) return false;
    await ctx.db.patch(account._id, {
      location_id: args.location_id,
      location_name: args.location_name,
      updated_at: Date.now(),
    });
    return true;
  },
});

export const deleteSellerAccount = internalMutation({
  args: { business_id: v.id("businesses") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("squareSellerAccounts")
      .withIndex("by_business", (q) => q.eq("business_id", args.business_id))
      .collect();
    for (const row of rows) await ctx.db.delete(row._id);
    return rows.length;
  },
});

/** `oauth.authorization.revoked`: the seller removed ChemCheck in Square. */
export const deleteSellerAccountsByMerchant = internalMutation({
  args: { merchant_id: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("squareSellerAccounts")
      .withIndex("by_merchant", (q) => q.eq("merchant_id", args.merchant_id))
      .collect();
    for (const row of rows) await ctx.db.delete(row._id);
    return rows.length;
  },
});

export const listAccountsExpiringBefore = internalQuery({
  args: { before: v.number() },
  handler: async (ctx, args) => await ctx.db
    .query("squareSellerAccounts")
    .withIndex("by_expires_at", (q) => q.lt("expires_at", args.before))
    .take(200),
});

export const cleanupExpiredOAuthStates = internalMutation({
  args: {},
  handler: async (ctx) => {
    const expired = await ctx.db
      .query("squareOAuthStates")
      .withIndex("by_expires_at", (q) => q.lt("expires_at", Date.now()))
      .take(500);
    for (const row of expired) await ctx.db.delete(row._id);
    return expired.length;
  },
});

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

type SellerAccountRow = {
  business_id: Id<"businesses">;
  merchant_id: string;
  access_token_enc: string;
  refresh_token_enc: string;
  expires_at: number;
  location_id?: string;
};

async function refreshSellerToken(ctx: ActionCtx, account: SellerAccountRow): Promise<string> {
  const { applicationId, applicationSecret } = requireSquareOAuthConfig();
  try {
    const refreshToken = await decryptSecret(account.refresh_token_enc);
    const data = await squareRequest("/oauth2/token", {
      method: "POST",
      body: {
        client_id: applicationId,
        client_secret: applicationSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      },
    });
    const token = parseTokenResponse(data);
    if (token.merchant_id !== account.merchant_id) throw new Error("Square refreshed a token for a different merchant.");
    await ctx.runMutation(internal.squareConnect.updateSellerTokens, {
      business_id: account.business_id,
      merchant_id: account.merchant_id,
      access_token_enc: await encryptSecret(token.access_token),
      refresh_token_enc: token.refresh_token ? await encryptSecret(token.refresh_token) : undefined,
      expires_at: token.expires_at,
    });
    return token.access_token;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await ctx.runMutation(internal.squareConnect.recordRefreshError, { business_id: account.business_id, error: message });
    throw error;
  }
}

/** Decrypted seller access token, refreshed first when it expires within `windowMs`. */
async function ensureFreshToken(
  ctx: ActionCtx,
  account: SellerAccountRow,
  windowMs = ON_DEMAND_REFRESH_WINDOW_MS,
  force = false,
): Promise<string> {
  if (force || shouldRefreshToken(account.expires_at, Date.now(), windowMs)) {
    return await refreshSellerToken(ctx, account);
  }
  return await decryptSecret(account.access_token_enc);
}

export type SellerCredentials = { merchantId: string; locationId: string; accessToken: string };

/**
 * Credentials to charge on behalf of the business that owns `tenantEmail`
 * (invoice/quote `created_by`). Throws the user-facing "connect Square" error
 * when the business has no usable connection. Never falls back to the
 * platform account.
 */
export async function requireSellerCredentials(ctx: ActionCtx, tenantEmail: string): Promise<SellerCredentials> {
  const businessId = await ctx.runQuery(internal.squareConnect.getBusinessIdForTenant, { user_email: tenantEmail });
  if (!businessId) throw new Error(CONNECT_REQUIRED_MESSAGE);
  return await requireSellerCredentialsForBusiness(ctx, businessId);
}

/** Same as requireSellerCredentials, for a known business id. */
export async function requireSellerCredentialsForBusiness(
  ctx: ActionCtx,
  businessId: Id<"businesses">,
): Promise<SellerCredentials> {
  const account = await ctx.runQuery(internal.squareConnect.getSellerAccountByBusiness, { business_id: businessId });
  if (!account || !account.merchant_id || !account.location_id) throw new Error(CONNECT_REQUIRED_MESSAGE);
  let accessToken: string;
  try {
    accessToken = await ensureFreshToken(ctx, account);
  } catch {
    throw new Error(`${CONNECT_REQUIRED_MESSAGE} (the Square connection needs to be renewed).`);
  }
  return { merchantId: account.merchant_id, locationId: account.location_id, accessToken };
}

/** Daily cron: refresh seller tokens expiring within 7 days; drop stale OAuth states. */
export const refreshExpiringTokens = internalAction({
  args: {},
  handler: async (ctx) => {
    await ctx.runMutation(internal.squareConnect.cleanupExpiredOAuthStates, {});
    const accounts = await ctx.runQuery(internal.squareConnect.listAccountsExpiringBefore, {
      before: Date.now() + REFRESH_WINDOW_MS,
    });
    let refreshed = 0;
    let failed = 0;
    for (const account of accounts) {
      try {
        await refreshSellerToken(ctx, account);
        refreshed += 1;
      } catch (error) {
        failed += 1;
        console.error("[Square Connect] Token refresh failed", {
          business_id: String(account.business_id),
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { refreshed, failed };
  },
});

// ---------------------------------------------------------------------------
// OAuth callback (GET /square/oauth/callback)
// ---------------------------------------------------------------------------

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location, "Cache-Control": "no-store" } });
}

export const handleSquareOAuthCallback = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const state = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  const oauthError = url.searchParams.get("error");

  // Always consume the state, even when the seller declined.
  const claim = await ctx.runMutation(internal.squareConnect.consumeOAuthState, { state });
  if (!claim.ok) return redirect(settingsReturnUrl("error", claim.reason));
  if (oauthError) return redirect(settingsReturnUrl("error", "access_denied"));
  if (!code || code.length > 512) return redirect(settingsReturnUrl("error", "missing_code"));

  try {
    const { applicationId, applicationSecret, redirectUrl } = requireSquareOAuthConfig();
    const data = await squareRequest("/oauth2/token", {
      method: "POST",
      body: {
        client_id: applicationId,
        client_secret: applicationSecret,
        grant_type: "authorization_code",
        code,
        ...(redirectUrl ? { redirect_uri: redirectUrl } : {}),
      },
    });
    const token = parseTokenResponse(data);
    if (!token.refresh_token) throw new Error("Square did not return a refresh token.");

    const locations = await squareRequest("/v2/locations", { method: "GET", token: token.access_token });
    const location = selectSquareLocation(locations?.locations);

    const stored = await ctx.runMutation(internal.squareConnect.storeSellerAccount, {
      business_id: claim.business_id,
      merchant_id: token.merchant_id,
      access_token_enc: await encryptSecret(token.access_token),
      refresh_token_enc: await encryptSecret(token.refresh_token),
      expires_at: token.expires_at,
      location_id: location?.id,
      location_name: location?.name,
      scopes: sellerOAuthScopes(parsePlatformFeeBps(process.env.PLATFORM_FEE_BPS) > 0).join(" "),
      connected_by: claim.user_email,
    });
    if (!stored.ok) return redirect(settingsReturnUrl("error", stored.reason));
    if (!location) return redirect(settingsReturnUrl("error", "no_card_location"));
    return redirect(settingsReturnUrl("return"));
  } catch (error) {
    console.error("[Square Connect] OAuth callback failed", error instanceof Error ? error.message : String(error));
    return redirect(settingsReturnUrl("error", "token_exchange_failed"));
  }
});
