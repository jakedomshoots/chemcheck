import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { normalizeTaxRate } from "./tax";

const VALID_STATUSES = ["scheduled", "in_progress", "completed", "cancelled"] as const;
const VALID_PRIORITIES = ["low", "medium", "high"] as const;

function validateStatus(status: string): void {
  if (!VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number])) {
    throw new Error(`Invalid work order status: \"${status}\"`);
  }
}

function validatePriority(priority?: string): void {
  if (!priority) return;
  if (!VALID_PRIORITIES.includes(priority as (typeof VALID_PRIORITIES)[number])) {
    throw new Error(`Invalid work order priority: \"${priority}\"`);
  }
}

function getDatePlusDays(baseDate: string, days: number): string {
  const date = new Date(`${baseDate}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export const list = query({
  args: {
    scheduled_date: v.optional(v.string()),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    let workOrders = await ctx.db
      .query("workOrders")
      .withIndex("by_created_by", (q) => q.eq("created_by", identity.email!))
      .collect();

    if (args.scheduled_date) {
      workOrders = workOrders.filter((item) => item.scheduled_date === args.scheduled_date);
    }

    if (args.status) {
      workOrders = workOrders.filter((item) => item.status === args.status);
    }

    workOrders.sort((a, b) => {
      const dateDiff = a.scheduled_date.localeCompare(b.scheduled_date);
      if (dateDiff !== 0) return dateDiff;
      return a.created_at - b.created_at;
    });

    return workOrders;
  },
});

export const get = query({
  args: { id: v.id("workOrders") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const workOrder = await ctx.db.get(args.id);
    if (!workOrder) throw new Error("Work order not found");
    if (workOrder.created_by !== identity.email) throw new Error("Access denied");

    return workOrder;
  },
});

export const create = mutation({
  args: {
    customer_id: v.id("customers"),
    title: v.string(),
    description: v.optional(v.string()),
    assignee_email: v.optional(v.string()),
    scheduled_date: v.string(),
    is_recurring: v.optional(v.boolean()),
    recurrence_rule: v.optional(v.string()),
    priority: v.optional(v.string()),
    source_quote_id: v.optional(v.id("quotes")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const customer = await ctx.db.get(args.customer_id);
    if (!customer || customer.created_by !== identity.email) {
      throw new Error("Customer not found or access denied");
    }

    validatePriority(args.priority);

    const now = Date.now();
    const workOrderId = await ctx.db.insert("workOrders", {
      customer_id: args.customer_id,
      business_id: undefined,
      created_by: identity.email!,
      title: args.title.trim(),
      description: args.description?.trim(),
      status: "scheduled",
      assignee_email: args.assignee_email?.trim(),
      scheduled_date: args.scheduled_date,
      is_recurring: args.is_recurring ?? false,
      recurrence_rule: args.recurrence_rule?.trim(),
      source_quote_id: args.source_quote_id,
      priority: args.priority,
      completed_at: undefined,
      created_at: now,
      updated_at: now,
    });

    return workOrderId;
  },
});

export const update = mutation({
  args: {
    id: v.id("workOrders"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    assignee_email: v.optional(v.string()),
    scheduled_date: v.optional(v.string()),
    status: v.optional(v.string()),
    is_recurring: v.optional(v.boolean()),
    recurrence_rule: v.optional(v.string()),
    priority: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const current = await ctx.db.get(args.id);
    if (!current) throw new Error("Work order not found");
    if (current.created_by !== identity.email) throw new Error("Access denied");

    if (args.status) validateStatus(args.status);
    if (args.priority) validatePriority(args.priority);

    const patch: Record<string, unknown> = {
      updated_at: Date.now(),
    };

    if (args.title !== undefined) patch.title = args.title.trim();
    if (args.description !== undefined) patch.description = args.description?.trim();
    if (args.assignee_email !== undefined) patch.assignee_email = args.assignee_email?.trim();
    if (args.scheduled_date !== undefined) patch.scheduled_date = args.scheduled_date;
    if (args.status !== undefined) {
      patch.status = args.status;
      patch.completed_at = args.status === "completed" ? Date.now() : undefined;
    }
    if (args.is_recurring !== undefined) patch.is_recurring = args.is_recurring;
    if (args.recurrence_rule !== undefined) patch.recurrence_rule = args.recurrence_rule?.trim();
    if (args.priority !== undefined) patch.priority = args.priority;

    await ctx.db.patch(args.id, patch);
    return args.id;
  },
});

export const complete = mutation({
  args: {
    id: v.id("workOrders"),
    unit_price: v.optional(v.number()),
    tax_rate: v.optional(v.number()), // e.g. 0.0825
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const workOrder = await ctx.db.get(args.id);
    if (!workOrder) throw new Error("Work order not found");
    if (workOrder.created_by !== identity.email) throw new Error("Access denied");

    const customer = await ctx.db.get(workOrder.customer_id);
    if (!customer || customer.created_by !== identity.email) {
      throw new Error("Customer not found or access denied");
    }

    const now = Date.now();

    await ctx.db.patch(args.id, {
      status: "completed",
      completed_at: now,
      updated_at: now,
    });

    let invoiceBlockedReason: string | undefined;
    let depositApplied = 0;
    if (workOrder.source_quote_id) {
      const quote = await ctx.db.get(workOrder.source_quote_id);
      if (
        quote &&
        quote.created_by === identity.email &&
        quote.deposit_required &&
        quote.deposit_required > 0 &&
        quote.deposit_status !== "paid"
      ) {
        invoiceBlockedReason = "deposit_pending";
      } else if (
        quote &&
        quote.created_by === identity.email &&
        quote.deposit_status === "paid" &&
        quote.deposit_required &&
        quote.deposit_required > 0
      ) {
        depositApplied = quote.deposit_required;
      }
    }

    const existingInvoice = await ctx.db
      .query("invoices")
      .withIndex("by_work_order", (q) => q.eq("work_order_id", args.id))
      .first();

    let invoiceId = existingInvoice?._id;
    if (!invoiceId && !invoiceBlockedReason) {
      const unitPrice = args.unit_price ?? 120;
      const quantity = 1;
      const subtotal = Number((unitPrice * quantity).toFixed(2));
      const taxRate = normalizeTaxRate(args.tax_rate);
      const tax = Number((subtotal * taxRate).toFixed(2));
      const grossTotal = Number((subtotal + tax).toFixed(2));
      const safeDepositApplied = Number(Math.min(grossTotal, depositApplied).toFixed(2));
      const total = Number((grossTotal - safeDepositApplied).toFixed(2));
      const initialStatus = total <= 0 ? "paid" : "draft";
      const notes = workOrder.description?.trim() || workOrder.title;

      invoiceId = await ctx.db.insert("invoices", {
        customer_id: workOrder.customer_id,
        work_order_id: args.id,
        source_quote_id: workOrder.source_quote_id,
        service_log_id: undefined,
        created_by: identity.email!,
        status: initialStatus,
        line_items: [
          {
            description: workOrder.title,
            quantity,
            unit_price: unitPrice,
            amount: subtotal,
          },
        ],
        subtotal,
        tax,
        deposit_applied: safeDepositApplied > 0 ? safeDepositApplied : undefined,
        total,
        due_date: getDatePlusDays(workOrder.scheduled_date, 7),
        sent_at: undefined,
        paid_at: initialStatus === "paid" ? now : undefined,
        payment_url: undefined,
        stripe_checkout_session_id: undefined,
        stripe_payment_intent_id: undefined,
        notes,
        created_at: now,
        updated_at: now,
      });
    }

    // Month 1 service-text infrastructure: queue an event on completion.
    if (customer.phone) {
      await ctx.db.insert("communications", {
        type: "service_text",
        channel: "sms",
        recipient: customer.phone,
        customer_id: customer._id,
        work_order_id: args.id,
        template_key: "work_order_completed",
        status: "queued",
        message: `${workOrder.title} completed on ${workOrder.scheduled_date}.`,
        scheduled_for: now,
        sent_at: undefined,
        delivered_at: undefined,
        last_attempt_at: undefined,
        attempts: 0,
        provider: undefined,
        provider_message_id: undefined,
        error: undefined,
        created_by: identity.email!,
        created_at: now,
        updated_at: now,
      });
    }

    return {
      success: true,
      invoice_id: invoiceId,
      invoice_blocked_reason: invoiceBlockedReason,
    };
  },
});

export const remove = mutation({
  args: { id: v.id("workOrders") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const workOrder = await ctx.db.get(args.id);
    if (!workOrder) throw new Error("Work order not found");
    if (workOrder.created_by !== identity.email) throw new Error("Access denied");

    await ctx.db.delete(args.id);
  },
});
