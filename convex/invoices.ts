import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { validateEmail, validatePhone } from "./validation";
import { normalizeTaxRate } from "./tax";

const VALID_STATUSES = ["draft", "sent", "paid", "cancelled"] as const;
const REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const DEFAULT_BACKFILL_BATCH_SIZE = 100;
const MAX_BACKFILL_BATCH_SIZE = 500;

function validateStatus(status: string): void {
  if (!VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number])) {
    throw new Error(`Invalid invoice status: \"${status}\"`);
  }
}

function resolveCommunicationDestination(
  customer: { phone?: string; email?: string },
  override?: { channel?: string; recipient?: string }
): {
  recipient: string;
  channel: "sms" | "email";
} {
  if (override?.channel || override?.recipient) {
    if (!override.channel || !override.recipient) {
      throw new Error("Alternate recipient requires both channel and recipient.");
    }

    if (override.channel === "sms") {
      const recipient = validatePhone(override.recipient);
      if (!recipient) throw new Error("Alternate phone number is invalid.");
      return { recipient, channel: "sms" };
    }

    if (override.channel === "email") {
      const recipient = validateEmail(override.recipient);
      if (!recipient) throw new Error("Alternate email is invalid.");
      return { recipient, channel: "email" };
    }

    throw new Error("Alternate channel must be either sms or email.");
  }

  let validPhone: string | undefined;
  let validEmail: string | undefined;

  try {
    validPhone = validatePhone(customer.phone);
  } catch {
    validPhone = undefined;
  }

  try {
    validEmail = validateEmail(customer.email);
  } catch {
    validEmail = undefined;
  }

  if (validPhone) {
    return { recipient: validPhone, channel: "sms" };
  }
  if (validEmail) {
    return { recipient: validEmail, channel: "email" };
  }

  throw new Error("Cannot send invoice: customer needs a valid phone or email.");
}

function getDatePlusDays(baseDate: string, days: number): string {
  const date = new Date(`${baseDate}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function resolveReminderDestination(customer: { phone?: string; email?: string }): {
  channel: "sms" | "email";
  recipient: string;
} | null {
  try {
    const phone = validatePhone(customer.phone);
    if (phone) {
      return { channel: "sms", recipient: phone };
    }
  } catch {
    // Ignore invalid phone; we'll try email next.
  }

  try {
    const email = validateEmail(customer.email);
    if (email) {
      return { channel: "email", recipient: email };
    }
  } catch {
    // Ignore invalid email.
  }

  return null;
}

function resolveInvoiceNotes(
  notes: string | undefined,
  lineItems: Array<{ description: string }>,
  fallback: string | undefined
): string | undefined {
  const explicitNotes = notes?.trim();
  if (explicitNotes) return explicitNotes;

  const lineDescription = lineItems
    .map((item) => item.description?.trim())
    .find(Boolean);
  if (lineDescription) return lineDescription;

  const fallbackText = fallback?.trim();
  return fallbackText || undefined;
}

export const list = query({
  args: {
    status: v.optional(v.string()),
    customer_id: v.optional(v.id("customers")),
    source_quote_id: v.optional(v.id("quotes")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    let invoices = await ctx.db
      .query("invoices")
      .withIndex("by_created_by", (q) => q.eq("created_by", identity.email!))
      .collect();

    if (args.status) {
      invoices = invoices.filter((invoice) => invoice.status === args.status);
    }

    if (args.customer_id) {
      invoices = invoices.filter((invoice) => invoice.customer_id === args.customer_id);
    }

    if (args.source_quote_id) {
      invoices = invoices.filter((invoice) => invoice.source_quote_id === args.source_quote_id);
    }

    invoices.sort((a, b) => b.created_at - a.created_at);
    return invoices;
  },
});

export const get = query({
  args: { id: v.id("invoices") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const invoice = await ctx.db.get(args.id);
    if (!invoice) throw new Error("Invoice not found");
    if (invoice.created_by !== identity.email) throw new Error("Access denied");

    return invoice;
  },
});

export const getForPayment = internalQuery({
  args: {
    id: v.id("invoices"),
    user_email: v.string(),
  },
  handler: async (ctx, args) => {
    const invoice = await ctx.db.get(args.id);
    if (!invoice || invoice.created_by !== args.user_email) {
      throw new Error("Invoice not found or access denied");
    }

    const customer = await ctx.db.get(invoice.customer_id);
    if (!customer || customer.created_by !== args.user_email) {
      throw new Error("Customer not found or access denied");
    }

    return { invoice, customer };
  },
});

export const createDraft = mutation({
  args: {
    customer_id: v.id("customers"),
    work_order_id: v.optional(v.id("workOrders")),
    source_quote_id: v.optional(v.id("quotes")),
    line_items: v.array(v.object({
      description: v.string(),
      quantity: v.number(),
      unit_price: v.number(),
      amount: v.number(),
    })),
    tax_rate: v.optional(v.number()),
    due_date: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const customer = await ctx.db.get(args.customer_id);
    if (!customer || customer.created_by !== identity.email) {
      throw new Error("Customer not found or access denied");
    }

    let resolvedWorkOrderId = args.work_order_id;
    let resolvedSourceQuoteId = args.source_quote_id;
    let resolvedQuote: any = null;

    if (resolvedSourceQuoteId) {
      const quote = await ctx.db.get(resolvedSourceQuoteId);
      if (!quote || quote.created_by !== identity.email) {
        throw new Error("Quote not found or access denied");
      }
      if (quote.customer_id !== args.customer_id) {
        throw new Error("Quote customer does not match invoice customer");
      }
      resolvedQuote = quote;
      resolvedWorkOrderId = args.work_order_id ?? quote.converted_work_order_id;
    }

    if (resolvedWorkOrderId) {
      const workOrder = await ctx.db.get(resolvedWorkOrderId);
      if (!workOrder || workOrder.created_by !== identity.email) {
        throw new Error("Work order not found or access denied");
      }
      if (workOrder.customer_id !== args.customer_id) {
        throw new Error("Work order customer does not match invoice customer");
      }

      const existingWorkOrderInvoice = await ctx.db
        .query("invoices")
        .withIndex("by_work_order", (q) => q.eq("work_order_id", resolvedWorkOrderId))
        .first();
      if (existingWorkOrderInvoice && existingWorkOrderInvoice.status !== "cancelled") {
        throw new Error("An invoice already exists for this work order");
      }

      if (workOrder.source_quote_id) {
        if (resolvedSourceQuoteId && resolvedSourceQuoteId !== workOrder.source_quote_id) {
          throw new Error("Work order quote does not match invoice quote");
        }
        resolvedSourceQuoteId = resolvedSourceQuoteId ?? workOrder.source_quote_id;
      }
    }

    if (resolvedSourceQuoteId) {
      const quote = await ctx.db.get(resolvedSourceQuoteId);
      if (!quote || quote.created_by !== identity.email) {
        throw new Error("Quote not found or access denied");
      }
      if (quote.customer_id !== args.customer_id) {
        throw new Error("Quote customer does not match invoice customer");
      }
      if (quote.deposit_required && quote.deposit_required > 0 && quote.deposit_status !== "paid") {
        throw new Error("Deposit must be paid before creating an invoice from this quote");
      }
      resolvedQuote = quote;

      const existingQuoteInvoice = await ctx.db
        .query("invoices")
        .withIndex("by_source_quote", (q) => q.eq("source_quote_id", resolvedSourceQuoteId))
        .first();
      if (existingQuoteInvoice) {
        throw new Error("An invoice already exists for this quote");
      }
    }

    const subtotal = Number(args.line_items.reduce((sum, item) => sum + item.amount, 0).toFixed(2));
    const taxRate = normalizeTaxRate(args.tax_rate);
    const tax = Number((subtotal * taxRate).toFixed(2));
    const grossTotal = Number((subtotal + tax).toFixed(2));
    const depositApplied = Number(
      (
        resolvedQuote?.deposit_status === "paid" && resolvedQuote?.deposit_required && resolvedQuote.deposit_required > 0
          ? Math.min(grossTotal, resolvedQuote.deposit_required)
          : 0
      ).toFixed(2)
    );
    const total = Number((grossTotal - depositApplied).toFixed(2));
    const now = Date.now();
    const initialStatus = total <= 0 ? "paid" : "draft";
    const resolvedNotes = resolveInvoiceNotes(args.notes, args.line_items, undefined);

    const invoiceId = await ctx.db.insert("invoices", {
      customer_id: args.customer_id,
      work_order_id: resolvedWorkOrderId,
      source_quote_id: resolvedSourceQuoteId,
      service_log_id: undefined,
      created_by: identity.email!,
      status: initialStatus,
      line_items: args.line_items,
      subtotal,
      tax,
      deposit_applied: depositApplied > 0 ? depositApplied : undefined,
      total,
      due_date: args.due_date,
      sent_at: undefined,
      paid_at: initialStatus === "paid" ? now : undefined,
      payment_url: undefined,
      stripe_checkout_session_id: undefined,
      stripe_payment_intent_id: undefined,
      notes: resolvedNotes,
      created_at: now,
      updated_at: now,
    });

    return invoiceId;
  },
});

/**
 * One-time migration helper:
 * Backfills missing invoice notes from the first non-empty line item description.
 * Run repeatedly until isDone is true.
 */
export const backfillMissingNotesBatch = mutation({
  args: {
    cursor: v.optional(v.string()),
    batch_size: v.optional(v.number()),
    dry_run: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const batchSize = Math.max(
      1,
      Math.min(args.batch_size ?? DEFAULT_BACKFILL_BATCH_SIZE, MAX_BACKFILL_BATCH_SIZE)
    );
    const page = await ctx.db
      .query("invoices")
      .withIndex("by_created_by", (q) => q.eq("created_by", identity.email!))
      .paginate({
        cursor: args.cursor ?? null,
        numItems: batchSize,
      });

    let updated = 0;
    let wouldUpdate = 0;
    let skippedAlreadySet = 0;
    let skippedNoCandidate = 0;
    const now = Date.now();

    for (const invoice of page.page) {
      if (invoice.notes?.trim()) {
        skippedAlreadySet += 1;
        continue;
      }

      const candidateNotes = resolveInvoiceNotes(undefined, invoice.line_items, undefined);
      if (!candidateNotes) {
        skippedNoCandidate += 1;
        continue;
      }

      wouldUpdate += 1;
      if (args.dry_run) continue;

      await ctx.db.patch(invoice._id, {
        notes: candidateNotes,
        updated_at: now,
      });
      updated += 1;
    }

    return {
      processed: page.page.length,
      updated,
      would_update: wouldUpdate,
      skipped_already_set: skippedAlreadySet,
      skipped_no_candidate: skippedNoCandidate,
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

export const countMissingNotes = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const invoices = await ctx.db
      .query("invoices")
      .withIndex("by_created_by", (q) => q.eq("created_by", identity.email!))
      .collect();

    let missing = 0;
    let missingWithCandidate = 0;

    for (const invoice of invoices) {
      if (invoice.notes?.trim()) continue;
      missing += 1;
      const candidateNotes = resolveInvoiceNotes(undefined, invoice.line_items, undefined);
      if (candidateNotes) {
        missingWithCandidate += 1;
      }
    }

    return {
      total: invoices.length,
      missing_notes: missing,
      backfillable_notes: missingWithCandidate,
      already_set: invoices.length - missing,
    };
  },
});

export const batchCreateFromCompletedWorkOrders = mutation({
  args: {
    from_date: v.string(),
    to_date: v.string(),
    unit_price: v.optional(v.number()),
    tax_rate: v.optional(v.number()),
    due_in_days: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    if (args.from_date > args.to_date) {
      throw new Error("From date must be on or before To date");
    }

    const defaultUnitPrice = Math.max(0, args.unit_price ?? 120);
    const defaultTaxRate = normalizeTaxRate(args.tax_rate);
    const dueInDays = Math.max(0, Math.min(60, Math.floor(args.due_in_days ?? 7)));
    const limit = Math.max(1, Math.min(200, Math.floor(args.limit ?? 100)));

    const allWorkOrders = await ctx.db
      .query("workOrders")
      .withIndex("by_created_by", (q) => q.eq("created_by", identity.email!))
      .collect();

    const candidates = allWorkOrders
      .filter((workOrder) =>
        workOrder.status === "completed"
        && workOrder.scheduled_date >= args.from_date
        && workOrder.scheduled_date <= args.to_date
      )
      .sort((a, b) => {
        const dateDiff = a.scheduled_date.localeCompare(b.scheduled_date);
        if (dateDiff !== 0) return dateDiff;
        return a.created_at - b.created_at;
      })
      .slice(0, limit);

    let created = 0;
    let skippedExisting = 0;
    let skippedDeposit = 0;
    let failed = 0;
    const createdInvoiceIds: any[] = [];

    for (const workOrder of candidates) {
      try {
        const existingWorkOrderInvoice = await ctx.db
          .query("invoices")
          .withIndex("by_work_order", (q) => q.eq("work_order_id", workOrder._id))
          .first();
        if (existingWorkOrderInvoice && existingWorkOrderInvoice.status !== "cancelled") {
          skippedExisting += 1;
          continue;
        }

        let linkedQuote: any = null;
        if (workOrder.source_quote_id) {
          const quote = await ctx.db.get(workOrder.source_quote_id);
          if (quote && quote.created_by === identity.email) {
            linkedQuote = quote;
          }
        }

        if (linkedQuote?._id) {
          const existingQuoteInvoice = await ctx.db
            .query("invoices")
            .withIndex("by_source_quote", (q) => q.eq("source_quote_id", linkedQuote._id))
            .first();
          if (existingQuoteInvoice && existingQuoteInvoice.status !== "cancelled") {
            skippedExisting += 1;
            continue;
          }

          if (linkedQuote.deposit_required && linkedQuote.deposit_required > 0 && linkedQuote.deposit_status !== "paid") {
            skippedDeposit += 1;
            continue;
          }
        }

        const lineItems = [
          {
            description: workOrder.title,
            quantity: 1,
            unit_price: defaultUnitPrice,
            amount: Number(defaultUnitPrice.toFixed(2)),
          },
        ];

        const subtotal = Number(lineItems.reduce((sum: number, item: any) => sum + item.amount, 0).toFixed(2));
        const taxRate = defaultTaxRate;
        const tax = Number((subtotal * taxRate).toFixed(2));
        const grossTotal = Number((subtotal + tax).toFixed(2));
        const depositApplied = Number(
          (
            linkedQuote?.deposit_status === "paid" && linkedQuote?.deposit_required && linkedQuote.deposit_required > 0
              ? Math.min(grossTotal, linkedQuote.deposit_required)
              : 0
          ).toFixed(2)
        );
        const total = Number((grossTotal - depositApplied).toFixed(2));

        const now = Date.now();
        const initialStatus = total <= 0 ? "paid" : "draft";
        const dueDate = getDatePlusDays(workOrder.scheduled_date, dueInDays);
        const notes = resolveInvoiceNotes(linkedQuote?.description || workOrder.description, lineItems, workOrder.title);

        const invoiceId = await ctx.db.insert("invoices", {
          customer_id: workOrder.customer_id,
          work_order_id: workOrder._id,
          source_quote_id: linkedQuote?._id || workOrder.source_quote_id,
          service_log_id: undefined,
          created_by: identity.email!,
          status: initialStatus,
          line_items: lineItems,
          subtotal,
          tax,
          deposit_applied: depositApplied > 0 ? depositApplied : undefined,
          total,
          due_date: dueDate,
          sent_at: undefined,
          paid_at: initialStatus === "paid" ? now : undefined,
          payment_url: undefined,
          stripe_checkout_session_id: undefined,
          stripe_payment_intent_id: undefined,
          notes,
          created_at: now,
          updated_at: now,
        });

        createdInvoiceIds.push(invoiceId);
        created += 1;
      } catch {
        failed += 1;
      }
    }

    return {
      success: true,
      processed: candidates.length,
      created,
      skipped_existing: skippedExisting,
      skipped_deposit: skippedDeposit,
      failed,
      created_invoice_ids: createdInvoiceIds,
    };
  },
});

export const updateStatus = mutation({
  args: {
    id: v.id("invoices"),
    status: v.string(),
    payment_url: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    validateStatus(args.status);

    const invoice = await ctx.db.get(args.id);
    if (!invoice) throw new Error("Invoice not found");
    if (invoice.created_by !== identity.email) throw new Error("Access denied");

    const now = Date.now();
    await ctx.db.patch(args.id, {
      status: args.status,
      sent_at: args.status === "sent" ? now : invoice.sent_at,
      paid_at: args.status === "paid" ? now : invoice.paid_at,
      payment_url: args.payment_url ?? invoice.payment_url,
      updated_at: now,
    });

    return args.id;
  },
});

export const sendInvoice = mutation({
  args: {
    id: v.id("invoices"),
    base_url: v.optional(v.string()),
    channel_override: v.optional(v.string()),
    recipient_override: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const invoice = await ctx.db.get(args.id);
    if (!invoice) throw new Error("Invoice not found");
    if (invoice.created_by !== identity.email) throw new Error("Access denied");
    if (invoice.status === "paid" || invoice.status === "cancelled") {
      throw new Error("Cannot send an invoice that is paid or cancelled");
    }

    const customer = await ctx.db.get(invoice.customer_id);
    if (!customer || customer.created_by !== identity.email) {
      throw new Error("Customer not found or access denied");
    }

    const trimmedBase = (args.base_url || "").trim().replace(/\/+$/, "");
    const paymentUrl = trimmedBase
      ? `${trimmedBase}/workorders?invoice_id=${invoice._id}`
      : `https://pay.chemcheck.app/invoice/${invoice._id}`;

    const now = Date.now();
    await ctx.db.patch(args.id, {
      status: "sent",
      sent_at: now,
      payment_url: paymentUrl,
      updated_at: now,
    });

    const destination = resolveCommunicationDestination(customer, {
      channel: args.channel_override,
      recipient: args.recipient_override,
    });
    const communicationId = await ctx.db.insert("communications", {
      type: "reminder",
      channel: destination.channel,
      recipient: destination.recipient,
      customer_id: customer._id,
      work_order_id: invoice.work_order_id,
      invoice_id: invoice._id,
      quote_id: invoice.source_quote_id,
      template_key: "invoice_sent",
      status: "queued",
      message: `Invoice for $${invoice.total.toFixed(2)} is ready. Pay here: ${paymentUrl}`,
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

    return {
      success: true,
      payment_url: paymentUrl,
      communication_id: communicationId,
    };
  },
});

export const finalizeSend = internalMutation({
  args: {
    id: v.id("invoices"),
    user_email: v.string(),
    payment_url: v.string(),
    stripe_checkout_session_id: v.optional(v.string()),
    channel_override: v.optional(v.string()),
    recipient_override: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const invoice = await ctx.db.get(args.id);
    if (!invoice || invoice.created_by !== args.user_email) {
      throw new Error("Invoice not found or access denied");
    }

    if (invoice.status === "paid" || invoice.status === "cancelled") {
      throw new Error("Cannot send an invoice that is paid or cancelled");
    }

    const customer = await ctx.db.get(invoice.customer_id);
    if (!customer || customer.created_by !== args.user_email) {
      throw new Error("Customer not found or access denied");
    }

    const now = Date.now();
    await ctx.db.patch(args.id, {
      status: "sent",
      sent_at: now,
      payment_url: args.payment_url,
      stripe_checkout_session_id: args.stripe_checkout_session_id ?? invoice.stripe_checkout_session_id,
      updated_at: now,
    });

    const destination = resolveCommunicationDestination(customer, {
      channel: args.channel_override,
      recipient: args.recipient_override,
    });
    const communicationId = await ctx.db.insert("communications", {
      type: "reminder",
      channel: destination.channel,
      recipient: destination.recipient,
      customer_id: customer._id,
      work_order_id: invoice.work_order_id,
      invoice_id: invoice._id,
      quote_id: invoice.source_quote_id,
      template_key: "invoice_sent",
      status: "queued",
      message: `Invoice for $${invoice.total.toFixed(2)} is ready. Pay here: ${args.payment_url}`,
      scheduled_for: now,
      sent_at: undefined,
      delivered_at: undefined,
      last_attempt_at: undefined,
      attempts: 0,
      provider: undefined,
      provider_message_id: undefined,
      error: undefined,
      created_by: args.user_email,
      created_at: now,
      updated_at: now,
    });

    return {
      success: true,
      payment_url: args.payment_url,
      stripe_checkout_session_id: args.stripe_checkout_session_id,
      communication_id: communicationId,
    };
  },
});

export const markPaid = mutation({
  args: { id: v.id("invoices") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const invoice = await ctx.db.get(args.id);
    if (!invoice) throw new Error("Invoice not found");
    if (invoice.created_by !== identity.email) throw new Error("Access denied");
    if (invoice.stripe_checkout_session_id && invoice.status === "sent") {
      throw new Error("This invoice is linked to Stripe. It will be marked paid automatically after Stripe confirms payment.");
    }

    const now = Date.now();
    await ctx.db.patch(args.id, {
      status: "paid",
      paid_at: now,
      updated_at: now,
    });

    return args.id;
  },
});

export const markPaidFromStripe = internalMutation({
  args: {
    invoice_id: v.id("invoices"),
    stripe_checkout_session_id: v.optional(v.string()),
    stripe_payment_intent_id: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const invoice = await ctx.db.get(args.invoice_id);
    if (!invoice) throw new Error("Invoice not found");

    const now = Date.now();
    await ctx.db.patch(args.invoice_id, {
      status: "paid",
      paid_at: invoice.paid_at ?? now,
      stripe_checkout_session_id: args.stripe_checkout_session_id ?? invoice.stripe_checkout_session_id,
      stripe_payment_intent_id: args.stripe_payment_intent_id ?? invoice.stripe_payment_intent_id,
      updated_at: now,
    });

    return args.invoice_id;
  },
});

export const queueUnpaidReminders = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const invoices = await ctx.db
      .query("invoices")
      .withIndex("by_created_by", (q) => q.eq("created_by", identity.email!))
      .collect();
    const communications = await ctx.db
      .query("communications")
      .withIndex("by_created_by", (q) => q.eq("created_by", identity.email!))
      .collect();

    const pending = invoices.filter((invoice) => invoice.status === "sent");
    const now = Date.now();
    const today = new Date().toISOString().slice(0, 10);
    let queued = 0;

    const latestReminderByInvoice = new Map<string, { status: string; timestamp: number }>();
    for (const communication of communications) {
      if (communication.template_key !== "invoice_unpaid_reminder") continue;
      if (!communication.invoice_id) continue;
      const key = String(communication.invoice_id);
      const existing = latestReminderByInvoice.get(key);
      const currentTs = communication.updated_at || communication.created_at || 0;
      if (!existing || currentTs >= existing.timestamp) {
        latestReminderByInvoice.set(key, {
          status: communication.status,
          timestamp: currentTs,
        });
      }
    }

    for (const invoice of pending) {
      if (queued >= 50) break;
      if (invoice.due_date && invoice.due_date > today) continue;

      const latestReminder = latestReminderByInvoice.get(String(invoice._id));
      if (latestReminder?.status === "queued") continue;
      if (latestReminder && (now - latestReminder.timestamp) < REMINDER_COOLDOWN_MS) {
        continue;
      }

      const customer = await ctx.db.get(invoice.customer_id);
      if (!customer || customer.created_by !== identity.email) continue;

      const destination = resolveReminderDestination(customer);
      if (!destination) continue;

      await ctx.db.insert("communications", {
        type: "reminder",
        channel: destination.channel,
        recipient: destination.recipient,
        customer_id: customer._id,
        work_order_id: invoice.work_order_id,
        invoice_id: invoice._id,
        quote_id: invoice.source_quote_id,
        template_key: "invoice_unpaid_reminder",
        status: "queued",
        message: `Friendly reminder: invoice for $${invoice.total.toFixed(2)} is still unpaid.${invoice.payment_url ? ` Pay here: ${invoice.payment_url}` : ""}`,
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
      latestReminderByInvoice.set(String(invoice._id), {
        status: "queued",
        timestamp: now,
      });
      queued += 1;
    }

    return {
      success: true,
      queued,
    };
  },
});
