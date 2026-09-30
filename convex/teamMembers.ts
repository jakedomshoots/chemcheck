import { query } from "./_generated/server";
import { resolveBusinessForEmail } from "./entitlements";

// Ownership first, then active (accepted) team membership.
async function resolveBusinessContext(ctx: any, userEmail: string) {
    return await resolveBusinessForEmail(ctx, userEmail);
}

// Count active team members for the current user's business.
export const count = query({
    args: {},
    handler: async (ctx) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        const COUNT_CAP = 1000;
        const business = await resolveBusinessContext(ctx, identity.email!);

        if (!business) {
            // Solo user without a business still occupies one user seat.
            return { count: 1, isCapped: false };
        }

        const members = await ctx.db
            .query("team_members")
            .withIndex("by_business", (q: any) => q.eq("business_id", business._id))
            .filter((q: any) => q.eq(q.field("is_active"), true))
            .take(COUNT_CAP + 1);

        const isCapped = members.length > COUNT_CAP;
        return { count: Math.min(members.length, COUNT_CAP), isCapped };
    },
});
