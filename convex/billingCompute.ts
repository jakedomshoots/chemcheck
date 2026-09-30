/**
 * Db-reading helpers that compute what a billing schedule bills for a period.
 * Shared by billingSchedules.ts (runs, preview) and tickets.ts (summary).
 */

import type { Doc } from "./_generated/dataModel";
import {
  type BillingPeriod,
  type Cadence,
  type ChemicalPrice,
  type TicketItemCents,
  chemicalUsageDate,
  countCompletedVisits,
  itemsTotalCents,
  nextRunAt,
  periodBilledByRunAt,
  safeTimeZone,
  visitsBillItems,
  zonedTimeToUtc,
} from "./ticketLogic";

const MAX_LOGS_PER_PERIOD = 500;
const MAX_CHEMICAL_ROWS_SCANNED = 500;

export type ScheduleBill = { items: TicketItemCents[]; total_cents: number; unpriced: string[] };

export async function loadChemicalPrices(ctx: any, businessId: Doc<"businesses">["_id"]): Promise<ChemicalPrice[]> {
  const rows = await ctx.db
    .query("chemicalPrices")
    .withIndex("by_business", (q: any) => q.eq("business_id", businessId))
    .take(200);
  return rows.map((row: any) => ({ chemical_type: row.chemical_type, unit: row.unit, price_cents: row.price_cents }));
}

/** Fixed-mode items: the schedule's items, or one line for the rate. */
export function fixedItems(schedule: Pick<Doc<"billingSchedules">, "items" | "rate_cents" | "note">): TicketItemCents[] {
  if (schedule.items.length > 0) return schedule.items;
  if (schedule.rate_cents > 0) return [{ label: (schedule.note || "Pool service").slice(0, 120), amount_cents: schedule.rate_cents }];
  return [];
}

/** What the schedule bills for `period`, from the data recorded so far. */
export async function computeScheduleBill(
  ctx: any,
  schedule: Doc<"billingSchedules">,
  business: Doc<"businesses">,
  period: BillingPeriod,
): Promise<ScheduleBill> {
  if (schedule.bill_mode !== "visits") {
    const items = fixedItems(schedule);
    return { items, total_cents: itemsTotalCents(items), unpriced: [] };
  }
  const tz = safeTimeZone(business.timezone);
  const logs = await ctx.db
    .query("serviceLogs")
    .withIndex("by_customer_and_date", (q: any) =>
      q.eq("customer_id", schedule.customer_id).gte("service_date", period.start).lte("service_date", period.end))
    .take(MAX_LOGS_PER_PERIOD);
  const visits = countCompletedVisits(logs, period);
  // Newest first; stop once rows were created well before the period started.
  const [sy, sm, sd] = period.start.split("-").map(Number);
  const stopBefore = zonedTimeToUtc(sy, sm, sd, 0, 0, tz) - 2 * 24 * 60 * 60 * 1000;
  const chemicals: any[] = [];
  let scanned = 0;
  for await (const row of ctx.db
    .query("chemicalUsage")
    .withIndex("by_customer", (q: any) => q.eq("customer_id", schedule.customer_id))
    .order("desc")) {
    scanned += 1;
    if (scanned > MAX_CHEMICAL_ROWS_SCANNED || (typeof row._creationTime === "number" && row._creationTime < stopBefore)) break;
    const date = chemicalUsageDate(row, tz);
    if (date !== null && date >= period.start && date <= period.end) chemicals.push(row);
  }
  const prices = await loadChemicalPrices(ctx, business._id);
  const { items, unpriced } = visitsBillItems({ visits, rateCents: schedule.rate_cents, chemicals, prices });
  return { items, total_cents: itemsTotalCents(items), unpriced };
}

/** The period the schedule's next run will bill. */
export function nextBilledPeriod(schedule: Pick<Doc<"billingSchedules">, "cadence" | "next_run_at">, tz: string, now: number): BillingPeriod {
  const cadence = schedule.cadence as Cadence;
  const runAt = typeof schedule.next_run_at === "number" ? schedule.next_run_at : nextRunAt(cadence, now, tz);
  return periodBilledByRunAt(cadence, runAt, tz);
}

export async function scheduleNextTotalCents(
  ctx: any,
  schedule: Doc<"billingSchedules">,
  business: Doc<"businesses">,
  now: number,
): Promise<number> {
  const period = nextBilledPeriod(schedule, safeTimeZone(business.timezone), now);
  const bill = await computeScheduleBill(ctx, schedule, business, period);
  return bill.total_cents;
}
