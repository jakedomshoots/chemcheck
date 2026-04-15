import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildInvoiceDocumentHtml,
  buildQuoteDocumentHtml,
  downloadInvoicePdf,
  downloadQuotePdf,
} from "./workOrderDocuments";

describe("workOrderDocuments", () => {
  it("builds quote printable HTML with totals and escaped content", () => {
    const html = buildQuoteDocumentHtml({
      businessName: "My Pool Co",
      customer: {
        full_name: "Sam Client",
        email: "sam@client.com",
      },
      quote: {
        _id: "q_1",
        title: "Pump Repair",
        description: "<script>alert(1)</script>",
        status: "draft",
        subtotal: 200,
        tax: 20,
        total: 220,
        deposit_required: 100,
        deposit_status: "pending",
        line_items: [{ description: "Pump Labor", quantity: 1, unit_price: 200, amount: 200 }],
      },
    });

    expect(html).toContain("Quote");
    expect(html).toContain("Pump Repair");
    expect(html).toContain("$220.00");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("builds invoice printable HTML with deposit applied and total", () => {
    const html = buildInvoiceDocumentHtml({
      businessName: "My Pool Co",
      customer: {
        full_name: "Alex Client",
      },
      invoice: {
        _id: "inv_1",
        status: "sent",
        subtotal: 300,
        tax: 0,
        deposit_applied: 100,
        total: 200,
        due_date: "2026-02-20",
        line_items: [{ description: "Weekly Service", quantity: 1, unit_price: 300, amount: 300 }],
      },
    });

    expect(html).toContain("Invoice");
    expect(html).toContain("Deposit Applied");
    expect(html).toContain("$200.00");
    expect(html).toContain("2026-02-20");
  });

  it("opens a print window and auto-triggers print", () => {
    vi.useFakeTimers();
    const fakeWindow = {
      document: {
        open: vi.fn(),
        write: vi.fn(),
        close: vi.fn(),
      },
      focus: vi.fn(),
      print: vi.fn(),
    };
    const openSpy = vi.spyOn(window, "open").mockReturnValue(fakeWindow as any);

    const result = downloadQuotePdf({
      businessName: "My Pool Co",
      customer: { full_name: "Sam Client" },
      quote: {
        _id: "q_2",
        title: "Filter Cleaning",
        status: "draft",
        subtotal: 120,
        tax: 0,
        total: 120,
        line_items: [{ description: "Filter Cleaning", quantity: 1, unit_price: 120, amount: 120 }],
      },
    });

    expect(result).toBe(true);
    expect(openSpy).toHaveBeenCalledWith("", "_blank");
    expect(fakeWindow.document.open).toHaveBeenCalled();
    expect(fakeWindow.document.write).toHaveBeenCalled();
    vi.runAllTimers();
    expect(fakeWindow.focus).toHaveBeenCalled();
    expect(fakeWindow.print).toHaveBeenCalled();
  });

  it("returns false if popup is blocked", () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);

    const result = downloadInvoicePdf({
      businessName: "My Pool Co",
      customer: { full_name: "Alex Client" },
      invoice: {
        _id: "inv_2",
        status: "draft",
        subtotal: 80,
        tax: 0,
        total: 80,
        line_items: [{ description: "Chem Service", quantity: 1, unit_price: 80, amount: 80 }],
      },
    });

    expect(result).toBe(false);
    expect(openSpy).toHaveBeenCalledWith("", "_blank");
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
