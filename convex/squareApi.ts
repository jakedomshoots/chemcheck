/**
 * Square REST helpers shared by seller OAuth (squareConnect.ts), customer
 * payments (payments.ts), platform subscriptions (subscriptions.ts) and the
 * webhook (squareWebhook.ts).
 *
 * Everything except `squareRequest` is pure so it can be unit tested.
 */

import { SQUARE_API_VERSION, fetchProvider, squareBaseUrl } from "./providerConfig";

export { SQUARE_API_VERSION, squareBaseUrl };

export const CONNECT_REQUIRED_MESSAGE =
  "Connect your Square account in Settings to accept card payments";

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

export class SquareApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

export function squareHeaders(token?: string, scheme: "Bearer" | "Client" = "Bearer"): Record<string, string> {
  const headers: Record<string, string> = {
    "Square-Version": SQUARE_API_VERSION,
    "Content-Type": "application/json",
  };
  if (token !== undefined) {
    if (!token || /[\r\n]/.test(token)) throw new Error("Invalid Square credential");
    headers.Authorization = `${scheme} ${token}`;
  }
  return headers;
}

/** Square error payload -> message. */
export function squareErrorMessage(data: any, status: number): { message: string; code?: string } {
  const first = Array.isArray(data?.errors) ? data.errors[0] : undefined;
  const detail = typeof first?.detail === "string" ? first.detail : undefined;
  const code = typeof first?.code === "string" ? first.code : undefined;
  const oauthMessage = typeof data?.message === "string" ? data.message : undefined;
  return { message: detail || oauthMessage || `Square request failed (${status})`, code };
}

/** Call the Square API. `path` starts with "/" (e.g. "/v2/locations"). */
export async function squareRequest(
  path: string,
  init: { method: "GET" | "POST" | "PUT" | "DELETE"; token?: string; scheme?: "Bearer" | "Client"; body?: unknown },
): Promise<any> {
  const response = await fetchProvider(`${squareBaseUrl()}${path}`, {
    method: init.method,
    headers: squareHeaders(init.token, init.scheme),
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  let data: any = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    const { message, code } = squareErrorMessage(data, response.status);
    throw new SquareApiError(message, response.status, code);
  }
  return data;
}

// ---------------------------------------------------------------------------
// Webhook signature
// ---------------------------------------------------------------------------

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Constant-time string comparison (length is not secret). */
export function constantTimeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

/** base64(HMAC-SHA256(key, notificationUrl + rawBody)) as Square computes it. */
export async function computeSquareSignature(rawBody: string, signatureKey: string, notificationUrl: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(signatureKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(notificationUrl + rawBody));
  return bytesToBase64(new Uint8Array(signature));
}

/**
 * Verify the `x-square-hmacsha256-signature` header. The notification URL
 * must be exactly the URL configured on the Square webhook subscription.
 */
export async function verifySquareSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  signatureKey: string,
  notificationUrl: string,
): Promise<boolean> {
  if (!signatureHeader || !signatureKey || !notificationUrl) return false;
  const expected = await computeSquareSignature(rawBody, signatureKey, notificationUrl);
  return constantTimeEqual(signatureHeader.trim(), expected);
}

// ---------------------------------------------------------------------------
// Token encryption at rest (AES-256-GCM, key from SQUARE_TOKEN_ENCRYPTION_KEY)
// ---------------------------------------------------------------------------

const ENCRYPTION_PREFIX = "v1";

async function importEncryptionKey(keyBase64: string | undefined): Promise<CryptoKey> {
  const raw = (keyBase64 || "").trim();
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = base64ToBytes(raw);
  } catch {
    throw new Error("SQUARE_TOKEN_ENCRYPTION_KEY must be base64.");
  }
  if (bytes.length !== 32) {
    throw new Error("Square token encryption is not configured. Set SQUARE_TOKEN_ENCRYPTION_KEY to 32 random bytes (base64).");
  }
  return await crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(
  plaintext: string,
  keyBase64: string | undefined = process.env.SQUARE_TOKEN_ENCRYPTION_KEY,
): Promise<string> {
  const key = await importEncryptionKey(keyBase64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
  return `${ENCRYPTION_PREFIX}:${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(cipher))}`;
}

export async function decryptSecret(
  encrypted: string,
  keyBase64: string | undefined = process.env.SQUARE_TOKEN_ENCRYPTION_KEY,
): Promise<string> {
  const [prefix, ivB64, dataB64] = String(encrypted || "").split(":");
  if (prefix !== ENCRYPTION_PREFIX || !ivB64 || !dataB64) throw new Error("Stored Square token is unreadable.");
  const key = await importEncryptionKey(keyBase64);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(ivB64) }, key, base64ToBytes(dataB64));
  return new TextDecoder().decode(plain);
}

// ---------------------------------------------------------------------------
// Seller OAuth
// ---------------------------------------------------------------------------

export const SELLER_OAUTH_SCOPES = [
  "MERCHANT_PROFILE_READ",
  "PAYMENTS_READ",
  "PAYMENTS_WRITE",
  "ORDERS_READ",
  "ORDERS_WRITE",
  // Work tickets: Square Customers, Invoices and cards on file.
  "CUSTOMERS_READ",
  "CUSTOMERS_WRITE",
  "INVOICES_READ",
  "INVOICES_WRITE",
] as const;

/** App fees (`app_fee_money`) need PAYMENTS_WRITE_ADDITIONAL_RECIPIENTS from the seller. */
export function sellerOAuthScopes(platformFeeEnabled: boolean): string[] {
  return platformFeeEnabled
    ? [...SELLER_OAUTH_SCOPES, "PAYMENTS_WRITE_ADDITIONAL_RECIPIENTS"]
    : [...SELLER_OAUTH_SCOPES];
}

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

/** 32 random bytes, hex. Used as the single-use OAuth `state`. */
export function generateStateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function isWellFormedState(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

/** Pure decision for a stored OAuth state row. */
export function validateOAuthState(
  row: { expires_at: number } | null | undefined,
  now: number,
): { ok: true } | { ok: false; reason: "unknown_state" | "expired_state" } {
  if (!row) return { ok: false, reason: "unknown_state" };
  if (row.expires_at <= now) return { ok: false, reason: "expired_state" };
  return { ok: true };
}

export function buildAuthorizeUrl(args: {
  baseUrl: string;
  applicationId: string;
  state: string;
  scopes: string[];
  redirectUrl?: string;
}): string {
  // Square expects space-separated scopes (encoded as "+").
  const params = [
    `client_id=${encodeURIComponent(args.applicationId)}`,
    `scope=${args.scopes.map(encodeURIComponent).join("+")}`,
    "session=false",
    `state=${encodeURIComponent(args.state)}`,
  ];
  if (args.redirectUrl) params.push(`redirect_uri=${encodeURIComponent(args.redirectUrl)}`);
  return `${args.baseUrl}/oauth2/authorize?${params.join("&")}`;
}

/** Square RFC 3339 timestamp -> ms. */
export function parseSquareTimestamp(value: unknown): number | undefined {
  if (typeof value !== "string" || !value) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

/** Square YYYY-MM-DD date -> ms (UTC midnight). */
export function parseSquareDate(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : undefined;
}

export const REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const ON_DEMAND_REFRESH_WINDOW_MS = 60 * 60 * 1000;

/** Refresh when the access token expires within `windowMs` (or already expired). */
export function shouldRefreshToken(expiresAt: number | undefined, now: number, windowMs: number): boolean {
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) return true;
  return expiresAt - now <= windowMs;
}

export type ParsedTokenResponse = {
  access_token: string;
  refresh_token?: string;
  merchant_id: string;
  expires_at: number;
};

export function parseTokenResponse(data: any): ParsedTokenResponse {
  const accessToken = typeof data?.access_token === "string" ? data.access_token : "";
  const merchantId = typeof data?.merchant_id === "string" ? data.merchant_id : "";
  const expiresAt = parseSquareTimestamp(data?.expires_at);
  if (!accessToken || !merchantId || !expiresAt) throw new Error("Square returned an incomplete OAuth token response.");
  return {
    access_token: accessToken,
    refresh_token: typeof data?.refresh_token === "string" && data.refresh_token ? data.refresh_token : undefined,
    merchant_id: merchantId,
    expires_at: expiresAt,
  };
}

/**
 * Pick the location that takes card payments: an ACTIVE USD location with
 * card processing (the main location when Square marks one).
 */
export function selectSquareLocation(locations: unknown): { id: string; name: string } | null {
  if (!Array.isArray(locations)) return null;
  const eligible = locations.filter((location: any) => {
    if (!location || typeof location.id !== "string" || location.status !== "ACTIVE") return false;
    if (location.currency && location.currency !== "USD") return false;
    const capabilities: unknown[] = Array.isArray(location.capabilities) ? location.capabilities : [];
    return capabilities.includes("CREDIT_CARD_PROCESSING") || capabilities.includes("CARD_PROCESSING");
  });
  const main = eligible.find((location: any) => location.type === "PHYSICAL" && location.main === true);
  const chosen: any = main ?? eligible[0];
  return chosen ? { id: chosen.id, name: typeof chosen.name === "string" ? chosen.name : "Square location" } : null;
}

export function maskMerchantId(merchantId: string | undefined): string | null {
  if (!merchantId) return null;
  return merchantId.length <= 4 ? "****" : `****${merchantId.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Payment links
// ---------------------------------------------------------------------------

export type PaymentLinkArgs = {
  idempotencyKey: string;
  name: string;
  amountCents: number;
  locationId: string;
  redirectUrl: string;
  appFeeCents?: number;
  paymentNote?: string;
  buyerEmail?: string;
  subscriptionPlanVariationId?: string;
};

/** Body for POST /v2/online-checkout/payment-links (quick pay). */
export function buildPaymentLinkBody(args: PaymentLinkArgs): Record<string, any> {
  if (!Number.isInteger(args.amountCents) || args.amountCents <= 0) throw new Error("Payment amount must be positive.");
  if (!args.locationId) throw new Error("Square location is missing.");
  const checkoutOptions: Record<string, any> = { redirect_url: args.redirectUrl };
  if (args.appFeeCents && args.appFeeCents > 0) {
    checkoutOptions.app_fee_money = { amount: args.appFeeCents, currency: "USD" };
  }
  if (args.subscriptionPlanVariationId) {
    checkoutOptions.subscription_plan_id = args.subscriptionPlanVariationId;
  }
  const body: Record<string, any> = {
    idempotency_key: args.idempotencyKey.slice(0, 192),
    quick_pay: {
      name: args.name.slice(0, 255),
      price_money: { amount: args.amountCents, currency: "USD" },
      location_id: args.locationId,
    },
    checkout_options: checkoutOptions,
  };
  if (args.paymentNote) body.payment_note = args.paymentNote.slice(0, 500);
  if (args.buyerEmail) body.pre_populated_data = { buyer_email: args.buyerEmail };
  return body;
}

export function parsePaymentLinkResponse(data: any): { id: string; url: string; order_id: string } {
  const link = data?.payment_link;
  const id = typeof link?.id === "string" ? link.id : "";
  const url = typeof link?.url === "string" ? link.url : typeof link?.long_url === "string" ? link.long_url : "";
  const orderId = typeof link?.order_id === "string" ? link.order_id : "";
  if (!id || !orderId || !/^https:\/\//.test(url)) throw new Error("Square payment link response is missing required fields");
  return { id, url, order_id: orderId };
}

/** Hosts Square uses for hosted checkout pages. */
export function isSquareHostedUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && (
      host === "square.link" || host.endsWith(".square.link")
      || host.endsWith(".square.site")
      || host === "squareup.com" || host.endsWith(".squareup.com")
      || host === "squareupsandbox.com" || host.endsWith(".squareupsandbox.com")
    );
  } catch {
    return false;
  }
}

/** Normalized view of a Square Payment object. */
export type SquarePaymentFacts = {
  payment_id?: string;
  status?: string;
  order_id?: string;
  location_id?: string;
  customer_id?: string;
  amount_cents?: number;
  currency?: string;
};

export function paymentFacts(payment: any): SquarePaymentFacts {
  return {
    payment_id: typeof payment?.id === "string" ? payment.id : undefined,
    status: typeof payment?.status === "string" ? payment.status : undefined,
    order_id: typeof payment?.order_id === "string" ? payment.order_id : undefined,
    location_id: typeof payment?.location_id === "string" ? payment.location_id : undefined,
    customer_id: typeof payment?.customer_id === "string" ? payment.customer_id : undefined,
    // amount_money excludes tips; it is what the payment link charged.
    amount_cents: typeof payment?.amount_money?.amount === "number" ? payment.amount_money.amount : undefined,
    currency: typeof payment?.amount_money?.currency === "string" ? payment.amount_money.currency : undefined,
  };
}
