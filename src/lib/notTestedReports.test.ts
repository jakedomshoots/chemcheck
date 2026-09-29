import { describe, expect, it } from "vitest";
import {
  determinePoolStatus,
  generateSimpleEmailContent,
  testedReadingOrNull,
} from "../../convex/serviceReports";
import { generateSimpleEmailContent as previewGenerate } from "./emailPreview";
import { formatSmsMessage } from "./smsReport";

const log = (overrides: Record<string, string | undefined>) => ({
  ph: "not_tested",
  chlorine: "not_tested",
  alkalinity: "not_tested",
  stabilizer: "not_tested",
  ...overrides,
});

describe("determinePoolStatus with not_tested readings", () => {
  it("does not claim good when nothing was tested", () => {
    expect(determinePoolStatus(log({}))).toBe("not_tested");
    expect(determinePoolStatus({})).toBe("not_tested");
  });

  it("does not treat not_tested as a problem", () => {
    expect(determinePoolStatus(log({ ph: "good" }))).toBe("good");
  });

  it("still flags recorded problems", () => {
    expect(determinePoolStatus(log({ chlorine: "low" }))).toBe("needs_attention");
    expect(determinePoolStatus(log({ ph: "good", stabilizer: "critical" }))).toBe("needs_attention");
  });

  it("keeps legacy all-good logs as good", () => {
    expect(determinePoolStatus({ ph: "good", chlorine: "good", alkalinity: "good", stabilizer: "good" })).toBe("good");
  });
});

describe("testedReadingOrNull", () => {
  it("hides the raw not_tested token from the public report payload", () => {
    expect(testedReadingOrNull("not_tested")).toBeNull();
    expect(testedReadingOrNull(undefined)).toBeNull();
    expect(testedReadingOrNull("low")).toBe("low");
  });
});

describe("customer messages for a not-tested visit", () => {
  const params = {
    customerName: "Jane Doe",
    serviceDate: "01/15/2026",
    poolStatus: "not_tested" as const,
    businessName: "Acme Pools",
    reportLink: "https://app.example.com/report/abc",
  };

  it("email neither claims perfection nor prints the raw token", () => {
    const email = generateSimpleEmailContent(params);
    for (const body of [email.htmlBody, email.textBody]) {
      expect(body).toContain("Service Completed");
      expect(body).toContain("Water chemistry was not tested on this visit.");
      expect(body).not.toContain("Everything is Perfect");
      expect(body).not.toContain("Needs Attention");
      expect(body).not.toContain("not_tested");
    }
  });

  it("email preview stays byte-identical to the backend email", () => {
    for (const customNote of [undefined, "Brushed the steps"]) {
      const backend = generateSimpleEmailContent({ ...params, customNote });
      const preview = previewGenerate({ ...params, customNote });
      expect(preview).toEqual(backend);
    }
  });

  it("shows a custom note as a custom message, not a problem", () => {
    const email = generateSimpleEmailContent({ ...params, customNote: "Brushed the steps" });
    expect(email.textBody).toContain("Custom Message:\nBrushed the steps");
    expect(email.textBody).not.toContain("Technician Notes:");
  });

  it("SMS says Not tested rather than OK", () => {
    const sms = formatSmsMessage("Acme Pools", "01/15/2026", "not_tested", params.reportLink);
    expect(sms).toContain("Pool Status: Not tested");
    expect(sms).not.toContain("not_tested");
    expect(sms).not.toContain("Pool Status: OK");
    // GSM-7 safe
    expect(/^[\x20-\x7E\n]*$/.test(sms)).toBe(true);
  });
});
