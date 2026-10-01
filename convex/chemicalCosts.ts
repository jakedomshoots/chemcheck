/**
 * Chemical cost roll-ups for the cost dashboard.
 *
 * Reads are bounded: usage rows come from the
 * by_created_by_and_created_date index for each member of the caller's
 * business over the requested date range, capped per technician and in
 * total. Rows without a stored cost are costed on the fly from the price
 * table, so prices added after the fact still show up.
 */
import { v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { normalizeEmail, resolveBusinessForEmail } from "./entitlements";
import { NOT_DELETED_FILTER } from "./sync";
import { listPricesForBusiness } from "./chemicalPricing";
import {
  computeUsageCost,
  findPriceForChemical,
  isIsoDate,
  rollupCosts,
  type CostRollup,
  type CostRow,
} from "../src/lib/chemicalCosts";

type DbCtx = Pick<QueryCtx, "db">;

export const MAX_ROWS_PER_TECHNICIAN = 2000;
export const MAX_TOTAL_ROWS = 6000;
export const MAX_SERVICE_LOG_LOOKUPS = 400;
export const MAX_RANGE_DAYS = 400;

export interface CostSummary extends CostRollup {
  range: { start: string; end: string };
  truncated: boolean;
  technicians: string[];
  has_prices: boolean;
}

function assertRange(start: string, end: string): void {
  if (!isIsoDate(start) || !isIsoDate(end)) throw new Error("Dates must be YYYY-MM-DD.");
  if (start > end) throw new Error("Start date must be on or before the end date.");
  const days = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000;
  if (days > MAX_RANGE_DAYS) throw new Error(`Date range is limited to ${MAX_RANGE_DAYS} days.`);
}

/** Emails whose chemicalUsage rows belong to the caller's business (owner + active members + caller). */
export async function technicianEmailsForCaller(ctx: DbCtx, email: string): Promise<{ emails: string[]; business: Doc<"businesses"> | null }> {
  const business = await resolveBusinessForEmail(ctx, email);
  const emails = new Set<string>([email]);
  if (business) {
    emails.add(business.owner_email);
    const members = await ctx.db
      .query("team_members")
      .withIndex("by_business", (q) => q.eq("business_id", business._id))
      .filter((q) => q.eq(q.field("is_active"), true))
      .take(200);
    for (const member of members) emails.add(member.user_email);
  }
  // Dedupe case variants: rows were written with the raw identity email.
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const candidate of emails) {
    const key = normalizeEmail(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(candidate);
  }
  return { emails: unique, business };
}

export async function loadCostSummary(
  ctx: DbCtx,
  email: string,
  args: { start: string; end: string; top_n?: number },
): Promise<CostSummary> {
  assertRange(args.start, args.end);
  const { emails, business } = await technicianEmailsForCaller(ctx, email);
  const prices = business ? await listPricesForBusiness(ctx, business._id) : [];

  let truncated = false;
  const usage: Doc<"chemicalUsage">[] = [];
  for (const technician of emails) {
    if (usage.length >= MAX_TOTAL_ROWS) {
      truncated = true;
      break;
    }
    const rows = await ctx.db
      .query("chemicalUsage")
      .withIndex("by_created_by_and_created_date", (q) =>
        q.eq("created_by", technician).gte("created_date", args.start).lte("created_date", args.end),
      )
      .filter(NOT_DELETED_FILTER)
      .take(MAX_ROWS_PER_TECHNICIAN);
    if (rows.length >= MAX_ROWS_PER_TECHNICIAN) truncated = true;
    usage.push(...rows.slice(0, MAX_TOTAL_ROWS - usage.length));
  }

  const customers = new Map<string, Doc<"customers"> | null>();
  const pools = new Map<string, Doc<"pools"> | null>();
  const serviceLogTech = new Map<string, string | null>();
  let logLookups = 0;

  const costRows: CostRow[] = [];
  for (const row of usage) {
    const customerKey = String(row.customer_id);
    if (!customers.has(customerKey)) customers.set(customerKey, await ctx.db.get(row.customer_id));
    const customer = customers.get(customerKey);
    if (!customer) continue;

    let pool: Doc<"pools"> | null = null;
    if (row.pool_id) {
      const poolKey = String(row.pool_id);
      if (!pools.has(poolKey)) pools.set(poolKey, await ctx.db.get(row.pool_id));
      pool = pools.get(poolKey) ?? null;
    }

    const date = row.created_date ?? "";
    // Attribute the row to whoever logged the service visit that day when one exists.
    let technician = row.created_by ?? "";
    const visitKey = `${customerKey}|${date}`;
    if (date) {
      if (!serviceLogTech.has(visitKey) && logLookups < MAX_SERVICE_LOG_LOOKUPS) {
        logLookups += 1;
        const log = await ctx.db
          .query("serviceLogs")
          .withIndex("by_customer_and_date", (q) => q.eq("customer_id", row.customer_id).eq("service_date", date))
          .filter(NOT_DELETED_FILTER)
          .first();
        serviceLogTech.set(visitKey, log?.created_by ?? null);
      }
      technician = serviceLogTech.get(visitKey) ?? technician;
    }

    let cost: number | null = typeof row.total_cost === "number" ? row.total_cost : null;
    let normalizedAmount = row.normalized_amount;
    let normalizedUnit = row.normalized_unit;
    if (cost === null) {
      const computed = computeUsageCost(findPriceForChemical(prices, row.chemical_type), row.chemical_type, row.quantity);
      if (computed) {
        cost = computed.total_cost;
        normalizedAmount = computed.normalized_amount;
        normalizedUnit = computed.normalized_unit;
      }
    }

    costRows.push({
      id: String(row._id),
      customer_id: customerKey,
      customer_name: customer.full_name,
      pool_id: pool ? String(pool._id) : undefined,
      pool_name: pool?.name,
      service_day: pool?.service_day ?? customer.service_day,
      technician,
      date,
      chemical_type: row.chemical_type,
      quantity: row.quantity,
      normalized_amount: normalizedAmount,
      normalized_unit: normalizedUnit,
      cost,
    });
  }

  return {
    ...rollupCosts(costRows, { topN: args.top_n }),
    range: { start: args.start, end: args.end },
    truncated,
    technicians: emails,
    has_prices: prices.length > 0,
  };
}

export const summary = query({
  args: {
    start: v.string(),
    end: v.string(),
    top_n: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<CostSummary> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) throw new Error("Not authenticated");
    return await loadCostSummary(ctx, identity.email, args);
  },
});
