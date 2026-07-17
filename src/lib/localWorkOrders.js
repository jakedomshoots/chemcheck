import { useRef, useState } from "react";

const STORAGE_KEY = "chemcheck_dev_work_orders_v1";

const emptyData = () => ({ workOrders: [], invoices: [], quotes: [], communications: [] });

function loadData() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "");
    if (!parsed || typeof parsed !== "object") return emptyData();
    return {
      workOrders: Array.isArray(parsed.workOrders) ? parsed.workOrders : [],
      invoices: Array.isArray(parsed.invoices) ? parsed.invoices : [],
      quotes: Array.isArray(parsed.quotes) ? parsed.quotes : [],
      communications: Array.isArray(parsed.communications) ? parsed.communications : [],
    };
  } catch {
    return emptyData();
  }
}

function createId(prefix) {
  const suffix = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `local_${prefix}_${suffix}`;
}

function totals(lineItems, taxRate = 0) {
  const subtotal = lineItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const tax = Number((subtotal * Number(taxRate || 0)).toFixed(2));
  return { subtotal, tax, total: Number((subtotal + tax).toFixed(2)) };
}

export function useLocalWorkOrders(enabled = false) {
  const dataRef = useRef(null);
  if (!dataRef.current) dataRef.current = enabled ? loadData() : emptyData();
  const [data, setData] = useState(dataRef.current);

  const commit = (transform) => {
    const next = transform(dataRef.current);
    dataRef.current = next;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setData(next);
    return next;
  };

  return {
    ...data,
    createWorkOrder: async (input) => {
      const now = Date.now();
      const record = { _id: createId("wo"), status: "scheduled", created_at: now, updated_at: now, ...input };
      commit((current) => ({ ...current, workOrders: [...current.workOrders, record] }));
      return record._id;
    },
    updateWorkOrder: async ({ id, ...changes }) => {
      commit((current) => ({
        ...current,
        workOrders: current.workOrders.map((record) => record._id === id ? { ...record, ...changes, updated_at: Date.now() } : record),
      }));
      return id;
    },
    completeWorkOrder: async ({ id }) => {
      commit((current) => ({
        ...current,
        workOrders: current.workOrders.map((record) => record._id === id
          ? { ...record, status: "completed", completed_at: Date.now(), updated_at: Date.now() }
          : record),
      }));
      return { invoice_id: undefined };
    },
    removeWorkOrder: async ({ id }) => {
      commit((current) => ({ ...current, workOrders: current.workOrders.filter((record) => record._id !== id) }));
    },
    createInvoiceDraft: async (input) => {
      const lineItems = input.line_items || [];
      const now = Date.now();
      const record = {
        _id: createId("inv"),
        status: "draft",
        created_at: now,
        updated_at: now,
        ...totals(lineItems, input.tax_rate),
        ...input,
      };
      commit((current) => ({ ...current, invoices: [...current.invoices, record] }));
      return record._id;
    },
    batchCreateFromCompletedWorkOrders: async ({ from_date, to_date, unit_price, tax_rate, due_in_days }) => {
      const createdInvoiceIds = [];
      const now = Date.now();
      commit((current) => {
        const existingWorkOrderIds = new Set(current.invoices.map((invoice) => String(invoice.work_order_id || "")));
        const candidates = current.workOrders.filter((order) =>
          order.status === "completed" &&
          order.scheduled_date >= from_date &&
          order.scheduled_date <= to_date &&
          !existingWorkOrderIds.has(String(order._id))
        );
        const invoices = candidates.map((order) => {
          const lineItems = [{ description: order.title, quantity: 1, unit_price, amount: unit_price }];
          const invoice = {
            _id: createId("inv"),
            customer_id: order.customer_id,
            work_order_id: order._id,
            line_items: lineItems,
            notes: order.description || order.title,
            status: "draft",
            due_date: new Date(new Date(order.scheduled_date).getTime() + (due_in_days * 86400000)).toISOString().slice(0, 10),
            created_at: now,
            updated_at: now,
            ...totals(lineItems, tax_rate),
          };
          createdInvoiceIds.push(invoice._id);
          return invoice;
        });
        return { ...current, invoices: [...current.invoices, ...invoices] };
      });
      return { processed: createdInvoiceIds.length, created: createdInvoiceIds.length, skipped_existing: 0, skipped_deposit: 0, failed: 0, created_invoice_ids: createdInvoiceIds };
    },
    markInvoicePaid: async ({ id }) => {
      const now = Date.now();
      commit((current) => ({
        ...current,
        invoices: current.invoices.map((record) => record._id === id ? { ...record, status: "paid", paid_at: now, updated_at: now } : record),
      }));
    },
    createQuote: async (input) => {
      const lineItems = input.line_items || [];
      const now = Date.now();
      const record = {
        _id: createId("quote"),
        status: "draft",
        created_at: now,
        updated_at: now,
        ...totals(lineItems, input.tax_rate),
        ...input,
      };
      commit((current) => ({ ...current, quotes: [...current.quotes, record] }));
      return record._id;
    },
    updateQuoteStatus: async ({ id, ...changes }) => {
      commit((current) => ({
        ...current,
        quotes: current.quotes.map((record) => record._id === id ? { ...record, ...changes, updated_at: Date.now() } : record),
      }));
    },
    convertQuoteToWorkOrder: async ({ id, scheduled_date, priority }) => {
      const quote = dataRef.current.quotes.find((record) => record._id === id);
      if (!quote) throw new Error("Quote not found.");
      const now = Date.now();
      const workOrder = {
        _id: createId("wo"),
        customer_id: quote.customer_id,
        title: quote.title,
        description: quote.description,
        status: "scheduled",
        scheduled_date,
        priority,
        source_quote_id: id,
        created_at: now,
        updated_at: now,
      };
      commit((current) => ({
        ...current,
        workOrders: [...current.workOrders, workOrder],
        quotes: current.quotes.map((record) => record._id === id
          ? { ...record, status: "converted", converted_work_order_id: workOrder._id, updated_at: now }
          : record),
      }));
      return workOrder._id;
    },
  };
}
