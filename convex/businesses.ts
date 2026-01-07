import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

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
    if (!identity) return null;

    // First check if user is a team member
    const teamMember = await ctx.db
      .query("team_members")
      .withIndex("by_user_email", (q) => q.eq("user_email", identity.email!))
      .filter((q) => q.eq(q.field("is_active"), true))
      .first();

    if (teamMember) {
      return await ctx.db.get(teamMember.business_id);
    }

    // Check if user owns a business
    const ownedBusiness = await ctx.db
      .query("businesses")
      .withIndex("by_owner_email", (q) => q.eq("owner_email", identity.email!))
      .first();

    return ownedBusiness;
  },
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

// Invite a team member
export const inviteTeamMember = mutation({
  args: {
    email: v.string(),
    name: v.string(),
    role: v.string(),
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

    // Check if already a member
    const existingMember = await ctx.db
      .query("team_members")
      .withIndex("by_business", (q) => q.eq("business_id", business._id))
      .filter((q) => q.eq(q.field("user_email"), args.email))
      .first();

    if (existingMember) {
      throw new Error("User is already a team member");
    }

    // Validate role
    validateRole(args.role);

    // Cannot assign owner role to team members
    if (args.role === 'owner') {
      throw new Error("Cannot assign 'owner' role to team members. Use transfer ownership instead.");
    }

    return await ctx.db.insert("team_members", {
      business_id: business._id,
      user_email: args.email,
      name: args.name,
      role: args.role,
      is_active: true,
      invited_at: Date.now(),
    });
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
    if (!business || business.owner_email !== identity.email) {
      throw new Error("Access denied");
    }

    // Can't remove the owner
    if (member.role === "owner") {
      throw new Error("Cannot remove the business owner");
    }

    await ctx.db.patch(args.memberId, { is_active: false });
  },
});
