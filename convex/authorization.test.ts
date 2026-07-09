import { describe, expect, it } from "vitest";
import {
  assertBusinessRole,
  resolveSelectedBusinessContext,
  type BusinessAccessCandidate,
} from "./authorization";

const ownerBusiness: BusinessAccessCandidate = {
  businessId: "business-owner",
  ownerEmail: "owner@chemcheck.test",
  userEmail: "owner@chemcheck.test",
  membershipRole: "technician",
  membershipActive: true,
};

const technicianBusiness: BusinessAccessCandidate = {
  businessId: "business-tech",
  ownerEmail: "owner@chemcheck.test",
  userEmail: "tech@chemcheck.test",
  membershipRole: "technician",
  membershipActive: true,
};

describe("tenant authorization policy", () => {
  it("gives a business owner the owner role even when a stale membership has a weaker role", () => {
    const context = resolveSelectedBusinessContext([ownerBusiness]);

    expect(context).toMatchObject({
      businessId: "business-owner",
      role: "owner",
      userEmail: "owner@chemcheck.test",
    });
  });

  it("requires an explicit business selection when an active technician belongs to multiple businesses", () => {
    expect(() => resolveSelectedBusinessContext([
      technicianBusiness,
      { ...technicianBusiness, businessId: "business-tech-2" },
    ])).toThrow("Select an active business");
  });

  it("selects only the requested active business and rejects an inactive membership", () => {
    const selected = resolveSelectedBusinessContext([
      technicianBusiness,
      { ...technicianBusiness, businessId: "business-inactive", membershipActive: false },
    ], "business-tech");

    expect(selected).toMatchObject({ businessId: "business-tech", role: "technician" });
    expect(() => resolveSelectedBusinessContext([
      technicianBusiness,
      { ...technicianBusiness, businessId: "business-inactive", membershipActive: false },
    ], "business-inactive")).toThrow("Access denied");
  });

  it("enforces least privilege for customer and billing writes", () => {
    expect(() => assertBusinessRole("viewer", ["owner", "admin"])).toThrow("Insufficient role permissions");
    expect(() => assertBusinessRole("technician", ["owner", "admin"])).toThrow("Insufficient role permissions");
    expect(() => assertBusinessRole("technician", ["owner", "admin", "technician"])).not.toThrow();
  });
});
