import { describe, expect, it } from "vitest";
import { generateSimpleEmailContent } from "./serviceReports";

describe("serviceReports email photo rendering", () => {
  it("includes photo section when photo URLs are provided", () => {
    const result = generateSimpleEmailContent({
      customerName: "Jake",
      serviceDate: "12/21/2025",
      poolStatus: "good",
      businessName: "ChemCheck",
      reportLink: "https://chemcheck.xyz/report/test-token",
      beforePhotoUrls: ["https://cdn.example.com/before-1.jpg"],
      afterPhotoUrls: ["https://cdn.example.com/after-1.jpg"],
    });

    expect(result.htmlBody).toContain("Service Photos");
    expect(result.htmlBody).toContain('src="https:&#x2F;&#x2F;cdn.example.com&#x2F;before-1.jpg"');
    expect(result.htmlBody).toContain('src="https:&#x2F;&#x2F;cdn.example.com&#x2F;after-1.jpg"');
    expect(result.textBody).toContain("Service Photos:");
    expect(result.textBody).toContain("https://cdn.example.com/before-1.jpg");
    expect(result.textBody).toContain("https://cdn.example.com/after-1.jpg");
  });
});
