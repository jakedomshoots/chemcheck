/**
 * Email Preview Utility
 * 
 * Generates email preview content that matches the actual email sent by the backend.
 * This ensures the preview shown to users is identical to what they will receive.
 * 
 * Requirements: 4.4 - Email preview accuracy
 */

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
 * Helper: Escape HTML to prevent XSS attacks
 * Must match the backend escapeHtml function exactly.
 */
export function escapeHtml(text: string | null | undefined): string {
  if (text === null || text === undefined) return '';
  if (typeof text !== 'string') return String(text);

  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
    '`': '&#x60;',
    '/': '&#x2F;',
  };
  return text.replace(/[&<>"'`\/]/g, (char) => map[char]);
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
 * Helper: Escape URL for safe href usage
 */
export function escapeUrlForHtml(url: string | null | undefined): string {
  if (!url) return '';
  if (!isValidReportLink(url)) return '';
  return escapeHtml(url);
}

export interface SafeEmailFields {
  customerName: string;
  serviceDate: string;
  customNote: string;
  businessName: string;
  reportLink: string;
}

export function createSafeEmailFields(params: {
  customerName?: string | null;
  serviceDate?: string | null;
  customNote?: string | null;
  businessName?: string | null;
  reportLink?: string | null;
}): SafeEmailFields {
  return {
    customerName: escapeHtml(params.customerName || 'Valued Customer'),
    serviceDate: escapeHtml(params.serviceDate || 'Unknown Date'),
    customNote: escapeHtml(params.customNote || ''),
    businessName: escapeHtml(params.businessName || 'Dominick Pool Solutions'),
    reportLink: escapeUrlForHtml(params.reportLink),
  };
}

/**
 * Helper: Sanitize string for use in email subject line
 * Removes newlines to prevent email header injection attacks
 */
export function sanitizeForSubject(text: string): string {
  if (!text) return '';
  return text.replace(/[\r\n\x00-\x1F\x7F]/g, ' ').trim().slice(0, 200);
}

/**
 * Generate simple email content for service completion notifications
 * 
 * This function MUST produce identical output to the backend generateSimpleEmailContent
 * function in convex/serviceReports.ts to ensure preview accuracy.
 * 
 * Creates clean, focused email content based on pool status:
 * - Good status: Simple notification that pool is in perfect condition
 * - Needs attention: Includes custom note or generic attention message
 * 
 * Requirements: 1.1, 1.2, 3.2, 3.6, 3.7, 4.4
 */
export function generateSimpleEmailContent(params: EmailContentParams): GeneratedEmailContent {
  const { customerName, serviceDate, poolStatus, customNote, businessName: inputBusinessName, reportLink } = params;

  // Keep preview output identical to backend by using centralized safe fields.
  const safeFields = createSafeEmailFields({
    customerName,
    serviceDate,
    customNote,
    businessName: inputBusinessName,
    reportLink,
  });

  const safeCustomerName = safeFields.customerName;
  const safeServiceDate = safeFields.serviceDate;
  const safeCustomNote = safeFields.customNote;
  const safeBusinessName = safeFields.businessName;
  const safeReportLink = safeFields.reportLink;
  
  // Use provided business name or default
  const businessName = inputBusinessName || "Dominick Pool Solutions";
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
  let optionalCustomMessageHtml = '';
  let optionalCustomMessageText = '';
  
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

  if (safeCustomNote && poolStatus === 'good') {
    optionalCustomMessageHtml = `
      <div style="background: #e0f2fe; padding: 15px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #0284c7;">
        <p style="margin: 0; font-size: 14px; color: #075985; font-weight: 600;">Custom Message:</p>
        <p style="margin: 10px 0 0 0; font-size: 16px; color: #0c4a6e;">${safeCustomNote}</p>
      </div>
    `;
    optionalCustomMessageText = `\nCustom Message:\n${customNote}\n`;
  }
  
  // Generate report link section if provided and URL is safe
  const reportLinkHtml = safeReportLink ? `
        <div style="text-align: center; margin: 25px 0;">
          <a href="${safeReportLink}" style="display: inline-block; background: linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%); color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">View Full Report</a>
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
        ${optionalCustomMessageHtml}
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

${textMessageContent}${optionalCustomMessageText}${reportLinkText}
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
