import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPortalPath, buildPortalUrl, copyTextToClipboard, daysUntil, formatMoney, formatPortalExpiry, formatVisitDate, isPortalToken, todayIso } from "./portal";

describe("portal link helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds portal paths and URLs", () => {
    expect(buildPortalPath("abc-123")).toBe("/portal/abc-123");
    expect(buildPortalUrl("abc-123", "https://app.example.com/")).toBe("https://app.example.com/portal/abc-123");
    expect(buildPortalUrl("abc-123")).toBe(`${window.location.origin}/portal/abc-123`);
  });

  it("validates tokens loosely (UUID-like)", () => {
    expect(isPortalToken("3f1c2a9e-1b2c-4d5e-8f90-123456789abc")).toBe(true);
    expect(isPortalToken("short")).toBe(false);
    expect(isPortalToken("has spaces in it here")).toBe(false);
    expect(isPortalToken(123)).toBe(false);
  });

  it("copies with the clipboard API and falls back to execCommand", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(await copyTextToClipboard("hello")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");

    vi.stubGlobal("navigator", {});
    document.execCommand = vi.fn().mockReturnValue(true);
    expect(await copyTextToClipboard("fallback")).toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith("copy");
  });

  it("describes expiry", () => {
    const now = Date.UTC(2026, 0, 1);
    const day = 86400000;
    expect(daysUntil(null)).toBeNull();
    expect(formatPortalExpiry(null)).toBe("Never expires");
    expect(formatPortalExpiry(now - day, now)).toBe("Expired");
    expect(formatPortalExpiry(now + day, now)).toBe("Expires tomorrow");
    expect(formatPortalExpiry(now + 5 * day, now)).toBe("Expires in 5 days");
    expect(formatPortalExpiry(now + 400 * day, now)).toMatch(/^Expires [A-Z][a-z]{2} \d{1,2}, \d{4}$/);
  });

  it("formats dates and money", () => {
    expect(formatVisitDate("2026-03-02")).toMatch(/Mon, Mar 2, 2026/);
    expect(formatVisitDate("bad")).toBe("bad");
    expect(formatMoney(12)).toBe("$12.00");
    expect(formatMoney(undefined)).toBe("—");
    expect(todayIso(new Date(2026, 2, 5))).toBe("2026-03-05");
  });
});
