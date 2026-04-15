import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { validateEmail, validatePhone } from "./validation";
import { normalizeTaxRate } from "./tax";

const VALID_STATUSES = ["draft", "sent", "approved", "declined", "converted"] as const;
const VALID_DEPOSIT_STATUSES = ["not_required", "pending", "paid"] as const;
const VALID_DEPOSIT_SOURCES = ["manual", "stripe"] as const;

function validateStatus(status: string): void {
  if (!VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number])) {
    throw new Error(`Invalid quote status: \"${status}\"`);
  }
}

function validateDepositStatus(status?: string): void {
  if (!status) return;
  if (!VALID_DEPOSIT_STATUSES.includes(status as (typeof VALID_DEPOSIT_STATUSES)[number])) {
    throw new Error(`Invalid deposit status: \"${status}\"`);
  }
}

function validateDepositSource(source?: string): void {
  if (!source) return;
  if (!VALID_DEPOSIT_SOURCES.includes(source as (typeof VALID_DEPOSIT_SOURCES)[number])) {
    throw new Error(`Invalid deposit source: \"${source}\"`);
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

  throw new Error("Cannot send deposit request: customer needs a valid phone or email.");
}

export const list = query({
  args: {
    status: v.optional(v.string()),
    customer_id: v.optional(v.id("customers")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    let quotes = await ctx.db
      .query("quotes")
      .withIndex("by_created_by", (q) => q.eq("created_by", identity.email!))
      .collect();

    if (args.status) {
      quotes = quotes.filter((quote) => quote.status === args.status);
    }

    if (args.customer_id) {
      quotes = quotes.filter((quote) => quote.customer_id === args.customer_id);
    }

    quotes.sort((a, b) => b.created_at - a.created_at);
    return quotes;
  },
});

export const create = mutation({
  args: {
    customer_id: v.id("customers"),
    title: v.string(),
    description: v.optional(v.string()),
    line_items: v.array(v.object({
      description: v.string(),
      quantity: v.number(),
      unit_price: v.number(),
      amount: v.number(),
    })),
    tax_rate: v.optional(v.number()),
    deposit_required: v.optional(v.number()),
    valid_until: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const customer = await ctx.db.get(args.customer_id);
    if (!customer || customer.created_by !== identity.email) {
      throw new Error("Customer not found or access denied");
    }

    const subtotal = Number(args.line_items.reduce((sum, item) => sum + item.amount, 0).toFixed(2));
    const taxRate = normalizeTaxRate(args.tax_rate);
    const tax = Number((subtotal * taxRate).toFixed(2));
    const total = Number((subtotal + tax).toFixed(2));

    const hasDeposit = Number.isFinite(args.deposit_required);
    const depositRequired = hasDeposit ? Math.max(0, args.deposit_required ?? 0) : undefined;

    const now = Date.now();
    const quoteId = await ctx.db.insert("quotes", {
      customer_id: args.customer_id,
      created_by: identity.email!,
      title: args.title.trim(),
      description: args.description?.trim(),
      status: "draft",
      line_items: args.line_items,
      subtotal,
      tax,
      total,
      deposit_required: depositRequired,
      deposit_status: depositRequired && depositRequired > 0 ? "pending" : "not_required",
      deposit_payment_url: undefined,
      deposit_checkout_session_id: undefined,
      deposit_paid_at: undefined,
      deposit_paid_source: undefined,
      valid_until: args.valid_until,
      converted_work_order_id: undefined,
      created_at: now,
      updated_at: now,
    });

    return quoteId;
  },
});

export const updateStatus = mutation({
  args: {
    id: v.id("quotes"),
    status: v.string(),
    deposit_status: v.optional(v.string()),
    deposit_paid_source: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    validateStatus(args.status);
    validateDepositStatus(args.deposit_status);
    validateDepositSource(args.deposit_paid_source);

    const quote = await ctx.db.get(args.id);
    if (!quote) throw new Error("Quote not found");
    if (quote.created_by !== identity.email) throw new Error("Access denied");

    const nextDepositStatus = args.deposit_status ?? quote.deposit_status;
    if (quote.deposit_required && quote.deposit_required > 0 && args.status === "converted" && nextDepositStatus !== "paid") {
      throw new Error("Deposit must be paid before marking quote converted");
    }

    const now = Date.now();
    const depositStatusWasExplicit = args.deposit_status !== undefined;
    let nextDepositPaidAt = quote.deposit_paid_at;
    let nextDepositPaidSource = quote.deposit_paid_source;
    if (nextDepositStatus === "paid") {
      nextDepositPaidAt = quote.deposit_paid_at ?? now;
      nextDepositPaidSource = args.deposit_paid_source ?? quote.deposit_paid_source ?? "manual";
    } else if (depositStatusWasExplicit) {
      nextDepositPaidAt = undefined;
      nextDepositPaidSource = undefined;
    }

    await ctx.db.patch(args.id, {
      status: args.status,
      deposit_status: nextDepositStatus,
      deposit_paid_at: nextDepositPaidAt,
      deposit_paid_source: nextDepositPaidSource,
      updated_at: now,
    });

    return args.id;
  },
});

export const convertToWorkOrder = mutation({
  args: {
    id: v.id("quotes"),
    scheduled_date: v.string(),
    assignee_email: v.optional(v.string()),
    priority: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const quote = await ctx.db.get(args.id);
    if (!quote) throw new Error("Quote not found");
    if (quote.created_by !== identity.email) throw new Error("Access denied");

    if (quote.converted_work_order_id) {
      return {
        success: true,
        work_order_id: quote.converted_work_order_id,
      };
    }

    if (!["approved", "sent", "draft"].includes(quote.status)) {
      throw new Error("Only draft/sent/approved quotes can be converted to work orders");
    }

    if (quote.deposit_required && quote.deposit_required > 0 && quote.deposit_status !== "paid") {
      throw new Error("Deposit must be paid before converting this quote");
    }

    const now = Date.now();
    const workOrderId = await ctx.db.insert("workOrders", {
      customer_id: quote.customer_id,
      business_id: undefined,
      created_by: identity.email!,
      title: quote.title,
      description: quote.description,
      status: "scheduled",
      assignee_email: args.assignee_email,
      scheduled_date: args.scheduled_date,
      is_recurring: false,
      recurrence_rule: undefined,
      source_quote_id: quote._id,
      priority: args.priority,
      completed_at: undefined,
      created_at: now,
      updated_at: now,
    });

    await ctx.db.patch(args.id, {
      status: "converted",
      converted_work_order_id: workOrderId,
      updated_at: now,
    });

    return {
      success: true,
      work_order_id: workOrderId,
    };
  },
});

export const getForDepositPayment = internalQuery({
  args: {
    id: v.id("quotes"),
    user_email: v.string(),
  },
  handler: async (ctx, args) => {
    const quote = await ctx.db.get(args.id);
    if (!quote || quote.created_by !== args.user_email) {
      throw new Error("Quote not found or access denied");
    }

    const customer = await ctx.db.get(quote.customer_id);
    if (!customer || customer.created_by !== args.user_email) {
      throw new Error("Customer not found or access denied");
    }

    return { quote, customer };
  },
});

export const storeDepositCheckoutLink = internalMutation({
  args: {
    id: v.id("quotes"),
    user_email: v.string(),
    payment_url: v.string(),
    stripe_checkout_session_id: v.optional(v.string()),
    channel_override: v.optional(v.string()),
    recipient_override: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const quote = await ctx.db.get(args.id);
    if (!quote || quote.created_by !== args.user_email) {
      throw new Error("Quote not found or access denied");
    }

    const customer = await ctx.db.get(quote.customer_id);
    if (!customer || customer.created_by !== args.user_email) {
      throw new Error("Customer not found or access denied");
    }

    const now = Date.now();
    await ctx.db.patch(args.id, {
      status: quote.status === "draft" ? "sent" : quote.status,
      deposit_status: quote.deposit_required && quote.deposit_required > 0 ? "pending" : quote.deposit_status,
      deposit_payment_url: args.payment_url,
      deposit_checkout_session_id: args.stripe_checkout_session_id ?? quote.deposit_checkout_session_id,
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
      work_order_id: quote.converted_work_order_id,
      invoice_id: undefined,
      quote_id: quote._id,
      template_key: "quote_deposit_requested",
      status: "queued",
      message: `Deposit request for ${quote.title}: ${args.payment_url}`,
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

export const markDepositPaidFromStripe = internalMutation({
  args: {
    quote_id: v.id("quotes"),
    stripe_checkout_session_id: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const quote = await ctx.db.get(args.quote_id);
    if (!quote) throw new Error("Quote not found");

    const now = Date.now();
    await ctx.db.patch(args.quote_id, {
      status: quote.status,
      deposit_status: "paid",
      deposit_paid_at: quote.deposit_paid_at ?? now,
      deposit_paid_source: "stripe",
      deposit_checkout_session_id: args.stripe_checkout_session_id ?? quote.deposit_checkout_session_id,
      updated_at: now,
    });

    return args.quote_id;
  },
});
