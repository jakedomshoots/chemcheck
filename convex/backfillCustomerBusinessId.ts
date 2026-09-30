import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { resolveBusinessForEmail } from "./entitlements";

/**
 * One-time backfill: sets `business_id` on all customers that belong to the
 * given user's business but were synced from Dexie without it.
 *
 * SECURITY: internal-only. A public version let any signed-in user claim every
 * orphaned customer. Run from the Convex Dashboard → Functions →
 * backfillCustomerBusinessId:run with `{ "userEmail": "<owner email>" }`.
 */
export const run = internalMutation({
    args: { userEmail: v.string() },
    handler: async (ctx, args) => {
        const userEmail = args.userEmail.trim();
        if (!userEmail) {
            throw new Error("userEmail is required");
        }

        // 1. Find the user's business (owner first, then active team member)
        const business: any = await resolveBusinessForEmail(ctx, userEmail);

        if (!business) {
            return { patched: 0, message: "No business found for this user." };
        }

        // 2. Collect allowed emails (owner + active team members)
        const members = await ctx.db
            .query("team_members")
            .withIndex("by_business", (q: any) => q.eq("business_id", business._id))
            .filter((q: any) => q.eq(q.field("is_active"), true))
            .collect();

        const allowedEmails = new Set<string>();
        allowedEmails.add(String(business.owner_email || "").trim().toLowerCase());
        for (const m of members) {
            if (m.user_email) {
                allowedEmails.add(String(m.user_email).trim().toLowerCase());
            }
        }

        const businessId = String(business._id);

        // 3. Find customers with no business_id that were created by an allowed email
        //    OR created_by is "local" (legacy Dexie sync without auth)
        const allCustomers = await ctx.db.query("customers").collect();
        let patched = 0;

        for (const customer of allCustomers) {
            const existingBizId = customer.business_id ? String(customer.business_id) : "";
            if (existingBizId) continue; // already has business_id

            const createdBy = String(customer.created_by || "").trim().toLowerCase();

            // Patch if created_by matches an allowed email OR is "local" / empty
            const isLegacyLocal = !createdBy || createdBy === "local";
            const isAllowedEmail = createdBy && allowedEmails.has(createdBy);

            if (!isLegacyLocal && !isAllowedEmail) continue;

            await ctx.db.patch(customer._id, {
                business_id: businessId,
                // Normalize created_by to the owner email for consistency
                created_by: business.owner_email,
            });
            patched++;
        }

        return {
            patched,
            businessId,
            message: `Backfilled ${patched} customer(s) with business_id.`,
        };
    },
});
