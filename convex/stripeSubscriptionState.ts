/**
 * Pure helpers for applying Stripe subscription webhooks. Kept free of Convex
 * runtime imports so they can be unit tested directly.
 */

export type PlanId = "starter" | "professional" | "business";
export type SubscriptionStatus =
  | "active"
  | "canceled"
  | "incomplete"
  | "incomplete_expired"
  | "past_due"
  | "trialing"
  | "unpaid";

const PLAN_IDS: readonly PlanId[] = ["starter", "professional", "business"];
const SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = [
  "active",
  "canceled",
  "incomplete",
  "incomplete_expired",
  "past_due",
  "trialing",
  "unpaid",
];

/** Env var names holding each plan's Stripe price ids (see subscriptions.ts / STRIPE_SETUP.md). */
export const PLAN_PRICE_ENV_VARS: Record<PlanId, readonly string[]> = {
  starter: ["STRIPE_STARTER_MONTHLY_PRICE_ID", "STRIPE_STARTER_YEARLY_PRICE_ID"],
  professional: ["STRIPE_PROFESSIONAL_MONTHLY_PRICE_ID", "STRIPE_PROFESSIONAL_YEARLY_PRICE_ID"],
  business: ["STRIPE_BUSINESS_MONTHLY_PRICE_ID", "STRIPE_BUSINESS_YEARLY_PRICE_ID"],
};

type Env = Record<string, string | undefined>;

function isObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object";
}

function idOf(value: unknown): string | undefined {
  if (typeof value === "string" && value) return value;
  if (isObject(value) && typeof value.id === "string" && value.id) return value.id;
  return undefined;
}

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === "string" && (PLAN_IDS as readonly string[]).includes(value);
}

export function isSubscriptionStatus(value: unknown): value is SubscriptionStatus {
  return typeof value === "string" && (SUBSCRIPTION_STATUSES as readonly string[]).includes(value);
}

/** Map a Stripe price id to a plan using the configured env price ids. */
export function planIdFromPriceId(priceId: string | undefined, env: Env): PlanId | undefined {
  if (!priceId) return undefined;
  for (const plan of PLAN_IDS) {
    for (const name of PLAN_PRICE_ENV_VARS[plan]) {
      const configured = (env[name] || "").trim();
      if (configured && configured === priceId) return plan;
    }
  }
  return undefined;
}

function firstItem(subscription: Record<string, any>): Record<string, any> | undefined {
  const items = subscription?.items?.data;
  return Array.isArray(items) && isObject(items[0]) ? items[0] : undefined;
}

/**
 * Resolve the plan from the subscription's price (so billing-portal plan
 * changes are honored), falling back to checkout metadata.
 */
export function resolvePlanId(subscription: Record<string, any>, env: Env): PlanId | undefined {
  const items = Array.isArray(subscription?.items?.data) ? subscription.items.data : [];
  for (const item of items) {
    const priceId = idOf(item?.price) ?? idOf(item?.plan);
    const plan = planIdFromPriceId(priceId, env);
    if (plan) return plan;
  }
  const metadataPlan = subscription?.metadata?.plan_id;
  return isPlanId(metadataPlan) ? metadataPlan : undefined;
}

function secondsToMs(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value * 1000 : undefined;
}

/**
 * Billing period bounds. Newer Stripe API versions moved these from the
 * subscription onto each subscription item.
 */
export function resolvePeriod(subscription: Record<string, any>): { start?: number; end?: number } {
  const item = firstItem(subscription);
  return {
    start: secondsToMs(subscription?.current_period_start) ?? secondsToMs(item?.current_period_start),
    end: secondsToMs(subscription?.current_period_end) ?? secondsToMs(item?.current_period_end),
  };
}

/**
 * Subscription id on an invoice. Newer API versions moved it to
 * invoice.parent.subscription_details.subscription.
 */
export function invoiceSubscriptionId(invoice: Record<string, any>): string | undefined {
  return (
    idOf(invoice?.subscription) ??
    idOf(invoice?.parent?.subscription_details?.subscription) ??
    idOf(invoice?.subscription_details?.subscription)
  );
}

/** Stripe event.created (seconds) -> ms. */
export function eventCreatedMs(event: Record<string, any>): number | undefined {
  return secondsToMs(event?.created);
}

/**
 * Webhooks can arrive out of order. Apply an event only when it is not older
 * than the last one applied to the same subscription.
 */
export function shouldApplyEvent(lastApplied: number | undefined, eventCreated: number | undefined): boolean {
  if (eventCreated === undefined || lastApplied === undefined) return true;
  return eventCreated >= lastApplied;
}

const TERMINAL_STATUSES: readonly string[] = ["canceled", "incomplete_expired"];

/**
 * Status after `invoice.payment_succeeded` when the live subscription could
 * not be fetched. A payment never resurrects an ended subscription, and a
 * trialing subscription stays trialing.
 */
export function statusAfterPaymentSucceeded(current: string): SubscriptionStatus | null {
  if (TERMINAL_STATUSES.includes(current)) return null;
  if (current === "trialing" || current === "active") return null;
  return "active";
}

/** Status after `invoice.payment_failed`; ended subscriptions are left alone. */
export function statusAfterPaymentFailed(current: string): SubscriptionStatus | null {
  if (TERMINAL_STATUSES.includes(current)) return null;
  if (current === "past_due" || current === "unpaid") return null;
  return "past_due";
}

export interface SubscriptionUpsertFields {
  business_id?: string;
  user_email: string;
  stripe_customer_id: string;
  stripe_subscription_id: string;
  plan_id?: PlanId;
  status: SubscriptionStatus;
  current_period_start?: number;
  current_period_end?: number;
  cancel_at_period_end: boolean;
  trial_end?: number;
}

/** Dollars -> integer cents, matching payments.ts toUsdCents. */
export function toUsdCents(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.max(0, Math.round(amount * 100));
}

/**
 * Returns why a paid Checkout Session must not settle a record, or null when
 * the session paid exactly the amount due in USD.
 */
export function checkoutPaymentMismatch(
  expectedAmount: number,
  session: { amount_total?: unknown; currency?: unknown }
): string | null {
  const expectedCents = toUsdCents(expectedAmount);
  if (expectedCents <= 0) return "no_amount_due";
  if (typeof session.currency !== "string" || session.currency.toLowerCase() !== "usd") return "currency_mismatch";
  if (typeof session.amount_total !== "number" || !Number.isFinite(session.amount_total)) return "amount_missing";
  if (Math.round(session.amount_total) !== expectedCents) return "amount_mismatch";
  return null;
}

/** Build the subscriptions.upsert payload from a Stripe subscription object. */
export function subscriptionUpsertFields(
  subscription: Record<string, any>,
  env: Env,
  overrides: { status?: SubscriptionStatus; cancel_at_period_end?: boolean } = {}
): SubscriptionUpsertFields {
  const status = overrides.status ?? subscription?.status;
  if (!isSubscriptionStatus(status)) {
    throw new Error(`Unsupported Stripe subscription status: ${String(status)}`);
  }
  const period = resolvePeriod(subscription);
  const businessId = subscription?.metadata?.business_id;
  return {
    business_id: typeof businessId === "string" && businessId ? businessId : undefined,
    user_email: typeof subscription?.metadata?.user_email === "string" ? subscription.metadata.user_email : "",
    stripe_customer_id: idOf(subscription?.customer) ?? "",
    stripe_subscription_id: String(subscription?.id ?? ""),
    plan_id: resolvePlanId(subscription, env),
    status,
    current_period_start: period.start,
    current_period_end: period.end,
    cancel_at_period_end: overrides.cancel_at_period_end ?? subscription?.cancel_at_period_end === true,
    trial_end: secondsToMs(subscription?.trial_end),
  };
}
