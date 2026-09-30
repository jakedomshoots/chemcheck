import { describe, expect, it } from "vitest";
import {
  addDays,
  assertSendableTotal,
  canUseAutopay,
  cardLabel,
  centsToDollars,
  countCompletedVisits,
  currentPeriod,
  dollarsToCents,
  invoiceDeliveryPlan,
  invoiceDueDate,
  isOverdue,
  itemsTotalCents,
  legacyInvoiceStatus,
  legacyQuoteStatus,
  matchesFilter,
  nextRunAt,
  normalizeTicketItems,
  parseQuantity,
  periodBilledByRunAt,
  planTicketInvoiceEvent,
  scopesNeedReconnect,
  ticketIdempotencyKey,
  visitsBillItems,
  invoiceEventFacts,
} from "./ticketLogic";
import { buildExternalPaymentBody, buildInvoiceBody, squarePhone } from "./squareInvoices";
import { applyInvoiceEvent, buildQuoteMessage, legacyInvoiceToTicket, legacyQuoteToTicket, migrateLegacy } from "./tickets";
import { normalizeScheduleBilling, prepareRun, scheduleRunOutcome, MAX_RUN_ATTEMPTS } from "./billingSchedules";
import { normalizeChemicalPrices } from "./chemicalPrices";
import { connectionNeedsReconnect } from "./squareConnect";
import { planSquareWebhookEvent } from "./squareWebhook";
import { SELLER_OAUTH_SCOPES } from "./squareApi";

// ---------------------------------------------------------------------------
// Minimal in-memory Convex db (indexes are emulated with field filters).
// ---------------------------------------------------------------------------
type Row = Record<string, any> & { _id: string };

function createFakeDb(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {};
  let counter = 0;
  for (const [table, rows] of Object.entries(seed)) tables[table] = rows.map((row) => ({ ...row }));
  const tableOf = (id: string) => id.split(":")[0];

  function query(table: string) {
    const constraints: Array<(row: Row) => boolean> = [];
    let descending = false;
    const builder: any = {
      eq(field: string, value: unknown) {
        constraints.push((row) => row[field] === value);
        return builder;
      },
      gt(field: string, value: any) {
        constraints.push((row) => row[field] !== undefined && row[field] > value);
        return builder;
      },
      gte(field: string, value: any) {
        constraints.push((row) => row[field] !== undefined && row[field] >= value);
        return builder;
      },
      lt(field: string, value: any) {
        constraints.push((row) => row[field] !== undefined && row[field] < value);
        return builder;
      },
      lte(field: string, value: any) {
        constraints.push((row) => row[field] !== undefined && row[field] <= value);
        return builder;
      },
    };
    const rows = () => {
      const found = (tables[table] ?? []).filter((row) => constraints.every((c) => c(row)));
      return descending ? [...found].reverse() : found;
    };
    const q: any = {
      withIndex(_name: string, fn?: (b: any) => any) {
        if (fn) fn(builder);
        return q;
      },
      order(direction: string) {
        descending = direction === "desc";
        return q;
      },
      async first() {
        return rows()[0] ?? null;
      },
      async take(n: number) {
        return rows().slice(0, n);
      },
      async collect() {
        return rows();
      },
      [Symbol.asyncIterator]() {
        const all = rows();
        let i = 0;
        return {
          async next() {
            return i < all.length ? { value: all[i++], done: false } : { value: undefined, done: true };
          },
        };
      },
      async paginate({ cursor, numItems }: { cursor: string | null; numItems: number }) {
        const all = rows();
        const start = cursor ? Number(cursor) : 0;
        const page = all.slice(start, start + numItems);
        const end = start + page.length;
        return { page, isDone: end >= all.length, continueCursor: String(end) };
      },
    };
    return q;
  }

  return {
    tables,
    query,
    async get(id: string) {
      return (tables[tableOf(String(id))] ?? []).find((row) => row._id === id) ?? null;
    },
    normalizeId(table: string, id: string) {
      return typeof id === "string" && id.startsWith(`${table}:`) ? id : null;
    },
    async insert(table: string, doc: Record<string, any>) {
      const _id = `${table}:new${++counter}`;
      (tables[table] ??= []).push({ ...doc, _id });
      return _id;
    },
    async patch(id: string, fields: Record<string, any>) {
      const row = (tables[tableOf(id)] ?? []).find((r) => r._id === id);
      if (!row) throw new Error(`missing ${id}`);
      for (const [key, value] of Object.entries(fields)) {
        if (value === undefined) delete row[key];
        else row[key] = value;
      }
    },
    async delete(id: string) {
      const table = tables[tableOf(id)] ?? [];
      const index = table.findIndex((r) => r._id === id);
      if (index >= 0) table.splice(index, 1);
    },
    system: { async get() { return null; } },
  };
}

const call = (fn: any, ctx: any, args: any = {}) => fn._handler(ctx, args);
const TZ = "America/Chicago";
const settings = {
  working_days: [],
  working_hours_start: "08:00",
  working_hours_end: "17:00",
  service_types: [],
  chemical_types: [],
  route_optimization: true,
  require_photos: false,
  require_signatures: false,
};

// ---------------------------------------------------------------------------

describe("ticket items and money", () => {
  it("converts dollars to integer cents without float drift", () => {
    expect(dollarsToCents(0.1 + 0.2)).toBe(30);
    expect(dollarsToCents(19.995)).toBe(2000);
    expect(centsToDollars(1999)).toBe(19.99);
    const items = normalizeTicketItems([{ label: "  Green pool cleanup ", amount: 250.5 }, { label: "Chlorine", amount: 0 }]);
    expect(items).toEqual([{ label: "Green pool cleanup", amount_cents: 25050 }, { label: "Chlorine", amount_cents: 0 }]);
    expect(itemsTotalCents(items)).toBe(25050);
  });

  it("rejects bad items with readable errors", () => {
    expect(() => normalizeTicketItems([{ label: "", amount: 1 }])).toThrow(/description/);
    expect(() => normalizeTicketItems([{ label: "x".repeat(121), amount: 1 }])).toThrow(/120/);
    expect(() => normalizeTicketItems([{ label: "a", amount: -1 }])).toThrow(/negative/);
    expect(() => normalizeTicketItems([{ label: "a", amount: Number.NaN }])).toThrow(/number/);
    expect(() => normalizeTicketItems([{ label: "a", amount: Number.POSITIVE_INFINITY }])).toThrow(/number/);
    expect(() => normalizeTicketItems([{ label: "a", amount: 100_000.01 }])).toThrow(/100,000/);
    expect(normalizeTicketItems([{ label: "a", amount: 100_000 }])[0].amount_cents).toBe(10_000_000);
    expect(() => normalizeTicketItems(Array.from({ length: 51 }, () => ({ label: "a", amount: 1 })))).toThrow(/50/);
    expect(() => assertSendableTotal(0)).toThrow();
    expect(() => assertSendableTotal(1)).not.toThrow();
  });

  it("filters and derives overdue", () => {
    expect(matchesFilter("draft", "open")).toBe(true);
    expect(matchesFilter("requested", "open")).toBe(true);
    expect(matchesFilter("quote", "open")).toBe(false);
    expect(matchesFilter("paid", "paid")).toBe(true);
    expect(matchesFilter("canceled", undefined)).toBe(true);
    expect(isOverdue({ status: "requested", square_due_date: "2026-09-29" }, "2026-09-30")).toBe(true);
    expect(isOverdue({ status: "requested", square_due_date: "2026-09-30" }, "2026-09-30")).toBe(false);
    expect(isOverdue({ status: "paid", square_due_date: "2026-01-01" }, "2026-09-30")).toBe(false);
  });

  it("builds deterministic, bounded idempotency keys that change with content", () => {
    const items = [{ label: "A", amount_cents: 100 }];
    const id = "tickets:jd7abc123def456ghi789jkl012";
    expect(ticketIdempotencyKey(id, "o1", items)).toBe(ticketIdempotencyKey(id, "o1", items));
    expect(ticketIdempotencyKey(id, "o1", items)).not.toBe(ticketIdempotencyKey(id, "o2", items));
    expect(ticketIdempotencyKey(id, "o1", items)).not.toBe(ticketIdempotencyKey(id, "o1", [{ label: "A", amount_cents: 101 }]));
    expect(ticketIdempotencyKey(id, "pub-XXXXXXXXXXXX").length).toBeLessThanOrEqual(45);
  });
});

describe("Square delivery rule", () => {
  it("emails when there is an email, texts the link when only a phone, else share manually", () => {
    expect(invoiceDeliveryPlan({ email: "a@b.co", phone: "5125550100" })).toEqual({ delivery_method: "EMAIL", delivered_via: "email" });
    expect(invoiceDeliveryPlan({ email: null, phone: "+15125550100" })).toEqual({ delivery_method: "SHARE_MANUALLY", delivered_via: "sms" });
    expect(invoiceDeliveryPlan({ email: " ", phone: "" })).toEqual({ delivery_method: "SHARE_MANUALLY", delivered_via: "link" });
  });

  it("uses autopay only with a card on file and email delivery", () => {
    expect(canUseAutopay(true, "ccof:1", "EMAIL")).toBe(true);
    expect(canUseAutopay(true, "ccof:1", "SHARE_MANUALLY")).toBe(false);
    expect(canUseAutopay(true, null, "EMAIL")).toBe(false);
    expect(canUseAutopay(false, "ccof:1", "EMAIL")).toBe(false);
  });

  it("builds the invoice body with saved-card support and autopay", () => {
    const base = {
      idempotencyKey: "k",
      locationId: "L1",
      orderId: "O1",
      squareCustomerId: "C1",
      dueDate: "2026-10-07",
      title: "Acme Pools invoice",
    };
    const email = buildInvoiceBody({ ...base, deliveryMethod: "EMAIL" });
    expect(email.invoice.store_payment_method_enabled).toBe(true);
    expect(email.invoice.delivery_method).toBe("EMAIL");
    expect(email.invoice.payment_requests[0]).toMatchObject({ request_type: "BALANCE", due_date: "2026-10-07" });
    expect(email.invoice.payment_requests[0].automatic_payment_source).toBeUndefined();
    expect(email.invoice.payment_requests[0].reminders.length).toBeGreaterThan(0);

    const autopay = buildInvoiceBody({ ...base, deliveryMethod: "EMAIL", cardId: "ccof:9" });
    expect(autopay.invoice.payment_requests[0]).toMatchObject({ automatic_payment_source: "CARD_ON_FILE", card_id: "ccof:9" });

    const manual = buildInvoiceBody({ ...base, deliveryMethod: "SHARE_MANUALLY", cardId: "ccof:9" });
    expect(manual.invoice.payment_requests[0].automatic_payment_source).toBeUndefined();
    expect(manual.invoice.payment_requests[0].reminders).toBeUndefined();
  });

  it("records cash with CASH details and check/other as EXTERNAL", () => {
    const common = { idempotencyKey: "k", orderId: "O", locationId: "L", amountCents: 5000 };
    expect(buildExternalPaymentBody({ ...common, method: "cash" })).toMatchObject({
      source_id: "CASH",
      cash_details: { buyer_supplied_money: { amount: 5000, currency: "USD" } },
      order_id: "O",
    });
    expect(buildExternalPaymentBody({ ...common, method: "check" })).toMatchObject({ source_id: "EXTERNAL", external_details: { type: "CHECK" } });
    expect(buildExternalPaymentBody({ ...common, method: "other" })).toMatchObject({ source_id: "EXTERNAL", external_details: { type: "OTHER" } });
  });

  it("normalizes phones to E.164 and labels cards", () => {
    expect(squarePhone("(512) 555-0100")).toBe("+15125550100");
    expect(squarePhone("+44 20 7946 0958")).toBe("+442079460958");
    expect(squarePhone("123")).toBeUndefined();
    expect(cardLabel({ card_brand: "VISA", last_4: "4242" })).toBe("Visa •• 4242");
    expect(cardLabel({ card_brand: "AMERICAN_EXPRESS", last_4: "0005" })).toBe("Amex •• 0005");
    expect(cardLabel({ enabled: false })).toBeNull();
  });

  it("keeps quote texts within an SMS and lists items and total", () => {
    const items = Array.from({ length: 40 }, (_, i) => ({ label: `Repair part number ${i + 1} with a long name`, amount_cents: 1000 }));
    const sms = buildQuoteMessage({ businessName: "Acme", customerName: "Jane Doe", items, totalCents: 40000, note: "", channel: "sms" });
    expect(sms.length).toBeLessThanOrEqual(640);
    expect(sms).toContain("Total: $400.00");
    expect(sms).toMatch(/\+\d+ more/);
    const email = buildQuoteMessage({ businessName: "Acme", customerName: "Jane", items: items.slice(0, 2), totalCents: 2000, note: "Thanks", channel: "email" });
    expect(email).toContain("- Repair part number 1 with a long name: $10.00");
    expect(email).toContain("Thanks");
  });
});

describe("due dates and billing periods", () => {
  it("computes the due date from today in the business time zone", () => {
    // 03:00 UTC Oct 1 is still Sep 30 in Chicago.
    expect(invoiceDueDate(Date.parse("2026-10-01T03:00:00Z"), TZ, 7)).toBe("2026-10-07");
    expect(invoiceDueDate(Date.parse("2026-10-01T03:00:00Z"), "UTC", 7)).toBe("2026-10-08");
    expect(invoiceDueDate(Date.parse("2026-12-28T15:00:00Z"), TZ, 7)).toBe("2027-01-04");
    expect(invoiceDueDate(Date.parse("2026-09-30T15:00:00Z"), "Not/AZone", Number.NaN)).toBe("2026-10-07");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("bills the week that just ended on the Monday run", () => {
    const run = Date.parse("2026-09-28T11:00:00Z"); // Monday 06:00 CDT
    expect(periodBilledByRunAt("weekly", run, TZ)).toEqual({ key: "2026-W39", start: "2026-09-21", end: "2026-09-27", label: "Sep 21 – Sep 27" });
    // ISO week 1 of 2027 starts Monday Jan 4; the week of Dec 28 is 2026-W53.
    expect(currentPeriod("weekly", Date.parse("2026-12-30T18:00:00Z"), TZ).key).toBe("2026-W53");
    expect(currentPeriod("weekly", Date.parse("2027-01-05T18:00:00Z"), TZ).key).toBe("2027-W01");
  });

  it("bills the previous month on the 1st, across year and leap boundaries", () => {
    expect(periodBilledByRunAt("monthly", Date.parse("2027-01-01T12:00:00Z"), TZ)).toMatchObject({ key: "2026-12", start: "2026-12-01", end: "2026-12-31", label: "December 2026" });
    expect(periodBilledByRunAt("monthly", Date.parse("2026-03-01T12:00:00Z"), TZ)).toMatchObject({ key: "2026-02", end: "2026-02-28" });
    expect(periodBilledByRunAt("monthly", Date.parse("2028-03-01T12:00:00Z"), TZ)).toMatchObject({ key: "2028-02", end: "2028-02-29" });
    // Late evening Sep 30 in Chicago is already Oct 1 UTC: still September locally.
    expect(currentPeriod("monthly", Date.parse("2026-10-01T03:00:00Z"), TZ).key).toBe("2026-09");
    expect(currentPeriod("monthly", Date.parse("2026-10-01T03:00:00Z"), "UTC").key).toBe("2026-10");
  });

  it("schedules the next run on Monday / the 1st at 06:00 local, DST aware", () => {
    const wed = Date.parse("2026-09-30T15:00:00Z");
    expect(new Date(nextRunAt("weekly", wed, TZ)).toISOString()).toBe("2026-10-05T11:00:00.000Z");
    expect(new Date(nextRunAt("monthly", wed, TZ)).toISOString()).toBe("2026-10-01T11:00:00.000Z");
    // Exactly at a run time -> the following one.
    expect(new Date(nextRunAt("weekly", Date.parse("2026-10-05T11:00:00Z"), TZ)).toISOString()).toBe("2026-10-12T11:00:00.000Z");
    // Monday before 06:00 -> same day.
    expect(new Date(nextRunAt("weekly", Date.parse("2026-10-05T08:00:00Z"), TZ)).toISOString()).toBe("2026-10-05T11:00:00.000Z");
    // DST ends Nov 1 2026: Monday Nov 2 06:00 CST is 12:00 UTC.
    expect(new Date(nextRunAt("weekly", Date.parse("2026-10-28T12:00:00Z"), TZ)).toISOString()).toBe("2026-11-02T12:00:00.000Z");
    expect(new Date(nextRunAt("monthly", Date.parse("2026-12-15T12:00:00Z"), TZ)).toISOString()).toBe("2027-01-01T12:00:00.000Z");
  });
});

describe("visits billing", () => {
  const period = { start: "2026-09-01", end: "2026-09-30" };

  it("counts distinct completed visit days in the period", () => {
    const logs = [
      { service_date: "2026-09-02", status: "completed" },
      { service_date: "2026-09-02", status: "completed" }, // second pool, same visit
      { service_date: "2026-09-09", status: "completed" },
      { service_date: "2026-09-16", status: "cancelled" },
      { service_date: "2026-09-23", status: "pending" },
      { service_date: "2026-10-01", status: "completed" },
    ];
    expect(countCompletedVisits(logs, period)).toBe(2);
  });

  it("bills visits x rate plus priced chemicals and lists unpriced ones", () => {
    const { items, unpriced } = visitsBillItems({
      visits: 4,
      rateCents: 3500,
      chemicals: [
        { chemical_type: "Liquid Chlorine", quantity: "2.5 gal" },
        { chemical_type: "liquid chlorine", quantity: "1" },
        { chemical_type: "Acid", quantity: "0.5" },
        { chemical_type: "Tabs", quantity: "3" },
        { chemical_type: "Salt", quantity: "none" },
      ],
      prices: [
        { chemical_type: "Liquid chlorine", unit: "gal", price_cents: 600 },
        { chemical_type: "acid", unit: "gal", price_cents: 1250 },
      ],
    });
    expect(items).toEqual([
      { label: "4 visits × $35.00", amount_cents: 14000 },
      { label: "Liquid Chlorine 3.5 gal × $6.00", amount_cents: 2100 },
      { label: "Acid 0.5 gal × $12.50", amount_cents: 625 },
    ]);
    expect(unpriced).toEqual(["Tabs"]);
    expect(parseQuantity("  .5lb")).toBe(0.5);
    expect(parseQuantity("-2")).toBeNull();
  });

  it("validates schedule billing and chemical prices", () => {
    expect(normalizeScheduleBilling({ bill_mode: "fixed", rate: 99, items: [] })).toEqual({ rate_cents: 9900, items: [] });
    expect(normalizeScheduleBilling({ bill_mode: "fixed", rate: 1, items: [{ label: "Weekly", amount: 120 }, { label: "Filter", amount: 30 }] }).rate_cents).toBe(15000);
    expect(() => normalizeScheduleBilling({ bill_mode: "fixed", rate: 0, items: [] })).toThrow();
    expect(() => normalizeScheduleBilling({ bill_mode: "visits", rate: 0, items: [] })).toThrow(/per visit/);
    expect(normalizeChemicalPrices([
      { chemical_type: "Acid", unit: "gal", price: 10 },
      { chemical_type: " acid ", unit: "gal", price: 12.5 },
    ])).toEqual([{ chemical_type: "acid", unit: "gal", price_cents: 1250 }]);
    expect(() => normalizeChemicalPrices([{ chemical_type: "", unit: "", price: 1 }])).toThrow();
    expect(() => normalizeChemicalPrices([{ chemical_type: "A", unit: "", price: -1 }])).toThrow();
  });
});

describe("schedule runs", () => {
  const seed = () => createFakeDb({
    businesses: [{ _id: "businesses:1", name: "Acme Pools", owner_email: "owner@acme.co", settings, timezone: TZ, created_at: 0, updated_at: 0 }],
    customers: [{ _id: "customers:1", full_name: "Jane Doe", email: "jane@doe.co", business_id: "businesses:1", created_by: "owner@acme.co" }],
    billingSchedules: [{
      _id: "billingSchedules:1",
      business_id: "businesses:1",
      customer_id: "customers:1",
      created_by: "owner@acme.co",
      cadence: "weekly",
      bill_mode: "visits",
      rate_cents: 4000,
      items: [],
      note: "Weekly service",
      autopay: true,
      paused: false,
      next_run_at: Date.parse("2026-09-28T11:00:00Z"),
      created_at: 0,
      updated_at: 0,
    }],
    serviceLogs: [
      { _id: "serviceLogs:1", customer_id: "customers:1", service_date: "2026-09-22", status: "completed" },
      { _id: "serviceLogs:2", customer_id: "customers:1", service_date: "2026-09-25", status: "completed" },
    ],
    chemicalUsage: [
      // index order is by _creationTime ascending
      { _id: "chemicalUsage:0", customer_id: "customers:1", chemical_type: "Acid", quantity: "9", created_date: "2026-08-01", _creationTime: Date.parse("2026-08-01T15:00:00Z") },
      { _id: "chemicalUsage:1", customer_id: "customers:1", chemical_type: "Acid", quantity: "1 gal", created_date: "2026-09-22", _creationTime: Date.parse("2026-09-22T15:00:00Z") },
      { _id: "chemicalUsage:2", customer_id: "customers:1", chemical_type: "Tabs", quantity: "2", created_date: "2026-09-25", _creationTime: Date.parse("2026-09-25T15:00:00Z") },
    ],
    chemicalPrices: [{ _id: "chemicalPrices:1", business_id: "businesses:1", chemical_type: "acid", unit: "gal", price_cents: 1500 }],
    tickets: [],
  });

  it("creates exactly one ticket per schedule period and resends only drafts", async () => {
    const db = seed();
    const ctx = { db } as any;
    const args = { schedule_id: "billingSchedules:1", mode: "scheduled", now: Date.parse("2026-09-28T11:05:00Z") };
    const first = await call(prepareRun, ctx, args);
    expect(first.kind).toBe("send");
    expect(first.period_key).toBe("2026-W39");
    expect(first.autopay).toBe(true);
    expect(first.sc.items).toEqual([
      { label: "2 visits × $40.00", amount_cents: 8000 },
      { label: "Acid 1 gal × $15.00", amount_cents: 1500 },
    ]);
    expect(first.sc.total_cents).toBe(9500);
    expect(first.sc.period_label).toBe("Sep 21 – Sep 27");

    const retry = await call(prepareRun, ctx, args);
    expect(retry.kind).toBe("send");
    expect(retry.sc.ticket_id).toBe(first.sc.ticket_id);
    expect(db.tables.tickets).toHaveLength(1);

    await db.patch(first.sc.ticket_id, { status: "requested", square_invoice_number: "0001" });
    const done = await call(prepareRun, ctx, args);
    expect(done).toMatchObject({ kind: "done", ticket_id: first.sc.ticket_id, status: "requested", square_invoice_number: "0001" });

    // billNow for the current (in-progress) week is a different period.
    const now = await call(prepareRun, ctx, { ...args, mode: "now", now: Date.parse("2026-09-30T15:00:00Z") });
    expect(now.period_key).toBe("2026-W40");
  });

  it("skips creating a ticket when the period bills nothing", async () => {
    const db = seed();
    db.tables.serviceLogs = [];
    db.tables.chemicalUsage = [];
    const result = await call(prepareRun, { db } as any, { schedule_id: "billingSchedules:1", mode: "scheduled", now: Date.now() });
    expect(result).toEqual({ kind: "skip_zero", period_key: "2026-W39" });
    expect(db.tables.tickets).toHaveLength(0);
  });

  it("advances on success, retries without advancing, and gives up after the cap", () => {
    const schedule = { cadence: "weekly", next_run_at: Date.parse("2026-09-28T11:00:00Z"), failed_attempts: 0 };
    const now = Date.parse("2026-09-28T11:07:00Z");
    expect(scheduleRunOutcome(schedule, { ok: true, advance: true }, TZ, now).next_run_at).toBe(Date.parse("2026-10-05T11:00:00Z"));
    expect(scheduleRunOutcome(schedule, { ok: true, advance: false }, TZ, now).next_run_at).toBe(schedule.next_run_at);
    const failed = scheduleRunOutcome(schedule, { ok: false, advance: true, error: "Square down" }, TZ, now);
    expect(failed).toEqual({ next_run_at: schedule.next_run_at, failed_attempts: 1, last_error: "Square down" });
    const gaveUp = scheduleRunOutcome({ ...schedule, failed_attempts: MAX_RUN_ATTEMPTS - 1 }, { ok: false, advance: true, error: "x" }, TZ, now);
    expect(gaveUp.next_run_at).toBe(Date.parse("2026-10-05T11:00:00Z"));
    expect(gaveUp.failed_attempts).toBe(0);
    expect(gaveUp.last_error).toMatch(/Gave up/);
  });
});

describe("Square invoice webhooks", () => {
  const invoiceEvent = (type: string, merchant: string, invoice: Record<string, any>) => ({
    type,
    merchant_id: merchant,
    event_id: "e1",
    data: { object: { invoice: { id: "INV1", ...invoice } } },
  });
  const paid = { status: "PAID", version: 3, payment_requests: [{ total_completed_amount_money: { amount: 5000 } }] };

  it("routes seller invoice events to tickets and keeps platform events for subscriptions", () => {
    expect(planSquareWebhookEvent(invoiceEvent("invoice.payment_made", "SELLER", {}), "PLATFORM"))
      .toEqual({ kind: "seller_invoice", merchant_id: "SELLER", invoice_id: "INV1" });
    expect(planSquareWebhookEvent(invoiceEvent("invoice.canceled", "SELLER", {}), undefined).kind).toBe("seller_invoice");
    expect(planSquareWebhookEvent(invoiceEvent("invoice.payment_made", "PLATFORM", { subscription_id: "S1" }), "PLATFORM").kind)
      .toBe("subscription_invoice");
    expect(planSquareWebhookEvent(invoiceEvent("invoice.canceled", "PLATFORM", { subscription_id: "S1" }), "PLATFORM").kind).toBe("ignore");
  });

  it("plans status transitions from invoice facts", () => {
    const ticket = { status: "requested", total_cents: 5000, square_invoice_version: 1 };
    const facts = (type: string, invoice: Record<string, any>, merchant = "M1") => invoiceEventFacts(invoiceEvent(type, merchant, invoice))!;
    expect(planTicketInvoiceEvent(ticket, "M1", facts("invoice.payment_made", paid))).toMatchObject({ apply: true, status: "paid", paid_method: "square" });
    expect((planTicketInvoiceEvent(ticket, "M1", facts("invoice.payment_made", { ...paid, status: "PARTIALLY_PAID" })) as any).status).toBeUndefined();
    expect((planTicketInvoiceEvent(ticket, "M1", facts("invoice.payment_made", { ...paid, payment_requests: [{ total_completed_amount_money: { amount: 100 } }] })) as any).status).toBeUndefined();
    expect(planTicketInvoiceEvent(ticket, "M1", facts("invoice.payment_made", paid, "M2"))).toEqual({ apply: false, reason: "merchant_mismatch" });
    expect(planTicketInvoiceEvent(ticket, null, facts("invoice.payment_made", paid))).toEqual({ apply: false, reason: "merchant_mismatch" });
    expect(planTicketInvoiceEvent(ticket, "M1", facts("invoice.canceled", { status: "CANCELED" }))).toMatchObject({ status: "canceled" });
    expect(planTicketInvoiceEvent({ ...ticket, settling_outside_square: true }, "M1", facts("invoice.canceled", { status: "CANCELED" })).apply).toBe(false);
    expect(planTicketInvoiceEvent({ ...ticket, status: "paid" }, "M1", facts("invoice.refunded", { status: "REFUNDED" })))
      .toMatchObject({ apply: true, timeline: { type: "refunded" } });
    const failed = planTicketInvoiceEvent(ticket, "M1", facts("invoice.scheduled_charge_failed", { status: "UNPAID" }));
    expect(failed).toMatchObject({ apply: true, timeline: { type: "charge_failed" } });
    expect((failed as any).status).toBeUndefined();
    expect(planTicketInvoiceEvent({ ...ticket, square_invoice_version: 5 }, "M1", facts("invoice.updated", { status: "UNPAID", version: 2 }))).toEqual({ apply: false, reason: "stale_version" });
  });

  it("applies events to the matching ticket only for the connected merchant", async () => {
    const db = createFakeDb({
      tickets: [{
        _id: "tickets:1",
        business_id: "businesses:1",
        customer_id: "customers:1",
        status: "requested",
        total_cents: 5000,
        square_invoice_id: "INV1",
        square_invoice_version: 1,
        timeline: [],
      }],
      squareSellerAccounts: [{ _id: "squareSellerAccounts:1", business_id: "businesses:1", merchant_id: "M1" }],
    });
    const ctx = { db } as any;
    const mismatch = await call(applyInvoiceEvent, ctx, { event: invoiceEvent("invoice.payment_made", "EVIL", paid) });
    expect(mismatch).toEqual({ matched: true, applied: false, reason: "merchant_mismatch" });
    expect(db.tables.tickets[0].status).toBe("requested");

    const unknown = await call(applyInvoiceEvent, ctx, { event: { ...invoiceEvent("invoice.payment_made", "M1", paid), data: { object: { invoice: { id: "OTHER" } } } } });
    expect(unknown.matched).toBe(false);

    const ok = await call(applyInvoiceEvent, ctx, { event: invoiceEvent("invoice.payment_made", "M1", paid) });
    expect(ok).toEqual({ matched: true, applied: true });
    expect(db.tables.tickets[0]).toMatchObject({ status: "paid", paid_method: "square", square_invoice_version: 3 });
    expect(db.tables.tickets[0].timeline.at(-1).text).toBe("Paid in Square");

    await call(applyInvoiceEvent, ctx, { event: invoiceEvent("invoice.canceled", "M1", { status: "CANCELED", version: 4 }) });
    expect(db.tables.tickets[0].status).toBe("paid");
    await call(applyInvoiceEvent, ctx, { event: invoiceEvent("invoice.refunded", "M1", { status: "REFUNDED", version: 5 }) });
    expect(db.tables.tickets[0].status).toBe("paid");
    expect(db.tables.tickets[0].timeline.at(-1).text).toBe("Refunded in Square");
  });
});

describe("Square reconnect for ticket scopes", () => {
  it("requests every ticket scope and flags older connections", () => {
    for (const scope of ["CUSTOMERS_READ", "CUSTOMERS_WRITE", "INVOICES_READ", "INVOICES_WRITE", "ORDERS_WRITE", "PAYMENTS_WRITE", "MERCHANT_PROFILE_READ"]) {
      expect(SELLER_OAUTH_SCOPES).toContain(scope);
    }
    expect(scopesNeedReconnect(SELLER_OAUTH_SCOPES.join(" "))).toBe(false);
    expect(scopesNeedReconnect("MERCHANT_PROFILE_READ PAYMENTS_READ PAYMENTS_WRITE ORDERS_READ ORDERS_WRITE")).toBe(true);
    expect(scopesNeedReconnect(undefined)).toBe(true);
    const now = Date.now();
    const current = { location_id: "L", expires_at: now + 1e9, scopes: SELLER_OAUTH_SCOPES.join(" ") };
    expect(connectionNeedsReconnect(current, now)).toBe(false);
    expect(connectionNeedsReconnect({ ...current, scopes: "PAYMENTS_READ" }, now)).toBe(true);
    expect(connectionNeedsReconnect({ ...current, location_id: undefined }, now)).toBe(true);
    expect(connectionNeedsReconnect(null, now)).toBe(false);
  });
});

describe("legacy migration", () => {
  it("maps statuses", () => {
    expect(legacyInvoiceStatus("draft")).toBe("draft");
    expect(legacyInvoiceStatus("sent")).toBe("requested");
    expect(legacyInvoiceStatus("paid")).toBe("paid");
    expect(legacyInvoiceStatus("cancelled")).toBe("canceled");
    expect(legacyQuoteStatus("sent")).toBe("quote");
    expect(legacyQuoteStatus("approved")).toBe("quote");
    expect(legacyQuoteStatus("declined")).toBe("canceled");
    expect(legacyQuoteStatus("converted")).toBe("canceled");
  });

  it("keeps totals, line items and payment state", () => {
    const ticket = legacyInvoiceToTicket({
      _id: "invoices:1",
      customer_id: "customers:1",
      status: "paid",
      line_items: [{ description: "Filter clean", quantity: 2, unit_price: 40, amount: 80 }],
      tax: 6.6,
      total: 86.6,
      paid_at: 123,
      square_payment_id: "P1",
      created_at: 1,
      updated_at: 2,
    }, "businesses:1" as any, "owner@acme.co");
    expect(ticket).toMatchObject({
      kind: "charge",
      status: "paid",
      paid_method: "square",
      paid_at: 123,
      total_cents: 8660,
      legacy_source: "invoice:invoices:1",
      items: [{ label: "Filter clean × 2", amount_cents: 8000 }, { label: "Tax", amount_cents: 660 }],
    });
    const quote = legacyQuoteToTicket({ _id: "quotes:1", customer_id: "customers:1", status: "approved", title: "Heater", line_items: [], tax: 0, total: 0, created_at: 1, updated_at: 2 }, "businesses:1" as any, "o");
    expect(quote).toMatchObject({ kind: "quote", status: "quote", legacy_source: "quote:quotes:1" });
  });

  it("is idempotent and never touches legacy rows", async () => {
    const db = createFakeDb({
      businesses: [{ _id: "businesses:1", name: "Acme", owner_email: "owner@acme.co", settings, created_at: 0, updated_at: 0 }],
      customers: [{ _id: "customers:1", full_name: "Jane", business_id: "businesses:1", created_by: "owner@acme.co" }],
      invoices: [
        { _id: "invoices:1", customer_id: "customers:1", created_by: "owner@acme.co", status: "sent", line_items: [], tax: 0, total: 10, created_at: 1, updated_at: 1 },
        { _id: "invoices:2", customer_id: "customers:gone", created_by: "owner@acme.co", status: "sent", line_items: [], tax: 0, total: 10, created_at: 1, updated_at: 1 },
      ],
      quotes: [{ _id: "quotes:1", customer_id: "customers:1", created_by: "owner@acme.co", status: "sent", title: "Q", line_items: [], tax: 0, total: 5, created_at: 1, updated_at: 1 }],
      tickets: [],
    });
    const ctx = { db } as any;
    const first = await call(migrateLegacy, ctx, { table: "invoices" });
    expect(first).toMatchObject({ created: 1, skipped: 1, next: { table: "quotes", cursor: null } });
    const quotes = await call(migrateLegacy, ctx, { table: "quotes" });
    expect(quotes).toMatchObject({ created: 1, done: true });
    await call(migrateLegacy, ctx, { table: "invoices" });
    await call(migrateLegacy, ctx, { table: "quotes" });
    expect(db.tables.tickets).toHaveLength(2);
    expect(db.tables.tickets.map((t) => t.status).sort()).toEqual(["quote", "requested"]);
    expect(db.tables.invoices).toHaveLength(2);
    expect(db.tables.quotes).toHaveLength(1);
  });
});
