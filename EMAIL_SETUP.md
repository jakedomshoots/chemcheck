# Email Report Setup

This document explains how to configure email delivery for customer service reports.

## Overview

Customers can now receive their service reports via either **SMS** or **Email**. The system automatically detects which contact methods are available for each customer and allows you to choose the delivery method.

## Features

- **Dual Delivery Options**: Send reports via SMS (Telnyx) or Email (Mailersend)
- **Smart Method Selection**: UI automatically shows available delivery methods based on customer contact info
- **Professional Email Templates**: HTML email with branded design and responsive layout
- **Delivery Tracking**: System tracks which method was used and when reports were sent

## Email Service Configuration

The email functionality uses [Mailersend](https://mailersend.com) API for transactional email delivery.

### Environment Variables

Add these to your Convex environment variables:

```bash
# Email Configuration (Mailersend)
MAILERSEND_API_KEY=mlsn_xxxxxxxxxxxxx
FROM_EMAIL=reports@yourdomain.com

# Existing SMS Configuration (Telnyx)
TELNYX_API_KEY=your_telnyx_api_key
TELNYX_FROM_NUMBER=+1234567890
TELNYX_MESSAGING_PROFILE_ID=your_profile_id

# App URL (required for report links)
APP_URL=https://yourdomain.com
```

### Setting Up Mailersend

1. **Sign up** at [mailersend.com](https://mailersend.com)
2. **Verify your domain** in the Mailersend dashboard:
   - Go to **Email** → **Domains**
   - Click **Add domain** and enter your domain name
   - Add the required DNS records (SPF, DKIM, DMARC) to your domain's DNS settings
   - Wait for verification to complete (usually within a few minutes)
3. **Create an API key** in the Mailersend dashboard:
   - Go to **Integration** → **API tokens**
   - Click **Generate new token**
   - Give it a descriptive name (e.g., "ChemCheck Production")
   - Select **Full access** or at minimum **Email** permissions
   - Copy the generated token (it won't be shown again)
4. **Add the API key** to your Convex environment variables:
   - Go to your Convex dashboard
   - Navigate to **Settings** → **Environment Variables**
   - Add `MAILERSEND_API_KEY` with your API token
   - Add `FROM_EMAIL` with an email address from your verified domain

### Mailersend Configuration Notes

- **Domain Verification**: Your `FROM_EMAIL` must be from a domain verified in Mailersend
- **API Token Security**: Keep your API token secure; regenerate if compromised
- **Rate Limits**: Mailersend has rate limits based on your plan; monitor usage in the dashboard
- **Sandbox Mode**: For testing, you can use Mailersend's sandbox mode to send test emails without affecting your quota

### Alternative Email Providers

To use a different email provider, modify the `sendViaEmail` function in `convex/serviceReports.ts`:

#### SendGrid Example
```typescript
const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${process.env.SENDGRID_API_KEY}`,
  },
  body: JSON.stringify({
    personalizations: [{ to: [{ email: customer.email }] }],
    from: { email: process.env.FROM_EMAIL },
    subject: subject,
    content: [
      { type: "text/plain", value: textBody },
      { type: "text/html", value: htmlBody }
    ]
  }),
});
```

#### AWS SES Example
```typescript
// Use AWS SDK
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const client = new SESClient({ region: "us-east-1" });
const command = new SendEmailCommand({
  Source: process.env.FROM_EMAIL,
  Destination: { ToAddresses: [customer.email] },
  Message: {
    Subject: { Data: subject },
    Body: {
      Html: { Data: htmlBody },
      Text: { Data: textBody }
    }
  }
});

await client.send(command);
```

## Database Schema Updates

The `serviceReports` table now tracks both SMS and email deliveries:

```typescript
{
  sent_at: number,                    // Last send timestamp
  sent_to_phone: string,              // Phone number (if sent via SMS)
  sent_to_email: string,              // Email address (if sent via email)
  send_count: number,                 // Total number of sends
  last_delivery_method: 'sms' | 'email'  // Last method used
}
```

## Usage

### In the UI

1. Navigate to a customer's detail page
2. Click "Send Report" on any completed service log
3. Choose delivery method (SMS or Email)
4. Review the preview
5. Click "Send Report"

### API Usage

```typescript
// Send via SMS
await sendReport({
  service_log_id: "...",
  delivery_method: "sms"
});

// Send via Email
await sendReport({
  service_log_id: "...",
  delivery_method: "email"
});
```

## Email Template

The email includes:
- **Professional header** with gradient branding
- **Service summary** with date and status
- **Call-to-action button** to view full report
- **Responsive design** that works on mobile and desktop
- **Plain text fallback** for email clients that don't support HTML

## Testing

### Test Email Delivery

1. Add an email address to a test customer
2. Complete a service log for that customer
3. Send the report via email
4. Check the customer's inbox

### Test SMS Delivery

1. Add a phone number to a test customer
2. Complete a service log for that customer
3. Send the report via SMS
4. Check the customer's phone

## Troubleshooting

### Email Not Sending

- **Check API key**: Verify `MAILERSEND_API_KEY` is set correctly in Convex environment variables
- **Verify domain**: Ensure your sending domain is verified in Mailersend dashboard
- **Check FROM_EMAIL**: Must be from your verified domain
- **Review logs**: Check Convex logs for error messages
- **Check rate limits**: Verify you haven't exceeded Mailersend rate limits

### Common Mailersend Error Codes

| Error Code | Meaning | Solution |
|------------|---------|----------|
| 401 | Invalid API key | Check your `MAILERSEND_API_KEY` is correct |
| 403 | Forbidden | Verify domain is properly configured |
| 422 | Validation error | Check email addresses and content format |
| 429 | Rate limited | Wait and retry, or upgrade your plan |
| 5xx | Server error | Retry later; check Mailersend status page |

### SMS Not Sending

- **Check Telnyx config**: Verify all Telnyx environment variables
- **Phone format**: Ensure phone numbers are in E.164 format (+1234567890)
- **Check balance**: Verify your Telnyx account has sufficient balance

### Customer Has No Contact Info

- The UI will show an error if the customer doesn't have the required contact method
- Add either a phone number or email address to the customer profile

## Security

- **Report tokens**: 122-bit entropy UUIDs prevent unauthorized access
- **No authentication required**: Customers can view reports via link (by design)
- **Rate limiting**: Duplicate sends within 60 seconds are prevented
- **Contact privacy**: Phone numbers are masked in the UI (last 4 digits visible)

## Future Enhancements

Potential improvements:
- **Delivery preferences**: Let customers choose their preferred method
- **Delivery status tracking**: Track email opens and link clicks
- **Batch sending**: Send reports to multiple customers at once
- **Custom templates**: Allow businesses to customize email templates
- **Scheduled sending**: Schedule reports to be sent at specific times
