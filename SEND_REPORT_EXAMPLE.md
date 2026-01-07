# Send Report Implementation Example

This document shows how to implement the send report functionality with both SMS and Email options.

## Complete Implementation Example

Here's a complete example of how to use the SendReportDialog with Convex:

```typescript
import { useState, useCallback } from 'react';
import { useAction } from 'convex/react';
import { api } from '../convex/_generated/api';
import { SendReportDialog } from '@/components/service-reports/SendReportDialog';
import { toast } from 'sonner';

function CustomerServiceLogs({ customer, serviceLogs }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedLog, setSelectedLog] = useState(null);
  const [error, setError] = useState(null);
  
  // Convex action for sending reports
  const sendReport = useAction(api.serviceReports.sendReport);

  const handleOpenDialog = (log) => {
    setSelectedLog(log);
    setError(null);
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setSelectedLog(null);
    setError(null);
  };

  const handleConfirmSend = async (deliveryMethod) => {
    if (!selectedLog) return;
    
    try {
      const result = await sendReport({
        service_log_id: selectedLog._id,
        delivery_method: deliveryMethod,
      });

      if (result.success) {
        if (result.was_duplicate) {
          toast.info('Report was already sent recently');
        } else {
          toast.success(
            `Report sent via ${deliveryMethod === 'sms' ? 'SMS' : 'Email'}!`
          );
        }
        handleCloseDialog();
      } else {
        setError(result.error || 'Failed to send report');
      }
    } catch (err) {
      setError(err.message || 'Failed to send report');
    }
  };

  const getMessagePreview = () => {
    if (!selectedLog) return '';
    
    const businessName = 'Pool Service';
    const serviceDate = formatDate(selectedLog.service_date);
    const status = determineStatus(selectedLog);
    const reportLink = `${window.location.origin}/report/preview`;
    
    return `${businessName} - Service completed ${serviceDate}\nPool Status: ${status}\nView report: ${reportLink}`;
  };

  return (
    <div>
      {serviceLogs.map(log => (
        <div key={log._id}>
          <button onClick={() => handleOpenDialog(log)}>
            Send Report
          </button>
        </div>
      ))}

      <SendReportDialog
        isOpen={dialogOpen}
        onClose={handleCloseDialog}
        onConfirm={handleConfirmSend}
        customerPhone={customer.phone}
        customerEmail={customer.email}
        messagePreview={getMessagePreview()}
        error={error}
      />
    </div>
  );
}

function formatDate(dateString) {
  const [year, month, day] = dateString.split('-');
  return `${month}/${day}/${year}`;
}

function determineStatus(log) {
  const readings = [log.ph, log.chlorine, log.alkalinity, log.stabilizer];
  const hasIssue = readings.some(r => r === 'low' || r === 'high' || r === 'critical');
  return hasIssue ? 'Needs Attention' : 'OK';
}
```

## Backend Configuration

### Convex Environment Variables

Set these in your Convex dashboard (Settings → Environment Variables):

```bash
# Required for both SMS and Email
APP_URL=https://yourdomain.com

# SMS Configuration (Telnyx)
TELNYX_API_KEY=KEY...
TELNYX_FROM_NUMBER=+1234567890
TELNYX_MESSAGING_PROFILE_ID=...

# Email Configuration (Resend)
RESEND_API_KEY=re_...
FROM_EMAIL=reports@yourdomain.com
```

## Testing Locally

### 1. Test with Mock Data

```typescript
// Test component with mock customer
const mockCustomer = {
  _id: 'test-id',
  full_name: 'John Doe',
  phone: '+12345678901',
  email: 'john@example.com',
};

const mockLog = {
  _id: 'log-id',
  service_date: '2025-12-21',
  ph: 'good',
  chlorine: 'good',
  alkalinity: 'good',
  stabilizer: 'good',
};

<SendReportDialog
  isOpen={true}
  onClose={() => {}}
  onConfirm={async (method) => {
    console.log('Would send via:', method);
  }}
  customerPhone={mockCustomer.phone}
  customerEmail={mockCustomer.email}
  messagePreview="Test message"
/>
```

### 2. Test API Endpoints

```bash
# Test Resend API
curl -X POST https://api.resend.com/emails \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "reports@yourdomain.com",
    "to": "test@example.com",
    "subject": "Test Email",
    "html": "<p>Test</p>"
  }'

# Test Telnyx API
curl -X POST https://api.telnyx.com/v2/messages \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "+1234567890",
    "to": "+1234567890",
    "text": "Test SMS"
  }'
```

## UI States

### Both Contact Methods Available
```
┌─────────────────────────────────┐
│ Send Service Report             │
├─────────────────────────────────┤
│ Delivery Method                 │
│ [SMS] [Email]                   │
│                                 │
│ Sending to                      │
│ **** **** 8901                  │
│                                 │
│ Message Preview                 │
│ Pool Service - Service...       │
│                                 │
│ [Cancel] [Send Report]          │
└─────────────────────────────────┘
```

### Only Phone Available
```
┌─────────────────────────────────┐
│ Send Service Report             │
├─────────────────────────────────┤
│ Delivery Method                 │
│ [SMS] [Email] (disabled)        │
│                                 │
│ Sending to                      │
│ **** **** 8901                  │
│                                 │
│ Message Preview                 │
│ Pool Service - Service...       │
│                                 │
│ [Cancel] [Send Report]          │
└─────────────────────────────────┘
```

### Only Email Available
```
┌─────────────────────────────────┐
│ Send Service Report             │
├─────────────────────────────────┤
│ Delivery Method                 │
│ [SMS] (disabled) [Email]        │
│                                 │
│ Sending to                      │
│ john@example.com                │
│                                 │
│ Email Preview                   │
│ Subject: Your Pool Service...   │
│ Message: Your pool service...   │
│                                 │
│ [Cancel] [Send Report]          │
└─────────────────────────────────┘
```

### No Contact Methods
```
┌─────────────────────────────────┐
│ Send Service Report             │
├─────────────────────────────────┤
│ ⚠ No phone number on file.      │
│   Please add a phone number     │
│   or email address.             │
│                                 │
│ [Cancel] [Send Report] (disabled)│
└─────────────────────────────────┘
```

## Error Handling

### Common Errors

```typescript
// No contact method
{
  success: false,
  error: "No phone number on file. Please add a phone number to send SMS reports."
}

// API not configured
{
  success: false,
  error: "SMS service not configured. Please contact support."
}

// Network error
{
  success: false,
  error: "Network error. Please check your connection and try again."
}

// API error
{
  success: false,
  error: "Failed to send SMS: Invalid phone number format"
}
```

### Handling Errors in UI

```typescript
const handleConfirmSend = async (deliveryMethod) => {
  try {
    const result = await sendReport({
      service_log_id: selectedLog._id,
      delivery_method: deliveryMethod,
    });

    if (!result.success) {
      // Show error in dialog
      setError(result.error);
      return;
    }

    // Success - close dialog and show toast
    toast.success('Report sent!');
    handleCloseDialog();
  } catch (err) {
    // Network or unexpected error
    setError('An unexpected error occurred. Please try again.');
  }
};
```

## Migration Guide

If you're upgrading from SMS-only to SMS + Email:

### 1. Update Schema
```bash
# Push schema changes
npx convex dev
```

### 2. Update Environment Variables
Add email configuration to Convex dashboard

### 3. Update Components
```typescript
// Before
<SendReportDialog
  customerPhone={customer.phone}
  // ...
/>

// After
<SendReportDialog
  customerPhone={customer.phone}
  customerEmail={customer.email}  // Add this
  // ...
/>
```

### 4. Update Handlers
```typescript
// Before
const handleConfirm = async () => {
  await sendReport({ service_log_id: log._id });
};

// After
const handleConfirm = async (deliveryMethod) => {
  await sendReport({ 
    service_log_id: log._id,
    delivery_method: deliveryMethod  // Add this
  });
};
```

## Best Practices

1. **Always provide both contact methods** when available
2. **Handle errors gracefully** with clear user messages
3. **Show loading states** during send operations
4. **Validate contact info** before opening dialog
5. **Track delivery status** in your database
6. **Test with real phone/email** before production
7. **Monitor API usage** to avoid rate limits
8. **Set up error alerts** for failed deliveries

## Troubleshooting

### Dialog doesn't show delivery method buttons
- Check that `customerPhone` or `customerEmail` props are provided
- Verify the values are not empty strings

### Send button is disabled
- Ensure the selected delivery method has a valid contact method
- Check for validation errors in the console

### Email not received
- Check spam folder
- Verify domain is verified in Resend
- Check Resend dashboard for delivery status
- Verify FROM_EMAIL matches verified domain

### SMS not received
- Verify phone number is in E.164 format
- Check Telnyx dashboard for delivery status
- Ensure sufficient account balance
- Verify messaging profile is active
