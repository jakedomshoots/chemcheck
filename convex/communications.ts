import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { validateEmail, validatePhone } from "./validation";
import { fetchProvider, requireMailersendConfig, requireTwilioConfig } from "./providerConfig";
import { enforceCommunicationEnqueueRateLimit } from "./rateLimit";
import { canAccessCustomerRecord, resolveBusinessForEmail } from "./entitlements";

const VALID_STATUSES = ["queued", "sent", "delivered", "failed"] as const;

/** Hard cap on outbound message bodies (SMS segments / email body). */
export const MAX_MESSAGE_LENGTH = 1000;

/**
 * Escape HTML special characters before interpolating user-controlled text
 * into an email body. Mirrors serviceReports.escapeHtml.
 */
export function escapeHtml(text: string | null | undefined): string {
  if (text === null || text === undefined) return "";
  const value = typeof text === "string" ? text : String(text);
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
    "`": "&#x60;",
    "/": "&#x2F;",
  };
  return value.replace(/[&<>"'`\/]/g, (char) => map[char]);
}

function normalizePhoneForCompare(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const digits = String(value).replace(/[^\d]/g, "");
  if (!digits) return undefined;
  // Treat a leading US country code as equivalent to the bare 10-digit number.
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

function normalizeEmailForCompare(value: string | undefined | null): string | undefined {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized || undefined;
}

/**
 * SECURITY: outbound messages may only go to the contact details stored on
 * the customer record. Returns true when `recipient` equals the customer's
 * stored phone (sms) or email (email) after normalization.
 */
export function recipientMatchesCustomer(
  channel: string,
  recipient: string | undefined | null,
  customer: { phone?: string | null; email?: string | null } | null | undefined
): boolean {
  if (!customer || !recipient) return false;
  if (channel === "sms") {
    const stored = normalizePhoneForCompare(customer.phone);
    const wanted = normalizePhoneForCompare(recipient);
    return Boolean(stored && wanted && stored === wanted);
  }
  if (channel === "email") {
    const stored = normalizeEmailForCompare(customer.email);
    const wanted = normalizeEmailForCompare(recipient);
    return Boolean(stored && wanted && stored === wanted);
  }
  return false;
}

export function assertRecipientMatchesCustomer(
  channel: string,
  recipient: string | undefined | null,
  customer: { phone?: string | null; email?: string | null } | null | undefined
): void {
  if (!recipientMatchesCustomer(channel, recipient, customer)) {
    throw new Error(
      channel === "sms"
        ? "Recipient must match the phone number stored on the customer record. Update the customer's phone first."
        : "Recipient must match the email address stored on the customer record. Update the customer's email first."
    );
  }
}

/** Enforce the message length cap and return the trimmed message. */
export function enforceMessageLength(message: string): string {
  const trimmed = String(message ?? "").trim();
  if (!trimmed) throw new Error("Message cannot be empty");
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`Message is too long (max ${MAX_MESSAGE_LENGTH} characters)`);
  }
  return trimmed;
}

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

async function sendEmailViaMailersend(args: {
  recipient: string;
  message: string;
  subject: string;
  fromName: string;
}): Promise<DeliveryResult> {
  try {
    const { apiKey, fromEmail } = requireMailersendConfig();

    const textBody = args.message;
    // SECURITY: subject and message are user-controlled; escape before HTML interpolation.
    const htmlBody = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #0f172a;">
        <h2 style="margin: 0 0 12px 0;">${escapeHtml(args.subject)}</h2>
        <p style="margin: 0; white-space: pre-line;">${escapeHtml(args.message)}</p>
      </div>
    `;

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
          q.eq("created_by", email).eq("customer_id", args.customer_id!)
        );
    } else if (args.status) {
      query = ctx.db
        .query("communications")
        .withIndex("by_created_by_and_status", (q) =>
          q.eq("created_by", email).eq("status", args.status!)
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
    if (!identity?.email) throw new Error("Not authenticated");

    const customer = await ctx.db.get(args.customer_id);
    if (!customer || !(await canAccessCustomerRecord(ctx, customer, identity.email))) {
      throw new Error("Customer not found or access denied");
    }

    // SECURITY: quota + recipient lock + message cap.
    await enforceCommunicationEnqueueRateLimit(ctx, identity.email);
    assertRecipientMatchesCustomer("sms", args.recipient, customer);
    const message = enforceMessageLength(args.message);
    const recipient = validatePhone(args.recipient);
    if (!recipient) throw new Error("SMS recipient is invalid.");

    const now = Date.now();
    return await ctx.db.insert("communications", {
      type: "service_text",
      channel: "sms",
      recipient,
      customer_id: args.customer_id,
      work_order_id: args.work_order_id,
      template_key: args.template_key,
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

/**
 * Delivery-time recipient verification. A queued row is deliverable only when
 * it references a customer the sender can access and its recipient equals
 * that customer's stored phone/email.
 */
async function verifyQueuedRecipient(
  ctx: any,
  item: { customer_id?: any; channel: string; recipient: string },
  userEmail: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!item.customer_id) {
    return { ok: false, error: "Communication has no customer; refusing to deliver to an unverified recipient." };
  }
  const customer = await ctx.db.get(item.customer_id);
  if (!customer || !(await canAccessCustomerRecord(ctx, customer, userEmail))) {
    return { ok: false, error: "Customer not found or access denied" };
  }
  if (!recipientMatchesCustomer(item.channel, item.recipient, customer)) {
    return { ok: false, error: "Recipient does not match the customer's stored contact details." };
  }
  return { ok: true };
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

    // SECURITY: the stored recipient must still match the customer's contact
    // details; otherwise refuse to deliver.
    const recipientCheck = await verifyQueuedRecipient(ctx, item, args.user_email);
    if (!recipientCheck.ok) {
      throw new Error(recipientCheck.error);
    }

    const business = await resolveBusinessForEmail(ctx, args.user_email);

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

    const business = await resolveBusinessForEmail(ctx, args.user_email);

    const due = queued
      .filter((item) => !item.scheduled_for || item.scheduled_for <= now)
      .sort((a, b) => a.created_at - b.created_at)
      .slice(0, limit);

    const results: Array<{ item: typeof due[number]; business_name: string; recipient_error?: string }> = [];
    for (const item of due) {
      const check = await verifyQueuedRecipient(ctx, item, args.user_email);
      results.push({
        item,
        business_name: business?.name || "ChemCheck",
        recipient_error: check.ok ? undefined : check.error,
      });
    }
    return results;
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
    if (!identity?.email) throw new Error("Not authenticated");

    const payload: any = await ctx.runQuery(internal.communications.getForDelivery, {
      id: args.id,
      user_email: identity.email,
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

    // SECURITY: consume the outbound quota before contacting a provider.
    await ctx.runMutation(internal.rateLimit.consumeCommunicationQuota, { userId: identity.email });

    const result = await deliverCommunication(item, businessName);

    await ctx.runMutation(internal.communications.recordDeliveryAttempt, {
      id: item._id,
      user_email: identity.email,
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
    if (!identity?.email) throw new Error("Not authenticated");

    const queued: any[] = await ctx.runQuery(internal.communications.listQueuedForDelivery, {
      user_email: identity.email,
      limit: args.limit,
      now: Date.now(),
    });

    let sent = 0;
    let failed = 0;

    for (const entry of queued) {
      const item = entry.item;

      let result: DeliveryResult;
      if (entry.recipient_error) {
        // Recipient no longer matches the customer record: never send.
        result = { success: false, status: "failed", error: entry.recipient_error };
      } else {
        // SECURITY: one quota unit per outbound message; stop the batch when exhausted.
        try {
          await ctx.runMutation(internal.rateLimit.consumeCommunicationQuota, { userId: identity.email });
        } catch (error: any) {
          return {
            success: false,
            processed: sent + failed,
            sent,
            failed,
            error: error?.message || "Rate limit exceeded",
          };
        }
        result = await deliverCommunication(item, entry.business_name);
      }

      await ctx.runMutation(internal.communications.recordDeliveryAttempt, {
        id: item._id,
        user_email: identity.email,
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
