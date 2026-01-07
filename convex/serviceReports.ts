/**
 * Service Reports mutations and queries for Customer Service Reports feature
 * 
 * Provides functionality for:
 * - Creating and managing service reports
 * - Sending SMS notifications via Telnyx
 * - Public report page access
 * 
 * Requirements: 2.4, 2.5, 2.6, 2.7, 2.8, 3.1, 5.3
 */

import { v } from "convex/values";
import { query, mutation, action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";

/**
 * Helper: Verify service log ownership
 */
async function verifyServiceLogOwnership(
  ctx: any,
  serviceLogId: Id<"serviceLogs">,
  userEmail: string
): Promise<{ serviceLog: any; customer: any }> {
  const serviceLog = await ctx.db.get(serviceLogId);
  if (!serviceLog) {
    throw new Error("Service log not found");
  }

  const customer = await ctx.db.get(serviceLog.customer_id);
  if (!customer || customer.created_by !== userEmail) {
    throw new Error("Access denied");
  }

  return { serviceLog, customer };
}

/**
 * Generate a unique report token using crypto.randomUUID
 * Checks for collisions and regenerates if necessary
 */
async function generateUniqueToken(ctx: any): Promise<string> {
  const maxAttempts = 5;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const token = crypto.randomUUID();

    // Check if token already exists
    const existing = await ctx.db
      .query("serviceReports")
      .withIndex("by_token", (q: any) => q.eq("report_token", token))
      .first();

    if (!existing) {
      return token;
    }
  }

  throw new Error("Failed to generate unique token after multiple attempts");
}

/**
 * Get or create a service report for a service log
 * 
 * If a report already exists for the service_log_id, returns the existing report.
 * If not, creates a new report with a generated token.
 * 
 * Requirements: 2.4, 5.3
 */
export const getOrCreateReport = mutation({
  args: {
    service_log_id: v.id("serviceLogs"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    // Verify ownership of service log
    const { serviceLog } = await verifyServiceLogOwnership(
      ctx,
      args.service_log_id,
      identity.email!
    );

    // Check if report already exists for this service log
    const existingReport = await ctx.db
      .query("serviceReports")
      .withIndex("by_service_log", (q) => q.eq("service_log_id", args.service_log_id))
      .first();

    if (existingReport) {
      // Return existing report (for re-send scenario)
      return {
        _id: existingReport._id,
        report_token: existingReport.report_token,
        sent_at: existingReport.sent_at,
        sent_to_phone: existingReport.sent_to_phone,
        send_count: existingReport.send_count,
        created_at: existingReport.created_at,
        isNew: false,
      };
    }

    // Generate unique token
    const reportToken = await generateUniqueToken(ctx);

    // Capture timestamp once for consistency between DB and return value
    const createdAt = Date.now();

    // Create new report
    const reportId = await ctx.db.insert("serviceReports", {
      service_log_id: args.service_log_id,
      customer_id: serviceLog.customer_id,
      report_token: reportToken,
      created_at: createdAt,
    });

    return {
      _id: reportId,
      report_token: reportToken,
      sent_at: undefined,
      sent_to_phone: undefined,
      send_count: undefined,
      created_at: createdAt,
      isNew: true,
    };
  },
});

/**
 * Get report by service log ID
 * Returns the report if it exists, null otherwise
 */
export const getByServiceLog = query({
  args: {
    service_log_id: v.id("serviceLogs"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    // Verify ownership
    await verifyServiceLogOwnership(ctx, args.service_log_id, identity.email!);

    const report = await ctx.db
      .query("serviceReports")
      .withIndex("by_service_log", (q) => q.eq("service_log_id", args.service_log_id))
      .first();

    return report;
  },
});


/**
 * Internal mutation to update report after SMS/Email is sent
 * Called by the sendReport action after successful delivery
 */
export const updateReportSent = internalMutation({
  args: {
    report_id: v.id("serviceReports"),
    sent_to_phone: v.optional(v.string()),
    sent_to_email: v.optional(v.string()),
    delivery_method: v.string(), // 'sms' or 'email'
  },
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.report_id);
    if (!report) {
      throw new Error("Report not found");
    }

    const currentSendCount = report.send_count || 0;

    await ctx.db.patch(args.report_id, {
      sent_at: Date.now(),
      ...(args.sent_to_phone && { sent_to_phone: args.sent_to_phone }),
      ...(args.sent_to_email && { sent_to_email: args.sent_to_email }),
      send_count: currentSendCount + 1,
      last_delivery_method: args.delivery_method,
    });
  },
});

/**
 * Send a service report via SMS or Email
 * 
 * This action:
 * 1. Validates the customer has the required contact method
 * 2. Gets or creates the report record
 * 3. Formats the message
 * 4. Sends via Telnyx (SMS) or email service
 * 5. Updates the report with sent timestamp
 * 
 * Requirements: 2.5, 2.6, 2.7, 2.8
 */
export const sendReport = action({
  args: {
    service_log_id: v.id("serviceLogs"),
    delivery_method: v.optional(v.string()), // 'sms' or 'email', defaults to 'sms'
    custom_note: v.optional(v.string()), // Optional custom note for needs_attention status
    pool_status: v.optional(v.string()), // Optional pool status override ('good' or 'needs_attention')
  },
  handler: async (ctx, args): Promise<{
    success: boolean;
    error?: string;
    report_token?: string;
    message_id?: string;
    was_duplicate?: boolean;
  }> => {
    const deliveryMethod = args.delivery_method || 'sms';
    const customNote = args.custom_note;
    const poolStatusOverride = args.pool_status as "good" | "needs_attention" | undefined;

    // Get the service log and customer data
    const serviceLog = await ctx.runQuery(internal.serviceReports.getServiceLogWithCustomer, {
      service_log_id: args.service_log_id,
    });

    if (!serviceLog) {
      return {
        success: false,
        error: "Service log not found or access denied",
      };
    }

    // Validate customer has required contact method (Requirement 2.6)
    if (deliveryMethod === 'sms' && !serviceLog.customer.phone) {
      return {
        success: false,
        error: "No phone number on file. Please add a phone number to send SMS reports.",
      };
    }

    if (deliveryMethod === 'email' && (!serviceLog.customer.email || serviceLog.customer.email.trim().length === 0)) {
      return {
        success: false,
        error: "No email address on file. Please add an email address to send email reports.",
      };
    }

    // Get or create the report
    const report = await ctx.runMutation(internal.serviceReports.getOrCreateReportInternal, {
      service_log_id: args.service_log_id,
      customer_id: serviceLog.customer._id,
    });

    // Check for duplicate send within 60 seconds (idempotency)
    if (report.sent_at) {
      const timeSinceLastSend = Date.now() - report.sent_at;
      if (timeSinceLastSend < 60000) {
        return {
          success: true,
          report_token: report.report_token,
          was_duplicate: true,
        };
      }
    }

    // Require APP_URL to be set
    const baseUrl = process.env.APP_URL;
    if (!baseUrl) {
      return {
        success: false,
        error: "APP_URL environment variable is not configured. Please contact support.",
      };
    }
    const reportLink = `${baseUrl}/report/${report.report_token}`;

    // Determine overall pool status - use override if provided, otherwise calculate from readings
    const overallStatus = poolStatusOverride || determinePoolStatus(serviceLog);
    const businessName = serviceLog.business?.name || "Dominick Pool Solutions";
    const serviceDate = formatServiceDate(serviceLog.service_date);

    if (deliveryMethod === 'sms') {
      return await sendViaSms(ctx, {
        report,
        customer: serviceLog.customer,
        businessName,
        serviceDate,
        overallStatus,
        reportLink,
      });
    } else {
      return await sendViaEmail(ctx, {
        report,
        customer: serviceLog.customer,
        businessName,
        serviceDate,
        overallStatus,
        reportLink,
        customNote,
      });
    }
  },
});

/**
 * Internal query to get service log with customer and business data
 * Used by the sendReport action
 */
export const getServiceLogWithCustomer = internalQuery({
  args: {
    service_log_id: v.id("serviceLogs"),
  },
  handler: async (ctx, args) => {
    const serviceLog = await ctx.db.get(args.service_log_id);
    if (!serviceLog) return null;

    const customer = await ctx.db.get(serviceLog.customer_id);
    if (!customer) return null;

    // Get business info for the customer's owner
    const business = await ctx.db
      .query("businesses")
      .withIndex("by_owner_email", (q) => q.eq("owner_email", customer.created_by))
      .first();

    return {
      ...serviceLog,
      customer,
      business,
    };
  },
});

/**
 * Internal mutation to get or create report (bypasses auth for action use)
 * Uses generateUniqueToken for consistent collision checking across all token generation
 */
export const getOrCreateReportInternal = internalMutation({
  args: {
    service_log_id: v.id("serviceLogs"),
    customer_id: v.id("customers"),
  },
  handler: async (ctx, args) => {
    // Check if report already exists
    const existingReport = await ctx.db
      .query("serviceReports")
      .withIndex("by_service_log", (q) => q.eq("service_log_id", args.service_log_id))
      .first();

    if (existingReport) {
      return existingReport;
    }

    // Generate unique token with collision checking (consistent with generateUniqueToken)
    const token = await generateUniqueToken(ctx);

    // Capture timestamp once for consistency between DB and return value
    const createdAt = Date.now();

    // Create new report
    const reportId = await ctx.db.insert("serviceReports", {
      service_log_id: args.service_log_id,
      customer_id: args.customer_id,
      report_token: token,
      created_at: createdAt,
    });

    return {
      _id: reportId,
      service_log_id: args.service_log_id,
      customer_id: args.customer_id,
      report_token: token,
      created_at: createdAt,
      sent_at: undefined as number | undefined,
      sent_to_phone: undefined as string | undefined,
      send_count: undefined as number | undefined,
    };
  },
});

/**
 * Helper: Escape HTML to prevent XSS attacks
 */
export function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (char) => map[char]);
}

/**
 * Helper: Validate URL uses safe protocol (http or https only)
 * Prevents javascript:, data:, and other dangerous URL schemes
 */
export function isValidReportLink(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Helper: Sanitize string for use in email subject line
 * Removes newlines to prevent email header injection attacks
 */
export function sanitizeForSubject(text: string): string {
  return text.replace(/[\r\n]/g, ' ');
}

/**
 * Email content parameters for generating simple email notifications
 */
export interface EmailContentParams {
  customerName: string;
  serviceDate: string;
  poolStatus: 'good' | 'needs_attention';
  customNote?: string;
  businessName?: string;
  reportLink?: string;
}

/**
 * Generated email content structure
 */
export interface GeneratedEmailContent {
  subject: string;
  htmlBody: string;
  textBody: string;
}

/**
 * Generate simple email content for service completion notifications
 * 
 * Creates clean, focused email content based on pool status:
 * - Good status: Simple notification that pool is in perfect condition
 * - Needs attention: Includes custom note or generic attention message
 * 
 * Requirements: 1.1, 1.2, 3.2, 3.6, 3.7
 */
export function generateSimpleEmailContent(params: EmailContentParams): GeneratedEmailContent {
  const { customerName, serviceDate, poolStatus, customNote, businessName: inputBusinessName, reportLink } = params;

  // Escape user input to prevent XSS (only for HTML content)
  const safeCustomerName = escapeHtml(customerName);
  const safeServiceDate = escapeHtml(serviceDate);
  const safeCustomNote = customNote ? escapeHtml(customNote) : '';

  // Use provided business name or default
  const businessName = inputBusinessName || "Dominick Pool Solutions";
  const safeBusinessName = escapeHtml(businessName);
  const footerText = "This email is powered by ChemCheck Pool Software built by Dominick Pool Solutions";

  // Subject line: sanitize to prevent email header injection, use unescaped values (plain text)
  const sanitizedServiceDate = sanitizeForSubject(serviceDate);
  const subject = `Pool Service Completed - ${sanitizedServiceDate}`;

  // Generate status-specific content
  const statusIcon = poolStatus === 'good' ? '✓' : '⚠';
  const statusText = poolStatus === 'good' ? 'Everything is Perfect' : 'Needs Attention';
  const statusColor = poolStatus === 'good' ? '#10b981' : '#f59e0b';

  // Generate the message body based on status
  let messageContent: string;
  let textMessageContent: string;

  if (poolStatus === 'good') {
    messageContent = `<p style="font-size: 16px; margin-bottom: 20px;">Your pool is in excellent condition and ready for use.</p>`;
    textMessageContent = 'Your pool is in excellent condition and ready for use.';
  } else {
    // Needs attention - include custom note or generic message
    const noteText = safeCustomNote || 'Your pool requires some attention. Please contact us if you have any questions.';
    messageContent = `
      <div style="background: #fef3c7; padding: 15px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #f59e0b;">
        <p style="margin: 0; font-size: 14px; color: #92400e; font-weight: 600;">Technician Notes:</p>
        <p style="margin: 10px 0 0 0; font-size: 16px; color: #78350f;">${noteText}</p>
      </div>
    `;
    textMessageContent = `Technician Notes:\n${customNote || 'Your pool requires some attention. Please contact us if you have any questions.'}`;
  }

  // Generate report link section if provided and URL is safe
  const reportLinkHtml = reportLink && isValidReportLink(reportLink) ? `
        <div style="text-align: center; margin: 25px 0;">
          <a href="${escapeHtml(reportLink)}" style="display: inline-block; background: linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%); color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">View Full Report</a>
        </div>
  ` : '';

  const reportLinkText = reportLink && isValidReportLink(reportLink) ? `\nView your full report: ${reportLink}\n` : '';

  const htmlBody = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Pool Service Completed</title>
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px;">Pool Service Completed</h1>
      </div>
      
      <div style="background: #f8fafc; padding: 30px; border-radius: 0 0 10px 10px;">
        <p style="font-size: 16px; margin-bottom: 20px;">Hello ${safeCustomerName},</p>
        
        <p style="font-size: 16px; margin-bottom: 20px;">Your pool service has been completed by ${safeBusinessName}.</p>
        
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid ${statusColor};">
          <p style="margin: 0; font-size: 14px; color: #64748b;">Service Date</p>
          <p style="margin: 5px 0 15px 0; font-size: 18px; font-weight: 600;">${safeServiceDate}</p>
          
          <p style="margin: 0; font-size: 14px; color: #64748b;">Pool Status</p>
          <p style="margin: 5px 0 0 0; font-size: 18px; font-weight: 600; color: ${statusColor};">${statusText} ${statusIcon}</p>
        </div>
        
        ${messageContent}
        ${reportLinkHtml}
        
        <p style="font-size: 14px; color: #64748b; margin-top: 30px;">If you have any questions about your service, please don't hesitate to contact us.</p>
        
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;">
        
        <p style="font-size: 12px; color: #94a3b8; text-align: center; margin: 0;">
          ${safeBusinessName}<br>
          ${footerText}
        </p>
        
        <p style="font-size: 10px; color: #cbd5e1; text-align: center; margin-top: 15px;">
          You received this email because you are a customer of ${safeBusinessName}.<br>
          This is a service notification, not a marketing email.
        </p>
      </div>
    </body>
    </html>
  `;

  // Text body uses unescaped values (plain text, not HTML)
  const textBody = `
Hello ${customerName},

Your pool service has been completed by ${businessName}.

Service Date: ${serviceDate}
Pool Status: ${statusText} ${statusIcon}

${textMessageContent}${reportLinkText}
If you have any questions about your service, please don't hesitate to contact us.

${businessName}
${footerText}

---
You received this email because you are a customer of ${businessName}.
This is a service notification, not a marketing email.
  `.trim();

  return {
    subject,
    htmlBody,
    textBody,
  };
}

/**
 * Helper: Determine overall pool status based on chemical readings
 * 
 * Note: Salt is excluded from status determination as it's a numeric value
 * (PPM) rather than a status indicator like the other readings.
 * 
 * Handles null/undefined readings by treating them as "unknown" which
 * doesn't trigger a "needs_attention" status (missing data is not the same
 * as bad data - the technician may not have tested that parameter).
 */
function determinePoolStatus(serviceLog: any): "good" | "needs_attention" {
  const readings = [
    serviceLog.ph,
    serviceLog.chlorine,
    serviceLog.alkalinity,
    serviceLog.stabilizer
  ];

  // Check for any reading that explicitly indicates an issue
  // null/undefined readings are not considered issues (just missing data)
  const hasIssue = readings.some((reading) =>
    reading !== null &&
    reading !== undefined &&
    (reading === "low" || reading === "high" || reading === "critical")
  );

  return hasIssue ? "needs_attention" : "good";
}

/**
 * Helper: Format service date for SMS message
 * 
 * @param dateString - Date in YYYY-MM-DD format
 * @returns Formatted date in MM/DD/YYYY format, or original string if invalid
 */
function formatServiceDate(dateString: string): string {
  // Validate input format: YYYY-MM-DD
  if (!dateString || typeof dateString !== 'string') {
    return 'Unknown date';
  }

  const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
  const match = dateString.match(datePattern);

  if (!match) {
    // Return original string if format doesn't match
    // This prevents garbage output for malformed dates
    return dateString;
  }

  const [, year, month, day] = match;

  // Basic validation of date components
  const monthNum = parseInt(month, 10);
  const dayNum = parseInt(day, 10);

  if (monthNum < 1 || monthNum > 12 || dayNum < 1 || dayNum > 31) {
    return dateString;
  }

  return `${month}/${day}/${year}`;
}

/**
 * Helper: Format SMS message
 * Uses ASCII characters only to ensure GSM-7 encoding (160 char limit).
 * Emoji characters would trigger UCS-2 encoding (70 char limit per segment).
 */
function formatSmsMessage(
  businessName: string,
  serviceDate: string,
  overallStatus: "good" | "needs_attention",
  reportLink: string
): string {
  // Truncate business name if too long
  const maxBusinessNameLength = 30;
  const truncatedBusinessName = businessName.length > maxBusinessNameLength
    ? businessName.slice(0, maxBusinessNameLength - 3) + "..."
    : businessName;

  // Use ASCII characters only for GSM-7 encoding compatibility
  const statusText = overallStatus === "good"
    ? "OK"
    : "Needs Attention";

  return `${truncatedBusinessName} - Service completed ${serviceDate}\nPool Status: ${statusText}\nView report: ${reportLink}`;
}

/**
 * Helper: Send report via SMS using Twilio
 */
async function sendViaSms(
  ctx: any,
  params: {
    report: any;
    customer: any;
    businessName: string;
    serviceDate: string;
    overallStatus: "good" | "needs_attention";
    reportLink: string;
  }
): Promise<{
  success: boolean;
  error?: string;
  report_token?: string;
  message_id?: string;
}> {
  const { report, customer, businessName, serviceDate, overallStatus, reportLink } = params;

  const message = formatSmsMessage(businessName, serviceDate, overallStatus, reportLink);

  try {
    const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
    const twilioFromNumber = process.env.TWILIO_FROM_NUMBER;

    if (!twilioAccountSid || !twilioAuthToken || !twilioFromNumber) {
      return {
        success: false,
        error: "SMS service not configured. Please contact support.",
      };
    }

    // Twilio API endpoint
    const url = `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`;

    // Create Basic Auth header
    const auth = btoa(`${twilioAccountSid}:${twilioAuthToken}`);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${auth}`,
      },
      body: new URLSearchParams({
        From: twilioFromNumber,
        To: customer.phone,
        Body: message,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData.message || "Failed to send SMS";

      // Log detailed error for debugging
      console.error("Twilio SMS Error:", {
        status: response.status,
        statusText: response.statusText,
        errorData,
        customerPhone: customer.phone,
        fromNumber: twilioFromNumber
      });

      return {
        success: false,
        error: `Failed to send SMS: ${errorMessage}`,
      };
    }

    const responseData = await response.json();
    const messageId = responseData.sid; // Twilio uses 'sid' for message ID

    // Update report with sent timestamp
    await ctx.runMutation(internal.serviceReports.updateReportSent, {
      report_id: report._id,
      sent_to_phone: customer.phone,
      delivery_method: 'sms',
    });

    return {
      success: true,
      report_token: report.report_token,
      message_id: messageId,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return {
      success: false,
      error: `Network error. Please check your connection and try again. (${errorMessage})`,
    };
  }
}

/**
 * Mailersend request body structure
 * Used for building and validating email API requests
 */
export interface MailersendRequestBody {
  from: {
    email: string;
    name: string;
  };
  to: Array<{ email: string }>;
  subject: string;
  text: string;
  html: string;
}

/**
 * Parameters for building Mailersend request body
 */
export interface MailersendRequestParams {
  recipientEmail: string;
  fromEmail: string;
  fromName: string;
  subject: string;
  textBody: string;
  htmlBody: string;
}

/**
 * Build Mailersend API request body from email parameters
 * 
 * This function creates the properly formatted request body for Mailersend's
 * email API endpoint. It ensures all required fields are present and correctly
 * structured according to Mailersend's API specification.
 * 
 * Requirements: 1.1, 1.4, 2.4, 2.5
 */
export function buildMailersendRequestBody(params: MailersendRequestParams): MailersendRequestBody {
  return {
    from: {
      email: params.fromEmail,
      name: params.fromName,
    },
    to: [{ email: params.recipientEmail }],
    subject: params.subject,
    text: params.textBody,
    html: params.htmlBody,
  };
}

/**
 * Mailersend error response structure
 * Used for parsing API error responses
 */
export interface MailersendErrorResponse {
  message?: string;
  errors?: Array<{ message: string; field?: string }>;
}

/**
 * Parse Mailersend error response and return user-friendly error message
 * 
 * Maps HTTP status codes to appropriate user-facing messages:
 * - 401: Authentication failed (invalid API key)
 * - 403: Access denied (forbidden)
 * - 422: Validation error (parse errors[].message)
 * - 429: Rate limited
 * - 5xx: Server error
 * 
 * Requirements: 1.5, 4.1, 4.2, 4.5
 */
export function parseMailersendError(statusCode: number, errorData: MailersendErrorResponse): string {
  if (statusCode === 401) {
    return "Email service authentication failed. Please contact support.";
  }

  if (statusCode === 403) {
    return "Email service access denied. Please contact support.";
  }

  if (statusCode === 422) {
    // Parse Mailersend error format: errors[].message
    return errorData.errors?.[0]?.message || "Invalid email data";
  }

  if (statusCode === 429) {
    return "Email service temporarily unavailable. Please try again later.";
  }

  if (statusCode >= 500) {
    return "Email service error. Please try again later.";
  }

  // Fallback for other error codes
  return errorData.message || "Failed to send email";
}

/**
 * Helper: Send report via Email using Mailersend
 * Mailersend allows sending to any email address after domain verification
 * 
 * Uses simplified email templates via generateSimpleEmailContent
 * Requirements: 1.1, 1.2, 1.4, 3.2, 3.6, 3.7
 */
async function sendViaEmail(
  ctx: any,
  params: {
    report: any;
    customer: any;
    businessName: string;
    serviceDate: string;
    overallStatus: "good" | "needs_attention";
    reportLink: string;
    customNote?: string;
  }
): Promise<{
  success: boolean;
  error?: string;
  report_token?: string;
  message_id?: string;
}> {
  const { report, customer, businessName, serviceDate, overallStatus, reportLink, customNote } = params;

  // Generate simplified email content using the new helper function
  const emailContent = generateSimpleEmailContent({
    customerName: customer.full_name,
    serviceDate: serviceDate,
    poolStatus: overallStatus,
    customNote: customNote,
    businessName: businessName,
    reportLink: reportLink,
  });

  try {
    // Using Mailersend API - allows sending to any email address
    const mailersendApiKey = process.env.MAILERSEND_API_KEY;
    const fromEmail = process.env.FROM_EMAIL;

    if (!mailersendApiKey) {
      console.error("MAILERSEND_API_KEY is missing from environment variables");
      return {
        success: false,
        error: "Email service API key not configured. Please check Convex environment variables.",
      };
    }

    if (!fromEmail) {
      console.error("FROM_EMAIL is missing from environment variables");
      return {
        success: false,
        error: "Sender email address not configured. Please check Convex environment variables.",
      };
    }

    const response = await fetch("https://api.mailersend.com/v1/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${mailersendApiKey}`,
      },
      body: JSON.stringify(buildMailersendRequestBody({
        recipientEmail: customer.email,
        fromEmail: fromEmail,
        fromName: businessName,
        subject: emailContent.subject,
        textBody: emailContent.textBody,
        htmlBody: emailContent.htmlBody,
      })),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as MailersendErrorResponse;

      // Parse error using helper function (Requirements: 1.5, 4.1, 4.2, 4.5)
      const errorMessage = parseMailersendError(response.status, errorData);

      // Log detailed error for debugging (Requirement 4.5)
      console.error("Mailersend Email Error:", {
        status: response.status,
        error_message: errorMessage,
        customer_email: customer.email,
        timestamp: new Date().toISOString()
      });

      return {
        success: false,
        error: `Failed to send email: ${errorMessage}`,
      };
    }

    // Mailersend returns 202 Accepted on success
    // Get message ID from headers if available
    const messageId = response.headers.get('x-message-id') || 'sent';

    // Update report with sent timestamp
    await ctx.runMutation(internal.serviceReports.updateReportSent, {
      report_id: report._id,
      sent_to_email: customer.email,
      delivery_method: 'email',
    });

    return {
      success: true,
      report_token: report.report_token,
      message_id: messageId,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return {
      success: false,
      error: `Network error. Please check your connection and try again. (${errorMessage})`,
    };
  }
}


/**
 * Get a service report by token for the public report page
 * 
 * This query is PUBLIC (no authentication required) to allow customers
 * to view their service reports via the link sent in SMS.
 * 
 * Returns all data needed for the public report page:
 * - Service date and technician name
 * - Chemical readings with status indicators
 * - Service notes
 * - Photos grouped by category
 * 
 * Requirements: 3.1
 */
export const getReportByToken = query({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    // Note: This query is intentionally public (no auth check)
    // Security relies on unguessable tokens (122-bit entropy)

    // Find report by token
    const report = await ctx.db
      .query("serviceReports")
      .withIndex("by_token", (q) => q.eq("report_token", args.token))
      .first();

    if (!report) {
      return {
        found: false,
        error: "Report not found. The link may be invalid.",
      };
    }

    // Get service log
    const serviceLog = await ctx.db.get(report.service_log_id);
    if (!serviceLog) {
      return {
        found: false,
        error: "This service report is no longer available.",
      };
    }

    // Get customer
    const customer = await ctx.db.get(report.customer_id);
    if (!customer) {
      return {
        found: false,
        error: "This service report is no longer available.",
      };
    }

    // Get business info for technician name
    const business = await ctx.db
      .query("businesses")
      .withIndex("by_owner_email", (q) => q.eq("owner_email", customer.created_by))
      .first();

    // Get photos for this service log
    const photos = await ctx.db
      .query("servicePhotos")
      .withIndex("by_service_log", (q) => q.eq("service_log_id", report.service_log_id))
      .collect();

    // Get URLs for photos
    const photosWithUrls = await Promise.all(
      photos.map(async (photo) => {
        const url = await ctx.storage.getUrl(photo.storage_id);
        return {
          id: photo._id,
          category: photo.category,
          timestamp: photo.timestamp,
          url: url || null,
        };
      })
    );

    // Filter out photos with missing URLs
    const validPhotos = photosWithUrls.filter((p) => p.url !== null);

    // Group photos by category
    const beforePhotos = validPhotos.filter((p) => p.category === "before");
    const afterPhotos = validPhotos.filter((p) => p.category === "after");

    // Determine overall pool status
    const overallStatus = determinePoolStatus(serviceLog);

    // Derive technician name with safe fallback
    // If created_by contains '@', use the part before it; otherwise use the full value
    const technicianName = business?.name || (
      customer.created_by.includes('@')
        ? customer.created_by.split('@')[0]
        : customer.created_by
    );

    return {
      found: true,
      report: {
        businessName: business?.name || "Dominick Pool Solutions",
        serviceDate: serviceLog.service_date,
        technicianName,
        customerName: customer.full_name,
        chemicalReadings: {
          ph: serviceLog.ph,
          chlorine: serviceLog.chlorine,
          alkalinity: serviceLog.alkalinity,
          stabilizer: serviceLog.stabilizer,
          salt: serviceLog.salt,
        },
        notes: serviceLog.notes,
        overallStatus,
        photos: {
          before: beforePhotos,
          after: afterPhotos,
        },
        serviceDuration: serviceLog.duration_ms,
        startTime: serviceLog.start_time,
        endTime: serviceLog.end_time,
        // Include customer's report customization settings
        settings: customer.report_settings || {
          show_chemical_readings: true,
          show_photos: true,
          show_service_notes: true,
          show_technician_name: true,
          show_service_duration: true,
          show_overall_status: true,
        },
      },
    };
  },
});
