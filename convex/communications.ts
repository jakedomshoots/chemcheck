import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { validateEmail, validatePhone } from "./validation";
import { fetchProvider, requireMailersendConfig, requireTwilioConfig } from "./providerConfig";
import { enforceRateLimit } from "./rateLimit";
import {
  canAccessCustomer,
  escapeHtml,
  normalizeEmailForComparison,
  resolveCustomerBusiness,
  sanitizeForSubject,
} from "./serviceReports";

const VALID_STATUSES = ["queued", "sent", "delivered", "failed"] as const;

type DeliveryResult = {
  success: boolean;
  status: "sent" | "failed";
  provider?: string;
  providerMessageId?: string;
  error?: string;
};

function validateStatus(status: string): void {
  if (!VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number])) {
    throw new Error(`Invalid communication status: "${status}"`);
  }
}

const MAX_BATCH_LIMIT = 100;
export const MAX_SMS_MESSAGE_LENGTH = 640;
const MAX_EMAIL_MESSAGE_LENGTH = 5000;
const SERVICE_TEXT_HOURLY_CAP = 60;
const MAX_SCHEDULE_AHEAD_MS = 365 * 24 * 60 * 60 * 1000;

export function toPositiveInt(value: number | undefined, fallback: number, max = MAX_BATCH_LIMIT): number {
  if (!Number.isFinite(value)) return Math.min(fallback, max);
  return Math.min(max, Math.max(1, Math.floor(value as number)));
}

/**
 * Normalize a phone number to E.164 digits (no "+") for comparison.
 * 10-digit numbers are treated as North American and get a leading "1".
 */
export function normalizePhoneForComparison(value: string | undefined | null): string {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) return `1${digits}`;
  return digits;
}

/**
 * True when `recipient` is one of the customer's phone numbers on file.
 */
export function isCustomerPhone(customer: { phone?: string | null } | null | undefined, recipient: string): boolean {
  const target = normalizePhoneForComparison(recipient);
  if (target.length < 7 || !customer) return false;
  const phones = [customer.phone].filter((phone): phone is string => Boolean(phone));
  return phones.some((phone) => normalizePhoneForComparison(phone) === target);
}

export function isCustomerEmail(customer: { email?: string | null } | null | undefined, recipient: string): boolean {
  const target = normalizeEmailForComparison(recipient);
  if (!target || !customer?.email) return false;
  return normalizeEmailForComparison(customer.email) === target;
}

function buildEmailSubject(item: {
  template_key?: string;
  type?: string;
}): string {
  const key = (item.template_key || "").toLowerCase();
  if (key === "invoice_sent") return "Your invoice is ready";
  if (key === "invoice_unpaid_reminder") return "Invoice reminder";
  if (key === "quote_deposit_requested") return "Deposit request";
  if (key === "work_order_completed") return "Service completed";

  const type = (item.type || "").toLowerCase();
  if (type === "service_text") return "Service update";
  if (type === "reminder") return "Reminder from ChemCheck";
  return "Update from ChemCheck";
}

async function sendSmsViaTwilio(recipient: string, message: string): Promise<DeliveryResult> {
  try {
    const {
      accountSid: twilioAccountSid,
      authToken: twilioAuthToken,
      fromNumber: twilioFromNumber,
    } = requireTwilioConfig();

    const response = await fetchProvider(`https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${twilioAccountSid}:${twilioAuthToken}`)}`,
      },
      body: new URLSearchParams({
        From: twilioFromNumber,
        To: recipient,
        Body: message,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({} as any));
      const errorMessage =
        typeof errorData?.message === "string" && errorData.message.trim().length > 0
          ? errorData.message
          : `Twilio request failed (${response.status})`;
      return {
        success: false,
        status: "failed",
        provider: "twilio",
        error: errorMessage,
      };
    }

    const body = await response.json().catch(() => ({} as any));
    return {
      success: true,
      status: "sent",
      provider: "twilio",
      providerMessageId: typeof body?.sid === "string" ? body.sid : undefined,
    };
  } catch (error: any) {
    return {
      success: false,
      status: "failed",
      provider: "twilio",
      error: error?.message || "Network error while sending SMS.",
    };
  }
}

/**
 * Build the HTML email body. Subject and message are user-controlled (message
 * text, payment links, titles), so both are HTML-escaped; links stay plain
 * text rather than being rendered as anchors.
 */
export function buildCommunicationEmailHtml(subject: string, message: string): string {
  return `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #0f172a;">
        <h2 style="margin: 0 0 12px 0;">${escapeHtml(subject)}</h2>
        <p style="margin: 0; white-space: pre-line;">${escapeHtml(message)}</p>
      </div>
    `;
}

async function sendEmailViaMailersend(args: {
  recipient: string;
  message: string;
  subject: string;
  fromName: string;
}): Promise<DeliveryResult> {
  try {
    const { apiKey, fromEmail } = requireMailersendConfig();

    const textBody = args.message;
    const htmlBody = buildCommunicationEmailHtml(args.subject, args.message);

    const response = await fetchProvider("https://api.mailersend.com/v1/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: {
          email: fromEmail,
          name: args.fromName || "ChemCheck",
        },
        to: [{ email: args.recipient }],
        subject: args.subject,
        text: textBody,
        html: htmlBody,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({} as any));
      const firstError = Array.isArray(errorData?.errors) ? errorData.errors[0] : null;
      const errorMessage =
        (firstError && typeof firstError.message === "string" && firstError.message) ||
        (typeof errorData?.message === "string" && errorData.message) ||
        `Mailersend request failed (${response.status})`;
      return {
        success: false,
        status: "failed",
        provider: "mailersend",
        error: errorMessage,
      };
    }

    return {
      success: true,
      status: "sent",
      provider: "mailersend",
      providerMessageId: response.headers.get("x-message-id") || undefined,
    };
  } catch (error: any) {
    return {
      success: false,
      status: "failed",
      provider: "mailersend",
      error: error?.message || "Network error while sending email.",
    };
  }
}

/**
 * Server-side delivery policy applied to every queued communication, whichever
 * mutation queued it. Returns an error message when the item must not be sent.
 * - Message length is capped per channel.
 * - Free-form service texts may only go to the owning customer's contact
 *   details. Templated reminders (invoice/quote) keep their explicit
 *   alternate-recipient support.
 */
export function getDeliveryPolicyError(
  item: { channel?: string; type?: string; recipient: string; message?: string },
  customer: { phone?: string | null; email?: string | null } | null
): string | null {
  const message = item.message || "";
  const maxLength = item.channel === "sms" ? MAX_SMS_MESSAGE_LENGTH : MAX_EMAIL_MESSAGE_LENGTH;
  if (message.length > maxLength) {
    return `Message exceeds the ${maxLength} character limit.`;
  }

  if (!customer) {
    return "Recipient customer not found.";
  }

  if (item.type === "service_text") {
    const matches = item.channel === "sms"
      ? isCustomerPhone(customer, item.recipient)
      : isCustomerEmail(customer, item.recipient);
    if (!matches) {
      return "Recipient must match the customer's contact details on file.";
    }
  }

  return null;
}

async function deliverCommunication(item: any, businessName: string, customer: any): Promise<DeliveryResult> {
  const policyError = getDeliveryPolicyError(item, customer);
  if (policyError) {
    return { success: false, status: "failed", error: policyError };
  }

  if (item.channel === "sms") {
    let recipient: string | undefined;
    try {
      recipient = validatePhone(item.recipient);
    } catch (error: any) {
      return {
        success: false,
        status: "failed",
        error: error?.message || "SMS recipient is invalid.",
      };
    }
    if (!recipient) {
      return {
        success: false,
        status: "failed",
        error: "SMS recipient is invalid.",
      };
    }
    return sendSmsViaTwilio(recipient, item.message || "");
  }

  if (item.channel === "email") {
    let recipient: string | undefined;
    try {
      recipient = validateEmail(item.recipient);
    } catch (error: any) {
      return {
        success: false,
        status: "failed",
        error: error?.message || "Email recipient is invalid.",
      };
    }
    if (!recipient) {
      return {
        success: false,
        status: "failed",
        error: "Email recipient is invalid.",
      };
    }

    return sendEmailViaMailersend({
      recipient,
      message: item.message || "",
      subject: buildEmailSubject(item),
      fromName: sanitizeForSubject(businessName) || "ChemCheck",
    });
  }

  return {
    success: false,
    status: "failed",
    error: `Unsupported channel: ${item.channel || "unknown"}`,
  };
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

function clampPageSize(numItems: number | undefined): number {
  return Math.max(1, Math.min(MAX_PAGE_SIZE, Math.floor(numItems ?? DEFAULT_PAGE_SIZE)));
}

export const list = query({
  args: {
    status: v.optional(v.string()),
    customer_id: v.optional(v.id("customers")),
    cursor: v.optional(v.string()),
    numItems: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const numItems = clampPageSize(args.numItems);
    const email = identity.email!;

    // Prefer the most selective index, then apply remaining filters in JS.
    let query;
    if (args.customer_id) {
      query = ctx.db
        .query("communications")
        .withIndex("by_created_by_and_customer", (q) =>
          q.eq("created_by", email).eq("customer_id", args.customer_id)
        );
    } else if (args.status) {
      const status = args.status;
      query = ctx.db
        .query("communications")
        .withIndex("by_created_by_and_status", (q) =>
          q.eq("created_by", email).eq("status", status)
        );
    } else {
      query = ctx.db
        .query("communications")
        .withIndex("by_created_by", (q) => q.eq("created_by", email));
    }

    const pageResult = await query.order("desc").paginate({
      cursor: args.cursor ?? null,
      numItems,
    });

    let items = pageResult.page;

    if (args.status && args.customer_id) {
      items = items.filter((item) => item.status === args.status);
    }

    return {
      page: items,
      continueCursor: pageResult.continueCursor,
      isDone: pageResult.isDone,
    };
  },
});

export const queueServiceText = mutation({
  args: {
    customer_id: v.id("customers"),
    work_order_id: v.optional(v.id("workOrders")),
    recipient: v.string(),
    message: v.string(),
    template_key: v.optional(v.string()),
    scheduled_for: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const email = identity.email;
    if (!email) throw new Error("Not authenticated");

    const customer = await ctx.db.get(args.customer_id);
    if (!customer || !(await canAccessCustomer(ctx, customer, email))) {
      throw new Error("Customer not found or access denied");
    }

    if (args.work_order_id) {
      const workOrder = await ctx.db.get(args.work_order_id);
      if (!workOrder || workOrder.customer_id !== args.customer_id) {
        throw new Error("Work order not found or access denied");
      }
    }

    // The platform Twilio number may only text the customer's own phone.
    if (!isCustomerPhone(customer, args.recipient)) {
      throw new Error("Recipient must be the customer's phone number on file.");
    }
    const recipient = validatePhone(customer.phone);
    if (!recipient) throw new Error("Customer phone number is invalid.");

    const message = args.message.trim();
    if (!message) throw new Error("Message cannot be empty.");
    if (message.length > MAX_SMS_MESSAGE_LENGTH) {
      throw new Error(`Message must be ${MAX_SMS_MESSAGE_LENGTH} characters or fewer.`);
    }

    const now = Date.now();
    if (
      args.scheduled_for !== undefined &&
      (!Number.isFinite(args.scheduled_for) || args.scheduled_for > now + MAX_SCHEDULE_AHEAD_MS)
    ) {
      throw new Error("Scheduled time is invalid.");
    }

    await enforceRateLimit(ctx, email, "communication.sms");
    const recentServiceTexts = await ctx.db
      .query("communications")
      .withIndex("by_created_by", (q) => q.eq("created_by", email).gt("_creationTime", now - 60 * 60 * 1000))
      .filter((q) => q.eq(q.field("type"), "service_text"))
      .take(SERVICE_TEXT_HOURLY_CAP);
    if (recentServiceTexts.length >= SERVICE_TEXT_HOURLY_CAP) {
      throw new Error("Hourly text message limit reached. Please try again later.");
    }

    return await ctx.db.insert("communications", {
      type: "service_text",
      channel: "sms",
      recipient,
      customer_id: args.customer_id,
      work_order_id: args.work_order_id,
      template_key: args.template_key?.slice(0, 100),
      status: "queued",
      message,
      scheduled_for: args.scheduled_for ?? now,
      sent_at: undefined,
      delivered_at: undefined,
      last_attempt_at: undefined,
      attempts: 0,
      provider: undefined,
      provider_message_id: undefined,
      error: undefined,
      created_by: email,
      created_at: now,
      updated_at: now,
    });
  },
});

export const updateStatus = mutation({
  args: {
    id: v.id("communications"),
    status: v.string(),
    error: v.optional(v.string()),
    provider: v.optional(v.string()),
    provider_message_id: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    validateStatus(args.status);

    const item = await ctx.db.get(args.id);
    if (!item) throw new Error("Communication record not found");
    if (item.created_by !== identity.email) throw new Error("Access denied");

    const now = Date.now();
    await ctx.db.patch(args.id, {
      status: args.status,
      sent_at: args.status === "sent" || args.status === "delivered" ? (item.sent_at ?? now) : item.sent_at,
      delivered_at: args.status === "delivered" ? (item.delivered_at ?? now) : item.delivered_at,
      provider: args.provider ?? item.provider,
      provider_message_id: args.provider_message_id ?? item.provider_message_id,
      error: args.error,
      updated_at: now,
    });

    return args.id;
  },
});

export const requeueFailed = mutation({
  args: {
    limit: v.optional(v.number()),
    only_template_keys: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const limit = toPositiveInt(args.limit, 25);
    const allowedTemplates = new Set((args.only_template_keys || []).map((key) => key.trim()).filter(Boolean));

    // Bounded scan using the status index; filter template_key in JS.
    const items = await ctx.db
      .query("communications")
      .withIndex("by_created_by_and_status", (q) =>
        q.eq("created_by", identity.email!).eq("status", "failed")
      )
      .order("desc")
      .take(limit * 4);

    const failed = items
      .filter((item) => {
        if (allowedTemplates.size === 0) return true;
        return Boolean(item.template_key && allowedTemplates.has(item.template_key));
      })
      .sort((a, b) => (b.last_attempt_at || b.updated_at || b.created_at) - (a.last_attempt_at || a.updated_at || a.created_at))
      .slice(0, limit);

    const now = Date.now();
    for (const item of failed) {
      await ctx.db.patch(item._id, {
        status: "queued",
        scheduled_for: now,
        error: undefined,
        updated_at: now,
      });
    }

    return {
      success: true,
      requeued: failed.length,
    };
  },
});

/**
 * Load what delivery needs for a queued item: the owning customer (only when
 * the sender can still access it; the delivery policy rejects items without
 * one) and the customer's business name for the sender label.
 */
async function loadDeliveryContext(ctx: any, item: any, userEmail: string) {
  const rawCustomer = item.customer_id ? await ctx.db.get(item.customer_id) : null;
  const customer = rawCustomer && (await canAccessCustomer(ctx, rawCustomer, userEmail)) ? rawCustomer : null;
  const business = customer ? await resolveCustomerBusiness(ctx, customer) : null;

  return {
    item,
    customer: customer ? { phone: customer.phone ?? null, email: customer.email ?? null } : null,
    business_name: (business?.name as string | undefined) || "ChemCheck",
  };
}

export const getForDelivery = internalQuery({
  args: {
    id: v.id("communications"),
    user_email: v.string(),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.id);
    if (!item || item.created_by !== args.user_email) {
      throw new Error("Communication record not found or access denied");
    }

    return await loadDeliveryContext(ctx, item, args.user_email);
  },
});

export const listQueuedForDelivery = internalQuery({
  args: {
    user_email: v.string(),
    limit: v.optional(v.number()),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = toPositiveInt(args.limit, 25);
    const now = args.now ?? Date.now();

    // Bounded scan of queued communications for this user.
    const queued = await ctx.db
      .query("communications")
      .withIndex("by_created_by_and_status", (q) =>
        q.eq("created_by", args.user_email).eq("status", "queued")
      )
      .order("asc")
      .take(limit * 4);

    const due = queued
      .filter((item) => !item.scheduled_for || item.scheduled_for <= now)
      .sort((a, b) => a.created_at - b.created_at)
      .slice(0, limit);

    return await Promise.all(due.map((item) => loadDeliveryContext(ctx, item, args.user_email)));
  },
});

export const recordDeliveryAttempt = internalMutation({
  args: {
    id: v.id("communications"),
    user_email: v.string(),
    status: v.string(),
    error: v.optional(v.string()),
    provider: v.optional(v.string()),
    provider_message_id: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    validateStatus(args.status);

    const item = await ctx.db.get(args.id);
    if (!item || item.created_by !== args.user_email) {
      throw new Error("Communication record not found or access denied");
    }

    const now = Date.now();
    const nextAttempts = (item.attempts || 0) + 1;

    await ctx.db.patch(args.id, {
      status: args.status,
      sent_at: args.status === "sent" || args.status === "delivered" ? (item.sent_at ?? now) : item.sent_at,
      delivered_at: args.status === "delivered" ? (item.delivered_at ?? now) : item.delivered_at,
      last_attempt_at: now,
      attempts: nextAttempts,
      provider: args.provider ?? item.provider,
      provider_message_id: args.provider_message_id ?? item.provider_message_id,
      error: args.error,
      updated_at: now,
    });

    return args.id;
  },
});

export const deliver = action({
  args: {
    id: v.id("communications"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const payload: any = await ctx.runQuery(internal.communications.getForDelivery, {
      id: args.id,
      user_email: identity.email!,
    });

    const item = payload.item;
    const businessName = payload.business_name;

    if (item.status === "sent" || item.status === "delivered") {
      return {
        success: true,
        skipped: true,
        status: item.status,
      };
    }

    const result = await deliverCommunication(item, businessName, payload.customer);

    await ctx.runMutation(internal.communications.recordDeliveryAttempt, {
      id: item._id,
      user_email: identity.email!,
      status: result.status,
      error: result.success ? undefined : result.error,
      provider: result.provider,
      provider_message_id: result.providerMessageId,
    });

    return {
      success: result.success,
      status: result.status,
      provider: result.provider,
      provider_message_id: result.providerMessageId,
      error: result.error,
    };
  },
});

export const deliverQueued = action({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const queued: any[] = await ctx.runQuery(internal.communications.listQueuedForDelivery, {
      user_email: identity.email!,
      limit: args.limit,
      now: Date.now(),
    });

    let sent = 0;
    let failed = 0;

    for (const entry of queued) {
      const item = entry.item;
      const result = await deliverCommunication(item, entry.business_name, entry.customer);

      await ctx.runMutation(internal.communications.recordDeliveryAttempt, {
        id: item._id,
        user_email: identity.email!,
        status: result.status,
        error: result.success ? undefined : result.error,
        provider: result.provider,
        provider_message_id: result.providerMessageId,
      });

      if (result.success) sent += 1;
      else failed += 1;
    }

    return {
      success: true,
      processed: queued.length,
      sent,
      failed,
    };
  },
});
