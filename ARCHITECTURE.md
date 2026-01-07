# Send Report Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         User Interface                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  CustomerDetail Page                                            │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │                                                           │ │
│  │  Service Log Card                                         │ │
│  │  ┌─────────────────────────────────────────────────────┐ │ │
│  │  │ Service Date: 12/21/2025                            │ │ │
│  │  │ Status: Completed                                   │ │ │
│  │  │                                                     │ │ │
│  │  │ [Send Report] ← Click                               │ │ │
│  │  └─────────────────────────────────────────────────────┘ │ │
│  │                                                           │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│                          ↓                                      │
│                                                                 │
│  SendReportDialog Component                                     │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ Delivery Method                                           │ │
│  │ ┌─────────┐ ┌─────────┐                                  │ │
│  │ │   SMS   │ │  Email  │ ← Select                         │ │
│  │ └─────────┘ └─────────┘                                  │ │
│  │                                                           │ │
│  │ Sending to: customer@example.com                          │ │
│  │                                                           │ │
│  │ [Cancel] [Send Report] ← Confirm                          │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                      Convex Backend                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  sendReport Action                                              │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ 1. Validate contact method                                │ │
│  │ 2. Get/create report record                               │ │
│  │ 3. Check for duplicate send                               │ │
│  │ 4. Route to delivery method                               │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│              ↓                              ↓                   │
│                                                                 │
│  ┌─────────────────────┐      ┌─────────────────────┐         │
│  │   sendViaSms()      │      │   sendViaEmail()    │         │
│  ├─────────────────────┤      ├─────────────────────┤         │
│  │ • Format SMS        │      │ • Format HTML       │         │
│  │ • Call Telnyx API   │      │ • Call Resend API   │         │
│  │ • Update database   │      │ • Update database   │         │
│  └─────────────────────┘      └─────────────────────┘         │
│           ↓                              ↓                      │
└─────────────────────────────────────────────────────────────────┘
              ↓                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    External Services                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────┐      ┌─────────────────────┐         │
│  │   Telnyx API        │      │   Resend API        │         │
│  ├─────────────────────┤      ├─────────────────────┤         │
│  │ POST /v2/messages   │      │ POST /emails        │         │
│  │                     │      │                     │         │
│  │ {                   │      │ {                   │         │
│  │   from: "+1...",    │      │   from: "...",      │         │
│  │   to: "+1...",      │      │   to: "...",        │         │
│  │   text: "..."       │      │   html: "...",      │         │
│  │ }                   │      │   subject: "..."    │         │
│  │                     │      │ }                   │         │
│  └─────────────────────┘      └─────────────────────┘         │
│           ↓                              ↓                      │
└─────────────────────────────────────────────────────────────────┘
              ↓                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                         Customer                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  📱 SMS Message              ✉️ Email                           │
│  ┌─────────────────┐        ┌─────────────────────────────┐   │
│  │ Pool Service    │        │ Subject: Your Pool Service  │   │
│  │ Service         │        │                             │   │
│  │ completed       │        │ Hello John,                 │   │
│  │ 12/21/2025      │        │                             │   │
│  │                 │        │ Your service is complete.   │   │
│  │ Pool Status: OK │        │                             │   │
│  │                 │        │ [View Full Report]          │   │
│  │ View report:    │        │                             │   │
│  │ https://...     │        └─────────────────────────────┘   │
│  └─────────────────┘                                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow

### 1. User Initiates Send

```typescript
// CustomerDetail.jsx
const handleOpenSendReport = (log) => {
  setSelectedLogForReport(log);
  setSendReportDialogOpen(true);
};
```

### 2. User Selects Method

```typescript
// SendReportDialog.tsx
const [selectedMethod, setSelectedMethod] = useState('sms');

// User clicks SMS or Email button
<Button onClick={() => setSelectedMethod('email')}>
  Email
</Button>
```

### 3. User Confirms

```typescript
// SendReportDialog.tsx
const handleConfirm = async () => {
  await onConfirm(selectedMethod); // 'sms' or 'email'
};
```

### 4. Backend Processes

```typescript
// convex/serviceReports.ts
export const sendReport = action({
  args: {
    service_log_id: v.id("serviceLogs"),
    delivery_method: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // 1. Validate
    if (deliveryMethod === 'sms' && !customer.phone) {
      return { success: false, error: "No phone" };
    }
    
    // 2. Get/create report
    const report = await getOrCreateReport(...);
    
    // 3. Route to delivery method
    if (deliveryMethod === 'sms') {
      return await sendViaSms(...);
    } else {
      return await sendViaEmail(...);
    }
  }
});
```

### 5. External API Call

```typescript
// SMS via Telnyx
await fetch("https://api.telnyx.com/v2/messages", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${TELNYX_API_KEY}`,
  },
  body: JSON.stringify({
    from: TELNYX_FROM_NUMBER,
    to: customer.phone,
    text: message,
  }),
});

// Email via Resend
await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${RESEND_API_KEY}`,
  },
  body: JSON.stringify({
    from: FROM_EMAIL,
    to: customer.email,
    subject: subject,
    html: htmlBody,
  }),
});
```

### 6. Database Update

```typescript
// Update report record
await ctx.db.patch(report._id, {
  sent_at: Date.now(),
  sent_to_email: customer.email,
  send_count: (report.send_count || 0) + 1,
  last_delivery_method: 'email',
});
```

### 7. User Feedback

```typescript
// CustomerDetail.jsx
if (result.success) {
  toast.success('Report sent!');
  handleCloseDialog();
} else {
  setError(result.error);
}
```

## Component Hierarchy

```
App
└── CustomerDetail
    ├── ServiceLogCard (multiple)
    │   └── [Send Report Button]
    │
    └── SendReportDialog
        ├── Delivery Method Selector
        │   ├── SMS Button
        │   └── Email Button
        │
        ├── Recipient Display
        │   ├── Phone (masked)
        │   └── Email
        │
        ├── Message Preview
        │   ├── SMS Preview
        │   └── Email Preview
        │
        └── Action Buttons
            ├── Cancel Button
            └── Send Button
```

## State Management

```typescript
// CustomerDetail.jsx
const [sendReportDialogOpen, setSendReportDialogOpen] = useState(false);
const [selectedLogForReport, setSelectedLogForReport] = useState(null);
const [sendReportLoading, setSendReportLoading] = useState(false);
const [sendReportError, setSendReportError] = useState(null);

// SendReportDialog.tsx
const [selectedMethod, setSelectedMethod] = useState('sms');
const [internalLoading, setInternalLoading] = useState(false);
```

## Database Schema

```typescript
serviceReports: {
  _id: Id<"serviceReports">,
  service_log_id: Id<"serviceLogs">,
  customer_id: Id<"customers">,
  report_token: string,              // UUID v4
  created_at: number,                // Timestamp
  
  // Delivery tracking
  sent_at?: number,                  // Last send time
  sent_to_phone?: string,            // SMS recipient
  sent_to_email?: string,            // Email recipient
  send_count?: number,               // Total sends
  last_delivery_method?: 'sms' | 'email'  // Last method
}
```

## API Endpoints

### Telnyx (SMS)
```
POST https://api.telnyx.com/v2/messages
Authorization: Bearer {TELNYX_API_KEY}

Request:
{
  "from": "+1234567890",
  "to": "+1234567890",
  "text": "Message content",
  "messaging_profile_id": "optional"
}

Response:
{
  "data": {
    "id": "message-id",
    "status": "queued"
  }
}
```

### Resend (Email)
```
POST https://api.resend.com/emails
Authorization: Bearer {RESEND_API_KEY}

Request:
{
  "from": "reports@domain.com",
  "to": "customer@email.com",
  "subject": "Your Pool Service Report",
  "html": "<html>...</html>",
  "text": "Plain text fallback"
}

Response:
{
  "id": "email-id"
}
```

## Error Handling Flow

```
User Action
    ↓
Validation
    ├─ No contact method → Show error in dialog
    ├─ Invalid format → Show error in dialog
    └─ Valid → Continue
        ↓
API Call
    ├─ Network error → Show error in dialog
    ├─ API error → Show error in dialog
    └─ Success → Update database
        ↓
Database Update
    ├─ Error → Log and show generic error
    └─ Success → Show success message
        ↓
Close Dialog
```

## Security Layers

```
┌─────────────────────────────────────┐
│ 1. Authentication (Clerk)           │
│    - User must be logged in         │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│ 2. Tenant Isolation                 │
│    - User can only access their     │
│      customers and service logs     │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│ 3. Validation                       │
│    - Contact method exists          │
│    - Format is valid                │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│ 4. Rate Limiting                    │
│    - Duplicate send prevention      │
│    - 60-second cooldown             │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│ 5. Report Token Security            │
│    - 122-bit entropy UUID           │
│    - Unguessable links              │
└─────────────────────────────────────┘
```

## Performance Considerations

### Optimizations
- ✅ Lazy loading of dialog component
- ✅ Debounced method selection
- ✅ Cached message preview
- ✅ Optimistic UI updates
- ✅ Async API calls

### Bottlenecks
- ⚠️ External API latency (Telnyx/Resend)
- ⚠️ Email template rendering
- ⚠️ Database writes

### Monitoring
- 📊 Track send success rate
- 📊 Monitor API response times
- 📊 Log error rates
- 📊 Track delivery method usage

## Scalability

### Current Limits
- Telnyx: ~100 SMS/second
- Resend: 100 emails/day (free tier)
- Convex: 1M function calls/month (free tier)

### Scaling Strategy
1. Upgrade Resend plan for higher limits
2. Implement queue for batch sending
3. Add retry logic for failed sends
4. Cache report tokens
5. Optimize database queries

## Testing Strategy

### Unit Tests
- Component rendering
- Method selection
- Validation logic
- Error handling

### Integration Tests
- API calls (mocked)
- Database updates
- Error scenarios

### E2E Tests
- Full send flow
- Both delivery methods
- Error states
- Mobile responsive

## Deployment

### Environment Setup
```bash
# Development
RESEND_API_KEY=test_key
FROM_EMAIL=dev@localhost
APP_URL=http://localhost:5173

# Staging
RESEND_API_KEY=staging_key
FROM_EMAIL=reports@staging.domain.com
APP_URL=https://staging.domain.com

# Production
RESEND_API_KEY=prod_key
FROM_EMAIL=reports@domain.com
APP_URL=https://domain.com
```

### Rollout Plan
1. Deploy to staging
2. Test with internal team
3. Test with beta customers
4. Monitor for 24 hours
5. Deploy to production
6. Monitor delivery rates
7. Gather feedback

## Monitoring & Alerts

### Metrics to Track
- Send success rate (target: >95%)
- API response time (target: <2s)
- Error rate (target: <5%)
- Delivery method usage (SMS vs Email)

### Alerts
- ⚠️ Send success rate drops below 90%
- ⚠️ API errors exceed 10%
- ⚠️ Response time exceeds 5s
- ⚠️ API key expiration approaching

## Maintenance

### Regular Tasks
- [ ] Review API usage monthly
- [ ] Check delivery rates weekly
- [ ] Update email template quarterly
- [ ] Review error logs daily
- [ ] Test both methods monthly

### Updates
- Keep dependencies updated
- Monitor API changes
- Update documentation
- Refine error messages
- Optimize performance
