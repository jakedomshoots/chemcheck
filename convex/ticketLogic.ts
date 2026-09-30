/**
 * Pure helpers for work tickets, billing schedules and their Square mirror.
 * No Convex runtime imports so everything here is unit tested directly
 * (convex/tickets.test.ts).
 *
 * Money is integer cents internally and dollars at the API boundary.
 */

// ---------------------------------------------------------------------------
// Money and line items
// ---------------------------------------------------------------------------

export const MAX_TICKET_ITEMS = 50;
export const MAX_ITEM_LABEL_LENGTH = 120;
export const MAX_ITEM_AMOUNT_CENTS = 100_000 * 100;
export const MAX_NOTE_LENGTH = 2000;
export const MAX_TICKET_PHOTOS = 10;

export type TicketItemInput = { label: string; amount: number };
export type TicketItemCents = { label: string; amount_cents: number };
export type TicketItemDollars = { label: string; amount: number };

export function dollarsToCents(amount: number): number {
  return Math.round(amount * 100);
}

export function centsToDollars(cents: number): number {
  return Math.round(cents) / 100;
}

/** Validate API items (dollars) and convert to cents. Throws a readable Error. */
export function normalizeTicketItems(items: unknown): TicketItemCents[] {
  if (!Array.isArray(items)) throw new Error("Line items are missing.");
  if (items.length > MAX_TICKET_ITEMS) throw new Error(`A ticket can have at most ${MAX_TICKET_ITEMS} line items.`);
  return items.map((raw: any, index) => {
    const label = String(raw?.label ?? "").trim();
    const name = `Line ${index + 1}`;
    if (!label) throw new Error(`${name}: add a description.`);
    if (label.length > MAX_ITEM_LABEL_LENGTH) throw new Error(`${name}: description must be ${MAX_ITEM_LABEL_LENGTH} characters or fewer.`);
    const amount = raw?.amount;
    if (typeof amount !== "number" || !Number.isFinite(amount)) throw new Error(`${name}: amount must be a number.`);
    if (amount < 0) throw new Error(`${name}: amount cannot be negative.`);
    const cents = dollarsToCents(amount);
    if (cents > MAX_ITEM_AMOUNT_CENTS) throw new Error(`${name}: amount cannot be more than $100,000.`);
    return { label, amount_cents: cents };
  });
}

export function itemsTotalCents(items: TicketItemCents[]): number {
  return items.reduce((sum, item) => sum + item.amount_cents, 0);
}

export function itemsToDollars(items: TicketItemCents[]): TicketItemDollars[] {
  return items.map((item) => ({ label: item.label, amount: centsToDollars(item.amount_cents) }));
}

export function normalizeNote(note: unknown): string {
  const text = String(note ?? "").trim();
  if (text.length > MAX_NOTE_LENGTH) throw new Error(`Note must be ${MAX_NOTE_LENGTH} characters or fewer.`);
  return text;
}

export function assertSendableTotal(totalCents: number): void {
  if (!(totalCents > 0)) throw new Error("Add at least one line item with an amount before sending.");
}

export function formatUsd(cents: number): string {
  const dollars = Math.round(cents) / 100;
  return `$${dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Short, stable hash (FNV-1a, base36) used to scope Square idempotency keys to content. */
export function contentHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/** Deterministic Square idempotency key for one ticket action (max 45 chars for Orders/Payments). */
export function ticketIdempotencyKey(ticketId: string, action: string, items?: TicketItemCents[]): string {
  const idPart = String(ticketId).replace(/[^A-Za-z0-9]/g, "").slice(-20);
  const suffix = items ? `-${contentHash(items)}` : "";
  return `t${idPart}-${action}${suffix}`.slice(0, 45);
}

// ---------------------------------------------------------------------------
// Ticket state
// ---------------------------------------------------------------------------

export type TicketKind = "charge" | "quote";
export type TicketStatus = "draft" | "quote" | "requested" | "paid" | "canceled";
export type PaidMethod = "square" | "cash" | "check" | "other";
export type TimelineEvent = { type: string; text: string; at: number };

export const MAX_TIMELINE_EVENTS = 100;

export function appendTimeline(timeline: TimelineEvent[] | undefined, event: TimelineEvent): TimelineEvent[] {
  const next = [...(timeline ?? []), { ...event, text: event.text.slice(0, 300) }];
  return next.length > MAX_TIMELINE_EVENTS ? next.slice(next.length - MAX_TIMELINE_EVENTS) : next;
}

export type TicketFilter = "all" | "open" | "quote" | "paid";

export function matchesFilter(status: string, filter: TicketFilter | undefined): boolean {
  switch (filter ?? "all") {
    case "open":
      return status === "draft" || status === "requested";
    case "quote":
      return status === "quote";
    case "paid":
      return status === "paid";
    default:
      return true;
  }
}

/** `overdue`: requested and the Square due date (YYYY-MM-DD, business tz) is before today. */
export function isOverdue(ticket: { status: string; square_due_date?: string }, todayLocal: string): boolean {
  return ticket.status === "requested" && Boolean(ticket.square_due_date) && ticket.square_due_date! < todayLocal;
}

// ---------------------------------------------------------------------------
// Square delivery
// ---------------------------------------------------------------------------

export type SquareDeliveryMethod = "EMAIL" | "SHARE_MANUALLY";
export type DeliveredVia = "email" | "sms" | "link";

/**
 * How the invoice reaches the customer.
 * - Email on file: Square emails it (EMAIL).
 * - Else phone on file: Square's API cannot set SMS delivery (SMS is only
 *   configurable in Square's own apps), so the invoice is SHARE_MANUALLY and
 *   ChemCheck texts the Square payment link through communications.
 * - Else: SHARE_MANUALLY; the owner shares the link.
 * Autopay (CARD_ON_FILE) requires EMAIL delivery, so it only applies with an email.
 */
export function invoiceDeliveryPlan(customer: { email?: string | null; phone?: string | null }): {
  delivery_method: SquareDeliveryMethod;
  delivered_via: DeliveredVia;
} {
  if (customer.email && customer.email.trim()) return { delivery_method: "EMAIL", delivered_via: "email" };
  if (customer.phone && customer.phone.trim()) return { delivery_method: "SHARE_MANUALLY", delivered_via: "sms" };
  return { delivery_method: "SHARE_MANUALLY", delivered_via: "link" };
}

export function canUseAutopay(autopayRequested: boolean, cardId: string | null | undefined, deliveryMethod: SquareDeliveryMethod): boolean {
  return autopayRequested && Boolean(cardId) && deliveryMethod === "EMAIL";
}

export function cardLabel(card: any): string | null {
  if (!card || card.enabled === false) return null;
  const brand = typeof card.card_brand === "string" ? card.card_brand : "Card";
  const last4 = typeof card.last_4 === "string" ? card.last_4 : "";
  const pretty = brand === "AMERICAN_EXPRESS" ? "Amex"
    : brand === "MASTERCARD" ? "Mastercard"
    : brand.charAt(0) + brand.slice(1).toLowerCase().replace(/_/g, " ");
  return last4 ? `${pretty} •• ${last4}` : pretty;
}

/** First enabled card from a ListCards response. */
export function pickCardOnFile(cards: unknown): { id: string; label: string } | null {
  if (!Array.isArray(cards)) return null;
  for (const card of cards) {
    if (card && typeof card.id === "string" && card.enabled !== false) {
      return { id: card.id, label: cardLabel(card) ?? "Card on file" };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Time zones and dates
// ---------------------------------------------------------------------------

export const DEFAULT_TIMEZONE = "America/Chicago";
export const DEFAULT_NET_DAYS = 7;
export const SCHEDULE_RUN_HOUR = 6; // local time the cron bills a new period

export function safeTimeZone(tz: unknown): string {
  if (typeof tz !== "string" || !tz) return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

export function safeNetDays(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 365 ? value : DEFAULT_NET_DAYS;
}

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

export function localParts(ms: number, tz: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") % 24, minute: get("minute"), second: get("second") };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** YYYY-MM-DD of `ms` in `tz`. */
export function localDateString(ms: number, tz: string): string {
  const p = localParts(ms, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** UTC ms of a wall-clock time in `tz`. */
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, tz: string): number {
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const p = localParts(guess, tz);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const diff = target - asUtc;
    if (diff === 0) break;
    guess += diff;
  }
  return guess;
}

/** Pure calendar arithmetic on YYYY-MM-DD strings. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d) + days * 86_400_000;
  const dt = new Date(ms);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** 0 = Monday ... 6 = Sunday. */
export function weekdayIndex(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** Square invoice due date: today (business tz) + net days. */
export function invoiceDueDate(now: number, tz: string, netDays: number): string {
  return addDays(localDateString(now, safeTimeZone(tz)), safeNetDays(netDays));
}

// ---------------------------------------------------------------------------
// Billing periods (billed in arrears)
// ---------------------------------------------------------------------------
//
// weekly:  periods run Monday..Sunday. The run on Monday 06:00 (business tz)
//          bills the week that just ended.
// monthly: periods are calendar months. The run on the 1st at 06:00 bills the
//          previous month.
// `billNow` bills the CURRENT (in-progress) period; the later scheduled run for
// that same period finds the existing ticket (schedule_id + period_key) and
// only advances.

export type Cadence = "weekly" | "monthly";
export type BillingPeriod = { key: string; start: string; end: string; label: string };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT_MONTHS = MONTHS.map((m) => m.slice(0, 3));

/** ISO-8601 week key (e.g. "2026-W39") for the week starting Monday `monday`. */
export function isoWeekKey(monday: string): string {
  const thursday = addDays(monday, 3);
  const [y, m, d] = thursday.split("-").map(Number);
  const thursdayMs = Date.UTC(y, m - 1, d);
  const jan1 = Date.UTC(y, 0, 1);
  const week = Math.floor((thursdayMs - jan1) / (7 * 86_400_000)) + 1;
  return `${y}-W${pad(week)}`;
}

function shortDate(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${SHORT_MONTHS[m - 1]} ${d}`;
}

export function weeklyPeriod(monday: string): BillingPeriod {
  const end = addDays(monday, 6);
  return { key: isoWeekKey(monday), start: monday, end, label: `${shortDate(monday)} – ${shortDate(end)}` };
}

export function monthlyPeriod(year: number, month: number): BillingPeriod {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    key: `${year}-${pad(month)}`,
    start: `${year}-${pad(month)}-01`,
    end: `${year}-${pad(month)}-${pad(lastDay)}`,
    label: `${MONTHS[month - 1]} ${year}`,
  };
}

/** The period that contains `ms` (business tz). */
export function currentPeriod(cadence: Cadence, ms: number, tz: string): BillingPeriod {
  const today = localDateString(ms, safeTimeZone(tz));
  if (cadence === "weekly") return weeklyPeriod(addDays(today, -weekdayIndex(today)));
  const [y, m] = today.split("-").map(Number);
  return monthlyPeriod(y, m);
}

/** The period billed by a scheduled run at `runAt`: the one that just ended. */
export function periodBilledByRunAt(cadence: Cadence, runAt: number, tz: string): BillingPeriod {
  const zone = safeTimeZone(tz);
  const runDay = localDateString(runAt, zone);
  if (cadence === "weekly") {
    const monday = addDays(runDay, -weekdayIndex(runDay));
    return weeklyPeriod(addDays(monday, -7));
  }
  const [y, m] = runDay.split("-").map(Number);
  return m === 1 ? monthlyPeriod(y - 1, 12) : monthlyPeriod(y, m - 1);
}

/** Next scheduled run strictly after `after`: Monday / the 1st at 06:00 business time. */
export function nextRunAt(cadence: Cadence, after: number, tz: string): number {
  const zone = safeTimeZone(tz);
  const today = localDateString(after, zone);
  let candidate: string;
  if (cadence === "weekly") {
    candidate = addDays(today, (7 - weekdayIndex(today)) % 7);
  } else {
    const [y, m] = today.split("-").map(Number);
    candidate = `${y}-${pad(m)}-01`;
  }
  for (let i = 0; i < 3; i++) {
    const [y, m, d] = candidate.split("-").map(Number);
    const ms = zonedTimeToUtc(y, m, d, SCHEDULE_RUN_HOUR, 0, zone);
    if (ms > after) return ms;
    if (cadence === "weekly") candidate = addDays(candidate, 7);
    else candidate = m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`;
  }
  throw new Error("Could not compute the next billing run.");
}

// ---------------------------------------------------------------------------
// Visits billing
// ---------------------------------------------------------------------------

export type ChemicalPrice = { chemical_type: string; unit: string; price_cents: number };

export function normalizeChemicalType(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Leading numeric quantity of a free-form chemicalUsage.quantity ("2.5 gal" -> 2.5). */
export function parseQuantity(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
  const match = /^\s*(\d+(?:\.\d+)?|\.\d+)/.exec(String(value ?? ""));
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function formatQuantity(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** Count distinct completed-visit dates inside [start, end]. */
export function countCompletedVisits(
  logs: Array<{ service_date?: string; status?: string }>,
  period: { start: string; end: string },
): number {
  const dates = new Set<string>();
  for (const log of logs) {
    if (log.status !== "completed" || !log.service_date) continue;
    if (log.service_date < period.start || log.service_date > period.end) continue;
    dates.add(log.service_date);
  }
  return dates.size;
}

export function visitsBillItems(args: {
  visits: number;
  rateCents: number;
  chemicals: Array<{ chemical_type: string; quantity: unknown }>;
  prices: ChemicalPrice[];
}): { items: TicketItemCents[]; unpriced: string[] } {
  const items: TicketItemCents[] = [];
  if (args.visits > 0 && args.rateCents > 0) {
    items.push({
      label: `${args.visits} visit${args.visits === 1 ? "" : "s"} × ${formatUsd(args.rateCents)}`,
      amount_cents: args.visits * args.rateCents,
    });
  }
  const priceByType = new Map(args.prices.map((p) => [normalizeChemicalType(p.chemical_type), p]));
  const totals = new Map<string, { display: string; quantity: number }>();
  for (const row of args.chemicals) {
    const key = normalizeChemicalType(row.chemical_type);
    const qty = parseQuantity(row.quantity);
    if (!key || qty === null) continue;
    const entry = totals.get(key) ?? { display: String(row.chemical_type).trim(), quantity: 0 };
    entry.quantity += qty;
    totals.set(key, entry);
  }
  const unpriced: string[] = [];
  for (const [key, entry] of totals) {
    const price = priceByType.get(key);
    if (!price || !(price.price_cents > 0)) {
      unpriced.push(entry.display);
      continue;
    }
    const unit = price.unit ? ` ${price.unit}` : "";
    items.push({
      label: `${entry.display} ${formatQuantity(entry.quantity)}${unit} × ${formatUsd(price.price_cents)}`.slice(0, MAX_ITEM_LABEL_LENGTH),
      amount_cents: Math.round(entry.quantity * price.price_cents),
    });
  }
  return { items, unpriced };
}

/** The date a chemicalUsage row counts for (created_date, else created_at in business tz). */
export function chemicalUsageDate(row: { created_date?: string; created_at?: number; _creationTime?: number }, tz: string): string | null {
  if (row.created_date && /^\d{4}-\d{2}-\d{2}/.test(row.created_date)) return row.created_date.slice(0, 10);
  const ms = row.created_at ?? row._creationTime;
  return typeof ms === "number" ? localDateString(ms, safeTimeZone(tz)) : null;
}

// ---------------------------------------------------------------------------
// Square OAuth scopes
// ---------------------------------------------------------------------------

export const TICKET_REQUIRED_SCOPES = [
  "CUSTOMERS_READ",
  "CUSTOMERS_WRITE",
  "INVOICES_READ",
  "INVOICES_WRITE",
  "ORDERS_READ",
  "ORDERS_WRITE",
  "PAYMENTS_READ",
  "PAYMENTS_WRITE",
  "MERCHANT_PROFILE_READ",
] as const;

/** True when a stored connection was granted without any scope tickets need. */
export function scopesNeedReconnect(storedScopes: string | undefined | null): boolean {
  const granted = new Set(String(storedScopes ?? "").split(/[\s,]+/).filter(Boolean));
  return TICKET_REQUIRED_SCOPES.some((scope) => !granted.has(scope));
}

// ---------------------------------------------------------------------------
// Square invoice webhooks -> ticket
// ---------------------------------------------------------------------------

export type InvoiceEventFacts = {
  event_type: string;
  merchant_id: string;
  invoice_id: string;
  status?: string;
  version?: number;
  public_url?: string;
  invoice_number?: string;
  due_date?: string;
  paid_cents?: number;
  total_cents?: number;
};

export function invoiceEventFacts(event: any): InvoiceEventFacts | null {
  const invoice = event?.data?.object?.invoice;
  const merchantId = typeof event?.merchant_id === "string" ? event.merchant_id : "";
  const invoiceId = typeof invoice?.id === "string" ? invoice.id : typeof event?.data?.id === "string" ? event.data.id : "";
  if (!merchantId || !invoiceId) return null;
  const request = Array.isArray(invoice?.payment_requests) ? invoice.payment_requests[0] : undefined;
  const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
  return {
    event_type: String(event?.type ?? ""),
    merchant_id: merchantId,
    invoice_id: invoiceId,
    status: typeof invoice?.status === "string" ? invoice.status : undefined,
    version: num(invoice?.version),
    public_url: typeof invoice?.public_url === "string" ? invoice.public_url : undefined,
    invoice_number: typeof invoice?.invoice_number === "string" ? invoice.invoice_number : undefined,
    due_date: typeof request?.due_date === "string" ? request.due_date : undefined,
    paid_cents: num(request?.total_completed_amount_money?.amount),
    total_cents: num(request?.computed_amount_money?.amount),
  };
}

export type TicketInvoicePatch =
  | { apply: false; reason: string }
  | {
    apply: true;
    status?: TicketStatus;
    paid_method?: PaidMethod;
    set_paid_at?: boolean;
    version?: number;
    public_url?: string;
    invoice_number?: string;
    due_date?: string;
    timeline?: { type: string; text: string };
  };

/**
 * Pure transition for a seller invoice event. `connectedMerchantId` is the
 * merchant the ticket's business has connected; events from any other
 * merchant are rejected.
 */
export function planTicketInvoiceEvent(
  ticket: {
    status: string;
    total_cents: number;
    square_invoice_version?: number;
    settling_outside_square?: boolean;
  },
  connectedMerchantId: string | null | undefined,
  facts: InvoiceEventFacts,
): TicketInvoicePatch {
  if (!connectedMerchantId || connectedMerchantId !== facts.merchant_id) return { apply: false, reason: "merchant_mismatch" };
  const meta = {
    version: facts.version,
    public_url: facts.public_url,
    invoice_number: facts.invoice_number,
    due_date: facts.due_date,
  };
  const stale = typeof facts.version === "number" && typeof ticket.square_invoice_version === "number"
    && facts.version < ticket.square_invoice_version;
  const fullyPaid = facts.status === "PAID"
    && (facts.paid_cents === undefined || facts.paid_cents >= ticket.total_cents);

  switch (facts.event_type) {
    case "invoice.payment_made":
    case "invoice.updated": {
      if (fullyPaid && (ticket.status === "requested" || ticket.status === "quote" || ticket.status === "draft")) {
        return { apply: true, ...meta, status: "paid", paid_method: "square", set_paid_at: true, timeline: { type: "paid", text: "Paid in Square" } };
      }
      if (facts.event_type === "invoice.payment_made" && facts.status === "PARTIALLY_PAID") {
        return { apply: true, ...(stale ? {} : meta), timeline: { type: "partial_payment", text: "Partial payment received in Square" } };
      }
      if (facts.status === "CANCELED" && ticket.status === "requested" && !ticket.settling_outside_square) {
        return { apply: true, ...meta, status: "canceled", timeline: { type: "canceled", text: "Invoice canceled in Square" } };
      }
      if (stale) return { apply: false, reason: "stale_version" };
      return { apply: true, ...meta };
    }
    case "invoice.canceled": {
      if (ticket.status !== "requested" || ticket.settling_outside_square) return { apply: false, reason: "not_cancelable" };
      return { apply: true, ...meta, status: "canceled", timeline: { type: "canceled", text: "Invoice canceled in Square" } };
    }
    case "invoice.refunded": {
      return { apply: true, ...(stale ? {} : meta), timeline: { type: "refunded", text: facts.status === "REFUNDED" ? "Refunded in Square" : "Partially refunded in Square" } };
    }
    case "invoice.scheduled_charge_failed": {
      return { apply: true, ...(stale ? {} : meta), timeline: { type: "charge_failed", text: "Autopay charge failed; the invoice is still open" } };
    }
    default:
      return { apply: false, reason: "unhandled_event_type" };
  }
}

// ---------------------------------------------------------------------------
// Legacy invoices / quotes -> tickets
// ---------------------------------------------------------------------------

type LegacyLineItem = { description: string; quantity: number; unit_price: number; amount: number };

export function legacyItems(lineItems: LegacyLineItem[] | undefined, taxDollars?: number): TicketItemCents[] {
  const items: TicketItemCents[] = (lineItems ?? []).map((item) => {
    const base = String(item.description || "Item").trim() || "Item";
    const label = item.quantity && item.quantity !== 1 ? `${base} × ${item.quantity}` : base;
    return { label: label.slice(0, MAX_ITEM_LABEL_LENGTH), amount_cents: Math.max(0, dollarsToCents(Number(item.amount) || 0)) };
  });
  if (typeof taxDollars === "number" && taxDollars > 0) items.push({ label: "Tax", amount_cents: dollarsToCents(taxDollars) });
  return items;
}

export function legacyInvoiceStatus(status: string): TicketStatus {
  switch (status) {
    case "sent":
      return "requested";
    case "paid":
      return "paid";
    case "cancelled":
    case "canceled":
      return "canceled";
    default:
      return "draft";
  }
}

/** Legacy quote status -> ticket status. `approved` stays a quote so it can be approved into a Square invoice. */
export function legacyQuoteStatus(status: string): TicketStatus {
  switch (status) {
    case "sent":
    case "approved":
      return "quote";
    case "declined":
    case "converted":
      return "canceled";
    default:
      return "draft";
  }
}
