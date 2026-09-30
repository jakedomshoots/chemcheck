import { v } from "convex/values";
import { query, mutation, internalQuery } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  findOwnedBusiness,
  isPendingInvite,
  normalizeEmail,
  resolveBusinessForEmail,
} from "./entitlements";

// Valid role values for team members
const VALID_ROLES = ['owner', 'admin', 'technician', 'viewer'] as const;
type TeamMemberRole = typeof VALID_ROLES[number];

function validateRole(role: string): void {
  if (!VALID_ROLES.includes(role as TeamMemberRole)) {
    throw new Error(`Invalid role: "${role}". Must be one of: ${VALID_ROLES.join(', ')}`);
  }
}

// Get the current user's business.
// SECURITY: ownership is resolved FIRST, then active (accepted) team
// membership, so a membership row can never hijack an owner's tenant.
export const getCurrent = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) return null;
    return await resolveBusinessForEmail(ctx, identity.email);
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
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

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

// ============================================
// Team invites
// ============================================
//
// Invites are inserted as PENDING rows (is_active: false, joined_at
// undefined). They become memberships only when the invited user accepts
// them while signed in with the invited email address.

type InviteCtx = Pick<MutationCtx, "db">;
type InviteReadCtx = Pick<QueryCtx, "db">;

export type PendingInviteSummary = {
  _id: Id<"team_members">;
  business_id: Id<"businesses">;
  business_name: string;
  name: string;
  role: string;
  invited_at: number;
};

/** Find an existing team_members row for this email on this business (raw or normalized email). */
async function findMemberRowForBusiness(
  ctx: InviteReadCtx,
  businessId: Id<"businesses">,
  email: string
): Promise<Doc<"team_members"> | null> {
  const normalized = normalizeEmail(email);
  const rows = await ctx.db
    .query("team_members")
    .withIndex("by_business", (q) => q.eq("business_id", businessId))
    .collect();
  return rows.find((row) => normalizeEmail(row.user_email) === normalized) ?? null;
}

/**
 * Create a pending invite for `email` on the business owned by `ownerEmail`.
 * - Only the business owner may invite.
 * - The owner cannot be invited to their own business.
 * - A duplicate pending invite returns the existing row id.
 * - A previously removed member is re-invited (row reset to pending).
 */
export async function createPendingInvite(
  ctx: InviteCtx,
  ownerEmail: string,
  args: { email: string; name: string; role: string }
): Promise<Id<"team_members">> {
  const business = await findOwnedBusiness(ctx, ownerEmail);
  if (!business) {
    throw new Error("Business not found or access denied");
  }

  const inviteeEmail = normalizeEmail(args.email);
  if (!inviteeEmail || !inviteeEmail.includes("@")) {
    throw new Error("A valid email address is required to invite a team member");
  }
  if (inviteeEmail === normalizeEmail(business.owner_email)) {
    throw new Error("The business owner cannot be invited to their own business");
  }

  // Validate role
  validateRole(args.role);

  // Cannot assign owner role to team members
  if (args.role === 'owner') {
    throw new Error("Cannot assign 'owner' role to team members. Use transfer ownership instead.");
  }

  const now = Date.now();
  const existing = await findMemberRowForBusiness(ctx, business._id, inviteeEmail);
  if (existing) {
    if (existing.is_active) {
      throw new Error("User is already a team member");
    }
    if (isPendingInvite(existing)) {
      // Duplicate pending invite: return the existing one.
      return existing._id;
    }
    // Previously removed member: reset the row to a fresh pending invite.
    await ctx.db.patch(existing._id, {
      user_email: inviteeEmail,
      name: args.name,
      role: args.role,
      is_active: false,
      invited_at: now,
      joined_at: undefined,
    });
    return existing._id;
  }

  return await ctx.db.insert("team_members", {
    business_id: business._id,
    user_email: inviteeEmail,
    name: args.name,
    role: args.role,
    is_active: false,
    invited_at: now,
    joined_at: undefined,
  });
}

/** Load a pending invite and verify it is addressed to the signed-in email. */
async function loadOwnPendingInvite(
  ctx: InviteReadCtx,
  inviteId: Id<"team_members">,
  identityEmail: string
): Promise<Doc<"team_members">> {
  const invite = await ctx.db.get(inviteId);
  if (!invite || !isPendingInvite(invite)) {
    throw new Error("Invite not found or no longer pending");
  }
  if (normalizeEmail(invite.user_email) !== normalizeEmail(identityEmail)) {
    throw new Error("This invite was sent to a different email address");
  }
  return invite;
}

/** Accept a pending invite: activates the membership for the signed-in user. */
export async function acceptPendingInvite(
  ctx: InviteCtx,
  identityEmail: string,
  inviteId: Id<"team_members">
): Promise<{ member_id: Id<"team_members">; business_id: Id<"businesses">; joined_at: number }> {
  const invite = await loadOwnPendingInvite(ctx, inviteId, identityEmail);
  const business = await ctx.db.get(invite.business_id);
  if (!business) {
    throw new Error("The business for this invite no longer exists");
  }
  const now = Date.now();
  await ctx.db.patch(invite._id, {
    user_email: normalizeEmail(invite.user_email),
    is_active: true,
    joined_at: now,
  });
  return { member_id: invite._id, business_id: invite.business_id, joined_at: now };
}

/** Decline (delete) a pending invite addressed to the signed-in user. */
export async function declinePendingInvite(
  ctx: InviteCtx,
  identityEmail: string,
  inviteId: Id<"team_members">
): Promise<{ declined: true; member_id: Id<"team_members"> }> {
  const invite = await loadOwnPendingInvite(ctx, inviteId, identityEmail);
  await ctx.db.delete(invite._id);
  return { declined: true, member_id: invite._id };
}

/** All pending invites addressed to the signed-in user (raw or normalized email). */
export async function listPendingInvitesForEmail(
  ctx: InviteReadCtx,
  identityEmail: string
): Promise<PendingInviteSummary[]> {
  const normalized = normalizeEmail(identityEmail);
  const candidates = normalized === identityEmail ? [normalized] : [normalized, identityEmail];
  const seen = new Set<string>();
  const invites: PendingInviteSummary[] = [];
  for (const candidate of candidates) {
    const rows = await ctx.db
      .query("team_members")
      .withIndex("by_user_email", (q) => q.eq("user_email", candidate))
      .filter((q) => q.eq(q.field("is_active"), false))
      .take(50);
    for (const row of rows) {
      if (!isPendingInvite(row) || seen.has(String(row._id))) continue;
      seen.add(String(row._id));
      const business = await ctx.db.get(row.business_id);
      if (!business) continue;
      invites.push({
        _id: row._id,
        business_id: row.business_id,
        business_name: business.name,
        name: row.name,
        role: row.role,
        invited_at: row.invited_at,
      });
    }
  }
  return invites;
}

// Invite a team member (creates a PENDING invite; see acceptInvite)
export const inviteTeamMember = mutation({
  args: {
    email: v.string(),
    name: v.string(),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) throw new Error("Not authenticated");
    return await createPendingInvite(ctx, identity.email, args);
  },
});

// Accept a pending invite addressed to the signed-in user's email
export const acceptInvite = mutation({
  args: { inviteId: v.id("team_members") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) throw new Error("Not authenticated");
    return await acceptPendingInvite(ctx, identity.email, args.inviteId);
  },
});

// Decline (delete) a pending invite addressed to the signed-in user's email
export const declineInvite = mutation({
  args: { inviteId: v.id("team_members") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) throw new Error("Not authenticated");
    return await declinePendingInvite(ctx, identity.email, args.inviteId);
  },
});

// Pending invites for the signed-in user
export const getPendingInvites = query({
  args: {},
  handler: async (ctx): Promise<PendingInviteSummary[]> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) return [];
    return await listPendingInvitesForEmail(ctx, identity.email);
  },
});

// Remove a team member
export const removeTeamMember = mutation({
  args: {
    memberId: v.id("team_members"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const member = await ctx.db.get(args.memberId);
    if (!member) throw new Error("Team member not found");

    const business = await ctx.db.get(member.business_id);
    if (!business || normalizeEmail(business.owner_email) !== normalizeEmail(identity.email)) {
      throw new Error("Access denied");
    }

    // Can't remove the owner
    if (member.role === "owner") {
      throw new Error("Cannot remove the business owner");
    }

    await ctx.db.patch(args.memberId, { is_active: false });
  },
});
