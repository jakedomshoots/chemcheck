import { describe, expect, it } from "vitest";
import { getEmailDeliveryValidationError, isEmailDeliverableForReports } from "./emailValidation";

describe("emailValidation", () => {
  it("rejects missing email", () => {
    expect(getEmailDeliveryValidationError("")).toMatch(/No email address on file/i);
  });

  it("rejects malformed email", () => {
    expect(getEmailDeliveryValidationError("bad-email")).toMatch(/invalid/i);
  });

  it("rejects placeholder domains", () => {
    expect(getEmailDeliveryValidationError("admin@example.com")).toMatch(/placeholder/i);
    expect(isEmailDeliverableForReports("admin@example.com")).toBe(false);
  });

  it("accepts a normal email domain", () => {
    expect(getEmailDeliveryValidationError("customer@gmail.com")).toBeNull();
    expect(isEmailDeliverableForReports("customer@gmail.com")).toBe(true);
  });
});
