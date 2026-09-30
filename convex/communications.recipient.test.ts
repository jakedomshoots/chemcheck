import { describe, expect, it } from "vitest";
import {
  MAX_MESSAGE_LENGTH,
  assertRecipientMatchesCustomer,
  enforceMessageLength,
  escapeHtml,
  recipientMatchesCustomer,
} from "./communications";

describe("recipient restriction", () => {
  const customer = { phone: "(555) 123-4567", email: "Jane@Example.com" };

  it("accepts the customer's stored phone in any common formatting", () => {
    expect(recipientMatchesCustomer("sms", "5551234567", customer)).toBe(true);
    expect(recipientMatchesCustomer("sms", "+1 555-123-4567", customer)).toBe(true);
    expect(recipientMatchesCustomer("sms", "555.123.4567", customer)).toBe(true);
  });

  it("rejects any other phone number", () => {
    expect(recipientMatchesCustomer("sms", "5559999999", customer)).toBe(false);
    expect(recipientMatchesCustomer("sms", "", customer)).toBe(false);
    expect(recipientMatchesCustomer("sms", "5551234567", { phone: undefined })).toBe(false);
  });

  it("accepts the customer's stored email case-insensitively and rejects others", () => {
    expect(recipientMatchesCustomer("email", "jane@example.com", customer)).toBe(true);
    expect(recipientMatchesCustomer("email", "  JANE@EXAMPLE.COM ", customer)).toBe(true);
    expect(recipientMatchesCustomer("email", "attacker@example.com", customer)).toBe(false);
    expect(recipientMatchesCustomer("email", "jane@example.com", { email: undefined })).toBe(false);
  });

  it("rejects unknown channels and missing customers", () => {
    expect(recipientMatchesCustomer("push", "x", customer)).toBe(false);
    expect(recipientMatchesCustomer("sms", "5551234567", null)).toBe(false);
  });

  it("assertRecipientMatchesCustomer throws a clear error", () => {
    expect(() => assertRecipientMatchesCustomer("sms", "5559999999", customer)).toThrow(/must match the phone number stored/);
    expect(() => assertRecipientMatchesCustomer("email", "x@y.com", customer)).toThrow(/must match the email address stored/);
    expect(() => assertRecipientMatchesCustomer("email", "jane@example.com", customer)).not.toThrow();
  });
});

describe("message hardening", () => {
  it("escapes HTML in subject/message interpolation", () => {
    expect(escapeHtml(`<script>alert("x")</script>`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;&#x2F;script&gt;"
    );
    expect(escapeHtml("a & b 'c' `d`")).toBe("a &amp; b &#039;c&#039; &#x60;d&#x60;");
    expect(escapeHtml(null)).toBe("");
  });

  it("caps message length and rejects empty messages", () => {
    expect(enforceMessageLength("  hello ")).toBe("hello");
    expect(enforceMessageLength("x".repeat(MAX_MESSAGE_LENGTH))).toHaveLength(MAX_MESSAGE_LENGTH);
    expect(() => enforceMessageLength("x".repeat(MAX_MESSAGE_LENGTH + 1))).toThrow(/too long/);
    expect(() => enforceMessageLength("   ")).toThrow(/empty/);
  });
});
