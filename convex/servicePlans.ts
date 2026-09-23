import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { createStripeCheckoutSession } from "./payments";
import { requireStripeConfig } from "./providerConfig";

const PLAN_STATUSES = ["active", "paused"] as const;
const RECURRING_INVOICE_DUE_DAYS = 14;
const DEFAULT_APP_URL = "https://app.chemcheck.app";

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function todayDateString(now: number = Date.now()): string {
  return toDateString(new Date(now));
}

/** Clamp a requested billing day into the safe 1-28 range. */
export function clampBillingDay(day: number): number {
  const rounded = Math.floor(day);
  if (!Number.isFinite(rounded)) return 1;
  return Math.min(28, Math.max(1, rounded));
}

/**
 * Next occurrence of a monthly billing day, never in the past.
 * Billing on the creation day runs the same day.
 */
export function computeNextRunDate(today: string, dayOfMonth: number): string {
  const day = clampBillingDay(dayOfMonth);
  const [year, month] = today.split("-").map(Number);
  const todayDay = Number(today.split("-")[2]);

  if (todayDay <= day) {
    return toDateString(new Date(Date.UTC(year, month - 1, day)));
  }
  return toDateString(new Date(Date.UTC(year, month, day)));
}

/** Advance one monthly cycle from a run date, keeping the same billing day. */
export function advanceMonthly(fromDate: string, dayOfMonth: number): string {
  const day = clampBillingDay(dayOfMonth);
  const [year, month] = fromDate.split("-").map(Number);
  return toDateString(new Date(Date.UTC(year, month, day)));
}

function getDatePlusDays(baseDate: string, days: number): string {
  const date = new Date(`${baseDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateString(date);
}

function monthLabel(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00Z`);
  return date.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

async function getOwnedPlan(ctx: any, id: string, email: string) {
  const plan = await ctx.db.get(id);
  if (!plan) throw new Error("Plan not found");
  if (plan.created_by !== email) throw new Error("Access denied");
  return plan;
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const plans = await ctx.db
      .query("servicePlans")
      .withIndex("by_created_by", (q) => q.eq("created_by", identity.email!))
      .order("desc")
      .collect();

    return await Promise.all(
      plans.map(async (plan) => {
        const customer = await ctx.db.get(plan.customer_id);
        return {
          ...plan,
          customer_name: customer?.full_name ?? "Unknown customer",
        };
      })
    );
  },
});

export const create = mutation({
  args: {
    customer_id: v.id("customers"),
    label: v.string(),
    amount: v.number(),
    day_of_month: v.number(),
    auto_send: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const customer = await ctx.db.get(args.customer_id);
    if (!customer || customer.created_by !== identity.email) {
      throw new Error("Customer not found or access denied");
    }

    const label = args.label.trim();
    if (!label) throw new Error("Plan needs a description");
    const amount = Number(args.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Plan amount must be greater than zero");
    }

    const dayOfMonth = clampBillingDay(args.day_of_month);
    const now = Date.now();

    return await ctx.db.insert("servicePlans", {
      customer_id: args.customer_id,
      created_by: identity.email!,
      business_id: customer.business_id,
      label,
      amount: Number(amount.toFixed(2)),
      day_of_month: dayOfMonth,
      auto_send: args.auto_send ?? true,
      status: "active",
      next_run_date: computeNextRunDate(todayDateString(now), dayOfMonth),
      last_invoice_id: undefined,
      created_at: now,
      updated_at: now,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("servicePlans"),
    label: v.optional(v.string()),
    amount: v.optional(v.number()),
    day_of_month: v.optional(v.number()),
    auto_send: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const plan = await getOwnedPlan(ctx, args.id, identity.email!);
    const now = Date.now();
    const patch: Record<string, unknown> = { updated_at: now };

    if (args.label !== undefined) {
      const label = args.label.trim();
      if (!label) throw new Error("Plan needs a description");
      patch.label = label;
    }
    if (args.amount !== undefined) {
      const amount = Number(args.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error("Plan amount must be greater than zero");
      }
      patch.amount = Number(amount.toFixed(2));
    }
    if (args.day_of_month !== undefined) {
      const day = clampBillingDay(args.day_of_month);
      patch.day_of_month = day;
      if (plan.status === "active") {
        patch.next_run_date = computeNextRunDate(todayDateString(now), day);
      }
    }
    if (args.auto_send !== undefined) {
      patch.auto_send = args.auto_send;
    }

    await ctx.db.patch(args.id, patch);
    return args.id;
  },
});

export const setStatus = mutation({
  args: {
    id: v.id("servicePlans"),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    if (!PLAN_STATUSES.includes(args.status as (typeof PLAN_STATUSES)[number])) {
      throw new Error(`Invalid plan status: "${args.status}"`);
    }

    await getOwnedPlan(ctx, args.id, identity.email!);
    const now = Date.now();
    const patch: Record<string, unknown> = { status: args.status, updated_at: now };

    if (args.status === "active") {
      const plan = await ctx.db.get(args.id);
      patch.next_run_date = computeNextRunDate(todayDateString(now), plan.day_of_month);
    }

    await ctx.db.patch(args.id, patch);
    return args.id;
  },
});

export const remove = mutation({
  args: { id: v.id("servicePlans") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    await getOwnedPlan(ctx, args.id, identity.email!);
    await ctx.db.delete(args.id);
    return args.id;
  },
});

/** Active plans whose billing day has arrived. */
export const listDuePlans = internalQuery({
  args: { today: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("servicePlans")
      .withIndex("by_status_and_next_run", (q) =>
        q.eq("status", "active").lte("next_run_date", args.today)
      )
      .collect();
  },
});

/**
 * Create the invoice for one due plan and advance its schedule.
 * Idempotent per run date: skips plans already advanced past today.
 */
export const createInvoiceForPlan = internalMutation({
  args: {
    plan_id: v.id("servicePlans"),
    today: v.string(),
  },
  handler: async (ctx, args) => {
    const plan = await ctx.db.get(args.plan_id);
    if (!plan) throw new Error("Plan not found");
    if (plan.status !== "active" || plan.next_run_date > args.today) {
      return { invoiceId: plan.last_invoice_id, created: false, created_by: plan.created_by };
    }

    const customer = await ctx.db.get(plan.customer_id);
    const now = Date.now();
    const amount = Number(plan.amount.toFixed(2));
    const description = `${plan.label} — ${monthLabel(plan.next_run_date)}`;

    const invoiceId = await ctx.db.insert("invoices", {
      customer_id: plan.customer_id,
      work_order_id: undefined,
      source_quote_id: undefined,
      service_log_id: undefined,
      created_by: plan.created_by,
      status: "draft",
      line_items: [
        { description, quantity: 1, unit_price: amount, amount },
      ],
      subtotal: amount,
      tax: 0,
      deposit_applied: undefined,
      total: amount,
      due_date: getDatePlusDays(args.today, RECURRING_INVOICE_DUE_DAYS),
      sent_at: undefined,
      paid_at: undefined,
      payment_url: undefined,
      stripe_checkout_session_id: undefined,
      stripe_payment_intent_id: undefined,
      notes: description,
      created_at: now,
      updated_at: now,
    });

    await ctx.db.patch(args.plan_id, {
      last_invoice_id: invoiceId,
      next_run_date: advanceMonthly(plan.next_run_date, plan.day_of_month),
      updated_at: now,
    });

    return { invoiceId, created: true, created_by: plan.created_by, customer };
  },
});

/**
 * Daily cron entry: generate invoices for every due plan, then send each one
 * with a Stripe payment link when auto_send is on and Stripe is configured.
 */
export const runDueBilling = internalAction({
  args: { today: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const today = args.today ?? todayDateString();
    const duePlans: any[] = await ctx.runQuery(internal.servicePlans.listDuePlans, { today });

    const appUrl = (process.env.APP_URL || DEFAULT_APP_URL).trim().replace(/\/+$/, "");
    let stripeSecretKey: string | undefined;
    try {
      stripeSecretKey = requireStripeConfig().secretKey;
    } catch {
      stripeSecretKey = undefined;
    }

    const summary = { generated: 0, sent: 0, failed: 0 };

    for (const plan of duePlans) {
      try {
        const result: any = await ctx.runMutation(internal.servicePlans.createInvoiceForPlan, {
          plan_id: plan._id,
          today,
        });
        if (!result.created || !result.invoiceId) continue;
        summary.generated += 1;

        if (!plan.auto_send) continue;

        let paymentUrl = `${appUrl}/billing?invoice_id=${result.invoiceId}`;
        let sessionId: string | undefined;

        if (stripeSecretKey) {
          const session = await createStripeCheckoutSession({
            stripeSecretKey,
            amountCents: Math.round(plan.amount * 100),
            customerEmail: result.customer?.email || undefined,
            customMessage: result.customer?.full_name
              ? `Paying invoice for ${result.customer.full_name}`
              : undefined,
            lineItemName: plan.label,
            lineItemDescription: `Recurring billing — ${monthLabel(today)}`,
            successUrl: `${appUrl}/billing?stripe_payment=invoice_success&invoice_id=${result.invoiceId}&session_id={CHECKOUT_SESSION_ID}`,
            cancelUrl: `${appUrl}/billing?stripe_payment=invoice_cancel&invoice_id=${result.invoiceId}`,
            clientReferenceId: String(result.invoiceId),
            metadata: {
              payment_type: "invoice",
              invoice_id: String(result.invoiceId),
            },
          });
          paymentUrl = session.url;
          sessionId = session.id;
        }

        await ctx.runMutation(internal.invoices.finalizeSend, {
          id: result.invoiceId,
          user_email: result.created_by,
          payment_url: paymentUrl,
          stripe_checkout_session_id: sessionId,
        });
        summary.sent += 1;
      } catch (error) {
        summary.failed += 1;
        console.error("runDueBilling failed for plan", plan._id, error);
      }
    }

    return summary;
  },
});
