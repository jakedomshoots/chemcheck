import { mutation } from "./_generated/server";

/**
 * One-time backfill: sets `business_id` on all customers that belong to the
 * authenticated user's business but were synced from Dexie without it.
 *
 * Run from the Convex Dashboard → Functions → backfillCustomerBusinessId:run
 */
export const run = mutation({
    args: {},
    handler: async (ctx) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity?.email) {
            throw new Error("Not authenticated or email missing from token");
        }

        const userEmail = identity.email;

        // 1. Find the user's business (as owner or team member)
        const teamMember = await ctx.db
            .query("team_members")
            .withIndex("by_user_email", (q: any) => q.eq("user_email", userEmail))
            .filter((q: any) => q.eq(q.field("is_active"), true))
            .first();

        let business: any = null;
        if (teamMember) {
            business = await ctx.db.get(teamMember.business_id);
        }
        if (!business) {
            business = await ctx.db
                .query("businesses")
                .withIndex("by_owner_email", (q: any) => q.eq("owner_email", userEmail))
                .first();
        }

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
