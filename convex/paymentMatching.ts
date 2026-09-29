/**
 * Provider-neutral money helpers shared by invoices, quotes and the Square
 * integration. Pure (no Convex runtime imports) so they are unit tested directly.
 */

const FALLBACK_APP_BASE_URL = "https://app.chemcheck.app";

/** App origin for redirect URLs. Always from server env, never the caller. */
export function appBaseUrl(): string {
  const trimmedEnv = (process.env.APP_URL || "").trim().replace(/\/+$/, "");
  return trimmedEnv || FALLBACK_APP_BASE_URL;
}

/** Dollars -> integer cents. */
export function toUsdCents(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.max(0, Math.round(amount * 100));
}

/**
 * Returns why a provider payment must not settle a record, or null when it
 * paid exactly the amount due (in cents) in USD.
 */
export function paymentAmountMismatch(
  expectedAmount: number,
  payment: { amount_cents?: unknown; currency?: unknown }
): string | null {
  const expectedCents = toUsdCents(expectedAmount);
  if (expectedCents <= 0) return "no_amount_due";
  if (typeof payment.currency !== "string" || payment.currency.toUpperCase() !== "USD") return "currency_mismatch";
  if (typeof payment.amount_cents !== "number" || !Number.isFinite(payment.amount_cents)) return "amount_missing";
  if (!Number.isInteger(payment.amount_cents) || payment.amount_cents !== expectedCents) return "amount_mismatch";
  return null;
}

/** Parse PLATFORM_FEE_BPS (basis points, 100 = 1%). Invalid/missing => 0. Clamped to [0, 10000]. */
export function parsePlatformFeeBps(raw: string | undefined): number {
  const trimmed = (raw || "").trim();
  if (!/^\d+$/.test(trimmed)) return 0;
  const bps = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(bps) || bps <= 0) return 0;
  return Math.min(bps, 10_000);
}

/** Application fee in cents for a charge of `amountCents`, rounded down, never above the charge. */
export function calculateApplicationFeeCents(amountCents: number, bps: number): number {
  if (!Number.isFinite(amountCents) || amountCents <= 0) return 0;
  if (!Number.isFinite(bps) || bps <= 0) return 0;
  const fee = Math.floor((Math.round(amountCents) * Math.min(bps, 10_000)) / 10_000);
  return Math.max(0, Math.min(fee, Math.round(amountCents)));
}

export function platformFeeCentsFromEnv(amountCents: number): number {
  return calculateApplicationFeeCents(amountCents, parsePlatformFeeBps(process.env.PLATFORM_FEE_BPS));
}

/**
 * Why a provider payment must not settle a record, or null when it may:
 * the payment is COMPLETED, was taken on the same merchant account the
 * payment link was created on (the business's own connected merchant), and
 * paid exactly the amount due in USD.
 */
export function providerSettlementMismatch(
  expected: { merchantId?: string; amount: number },
  payment: { merchant_id?: string; status?: string; amount_cents?: unknown; currency?: unknown }
): string | null {
  if (payment.status !== "COMPLETED") return "not_completed";
  if (!expected.merchantId || !payment.merchant_id || expected.merchantId !== payment.merchant_id) {
    return "merchant_mismatch";
  }
  return paymentAmountMismatch(expected.amount, payment);
}
