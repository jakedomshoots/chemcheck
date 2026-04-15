export type QuoteLifecycleLike = {
  status?: string;
  converted_work_order_id?: string;
  deposit_required?: number;
  deposit_status?: string;
};

export type InvoiceTotalsInput = {
  subtotal: number;
  tax: number;
  quote?: QuoteLifecycleLike;
};

export type InvoiceTotalsResult = {
  grossTotal: number;
  depositApplied: number;
  total: number;
  status: "draft" | "paid";
};

function roundCurrency(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(2));
}

export function hasPendingDeposit(quote?: QuoteLifecycleLike | null): boolean {
  return Boolean(quote?.deposit_required && quote.deposit_required > 0 && quote.deposit_status !== "paid");
}

export function canConvertQuote(quote?: QuoteLifecycleLike | null): boolean {
  if (!quote) return false;
  if (quote.converted_work_order_id) return false;
  if (!["draft", "sent", "approved"].includes(quote.status || "")) return false;
  return !hasPendingDeposit(quote);
}

export function canDraftInvoiceFromQuote(
  quote: QuoteLifecycleLike | null | undefined,
  hasLinkedInvoice: boolean
): boolean {
  if (!quote) return false;
  if (hasLinkedInvoice) return false;
  if (!["approved", "converted"].includes(quote.status || "")) return false;
  return !hasPendingDeposit(quote);
}

export function calculateInvoiceTotalsFromQuote(input: InvoiceTotalsInput): InvoiceTotalsResult {
  const safeSubtotal = roundCurrency(input.subtotal);
  const safeTax = roundCurrency(input.tax);
  const grossTotal = roundCurrency(safeSubtotal + safeTax);

  let depositApplied = 0;
  if (input.quote?.deposit_status === "paid" && (input.quote.deposit_required || 0) > 0) {
    depositApplied = roundCurrency(Math.min(grossTotal, input.quote.deposit_required || 0));
  }

  const total = roundCurrency(grossTotal - depositApplied);

  return {
    grossTotal,
    depositApplied,
    total,
    status: total <= 0 ? "paid" : "draft",
  };
}

export function isWorkOrderCompleted(status?: string): boolean {
  return status === "completed";
}
