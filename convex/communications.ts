import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { validateEmail, validatePhone } from "./validation";

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

function toPositiveInt(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value as number));
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
    const twilioAccountSid = (process.env.TWILIO_ACCOUNT_SID || "").trim();
    const twilioAuthToken = (process.env.TWILIO_AUTH_TOKEN || "").trim();
    const twilioFromNumber = (process.env.TWILIO_FROM_NUMBER || "").trim();

    if (!twilioAccountSid || !twilioAuthToken || !twilioFromNumber) {
      return {
        success: false,
        status: "failed",
        provider: "twilio",
        error: "SMS service is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER.",
      };
    }

    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`, {
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

async function sendEmailViaMailersend(args: {
  recipient: string;
  message: string;
  subject: string;
  fromName: string;
}): Promise<DeliveryResult> {
  try {
    const apiKey = (process.env.MAILERSEND_API_KEY || "").trim();
    const fromEmail = (process.env.FROM_EMAIL || "").trim();

    if (!apiKey || !fromEmail) {
      return {
        success: false,
        status: "failed",
        provider: "mailersend",
        error: "Email service is not configured. Set MAILERSEND_API_KEY and FROM_EMAIL.",
      };
    }

    const textBody = args.message;
    const htmlBody = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #0f172a;">
        <h2 style="margin: 0 0 12px 0;">${args.subject}</h2>
        <p style="margin: 0; white-space: pre-line;">${args.message}</p>
      </div>
    `;

    const response = await fetch("https://api.mailersend.com/v1/email", {
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

async function deliverCommunication(item: any, businessName: string): Promise<DeliveryResult> {
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
      fromName: businessName || "ChemCheck",
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
      query = ctx.db
        .query("communications")
        .withIndex("by_created_by_and_status", (q) =>
          q.eq("created_by", email).eq("status", args.status)
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

    const customer = await ctx.db.get(args.customer_id);
    if (!customer || customer.created_by !== identity.email) {
      throw new Error("Customer not found or access denied");
    }

    const now = Date.now();
    return await ctx.db.insert("communications", {
      type: "service_text",
      channel: "sms",
      recipient: args.recipient,
      customer_id: args.customer_id,
      work_order_id: args.work_order_id,
      template_key: args.template_key,
      status: "queued",
      message: args.message,
      scheduled_for: args.scheduled_for ?? now,
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

    const business = await ctx.db
      .query("businesses")
      .withIndex("by_owner_email", (q) => q.eq("owner_email", args.user_email))
      .first();

    return {
      item,
      business_name: business?.name || "ChemCheck",
    };
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

    const business = await ctx.db
      .query("businesses")
      .withIndex("by_owner_email", (q) => q.eq("owner_email", args.user_email))
      .first();

    return queued
      .filter((item) => !item.scheduled_for || item.scheduled_for <= now)
      .sort((a, b) => a.created_at - b.created_at)
      .slice(0, limit)
      .map((item) => ({
        item,
        business_name: business?.name || "ChemCheck",
      }));
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

    const result = await deliverCommunication(item, businessName);

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
      const result = await deliverCommunication(item, entry.business_name);

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
