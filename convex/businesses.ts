import { v } from "convex/values";
import { safeNetDays, safeTimeZone } from "./ticketLogic";
import { query, mutation, internalQuery } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  getMembershipsForEmail,
  isActiveMembership,
  isPendingMembership,
  normalizeEmail,
  resolveBusinessForUser,
} from "./access";
import { assertCanAddTeamMember } from "./planLimits";
import { enforceRateLimit } from "./rateLimit";

// Valid role values for team members
const VALID_ROLES = ['owner', 'admin', 'technician', 'viewer'] as const;
type TeamMemberRole = typeof VALID_ROLES[number];

function validateRole(role: string): void {
  if (!VALID_ROLES.includes(role as TeamMemberRole)) {
    throw new Error(`Invalid role: "${role}". Must be one of: ${VALID_ROLES.join(', ')}`);
  }
}

// Get the current user's business
export const getCurrent = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) return null;

    // Accepted (active) memberships first, then an owned business. Pending
    // invites never switch the caller into another tenant.
    return await resolveBusinessForUser(ctx, identity.email);
  },
});

export const getByOwnerEmailInternal = internalQuery({
  args: {
    owner_email: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("businesses")
      .withIndex("by_owner_email", (q) => q.eq("owner_email", args.owner_email))
      .first();
  },
});

export const getByIdInternal = internalQuery({
  args: { business_id: v.id("businesses") },
  handler: async (ctx, args) => await ctx.db.get(args.business_id),
});

// Create a new business (tenant)
export const create = mutation({
  args: {
    name: v.string(),
    address: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    await enforceRateLimit(ctx, identity.email!, "business.write");

    // Check if user already has a business
    const existingBusiness = await ctx.db
      .query("businesses")
      .withIndex("by_owner_email", (q) => q.eq("owner_email", identity.email!))
      .first();

    if (existingBusiness) {
      throw new Error("User already has a business");
    }

    const now = Date.now();

    // Create the business
    const businessId = await ctx.db.insert("businesses", {
      name: args.name,
      address: args.address,
      phone: args.phone,
      email: args.email || identity.email!,
      owner_email: identity.email!,
      settings: {
        working_days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        working_hours_start: "08:00",
        working_hours_end: "17:00",
        service_types: ["Regular Cleaning", "Chemical Balance", "Equipment Check", "Repair"],
        chemical_types: ["Chlorine Tablets", "Liquid Chlorine", "pH Up", "pH Down", "Alkalinity Up", "Stabilizer"],
        route_optimization: true,
        require_photos: false,
        require_signatures: false,
        default_workorders_section: "dispatch",
        home_primary_action: "start_next_pending",
        show_ops_brief: true,
      },
      created_at: now,
      updated_at: now,
    });

    // Add owner as team member
    await ctx.db.insert("team_members", {
      business_id: businessId,
      user_email: identity.email!,
      name: identity.name || "Owner",
      role: "owner",
      is_active: true,
      status: "active",
      invited_at: now,
      joined_at: now,
    });

    return businessId;
  },
});

// Proof-of-service settings type for validation
const proofOfServiceSettingsValidator = v.object({
  require_before_photos: v.boolean(),
  require_after_photos: v.boolean(),
  require_time_tracking: v.boolean(),
  min_photos_before: v.number(),
  min_photos_after: v.number(),
  service_type_requirements: v.optional(v.array(v.object({
    service_type: v.string(),
    require_before_photos: v.boolean(),
    require_after_photos: v.boolean(),
    require_time_tracking: v.boolean(),
    min_photos_before: v.number(),
    min_photos_after: v.number(),
  }))),
});

// Update business settings
export const updateSettings = mutation({
  args: {
    working_days: v.optional(v.array(v.string())),
    working_hours_start: v.optional(v.string()),
    working_hours_end: v.optional(v.string()),
    service_types: v.optional(v.array(v.string())),
    chemical_types: v.optional(v.array(v.string())),
    route_optimization: v.optional(v.boolean()),
    require_photos: v.optional(v.boolean()),
    require_signatures: v.optional(v.boolean()),
    default_workorders_section: v.optional(v.string()),
    home_primary_action: v.optional(v.string()),
    show_ops_brief: v.optional(v.boolean()),
    proof_of_service: v.optional(proofOfServiceSettingsValidator),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    await enforceRateLimit(ctx, identity.email!, "business.write");

    const business = await ctx.db
      .query("businesses")
      .withIndex("by_owner_email", (q) => q.eq("owner_email", identity.email!))
      .first();

    if (!business) {
      throw new Error("Business not found or access denied");
    }

    // Merge settings
    const updatedSettings = {
      ...business.settings,
      ...(args.working_days && { working_days: args.working_days }),
      ...(args.working_hours_start && { working_hours_start: args.working_hours_start }),
      ...(args.working_hours_end && { working_hours_end: args.working_hours_end }),
      ...(args.service_types && { service_types: args.service_types }),
      ...(args.chemical_types && { chemical_types: args.chemical_types }),
      ...(args.route_optimization !== undefined && { route_optimization: args.route_optimization }),
      ...(args.require_photos !== undefined && { require_photos: args.require_photos }),
      ...(args.require_signatures !== undefined && { require_signatures: args.require_signatures }),
      ...(args.default_workorders_section !== undefined && { default_workorders_section: args.default_workorders_section }),
      ...(args.home_primary_action !== undefined && { home_primary_action: args.home_primary_action }),
      ...(args.show_ops_brief !== undefined && { show_ops_brief: args.show_ops_brief }),
      ...(args.proof_of_service !== undefined && { proof_of_service: args.proof_of_service }),
    };

    await ctx.db.patch(business._id, {
      settings: updatedSettings,
      updated_at: Date.now(),
    });

    return business._id;
  },
});

// Update business info (creates if doesn't exist)
export const update = mutation({
  args: {
    name: v.optional(v.string()),
    address: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    // Work tickets: IANA time zone and invoice payment terms (days).
    timezone: v.optional(v.string()),
    invoice_net_days: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    await enforceRateLimit(ctx, identity.email!, "business.write");
    if (args.timezone !== undefined && safeTimeZone(args.timezone) !== args.timezone) {
      throw new Error("Unknown time zone.");
    }
    if (args.invoice_net_days !== undefined && safeNetDays(args.invoice_net_days) !== args.invoice_net_days) {
      throw new Error("Payment terms must be a whole number of days between 0 and 365.");
    }

    const business = await ctx.db
      .query("businesses")
      .withIndex("by_owner_email", (q) => q.eq("owner_email", identity.email!))
      .first();

    if (!business) {
      // Previously created business silently - now require explicit creation
      throw new Error("No business found. Please create a business first using the create mutation.");
    }

    await ctx.db.patch(business._id, {
      ...args,
      updated_at: Date.now(),
    });

    return business._id;
  },
});

// Get team members for current business
export const getTeamMembers = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const business = await ctx.db
      .query("businesses")
      .withIndex("by_owner_email", (q) => q.eq("owner_email", identity.email!))
      .first();

    if (!business) return [];

    return await ctx.db
      .query("team_members")
      .withIndex("by_business", (q) => q.eq("business_id", business._id))
      .collect();
  },
});

// Invite a team member. The invite grants no access until the invitee
// accepts it with acceptInvite (their signed-in email must match).
export const inviteTeamMember = mutation({
  args: {
    email: v.string(),
    name: v.string(),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    await enforceRateLimit(ctx, identity.email!, "team.invite");

    const business = await ctx.db
      .query("businesses")
      .withIndex("by_owner_email", (q) => q.eq("owner_email", identity.email!))
      .first();

    if (!business) {
      throw new Error("Business not found or access denied");
    }

    // Validate role
    validateRole(args.role);

    // Cannot assign owner role to team members
    if (args.role === 'owner') {
      throw new Error("Cannot assign 'owner' role to team members. Use transfer ownership instead.");
    }

    const inviteEmail = normalizeEmail(args.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail) || inviteEmail.length > 254) {
      throw new Error("A valid email address is required");
    }
    if (inviteEmail === normalizeEmail(business.owner_email)) {
      throw new Error("The business owner is already a team member");
    }

    // Check if already a member / invited
    const existingMember = (await getMembershipsForEmail(ctx, inviteEmail)).find(
      (member) => String(member.business_id) === String(business._id)
    );

    if (existingMember && isActiveMembership(existingMember)) {
      throw new Error("User is already a team member");
    }
    if (existingMember && isPendingMembership(existingMember)) {
      throw new Error("This user already has a pending invite");
    }

    await assertCanAddTeamMember(ctx, business, 1);

    const now = Date.now();
    if (existingMember) {
      // Re-invite a previously removed/declined/left member.
      await ctx.db.patch(existingMember._id, {
        name: args.name,
        role: args.role,
        is_active: false,
        status: "pending",
        invited_at: now,
        joined_at: undefined,
      });
      return existingMember._id;
    }

    return await ctx.db.insert("team_members", {
      business_id: business._id,
      user_email: inviteEmail,
      name: args.name,
      role: args.role,
      is_active: false,
      status: "pending",
      invited_at: now,
    });
  },
});

// Pending invites addressed to the signed-in user.
export const listMyInvites = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) return [];

    const invites = (await getMembershipsForEmail(ctx, identity.email)).filter(isPendingMembership);
    const results = [];
    for (const invite of invites) {
      const business = await ctx.db.get(invite.business_id as Id<"businesses">);
      if (!business) continue;
      results.push({
        _id: invite._id,
        business_id: invite.business_id,
        business_name: business.name,
        owner_email: business.owner_email,
        role: invite.role,
        invited_at: invite.invited_at,
      });
    }
    return results;
  },
});

async function getOwnInvite(ctx: any, memberId: any, email: string | undefined) {
  const invite = await ctx.db.get(memberId);
  if (!invite || !email || normalizeEmail(invite.user_email) !== normalizeEmail(email)) {
    throw new Error("Invite not found");
  }
  if (!isPendingMembership(invite)) {
    throw new Error("This invite is no longer pending");
  }
  return invite;
}

// Accept a pending invite addressed to the signed-in user's email.
export const acceptInvite = mutation({
  args: { memberId: v.id("team_members") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) throw new Error("Not authenticated");

    await enforceRateLimit(ctx, identity.email, "team.write");

    const invite = await getOwnInvite(ctx, args.memberId, identity.email);
    const business = await ctx.db.get(invite.business_id as Id<"businesses">);
    if (!business) throw new Error("This business no longer exists");

    // A user works in one business at a time; leave the current team first.
    const memberships = await getMembershipsForEmail(ctx, identity.email);
    const otherTeam = memberships.find(
      (member) =>
        isActiveMembership(member) &&
        member.role !== "owner" &&
        String(member.business_id) !== String(invite.business_id)
    );
    if (otherTeam) {
      throw new Error("Leave your current team before joining another business");
    }

    await ctx.db.patch(invite._id, {
      is_active: true,
      status: "active",
      joined_at: Date.now(),
    });
    return invite.business_id;
  },
});

// Decline a pending invite addressed to the signed-in user's email.
export const declineInvite = mutation({
  args: { memberId: v.id("team_members") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) throw new Error("Not authenticated");

    await enforceRateLimit(ctx, identity.email, "team.write");

    const invite = await getOwnInvite(ctx, args.memberId, identity.email);
    await ctx.db.patch(invite._id, { is_active: false, status: "declined" });
    return invite._id;
  },
});

// Leave the business the signed-in user joined as a team member.
export const leaveBusiness = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) throw new Error("Not authenticated");

    await enforceRateLimit(ctx, identity.email, "team.write");

    const memberships = (await getMembershipsForEmail(ctx, identity.email)).filter(isActiveMembership);
    let membership: any = null;
    for (const candidate of memberships) {
      if (candidate.role === "owner") continue;
      const business = await ctx.db.get(candidate.business_id as Id<"businesses">);
      if (business && normalizeEmail(business.owner_email) === normalizeEmail(identity.email)) continue;
      membership = candidate;
      break;
    }
    if (!membership) {
      throw new Error("You are not a team member of another business. Owners cannot leave their own business.");
    }

    await ctx.db.patch(membership._id, { is_active: false, status: "left" });
    return membership.business_id;
  },
});

// Remove a team member (or revoke a pending invite)
export const removeTeamMember = mutation({
  args: {
    memberId: v.id("team_members"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    await enforceRateLimit(ctx, identity.email!, "team.write");

    const member = await ctx.db.get(args.memberId);
    if (!member) throw new Error("Team member not found");

    const business = await ctx.db.get(member.business_id);
    if (!business || business.owner_email !== identity.email) {
      throw new Error("Access denied");
    }

    // Can't remove the owner
    if (member.role === "owner") {
      throw new Error("Cannot remove the business owner");
    }

    await ctx.db.patch(args.memberId, { is_active: false, status: "removed" });
  },
});
