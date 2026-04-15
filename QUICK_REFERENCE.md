# Send Report - Quick Reference

## 🚀 Quick Start

### 1. Add Email to Customer
```typescript
// In customer form or edit page
email: "customer@example.com"
```

### 2. Configure Resend (One-time)
```bash
# In Convex Dashboard → Settings → Environment Variables
RESEND_API_KEY=re_xxxxx
FROM_EMAIL=reports@yourdomain.com
APP_URL=https://yourdomain.com
```

### 3. Send Report
```typescript
// Click "Send Report" → Choose "Email" → Send
```

## 📋 Component Usage

```typescript
import { SendReportDialog } from '@/components/service-reports/SendReportDialog';

<SendReportDialog
  isOpen={dialogOpen}
  onClose={() => setDialogOpen(false)}
  onConfirm={async (method) => {
    await sendReport({
      service_log_id: log._id,
      delivery_method: method  // 'sms' or 'email'
    });
  }}
  customerPhone={customer.phone}      // Optional
  customerEmail={customer.email}      // Optional
  messagePreview="Preview text..."
  error={errorMessage}                // Optional
  isLoading={loading}                 // Optional
  isResend={false}                    // Optional
/>
```

## 🔧 API Usage

```typescript
// Send via SMS
const result = await sendReport({
  service_log_id: "...",
  delivery_method: "sms"
});

// Send via Email
const result = await sendReport({
  service_log_id: "...",
  delivery_method: "email"
});

// Response
{
  success: boolean,
  error?: string,
  report_token?: string,
  message_id?: string,
  was_duplicate?: boolean
}
```

## 🎨 UI States

| State | SMS Button | Email Button | Send Button |
|-------|-----------|--------------|-------------|
| Both available | Enabled | Enabled | Enabled |
| Only phone | Enabled | Disabled | Enabled |
| Only email | Disabled | Enabled | Enabled |
| Neither | Disabled | Disabled | Disabled |

## ⚙️ Environment Variables

| Variable | Required For | Example |
|----------|-------------|---------|
| `RESEND_API_KEY` | Email | `re_xxxxx` |
| `FROM_EMAIL` | Email | `reports@domain.com` |
| `TELNYX_API_KEY` | SMS | `KEYxxxxx` |
| `TELNYX_FROM_NUMBER` | SMS | `+1234567890` |
| `APP_URL` | Both | `https://domain.com` |

## 🐛 Common Issues

### Email not sending
```bash
# Check 1: API key set?
echo $RESEND_API_KEY

# Check 2: Domain verified?
# → Visit Resend dashboard

# Check 3: FROM_EMAIL matches domain?
# → Must be from verified domain
```

### SMS not sending
```bash
# Check 1: Phone format correct?
# → Must be E.164: +12345678901

# Check 2: Telnyx configured?
# → Check all TELNYX_* variables

# Check 3: Account balance?
# → Visit Telnyx dashboard
```

### Send button disabled
```typescript
// Check customer has contact method
if (!customer.phone && !customer.email) {
  // Add phone or email to customer
}
```

## 📊 Database Fields

```typescript
serviceReports: {
  sent_at: number,                    // Last send timestamp
  sent_to_phone?: string,             // SMS recipient
  sent_to_email?: string,             // Email recipient
  send_count: number,                 // Total sends
  last_delivery_method: 'sms' | 'email'  // Last method used
}
```

## 🧪 Testing

### Test SMS
```typescript
// 1. Add phone to test customer
customer.phone = "+1234567890"

// 2. Send report via SMS
// 3. Check phone for message
```

### Test Email
```typescript
// 1. Add email to test customer
customer.email = "test@example.com"

// 2. Send report via Email
// 3. Check inbox (and spam folder)
```

### Test API
```bash
# Test Resend
curl -X POST https://api.resend.com/emails \
  -H "Authorization: Bearer $RESEND_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"from":"reports@domain.com","to":"test@example.com","subject":"Test","html":"<p>Test</p>"}'

# Test Telnyx
curl -X POST https://api.telnyx.com/v2/messages \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"from":"+1234567890","to":"+1234567890","text":"Test"}'
```

## 📝 Error Messages

| Error | Cause | Solution |
|-------|-------|----------|
| "No phone number on file" | Customer missing phone | Add phone to customer |
| "No email address on file" | Customer missing email | Add email to customer |
| "SMS service not configured" | Missing Telnyx config | Add TELNYX_* variables |
| "Email service not configured" | Missing Resend config | Add RESEND_API_KEY |
| "Failed to send SMS: ..." | Telnyx API error | Check Telnyx dashboard |
| "Failed to send email: ..." | Resend API error | Check Resend dashboard |
| "Network error" | Connection issue | Check internet connection |

## 🔐 Security

- ✅ Report tokens: 122-bit entropy (unguessable)
- ✅ Phone masking: Only last 4 digits shown
- ✅ Rate limiting: 60-second duplicate prevention
- ✅ Validation: Contact info validated before send
- ✅ Tenant isolation: Users only see their data

## 📚 Documentation

| File | Purpose |
|------|---------|
| `EMAIL_SETUP.md` | Full configuration guide |
| `SEND_REPORT_EXAMPLE.md` | Code examples |
| `FEATURE_SUMMARY.md` | Feature overview |
| `QUICK_REFERENCE.md` | This file |

## 🎯 Key Files

| File | Purpose |
|------|---------|
| `src/components/service-reports/SendReportDialog.tsx` | UI component |
| `convex/serviceReports.ts` | Backend logic |
| `convex/schema.ts` | Database schema |
| `src/pages/CustomerDetail.jsx` | Usage example |

## 💡 Tips

1. **Always provide both contact methods** when available
2. **Test with your own phone/email** first
3. **Check spam folder** for test emails
4. **Monitor API dashboards** for delivery status
5. **Set up error alerts** in production
6. **Verify domain** before going live
7. **Keep API keys secure** (never commit to git)
8. **Use environment variables** for all config

## 🚨 Troubleshooting Checklist

- [ ] Environment variables set in Convex?
- [ ] Domain verified in Resend?
- [ ] FROM_EMAIL matches verified domain?
- [ ] Customer has phone or email?
- [ ] Phone in E.164 format?
- [ ] Email valid format?
- [ ] API keys correct?
- [ ] Sufficient API balance?
- [ ] Network connection working?
- [ ] Checked spam folder?

## 📞 Support

1. Check documentation files
2. Review Convex logs
3. Check API provider dashboards
4. Test with personal contact info
5. Verify environment variables

## ✅ Pre-Launch Checklist

- [ ] Resend account created
- [ ] Domain verified
- [ ] API key added to Convex
- [ ] FROM_EMAIL configured
- [ ] Test email sent successfully
- [ ] Test SMS sent successfully
- [ ] Error handling tested
- [ ] Mobile UI tested
- [ ] Documentation reviewed
- [ ] Team trained on new feature

---

**Need help?** Check `EMAIL_SETUP.md` for detailed setup instructions.
