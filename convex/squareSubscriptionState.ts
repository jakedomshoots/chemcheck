/**
 * Pure helpers for applying Square subscription webhooks to the
 * `subscriptions` table. Free of Convex runtime imports so they are unit
 * tested directly (billingState.test.ts).
 */

import { SQUARE_PLAN_VARIATION_ENV_VARS } from "./providerConfig";
import { parseSquareDate, parseSquareTimestamp } from "./squareApi";

export type PlanId = "starter" | "professional" | "business";
export type BillingInterval = "month" | "year";
export type SubscriptionStatus =
  | "active"
  | "canceled"
  | "incomplete"
  | "incomplete_expired"
  | "past_due"
  | "trialing"
  | "unpaid";

const PLAN_IDS: readonly PlanId[] = ["starter", "professional", "business"];

/** Monthly list prices in USD. Mirrors src/lib/billingPlans.ts. */
export const PLAN_MONTHLY_PRICE_USD: Record<PlanId, number> = {
  starter: 29,
  professional: 79,
  business: 149,
};
export const ANNUAL_DISCOUNT_PERCENT = 20;

type Env = Record<string, string | undefined>;

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === "string" && (PLAN_IDS as readonly string[]).includes(value);
}

/** Price charged at checkout, in cents. Annual = 12 months less 20%, rounded to whole dollars. */
export function planPriceCents(plan: PlanId, interval: BillingInterval): number {
  const monthly = PLAN_MONTHLY_PRICE_USD[plan];
  const dollars = interval === "year"
    ? Math.round(monthly * 12 * (1 - ANNUAL_DISCOUNT_PERCENT / 100))
    : monthly;
  return dollars * 100;
}

/** Configured Square plan variation id for a plan/interval, or undefined. */
export function variationIdFor(plan: PlanId, interval: BillingInterval, env: Env): string | undefined {
  const value = (env[SQUARE_PLAN_VARIATION_ENV_VARS[plan][interval]] || "").trim();
  return value || undefined;
}

/** Plan for a Square plan variation id, using only server-side env configuration. */
export function planIdFromVariationId(variationId: string | undefined, env: Env): PlanId | undefined {
  if (!variationId) return undefined;
  for (const plan of PLAN_IDS) {
    for (const interval of ["month", "year"] as const) {
      if (variationIdFor(plan, interval, env) === variationId) return plan;
    }
  }
  return undefined;
}

export const TERMINAL_SQUARE_STATUSES: readonly string[] = ["CANCELED", "DEACTIVATED"];

/**
 * Square subscription status -> app status (see planLimits ENTITLED_STATUSES):
 * ACTIVE -> active, PENDING (paid, starts later) -> trialing,
 * PAUSED / CANCELED / DEACTIVATED -> canceled.
 */
export function mapSquareStatus(status: unknown): SubscriptionStatus | undefined {
  switch (status) {
    case "ACTIVE":
      return "active";
    case "PENDING":
      return "trialing";
    case "PAUSED":
    case "CANCELED":
    case "DEACTIVATED":
      return "canceled";
    default:
      return undefined;
  }
}

const ENTITLED: readonly string[] = ["active", "trialing", "past_due"];

export function isEntitledStatus(status: unknown): boolean {
  return typeof status === "string" && ENTITLED.includes(status);
}

/** Square event `created_at` (RFC 3339) -> ms. */
export function eventCreatedMs(event: Record<string, any>): number | undefined {
  return parseSquareTimestamp(event?.created_at);
}

/**
 * Webhooks can arrive out of order. Apply an event only when it is not older
 * than the last one applied to the same subscription.
 */
export function shouldApplyEvent(lastApplied: number | undefined, eventCreated: number | undefined): boolean {
  if (eventCreated === undefined || lastApplied === undefined) return true;
  return eventCreated >= lastApplied;
}

const TERMINAL_APP_STATUSES: readonly string[] = ["canceled", "incomplete_expired"];

/**
 * Status after a successful subscription invoice payment when the live
 * subscription could not be fetched. Never resurrects an ended subscription.
 */
export function statusAfterPaymentSucceeded(current: string): SubscriptionStatus | null {
  if (TERMINAL_APP_STATUSES.includes(current)) return null;
  if (current === "trialing" || current === "active") return null;
  return "active";
}

/** Status after a failed scheduled charge; ended subscriptions are left alone. */
export function statusAfterPaymentFailed(current: string): SubscriptionStatus | null {
  if (TERMINAL_APP_STATUSES.includes(current)) return null;
  if (current === "past_due" || current === "unpaid") return null;
  return "past_due";
}

/**
 * A Square subscription that reached CANCELED/DEACTIVATED is terminal; a later
 * (e.g. replayed) event must never move it back to an entitled status.
 */
export function wouldResurrect(existingSquareStatus: string | undefined, incomingSquareStatus: string | undefined): boolean {
  return Boolean(existingSquareStatus && TERMINAL_SQUARE_STATUSES.includes(existingSquareStatus))
    && !(incomingSquareStatus && TERMINAL_SQUARE_STATUSES.includes(incomingSquareStatus));
}

export interface SquareSubscriptionFields {
  square_subscription_id: string;
  square_customer_id?: string;
  square_plan_variation_id?: string;
  square_status: string;
  plan_id?: PlanId;
  status: SubscriptionStatus;
  current_period_start?: number;
  current_period_end?: number;
  cancel_at_period_end: boolean;
}

/** Build the subscriptions upsert payload from a Square Subscription object. */
export function subscriptionFieldsFromSquare(subscription: Record<string, any>, env: Env): SquareSubscriptionFields {
  const id = typeof subscription?.id === "string" ? subscription.id : "";
  if (!id) throw new Error("Square subscription is missing an id");
  const squareStatus = subscription?.status;
  const status = mapSquareStatus(squareStatus);
  if (!status) throw new Error(`Unsupported Square subscription status: ${String(squareStatus)}`);
  const variationId = typeof subscription?.plan_variation_id === "string"
    ? subscription.plan_variation_id
    : typeof subscription?.plan_id === "string" ? subscription.plan_id : undefined;
  const canceledDate = parseSquareDate(subscription?.canceled_date);
  return {
    square_subscription_id: id,
    square_customer_id: typeof subscription?.customer_id === "string" ? subscription.customer_id : undefined,
    square_plan_variation_id: variationId,
    square_status: String(squareStatus),
    // Never trust client metadata: the plan comes only from env-configured variation ids.
    plan_id: planIdFromVariationId(variationId, env),
    status,
    current_period_start: parseSquareDate(subscription?.start_date),
    current_period_end: parseSquareDate(subscription?.charged_through_date) ?? canceledDate,
    // Square keeps a canceled subscription ACTIVE until canceled_date.
    cancel_at_period_end: status !== "canceled" && canceledDate !== undefined,
  };
}

export type SubscriptionTarget = "insert" | "replace" | "skip";

/**
 * Which `subscriptions` row an incoming Square subscription writes to when no
 * row carries its id yet. One row per business: a legacy (Stripe) row or an
 * ended Square subscription is replaced; an entitled Square subscription with
 * another id is only replaced by a newer, entitled one (a late event for an
 * old subscription never overwrites the current one).
 */
export function decideSubscriptionTarget(
  existing: { provider?: string; square_subscription_id?: string; status: string; last_event_created?: number } | null | undefined,
  incoming: { status: string; event_created?: number },
): SubscriptionTarget {
  if (!existing) return "insert";
  // Nothing entitled to protect (ended subscription, legacy canceled row): take the row.
  if (!isEntitledStatus(existing.status)) return "replace";
  // Never replace an entitled row with an ended subscription.
  if (!isEntitledStatus(incoming.status)) return "skip";
  const existingIsSquare = existing.provider === "square" && Boolean(existing.square_subscription_id);
  // Legacy (pre-Square) entitled row: the business moved to Square.
  if (!existingIsSquare) return "replace";
  return shouldApplyEvent(existing.last_event_created, incoming.event_created) ? "replace" : "skip";
}
