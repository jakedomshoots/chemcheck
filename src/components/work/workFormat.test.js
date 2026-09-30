import { describe, expect, it } from "vitest";
import {
  billingText,
  money,
  normalizeFilter,
  pressKey,
  readableError,
  scheduleChip,
  shortWhen,
  sumItems,
  ticketStatusKey,
} from "./workFormat";

const typeKeys = (keys, start = "") => keys.reduce((a, k) => pressKey(a, k), start);

describe("pressKey (amount keypad rules)", () => {
  it("builds an amount from digits", () => {
    expect(typeKeys(["1", "2", "5"])).toBe("125");
  });

  it("allows only one decimal point", () => {
    expect(typeKeys(["1", ".", "5", "."])).toBe("1.5");
  });

  it("prefixes a leading decimal point with zero", () => {
    expect(typeKeys([".", "5"])).toBe("0.5");
  });

  it("caps decimals at two places", () => {
    expect(typeKeys(["9", ".", "9", "9", "9"])).toBe("9.99");
  });

  it("caps the integer part at five digits", () => {
    expect(typeKeys(["1", "2", "3", "4", "5", "6"])).toBe("12345");
    expect(typeKeys(["1", "2", "3", "4", "5", ".", "6", "7"])).toBe("12345.67");
  });

  it("replaces a lone leading zero", () => {
    expect(typeKeys(["0", "7"])).toBe("7");
  });

  it("backspace removes the last character and is safe on empty", () => {
    expect(typeKeys(["4", ".", "5", "back"])).toBe("4.");
    expect(typeKeys(["back"])).toBe("");
  });

  it("ignores unknown keys", () => {
    expect(pressKey("12", "x")).toBe("12");
  });
});

describe("formatting helpers", () => {
  it("formats dollars with separators and cents", () => {
    expect(money(1234.5)).toBe("$1,234.50");
    expect(money(0)).toBe("$0.00");
    expect(money(undefined)).toBe("$0.00");
  });

  it("sums item amounts without float drift", () => {
    expect(sumItems([{ amount: 0.1 }, { amount: 0.2 }])).toBe(0.3);
  });

  it("derives the overdue status key", () => {
    expect(ticketStatusKey({ status: "requested", overdue: true })).toBe("overdue");
    expect(ticketStatusKey({ status: "requested", overdue: false })).toBe("requested");
    expect(ticketStatusKey({ status: "paid", overdue: true })).toBe("paid");
  });

  it("describes schedule billing", () => {
    expect(billingText({ bill_mode: "visits", rate: 55, cadence: "monthly" })).toBe("$55.00/visit + chemicals");
    expect(billingText({ bill_mode: "fixed", rate: 150, cadence: "weekly" })).toBe("$150.00/wk");
    expect(scheduleChip({ paused: true }).label).toBe("Paused");
    expect(scheduleChip({ autopay: true, card_label: "Visa •• 4242" }).label).toBe("Autopay");
    expect(scheduleChip({ last_error: "Card declined" }).label).toBe("Needs attention");
  });

  it("formats short relative times", () => {
    const now = Date.UTC(2026, 8, 30, 12);
    expect(shortWhen(now - 10_000, now)).toBe("Now");
    expect(shortWhen(now - 5 * 60_000, now)).toBe("5m");
    expect(shortWhen(now - 3 * 3_600_000, now)).toBe("3h");
    expect(shortWhen(now - 2 * 86_400_000, now)).toBe("2d");
  });

  it("normalizes unknown filters to all", () => {
    expect(normalizeFilter("paid")).toBe("paid");
    expect(normalizeFilter("invoices")).toBe("all");
  });

  it("extracts the server message from Convex errors", () => {
    const err = new Error(
      "[CONVEX A(tickets:send)] [Request ID: abc] Server Error\nUncaught Error: Connect your Square account in Settings to send invoices.\n    at handler (../convex/tickets.ts:10:5)"
    );
    expect(readableError(err)).toBe("Connect your Square account in Settings to send invoices.");
    expect(readableError(new Error("Plain failure"))).toBe("Plain failure");
    expect(readableError(null)).toBe("Something went wrong. Try again.");
  });
});
