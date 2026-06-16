import { query } from "./_generated/server";

async function resolveBusinessContext(ctx: any, userEmail: string) {
    const teamMember = await ctx.db
        .query("team_members")
        .withIndex("by_user_email", (q: any) => q.eq("user_email", userEmail))
        .filter((q: any) => q.eq(q.field("is_active"), true))
        .first();

    if (teamMember) {
        const teamBusiness = await ctx.db.get(teamMember.business_id);
        if (teamBusiness) return teamBusiness;
    }

    return await ctx.db
        .query("businesses")
        .withIndex("by_owner_email", (q: any) => q.eq("owner_email", userEmail))
        .first();
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
