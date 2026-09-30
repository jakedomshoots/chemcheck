/**
 * Recurring billing schedules (docs/WORK_TICKETS_API.md).
 *
 * A schedule creates one ticket + Square invoice per period, billed in
 * arrears: weekly runs on Monday 06:00 (business time zone) bill the Mon–Sun
 * week that just ended; monthly runs on the 1st at 06:00 bill the previous
 * calendar month. `billNow` bills the current period immediately; the later
 * scheduled run for that period finds the existing ticket and only advances.
 *
 * Idempotency: one ticket per (schedule_id, period_key). A failed Square send
 * keeps the draft ticket, records `last_error`, and retries on the next hourly
 * cron without advancing; after MAX_RUN_ATTEMPTS the schedule advances and the
 * draft stays for a manual send.
 */

import { v } from "convex/values";
import { type ActionCtx, action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { CUSTOMER_WRITE_ROLES } from "./access";
import { enforceRateLimit } from "./rateLimit";
import { buildSendContext, requireBusinessCustomer, requireBusinessRole } from "./tickets";
import { computeScheduleBill, nextBilledPeriod } from "./billingCompute";
import { findCardOnFile, findSquareCustomer, pushTicketToSquare, readableSquareError, requireTicketSeller, type TicketSendContext } from "./squareInvoices";
import {
  type Cadence,
  type TicketItemCents,
  centsToDollars,
  currentPeriod,
  dollarsToCents,
  itemsToDollars,
  itemsTotalCents,
  MAX_ITEM_AMOUNT_CENTS,
  nextRunAt,
  normalizeNote,
  normalizeTicketItems,
  periodBilledByRunAt,
  safeTimeZone,
} from "./ticketLogic";

export const MAX_RUN_ATTEMPTS = 24;
const MAX_SCHEDULES_PER_BUSINESS = 500;
const DUE_BATCH = 25;

const cadenceValidator = v.union(v.literal("weekly"), v.literal("monthly"));
const modeValidator = v.union(v.literal("fixed"), v.literal("visits"));
const itemValidator = v.object({ label: v.string(), amount: v.number() });

type TicketItem = { label: string; amount: number };

export type ScheduleView = {
  _id: Id<"billingSchedules">;
  customer_id: Id<"customers">;
  customer_name: string;
  cadence: "weekly" | "monthly";
  bill_mode: "fixed" | "visits";
  rate: number;
  items: TicketItem[];
  note: string;
  autopay: boolean;
  card_label?: string;
  paused: boolean;
  next_run_at: number | null;
  preview: { period_label: string; items: TicketItem[]; total: number; unpriced_chemicals: string[] };
  history: { ticket_id: Id<"tickets">; period_label: string; total: number; status: string; square_invoice_number?: string }[];
  last_error?: string;
};

async function identityEmail(ctx: any): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.email) throw new Error("Not authenticated");
  return identity.email as string;
}

async function billingAccessOrNull(ctx: any) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.email) return null;
  try {
    return await requireBusinessRole(ctx, identity.email, CUSTOMER_WRITE_ROLES);
  } catch {
    return null;
  }
}

/** Rate (dollars) -> cents with the same bounds as line items. */
export function normalizeRate(rate: number): number {
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0) throw new Error("Rate must be a positive amount.");
  const cents = dollarsToCents(rate);
  if (cents > MAX_ITEM_AMOUNT_CENTS) throw new Error("Rate cannot be more than $100,000.");
  return cents;
}

/** Validated schedule billing fields. Fixed: rate = sum(items) when items are given. */
export function normalizeScheduleBilling(input: { bill_mode: string; rate: number; items: TicketItem[] }): {
  rate_cents: number;
  items: TicketItemCents[];
} {
  const items = normalizeTicketItems(input.items);
  const rateCents = normalizeRate(input.rate);
  if (input.bill_mode === "fixed") {
    const total = items.length > 0 ? itemsTotalCents(items) : rateCents;
    if (!(total > 0)) throw new Error("A fixed schedule needs an amount.");
    return { rate_cents: total, items };
  }
  if (!(rateCents > 0)) throw new Error("Set the amount per visit.");
  return { rate_cents: rateCents, items: [] };
}

async function toView(ctx: any, schedule: Doc<"billingSchedules">, business: Doc<"businesses">, now: number): Promise<ScheduleView> {
  const tz = safeTimeZone(business.timezone);
  const customer = await ctx.db.get(schedule.customer_id);
  const period = nextBilledPeriod(schedule, tz, now);
  const bill = await computeScheduleBill(ctx, schedule, business, period);
  const tickets = await ctx.db
    .query("tickets")
    .withIndex("by_schedule_and_period", (q: any) => q.eq("schedule_id", schedule._id))
    .take(100);
  const history = tickets
    .sort((a: any, b: any) => b.created_at - a.created_at)
    .slice(0, 24)
    .map((ticket: any) => ({
      ticket_id: ticket._id,
      period_label: ticket.period_label ?? ticket.period_key ?? "",
      total: centsToDollars(ticket.total_cents),
      status: ticket.status,
      ...(ticket.square_invoice_number ? { square_invoice_number: ticket.square_invoice_number } : {}),
    }));
  return {
    _id: schedule._id,
    customer_id: schedule.customer_id,
    customer_name: customer?.full_name || "Customer",
    cadence: schedule.cadence as ScheduleView["cadence"],
    bill_mode: schedule.bill_mode as ScheduleView["bill_mode"],
    rate: centsToDollars(schedule.rate_cents),
    items: itemsToDollars(schedule.items),
    note: schedule.note,
    autopay: schedule.autopay,
    ...(schedule.card_label ? { card_label: schedule.card_label } : {}),
    paused: schedule.paused,
    next_run_at: schedule.paused ? null : schedule.next_run_at ?? null,
    preview: {
      period_label: period.label,
      items: itemsToDollars(bill.items),
      total: centsToDollars(bill.total_cents),
      unpriced_chemicals: bill.unpriced,
    },
    history,
    ...(schedule.last_error ? { last_error: schedule.last_error } : {}),
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const list = query({
  args: {},
  handler: async (ctx): Promise<ScheduleView[]> => {
    const access = await billingAccessOrNull(ctx);
    if (!access) return [];
    const now = Date.now();
    const rows = await ctx.db
      .query("billingSchedules")
      .withIndex("by_business", (q) => q.eq("business_id", access.businessId))
      .take(MAX_SCHEDULES_PER_BUSINESS);
    const views: ScheduleView[] = [];
    for (const row of rows) views.push(await toView(ctx, row, access.business, now));
    return views.sort((a, b) => a.customer_name.localeCompare(b.customer_name));
  },
});

export const get = query({
  args: { id: v.id("billingSchedules") },
  handler: async (ctx, args): Promise<ScheduleView | null> => {
    const access = await billingAccessOrNull(ctx);
    if (!access) return null;
    const schedule = await ctx.db.get(args.id);
    if (!schedule || String(schedule.business_id) !== String(access.businessId)) return null;
    return await toView(ctx, schedule, access.business, Date.now());
  },
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

async function loadSchedule(ctx: any, businessId: Id<"businesses">, id: Id<"billingSchedules">): Promise<Doc<"billingSchedules">> {
  const schedule = await ctx.db.get(id);
  if (!schedule || String(schedule.business_id) !== String(businessId)) throw new Error("Billing schedule not found.");
  return schedule;
}

export const create = mutation({
  args: {
    customer_id: v.id("customers"),
    cadence: cadenceValidator,
    bill_mode: modeValidator,
    rate: v.number(),
    items: v.array(itemValidator),
    note: v.string(),
    autopay: v.boolean(),
  },
  handler: async (ctx, args): Promise<Id<"billingSchedules">> => {
    const email = await identityEmail(ctx);
    await enforceRateLimit(ctx, email, "schedule.write");
    const access = await requireBusinessRole(ctx, email, CUSTOMER_WRITE_ROLES);
    await requireBusinessCustomer(ctx, access, args.customer_id, CUSTOMER_WRITE_ROLES);
    const existing = await ctx.db
      .query("billingSchedules")
      .withIndex("by_business", (q) => q.eq("business_id", access.businessId))
      .take(MAX_SCHEDULES_PER_BUSINESS);
    if (existing.length >= MAX_SCHEDULES_PER_BUSINESS) throw new Error("Billing schedule limit reached.");
    const billing = normalizeScheduleBilling(args);
    const now = Date.now();
    const tz = safeTimeZone(access.business.timezone);
    return await ctx.db.insert("billingSchedules", {
      business_id: access.businessId,
      customer_id: args.customer_id,
      created_by: access.tenantEmail,
      cadence: args.cadence,
      bill_mode: args.bill_mode,
      rate_cents: billing.rate_cents,
      items: billing.items,
      note: normalizeNote(args.note),
      autopay: args.autopay,
      paused: false,
      next_run_at: nextRunAt(args.cadence, now, tz),
      created_at: now,
      updated_at: now,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("billingSchedules"),
    customer_id: v.optional(v.id("customers")),
    cadence: v.optional(cadenceValidator),
    bill_mode: v.optional(modeValidator),
    rate: v.optional(v.number()),
    items: v.optional(v.array(itemValidator)),
    note: v.optional(v.string()),
    autopay: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const email = await identityEmail(ctx);
    await enforceRateLimit(ctx, email, "schedule.write");
    const access = await requireBusinessRole(ctx, email, CUSTOMER_WRITE_ROLES);
    const schedule = await loadSchedule(ctx, access.businessId, args.id);
    if (args.customer_id && args.customer_id !== schedule.customer_id) {
      await requireBusinessCustomer(ctx, access, args.customer_id, CUSTOMER_WRITE_ROLES);
    }
    const billMode = args.bill_mode ?? schedule.bill_mode;
    const billing = normalizeScheduleBilling({
      bill_mode: billMode,
      rate: args.rate ?? centsToDollars(schedule.rate_cents),
      items: args.items ?? (args.bill_mode === "visits" ? [] : itemsToDollars(schedule.items)),
    });
    const now = Date.now();
    const cadence = (args.cadence ?? schedule.cadence) as Cadence;
    const patch: Partial<Doc<"billingSchedules">> = {
      customer_id: args.customer_id ?? schedule.customer_id,
      cadence,
      bill_mode: billMode,
      rate_cents: billing.rate_cents,
      items: billing.items,
      note: args.note === undefined ? schedule.note : normalizeNote(args.note),
      autopay: args.autopay ?? schedule.autopay,
      updated_at: now,
    };
    if (args.customer_id && args.customer_id !== schedule.customer_id) patch.card_label = undefined;
    if (cadence !== schedule.cadence && !schedule.paused) {
      patch.next_run_at = nextRunAt(cadence, now, safeTimeZone(access.business.timezone));
    }
    await ctx.db.patch(schedule._id, patch);
    return null;
  },
});

export const setPaused = mutation({
  args: { id: v.id("billingSchedules"), paused: v.boolean() },
  handler: async (ctx, args) => {
    const email = await identityEmail(ctx);
    await enforceRateLimit(ctx, email, "schedule.write");
    const access = await requireBusinessRole(ctx, email, CUSTOMER_WRITE_ROLES);
    const schedule = await loadSchedule(ctx, access.businessId, args.id);
    const now = Date.now();
    await ctx.db.patch(schedule._id, {
      paused: args.paused,
      // Paused schedules leave the due index; resuming never back-bills paused periods.
      next_run_at: args.paused ? undefined : nextRunAt(schedule.cadence as Cadence, now, safeTimeZone(access.business.timezone)),
      failed_attempts: args.paused ? schedule.failed_attempts : 0,
      updated_at: now,
    });
    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("billingSchedules") },
  handler: async (ctx, args) => {
    const email = await identityEmail(ctx);
    await enforceRateLimit(ctx, email, "schedule.write");
    const access = await requireBusinessRole(ctx, email, CUSTOMER_WRITE_ROLES);
    const schedule = await loadSchedule(ctx, access.businessId, args.id);
    await ctx.db.delete(schedule._id);
    return null;
  },
});

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

type PrepareResult =
  | { kind: "skip_zero"; period_key: string }
  | { kind: "done"; period_key: string; ticket_id: Id<"tickets">; status: string; square_invoice_number?: string }
  | { kind: "send"; period_key: string; autopay: boolean; sc: TicketSendContext };

/**
 * Find or create the period's ticket (idempotent per schedule + period_key).
 * mode "scheduled" bills the period the due run covers; "now" bills the current period.
 */
export const prepareRun = internalMutation({
  args: { schedule_id: v.id("billingSchedules"), mode: v.union(v.literal("scheduled"), v.literal("now")), now: v.number() },
  handler: async (ctx, args): Promise<PrepareResult> => {
    const schedule = await ctx.db.get(args.schedule_id);
    if (!schedule) throw new Error("Billing schedule not found.");
    const business = await ctx.db.get(schedule.business_id);
    if (!business) throw new Error("Business not found.");
    const tz = safeTimeZone(business.timezone);
    const cadence = schedule.cadence as Cadence;
    const period = args.mode === "now"
      ? currentPeriod(cadence, args.now, tz)
      : periodBilledByRunAt(cadence, schedule.next_run_at ?? args.now, tz);

    const existing = await ctx.db
      .query("tickets")
      .withIndex("by_schedule_and_period", (q) => q.eq("schedule_id", schedule._id).eq("period_key", period.key))
      .first();
    if (existing) {
      if (existing.status === "draft") {
        return { kind: "send", period_key: period.key, autopay: schedule.autopay, sc: await buildSendContext(ctx, existing) };
      }
      return {
        kind: "done",
        period_key: period.key,
        ticket_id: existing._id,
        status: existing.status,
        square_invoice_number: existing.square_invoice_number,
      };
    }

    const customer = await ctx.db.get(schedule.customer_id);
    if (!customer) throw new Error("The customer on this schedule no longer exists.");
    const bill = await computeScheduleBill(ctx, schedule, business, period);
    if (!(bill.total_cents > 0)) return { kind: "skip_zero", period_key: period.key };

    const now = Date.now();
    const ticketId = await ctx.db.insert("tickets", {
      business_id: schedule.business_id,
      created_by: business.owner_email,
      customer_id: schedule.customer_id,
      kind: "charge",
      status: "draft",
      note: schedule.note,
      items: bill.items,
      total_cents: bill.total_cents,
      photo_storage_ids: [],
      schedule_id: schedule._id,
      period_key: period.key,
      period_label: period.label,
      timeline: [{ type: "created", text: `Created by ${cadence} billing for ${period.label}`, at: now }],
      created_at: now,
      updated_at: now,
    });
    const ticket = (await ctx.db.get(ticketId))!;
    return { kind: "send", period_key: period.key, autopay: schedule.autopay, sc: await buildSendContext(ctx, ticket) };
  },
});

/** Pure decision for a finished run. */
export function scheduleRunOutcome(
  schedule: { cadence: string; next_run_at?: number; failed_attempts?: number },
  result: { ok: boolean; advance: boolean; error?: string },
  tz: string,
  now: number,
): { next_run_at?: number; failed_attempts: number; last_error?: string } {
  const from = schedule.next_run_at ?? now;
  const advanced = nextRunAt(schedule.cadence as Cadence, from, tz);
  if (result.ok) {
    return { next_run_at: result.advance ? advanced : schedule.next_run_at, failed_attempts: 0, last_error: undefined };
  }
  const attempts = (schedule.failed_attempts ?? 0) + 1;
  const error = (result.error || "Billing failed.").slice(0, 280);
  if (result.advance && attempts >= MAX_RUN_ATTEMPTS) {
    return { next_run_at: advanced, failed_attempts: 0, last_error: `${error} (Gave up after ${MAX_RUN_ATTEMPTS} tries; the draft ticket is saved.)` };
  }
  return { next_run_at: schedule.next_run_at, failed_attempts: attempts, last_error: error };
}

export const finishRun = internalMutation({
  args: {
    schedule_id: v.id("billingSchedules"),
    ok: v.boolean(),
    advance: v.boolean(),
    period_key: v.string(),
    error: v.optional(v.string()),
    card_label: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const schedule = await ctx.db.get(args.schedule_id);
    if (!schedule) return null;
    const business = await ctx.db.get(schedule.business_id);
    const outcome = scheduleRunOutcome(schedule, args, safeTimeZone(business?.timezone), Date.now());
    await ctx.db.patch(schedule._id, {
      next_run_at: schedule.paused ? undefined : outcome.next_run_at,
      failed_attempts: outcome.failed_attempts,
      last_error: outcome.last_error,
      ...(args.ok ? { last_period_key: args.period_key } : {}),
      ...(args.card_label ? { card_label: args.card_label } : {}),
      updated_at: Date.now(),
    });
    return null;
  },
});

async function runSchedule(
  ctx: ActionCtx,
  scheduleId: Id<"billingSchedules">,
  mode: "scheduled" | "now",
): Promise<{ ticket_id?: Id<"tickets">; status: string; square_invoice_number?: string; error?: string }> {
  const advance = mode === "scheduled";
  let prep: PrepareResult;
  try {
    prep = await ctx.runMutation(internal.billingSchedules.prepareRun, { schedule_id: scheduleId, mode, now: Date.now() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await ctx.runMutation(internal.billingSchedules.finishRun, { schedule_id: scheduleId, ok: false, advance, period_key: "", error: message });
    return { status: "error", error: message };
  }
  if (prep.kind === "skip_zero") {
    if (!advance) return { status: "skipped" };
    await ctx.runMutation(internal.billingSchedules.finishRun, { schedule_id: scheduleId, ok: true, advance, period_key: prep.period_key });
    return { status: "skipped" };
  }
  if (prep.kind === "done") {
    await ctx.runMutation(internal.billingSchedules.finishRun, { schedule_id: scheduleId, ok: true, advance, period_key: prep.period_key });
    return { ticket_id: prep.ticket_id, status: prep.status, square_invoice_number: prep.square_invoice_number };
  }
  try {
    const result = await pushTicketToSquare(ctx, prep.sc, {
      fromStatuses: ["draft"],
      autopay: prep.autopay,
      events: [],
    });
    await ctx.runMutation(internal.billingSchedules.finishRun, {
      schedule_id: scheduleId,
      ok: true,
      advance,
      period_key: prep.period_key,
      card_label: result.card_label,
    });
    return { ticket_id: prep.sc.ticket_id, status: result.status, square_invoice_number: result.square_invoice_number };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await ctx.runMutation(internal.billingSchedules.finishRun, {
      schedule_id: scheduleId,
      ok: false,
      advance,
      period_key: prep.period_key,
      error: message,
    });
    return { ticket_id: prep.sc.ticket_id, status: "draft", error: message };
  }
}

export const listDue = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, args): Promise<Id<"billingSchedules">[]> => {
    const rows = await ctx.db
      .query("billingSchedules")
      .withIndex("by_next_run_at", (q) => q.gte("next_run_at", 0).lte("next_run_at", args.now))
      .take(DUE_BATCH);
    return rows.filter((row) => !row.paused).map((row) => row._id);
  },
});

/** Hourly cron: bill every due, unpaused schedule once. */
export const runDueSchedules = internalAction({
  args: {},
  handler: async (ctx) => {
    const due: Id<"billingSchedules">[] = await ctx.runQuery(internal.billingSchedules.listDue, { now: Date.now() });
    let billed = 0;
    let failed = 0;
    for (const id of due) {
      const result = await runSchedule(ctx, id, "scheduled");
      if (result.error) {
        failed += 1;
        console.error("[Billing] Schedule run failed", { schedule_id: String(id), message: result.error });
      } else {
        billed += 1;
      }
    }
    return { due: due.length, billed, failed };
  },
});

export const getForBillNow = internalMutation({
  args: { user_email: v.string(), id: v.id("billingSchedules") },
  handler: async (ctx, args): Promise<Id<"billingSchedules">> => {
    await enforceRateLimit(ctx, args.user_email, "ticket.send");
    const access = await requireBusinessRole(ctx, args.user_email, CUSTOMER_WRITE_ROLES);
    const schedule = await loadSchedule(ctx, access.businessId, args.id);
    return schedule._id;
  },
});

export const billNow = action({
  args: { id: v.id("billingSchedules") },
  handler: async (ctx, args): Promise<{ ticket_id: Id<"tickets">; status: string; square_invoice_number?: string }> => {
    const email = await identityEmail(ctx);
    const scheduleId: Id<"billingSchedules"> = await ctx.runMutation(internal.billingSchedules.getForBillNow, { user_email: email, id: args.id });
    const result = await runSchedule(ctx, scheduleId, "now");
    if (result.error) throw new Error(result.error);
    if (!result.ticket_id) throw new Error("Nothing to bill for this period yet.");
    return {
      ticket_id: result.ticket_id,
      status: result.status,
      ...(result.square_invoice_number ? { square_invoice_number: result.square_invoice_number } : {}),
    };
  },
});

// ---------------------------------------------------------------------------
// Card on file
// ---------------------------------------------------------------------------

export const getCustomerForCard = internalMutation({
  args: { user_email: v.string(), customer_id: v.id("customers") },
  handler: async (ctx, args) => {
    await enforceRateLimit(ctx, args.user_email, "payment.link");
    const access = await requireBusinessRole(ctx, args.user_email, CUSTOMER_WRITE_ROLES);
    const customer = await requireBusinessCustomer(ctx, access, args.customer_id, CUSTOMER_WRITE_ROLES);
    return {
      business_id: access.businessId,
      customer: {
        _id: customer._id,
        full_name: customer.full_name,
        email: customer.email ?? null,
        phone: customer.phone ?? null,
        square_customer_id: customer.square_customer_id ?? null,
        square_merchant_id: customer.square_merchant_id ?? null,
      },
    };
  },
});

export const cacheCardLabel = internalMutation({
  args: { business_id: v.id("businesses"), customer_id: v.id("customers"), card_label: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("billingSchedules")
      .withIndex("by_customer", (q) => q.eq("customer_id", args.customer_id))
      .take(20);
    for (const row of rows) {
      if (String(row.business_id) !== String(args.business_id) || row.card_label === args.card_label) continue;
      await ctx.db.patch(row._id, { card_label: args.card_label, updated_at: Date.now() });
    }
    return null;
  },
});

export const customerCard = action({
  args: { customer_id: v.id("customers") },
  handler: async (ctx, args): Promise<{ card_label: string | null }> => {
    const email = await identityEmail(ctx);
    const info: {
      business_id: Id<"businesses">;
      customer: { _id: Id<"customers">; full_name: string; email: string | null; phone: string | null; square_customer_id: string | null; square_merchant_id: string | null };
    } = await ctx.runMutation(internal.billingSchedules.getCustomerForCard, { user_email: email, customer_id: args.customer_id });
    const seller = await requireTicketSeller(ctx, info.business_id);
    let label: string | null = null;
    try {
      const squareCustomerId = await findSquareCustomer(seller, info.customer);
      const card = squareCustomerId ? await findCardOnFile(seller, squareCustomerId) : null;
      label = card?.label ?? null;
    } catch (error) {
      throw new Error(readableSquareError(error, "look up cards on file"));
    }
    await ctx.runMutation(internal.billingSchedules.cacheCardLabel, {
      business_id: info.business_id,
      customer_id: args.customer_id,
      card_label: label ?? undefined,
    });
    return { card_label: label };
  },
});
