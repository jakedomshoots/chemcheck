import { describe, expect, it } from "vitest";
import {
  acceptPendingInvite,
  createPendingInvite,
  declinePendingInvite,
  listPendingInvitesForEmail,
} from "./businesses";
import { resolveBusinessForEmail } from "./entitlements";
import { FakeDb, makeCtx, seedBusiness, seedMember } from "./fakeConvexDb.testing";

const OWNER = "owner@example.com";

describe("team invites", () => {
  it("creates a PENDING invite with a normalized email (no tenant access yet)", async () => {
    const db = new FakeDb();
    const ctx = makeCtx(db);
    const biz = await seedBusiness(db, OWNER, "Pool Co");

    const inviteId = await createPendingInvite(ctx, OWNER, {
      email: "  Tech@Example.COM ",
      name: "Tech",
      role: "technician",
    });

    const row = await db.get(inviteId);
    expect(row).toMatchObject({ business_id: biz, user_email: "tech@example.com", role: "technician", is_active: false });
    expect(row?.joined_at).toBeUndefined();
    expect(await resolveBusinessForEmail(ctx, "tech@example.com")).toBeNull();
  });

  it("rejects inviting the owner, owner-role invites, invalid emails and non-owners", async () => {
    const db = new FakeDb();
    const ctx = makeCtx(db);
    await seedBusiness(db, OWNER);
    await expect(createPendingInvite(ctx, OWNER, { email: "OWNER@example.com", name: "x", role: "admin" }))
      .rejects.toThrow(/owner cannot be invited/i);
    await expect(createPendingInvite(ctx, OWNER, { email: "a@b.co", name: "x", role: "owner" }))
      .rejects.toThrow(/Cannot assign 'owner' role/);
    await expect(createPendingInvite(ctx, OWNER, { email: "not-an-email", name: "x", role: "admin" }))
      .rejects.toThrow(/valid email/i);
    await expect(createPendingInvite(ctx, "stranger@example.com", { email: "a@b.co", name: "x", role: "admin" }))
      .rejects.toThrow(/Business not found or access denied/);
  });

  it("returns the existing invite for a duplicate pending invite and rejects active members", async () => {
    const db = new FakeDb();
    const ctx = makeCtx(db);
    const biz = await seedBusiness(db, OWNER);
    const first = await createPendingInvite(ctx, OWNER, { email: "tech@example.com", name: "T", role: "technician" });
    const second = await createPendingInvite(ctx, OWNER, { email: "Tech@example.com", name: "T", role: "technician" });
    expect(second).toBe(first);
    expect(db.all("team_members").filter((m) => m.user_email === "tech@example.com")).toHaveLength(1);

    await seedMember(db, biz, "active@example.com");
    await expect(createPendingInvite(ctx, OWNER, { email: "active@example.com", name: "A", role: "admin" }))
      .rejects.toThrow(/already a team member/);
  });

  it("acceptInvite activates membership only for the invited email", async () => {
    const db = new FakeDb();
    const ctx = makeCtx(db);
    const biz = await seedBusiness(db, OWNER);
    const inviteId = await createPendingInvite(ctx, OWNER, { email: "tech@example.com", name: "T", role: "technician" });

    await expect(acceptPendingInvite(ctx, "intruder@example.com", inviteId as any))
      .rejects.toThrow(/different email address/);
    expect(await resolveBusinessForEmail(ctx, "intruder@example.com")).toBeNull();

    const result = await acceptPendingInvite(ctx, "TECH@example.com", inviteId as any);
    expect(result.business_id).toBe(biz);
    expect(result.member_id).toBe(inviteId);
    const row = await db.get(inviteId);
    expect(row?.is_active).toBe(true);
    expect(typeof row?.joined_at).toBe("number");
    expect((await resolveBusinessForEmail(ctx, "tech@example.com"))?._id).toBe(biz);

    // Accepting twice is rejected: it is no longer pending.
    await expect(acceptPendingInvite(ctx, "tech@example.com", inviteId as any))
      .rejects.toThrow(/no longer pending/);
  });

  it("declineInvite deletes the pending row and is limited to the invited email", async () => {
    const db = new FakeDb();
    const ctx = makeCtx(db);
    await seedBusiness(db, OWNER);
    const inviteId = await createPendingInvite(ctx, OWNER, { email: "tech@example.com", name: "T", role: "technician" });

    await expect(declinePendingInvite(ctx, "someone@else.com", inviteId as any)).rejects.toThrow(/different email/);
    const result = await declinePendingInvite(ctx, "tech@example.com", inviteId as any);
    expect(result).toEqual({ declined: true, member_id: inviteId });
    expect(await db.get(inviteId)).toBeNull();
  });

  it("getPendingInvites lists only pending invites for the signed-in email", async () => {
    const db = new FakeDb();
    const ctx = makeCtx(db);
    const biz = await seedBusiness(db, OWNER, "Pool Co");
    const inviteId = await createPendingInvite(ctx, OWNER, { email: "tech@example.com", name: "T", role: "technician" });
    // Removed (inactive but previously joined) rows are not invites.
    await seedMember(db, biz, "removed@example.com", { is_active: false });

    const invites = await listPendingInvitesForEmail(ctx, "Tech@Example.com");
    expect(invites).toHaveLength(1);
    expect(invites[0]).toMatchObject({ _id: inviteId, business_id: biz, business_name: "Pool Co", role: "technician", name: "T" });
    expect(typeof invites[0].invited_at).toBe("number");

    expect(await listPendingInvitesForEmail(ctx, "removed@example.com")).toEqual([]);
    expect(await listPendingInvitesForEmail(ctx, "nobody@example.com")).toEqual([]);
  });

  it("re-invites a previously removed member as a fresh pending invite", async () => {
    const db = new FakeDb();
    const ctx = makeCtx(db);
    const biz = await seedBusiness(db, OWNER);
    const removedId = await seedMember(db, biz, "removed@example.com", { is_active: false, role: "admin" });
    const inviteId = await createPendingInvite(ctx, OWNER, { email: "removed@example.com", name: "R", role: "technician" });
    expect(inviteId).toBe(removedId);
    const row = await db.get(removedId);
    expect(row).toMatchObject({ is_active: false, role: "technician" });
    expect(row?.joined_at).toBeUndefined();
    expect(await resolveBusinessForEmail(ctx, "removed@example.com")).toBeNull();
  });
});
