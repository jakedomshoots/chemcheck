# Design Document

## Overview

This design describes the migration from SendGrid to Mailersend for email delivery in the service reports system. The migration involves updating the `sendViaEmail` helper function in `convex/serviceReports.ts` to use Mailersend's REST API while maintaining all existing functionality, error handling patterns, and delivery tracking.

## Architecture

### Current System
The existing email system uses SendGrid's REST API:
- Endpoint: `https://api.sendgrid.com/v3/mail/send`
- Authentication: Bearer token via `SENDGRID_API_KEY`
- Response: 202 Accepted with `x-message-id` header

### New System
The migrated system will use Mailersend's REST API:
- Endpoint: `https://api.mailersend.com/v1/email`
- Authentication: Bearer token via `MAILERSEND_API_KEY`
- Response: 202 Accepted with `x-message-id` header

### Key Differences

| Aspect | SendGrid | Mailersend |
|--------|----------|------------|
| Endpoint | `/v3/mail/send` | `/v1/email` |
| Auth Header | `Bearer {key}` | `Bearer {key}` |
| Recipients | `personalizations[].to[]` | `to[]` |
| From | `from.email`, `from.name` | `from.email`, `from.name` |
| Content | `content[].type`, `content[].value` | `html`, `text` |
| Success Code | 202 | 202 |
| Message ID | `x-message-id` header | `x-message-id` header |

## Components and Interfaces

### Modified Function: sendViaEmail

**Location**: `convex/serviceReports.ts`

**Current SendGrid Implementation**:
```typescript
const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${sendgridApiKey}`,
  },
  body: JSON.stringify({
    personalizations: [{ to: [{ email: customer.email }] }],
    from: { email: fromEmail, name: "Dominick Pool Solutions" },
    subject: emailContent.subject,
    content: [
      { type: "text/plain", value: emailContent.textBody },
      { type: "text/html", value: emailContent.htmlBody }
    ]
  }),
});
```

**New Mailersend Implementation**:
```typescript
const response = await fetch("https://api.mailersend.com/v1/email", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${mailersendApiKey}`,
  },
  body: JSON.stringify({
    from: { email: fromEmail, name: "Dominick Pool Solutions" },
    to: [{ email: customer.email }],
    subject: emailContent.subject,
    text: emailContent.textBody,
    html: emailContent.htmlBody,
  }),
});
```

### Environment Variables

**Remove**:
- `SENDGRID_API_KEY`

**Add**:
- `MAILERSEND_API_KEY` - API token from Mailersend dashboard

**Keep**:
- `FROM_EMAIL` - Sender email address (must be from verified domain in Mailersend)

### Error Response Mapping

| HTTP Status | Mailersend Meaning | User-Facing Message |
|-------------|-------------------|---------------------|
| 202 | Success | (no error) |
| 401 | Invalid API key | "Email service authentication failed. Please contact support." |
| 403 | Forbidden | "Email service access denied. Please contact support." |
| 422 | Validation error | Parse `errors[].message` from response |
| 429 | Rate limited | "Email service temporarily unavailable. Please try again later." |
| 5xx | Server error | "Email service error. Please try again later." |

## Data Models

No database schema changes required. The existing `serviceReports` table structure remains unchanged:

```typescript
{
  sent_at: number,                    // Last send timestamp
  sent_to_email: string,              // Email address (if sent via email)
  send_count: number,                 // Total number of sends
  last_delivery_method: 'sms' | 'email'  // Last method used
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

**Property 1: Request Format Correctness**
*For any* valid email parameters (recipient, subject, HTML body, text body, from address), the Mailersend API request should contain all required fields in the correct format: `from` object with email and name, `to` array with recipient email, `subject` string, `html` string, and `text` string
**Validates: Requirements 1.1, 1.4, 2.4, 2.5**

**Property 2: Authentication Header**
*For any* email send request, the Authorization header should contain "Bearer " followed by the MAILERSEND_API_KEY value
**Validates: Requirements 1.2**

**Property 3: Success Response Handling**
*For any* successful email send (202 response), the system should capture the x-message-id header, call updateReportSent with the recipient email, delivery_method 'email', and return success with the report token
**Validates: Requirements 3.1, 3.2, 3.4, 3.5**

**Property 4: Error Response Parsing**
*For any* Mailersend error response, the system should parse the error message from the response body and return it in a user-friendly format, and log detailed error information including status code and response data
**Validates: Requirements 1.5, 4.2, 4.5**

## Error Handling

### Missing Configuration
```typescript
if (!mailersendApiKey) {
  return {
    success: false,
    error: "Email service not configured. Please contact support.",
  };
}

if (!fromEmail) {
  return {
    success: false,
    error: "Email service not configured. Please contact support.",
  };
}
```

### API Error Response
```typescript
if (!response.ok) {
  const errorData = await response.json().catch(() => ({}));
  
  // Map status codes to user-friendly messages
  let errorMessage: string;
  if (response.status === 401) {
    errorMessage = "Email service authentication failed. Please contact support.";
  } else if (response.status === 422) {
    errorMessage = errorData.errors?.[0]?.message || "Invalid email data";
  } else if (response.status === 429) {
    errorMessage = "Email service temporarily unavailable. Please try again later.";
  } else {
    errorMessage = errorData.message || "Failed to send email";
  }
  
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
```

### Network Errors
```typescript
catch (error) {
  const errorMessage = error instanceof Error ? error.message : "Unknown error";
  return {
    success: false,
    error: `Network error. Please check your connection and try again. (${errorMessage})`,
  };
}
```

## Testing Strategy

### Unit Tests
- Test request body format matches Mailersend API specification
- Test error message mapping for different HTTP status codes
- Test missing API key returns appropriate error
- Test missing FROM_EMAIL returns appropriate error
- Test successful response extracts message ID from header

### Property-Based Tests
- **Property 1**: For any valid email content, the generated request body should contain all required Mailersend fields
- **Property 2**: For any API key value, the Authorization header should be correctly formatted
- **Property 3**: For any successful response with x-message-id header, the returned message_id should match
- **Property 4**: For any error response with errors array, the first error message should be extracted

### Integration Tests
- Test end-to-end email sending with Mailersend sandbox/test mode
- Verify delivery tracking updates correctly after send
- Test error handling with invalid API key

### Manual Testing
- Send test email to verify delivery
- Verify email content renders correctly
- Check Mailersend dashboard for delivery status
