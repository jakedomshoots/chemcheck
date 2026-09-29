import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { isActiveMembership, normalizeEmail } from "./access";

const DEFAULT_BATCH_SIZE = 200;
const MAX_BATCH_SIZE = 500;

/**
 * Backfill: sets `business_id` on customers of ONE business that were synced
 * from Dexie without it. Only customers whose `created_by` is the business
 * owner or an active member are adopted; legacy "local"/empty rows are never
 * claimed because their tenant cannot be proven.
 *
 * Internal only. Run from the Convex Dashboard -> Functions ->
 * backfillCustomerBusinessId:run with { business_id }, repeating with the
 * returned `continueCursor` until `isDone` is true.
 */
export const run = internalMutation({
    args: {
        business_id: v.id("businesses"),
        cursor: v.optional(v.string()),
        batch_size: v.optional(v.number()),
        dry_run: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const business = await ctx.db.get(args.business_id);
        if (!business) {
            return { patched: 0, isDone: true, continueCursor: null, message: "Business not found." };
        }

        // Allowed creators: owner + active (accepted) team members.
        const members = await ctx.db
            .query("team_members")
            .withIndex("by_business", (q) => q.eq("business_id", business._id))
            .collect();
        const allowedEmails = new Set<string>([normalizeEmail(business.owner_email)]);
        for (const member of members) {
            if (isActiveMembership(member) && member.user_email) {
                allowedEmails.add(normalizeEmail(member.user_email));
            }
        }
        allowedEmails.delete("");

        const businessId = String(business._id);
        const batchSize = Math.max(1, Math.min(Math.floor(args.batch_size ?? DEFAULT_BATCH_SIZE), MAX_BATCH_SIZE));

        // Only legacy rows (no business_id) are candidates; page through them.
        const page = await ctx.db
            .query("customers")
            .withIndex("by_business", (q) => q.eq("business_id", undefined))
            .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

        let patched = 0;
        for (const customer of page.page) {
            if (customer.business_id) continue;
            const createdBy = normalizeEmail(customer.created_by);
            if (!createdBy || !allowedEmails.has(createdBy)) continue;

            patched++;
            if (args.dry_run) continue;
            await ctx.db.patch(customer._id, {
                business_id: businessId,
                // Normalize created_by to the owner email for consistency
                created_by: business.owner_email,
            });
        }

        return {
            patched,
            processed: page.page.length,
            businessId,
            continueCursor: page.continueCursor,
            isDone: page.isDone,
            message: `${args.dry_run ? "Would backfill" : "Backfilled"} ${patched} customer(s) with business_id.`,
        };
    },
});
