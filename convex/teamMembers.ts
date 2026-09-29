import { query } from "./_generated/server";
import { isActiveMembership, resolveBusinessForUser } from "./access";

// Count active team members for the current user's business.
// Pending invites are not counted as members here.
export const count = query({
    args: {},
    handler: async (ctx) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        const COUNT_CAP = 1000;
        const business = await resolveBusinessForUser(ctx, identity.email!);

        if (!business) {
            // Solo user without a business still occupies one user seat.
            return { count: 1, isCapped: false };
        }

        const members = (
            await ctx.db
                .query("team_members")
                .withIndex("by_business", (q: any) => q.eq("business_id", business._id))
                .take(COUNT_CAP + 1)
        ).filter(isActiveMembership);

        const isCapped = members.length > COUNT_CAP;
        return { count: Math.min(members.length, COUNT_CAP), isCapped };
    },
});
