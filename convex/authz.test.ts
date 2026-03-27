import { describe, expect, it } from "vitest";

import {
  assertPermission,
  normalizeTeamMemberRole,
  resolveAccessContextForEmail,
} from "./authz";

type SeedData = {
  businesses?: any[];
  team_members?: any[];
};

function createQuery(records: any[]) {
  let current = [...records];

  return {
    withIndex(_indexName: string, build?: (q: any) => any) {
      if (build) {
        const conditions: Array<{ field: string; value: unknown }> = [];
        const q = {
          field(name: string) {
            return { __field: name };
          },
          eq(fieldOrName: string | { __field: string }, value: unknown) {
            conditions.push({
              field: typeof fieldOrName === "string" ? fieldOrName : fieldOrName.__field,
              value,
            });
            return q;
          },
        };
        build(q);
        current = current.filter((record) =>
          conditions.every((condition) => record?.[condition.field] === condition.value),
        );
      }
      return this;
    },
    filter(predicate: (q: any) => boolean) {
      current = current.filter((record) =>
        predicate({
          field(name: string) {
            return { __field: name };
          },
          eq(fieldRef: { __field: string }, value: unknown) {
            return record?.[fieldRef.__field] === value;
          },
        }),
      );
      return this;
    },
    async first() {
      return current[0] ?? null;
    },
    async collect() {
      return [...current];
    },
  };
}

function createCtx(seed: SeedData) {
  const data = {
    businesses: seed.businesses ?? [],
    team_members: seed.team_members ?? [],
  };

  return {
    db: {
      query(table: keyof typeof data) {
        return createQuery(data[table] ?? []);
      },
      async get(id: string) {
        for (const table of Object.values(data)) {
          const match = table.find((record) => String(record._id) === String(id));
          if (match) return match;
        }
        return null;
      },
    },
  };
}

describe("authz helper", () => {
  it("normalizes legacy employee memberships to technician", () => {
    expect(normalizeTeamMemberRole("employee")).toBe("technician");
    expect(normalizeTeamMemberRole("TECHNICIAN")).toBe("technician");
    expect(normalizeTeamMemberRole("viewer")).toBe("viewer");
  });

  it("resolves active team membership and grants operational write access to technicians", async () => {
    const ctx = createCtx({
      businesses: [{ _id: "biz_1", owner_email: "owner@example.com", name: "ChemCheck" }],
      team_members: [
        {
          _id: "member_1",
          business_id: "biz_1",
          user_email: "tech@example.com",
          role: "employee",
          is_active: true,
        },
        {
          _id: "member_2",
          business_id: "biz_1",
          user_email: "viewer@example.com",
          role: "viewer",
          is_active: true,
        },
      ],
    });

    const access = await resolveAccessContextForEmail(ctx, "tech@example.com");

    expect(access.role).toBe("technician");
    expect(access.business?._id).toBe("biz_1");
    expect(access.allowedUserEmails.has("owner@example.com")).toBe(true);
    expect(access.allowedUserEmails.has("tech@example.com")).toBe(true);
    expect(assertPermission(access, "operational:write")).toBe(access);
  });

  it("treats viewers as read-only and denies inactive outsiders", async () => {
    const ctx = createCtx({
      businesses: [{ _id: "biz_1", owner_email: "owner@example.com", name: "ChemCheck" }],
      team_members: [
        {
          _id: "member_1",
          business_id: "biz_1",
          user_email: "viewer@example.com",
          role: "viewer",
          is_active: true,
        },
        {
          _id: "member_2",
          business_id: "biz_1",
          user_email: "inactive@example.com",
          role: "technician",
          is_active: false,
        },
      ],
    });

    const viewerAccess = await resolveAccessContextForEmail(ctx, "viewer@example.com");
    expect(viewerAccess.role).toBe("viewer");
    expect(() => assertPermission(viewerAccess, "operational:write")).toThrow("Access denied");

    const outsiderAccess = await resolveAccessContextForEmail(ctx, "inactive@example.com");
    expect(outsiderAccess.role).toBe("owner");
    expect(outsiderAccess.business).toBeNull();
    expect(outsiderAccess.allowedUserEmails.has("inactive@example.com")).toBe(true);
    expect(outsiderAccess.allowedUserEmails.has("owner@example.com")).toBe(false);
  });
});
