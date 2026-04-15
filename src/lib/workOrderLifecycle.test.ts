import { describe, expect, it } from "vitest";
import {
  calculateInvoiceTotalsFromQuote,
  canConvertQuote,
  canDraftInvoiceFromQuote,
  hasPendingDeposit,
  isWorkOrderCompleted,
} from "./workOrderLifecycle";

describe("workOrderLifecycle", () => {
  it("enforces quote -> deposit -> convert -> invoice lifecycle for deposit-required jobs", () => {
    const draftQuote = {
      status: "draft",
      deposit_required: 100,
      deposit_status: "pending",
      converted_work_order_id: undefined,
    };

    expect(hasPendingDeposit(draftQuote)).toBe(true);
    expect(canConvertQuote(draftQuote)).toBe(false);

    const paidDepositQuote = {
      ...draftQuote,
      deposit_status: "paid",
    };

    expect(hasPendingDeposit(paidDepositQuote)).toBe(false);
    expect(canConvertQuote(paidDepositQuote)).toBe(true);

    const convertedQuote = {
      ...paidDepositQuote,
      status: "converted",
      converted_work_order_id: "wo_123",
    };

    expect(canConvertQuote(convertedQuote)).toBe(false);
    expect(canDraftInvoiceFromQuote(convertedQuote, false)).toBe(true);
    expect(canDraftInvoiceFromQuote(convertedQuote, true)).toBe(false);

    const totals = calculateInvoiceTotalsFromQuote({
      subtotal: 300,
      tax: 30,
      quote: convertedQuote,
    });

    expect(totals.grossTotal).toBe(330);
    expect(totals.depositApplied).toBe(100);
    expect(totals.total).toBe(230);
    expect(totals.status).toBe("draft");
    expect(isWorkOrderCompleted("scheduled")).toBe(false);
    expect(isWorkOrderCompleted("completed")).toBe(true);
  });

  it("marks invoice paid when paid deposit fully covers gross total", () => {
    const quote = {
      status: "approved",
      deposit_required: 500,
      deposit_status: "paid",
    };

    const totals = calculateInvoiceTotalsFromQuote({
      subtotal: 420,
      tax: 0,
      quote,
    });

    expect(totals.grossTotal).toBe(420);
    expect(totals.depositApplied).toBe(420);
    expect(totals.total).toBe(0);
    expect(totals.status).toBe("paid");
  });
});
