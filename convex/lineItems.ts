/**
 * Server-side line item validation and totals for invoices and quotes.
 * Client-supplied `amount` values are ignored; amounts are always recomputed
 * from quantity x unit_price so totals cannot be forged or made negative.
 */

export const MAX_LINE_ITEMS = 100;
export const MAX_LINE_ITEM_QUANTITY = 100_000;
export const MAX_LINE_ITEM_UNIT_PRICE = 1_000_000;
export const MAX_LINE_ITEM_DESCRIPTION_LENGTH = 500;

export type LineItemInput = {
  description: string;
  quantity: number;
  unit_price: number;
  amount?: number;
};

export type LineItem = {
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
};

export function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function normalizeLineItems(items: LineItemInput[]): LineItem[] {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("At least one line item is required");
  }
  if (items.length > MAX_LINE_ITEMS) {
    throw new Error(`A maximum of ${MAX_LINE_ITEMS} line items is allowed`);
  }

  return items.map((item, index) => {
    const label = `Line item ${index + 1}`;
    const description = String(item?.description ?? "").trim();
    if (description.length > MAX_LINE_ITEM_DESCRIPTION_LENGTH) {
      throw new Error(`${label}: description is too long`);
    }
    const quantity = item?.quantity;
    const unitPrice = item?.unit_price;
    if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity < 0 || quantity > MAX_LINE_ITEM_QUANTITY) {
      throw new Error(`${label}: quantity must be a non-negative number up to ${MAX_LINE_ITEM_QUANTITY}`);
    }
    if (typeof unitPrice !== "number" || !Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > MAX_LINE_ITEM_UNIT_PRICE) {
      throw new Error(`${label}: unit price must be a non-negative amount up to ${MAX_LINE_ITEM_UNIT_PRICE}`);
    }
    const roundedUnitPrice = roundCurrency(unitPrice);
    return {
      description,
      quantity,
      unit_price: roundedUnitPrice,
      amount: roundCurrency(quantity * roundedUnitPrice),
    };
  });
}

export function computeTotals(
  lineItems: LineItem[],
  taxRate: number,
  depositPaid = 0
): { subtotal: number; tax: number; grossTotal: number; depositApplied: number; total: number } {
  const subtotal = roundCurrency(lineItems.reduce((sum, item) => sum + item.amount, 0));
  const safeRate = Number.isFinite(taxRate) && taxRate > 0 ? taxRate : 0;
  const tax = roundCurrency(subtotal * safeRate);
  const grossTotal = roundCurrency(subtotal + tax);
  const safeDeposit = Number.isFinite(depositPaid) && depositPaid > 0 ? depositPaid : 0;
  const depositApplied = roundCurrency(Math.min(grossTotal, safeDeposit));
  const total = roundCurrency(Math.max(0, grossTotal - depositApplied));
  return { subtotal, tax, grossTotal, depositApplied, total };
}
