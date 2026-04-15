# Design Document

## Overview

The Simple Email Notification System replaces the current complex email template with a streamlined notification approach. The system automatically determines pool status and provides appropriate messaging - either a simple "everything is perfect" notification or a custom note input for issues that need attention.

## Architecture

### Current System Analysis
The existing email system in `convex/serviceReports.ts` uses a complex HTML template with:
- Detailed service report links
- Chemical readings display
- "View Full Report" buttons
- Generic business name handling

### New System Design
The improved system will:
- Simplify email templates to focus on service completion
- Add conditional custom note input for issues
- Update branding to use "Dominick Pool Solutions"
- Remove complex report viewing functionality from emails

## Components and Interfaces

### 1. Enhanced SendReportDialog Component

**Location**: `src/components/service-reports/SendReportDialog.tsx`

**New Props**:
```typescript
interface SendReportDialogProps {
  // Existing props...
  poolStatus: 'good' | 'needs_attention';
  onCustomNoteChange?: (note: string) => void;
  customNote?: string;
  showNoteInput?: boolean;
}
```

**Behavior**:
- When `poolStatus === 'good'`: Show simple send confirmation
- When `poolStatus === 'needs_attention'`: Show custom note input field
- Validate custom note is not empty when issues are present
- Preview email content before sending

### 2. Simplified Email Templates

**Location**: `convex/serviceReports.ts` (sendViaEmail function)

**Good Status Template**:
```html
<h1>Pool Service Completed</h1>
<p>Hello [Customer Name],</p>
<p>Your pool service has been completed by Dominick Pool Solutions.</p>
<p><strong>Service Date:</strong> [Date]</p>
<p><strong>Pool Status:</strong> Everything is Perfect ✓</p>
<p>Your pool is in excellent condition and ready for use.</p>
<footer>This email is powered by ChemCheck Pool Software built by Dominick Pool Solutions</footer>
```

**Needs Attention Template**:
```html
<h1>Pool Service Completed</h1>
<p>Hello [Customer Name],</p>
<p>Your pool service has been completed by Dominick Pool Solutions.</p>
<p><strong>Service Date:</strong> [Date]</p>
<p><strong>Pool Status:</strong> Needs Attention ⚠</p>
<p><strong>Technician Notes:</strong></p>
<p>[Custom Note from technician]</p>
<footer>This email is powered by ChemCheck Pool Software built by Dominick Pool Solutions</footer>
```

### 3. Email Generation Logic

**Function**: `generateSimpleEmailContent()`

```typescript
interface EmailContentParams {
  customerName: string;
  serviceDate: string;
  poolStatus: 'good' | 'needs_attention';
  customNote?: string;
}

function generateSimpleEmailContent(params: EmailContentParams): {
  subject: string;
  htmlBody: string;
  textBody: string;
}
```

**Logic**:
- Generate subject: "Pool Service Completed - [Date]"
- Select template based on pool status
- Include custom note if provided and status is 'needs_attention'
- Apply consistent branding and styling

## Data Models

### Enhanced Service Report Flow

**No database changes required** - the existing `serviceReports` table structure remains the same.

**New data flow**:
1. Determine pool status from existing chemical readings logic
2. If status is 'needs_attention', collect custom note from UI
3. Pass custom note to email generation function
4. Generate simplified email content
5. Send via existing SendGrid integration

### Custom Note Handling

**Validation Rules**:
- Maximum length: 500 characters
- Required when pool status is 'needs_attention'
- Sanitized for HTML output (existing escapeHtml function)
- Stored temporarily in component state (not persisted to database)

## Error Handling

### Input Validation
- **Empty custom note**: Show error "Please add a note about what needs attention"
- **Note too long**: Show character count and limit warning
- **Invalid email**: Use existing email validation logic

### Email Delivery
- **SendGrid errors**: Use existing error handling in `sendViaEmail`
- **Network errors**: Use existing retry and error display logic
- **Missing email**: Use existing "No email on file" validation

### Graceful Degradation
- If custom note input fails to load, fall back to generic "needs attention" message
- If email template generation fails, use plain text fallback
- Maintain existing email delivery tracking and logging

## Testing Strategy

### Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

**Property 1: Email Content Generation**
*For any* valid service data and pool status, the generated email should contain the service date, "Dominick Pool Solutions" as business name, appropriate status messaging, and the correct footer text
**Validates: Requirements 1.1, 1.2, 3.2, 3.6, 3.7**

**Property 2: Email Content Exclusions**
*For any* generated email, the content should not contain report links, "View Full Report" buttons, or detailed chemical readings
**Validates: Requirements 1.4**

**Property 3: Custom Note Email Integration**
*For any* service with needs_attention status, when a custom note is provided, the email should prominently include that note, and when no note is provided, a generic attention message should appear
**Validates: Requirements 2.2, 2.3**

**Property 4: Input Validation**
*For any* needs_attention pool status, empty custom notes should fail validation and prevent email sending
**Validates: Requirements 2.4, 4.3**

**Property 5: Dialog Behavior**
*For any* pool status, the dialog should show simple confirmation for good status and note input field for needs_attention status
**Validates: Requirements 4.1, 4.2**

**Property 6: Email Preview Accuracy**
*For any* email generation parameters, the preview content should match exactly what would be sent in the actual email
**Validates: Requirements 4.4**

**Property 7: Cancel Prevention**
*For any* dialog state, canceling the dialog should prevent any email sending operations from being triggered
**Validates: Requirements 4.5**

**Property 8: Backward Compatibility**
*For any* existing customer data and email infrastructure, the new system should work with existing email addresses, use existing SendGrid functions, and maintain delivery tracking
**Validates: Requirements 5.1, 5.2, 5.3, 5.4**

**Property 9: Error Message Display**
*For any* customer without an email address, attempting to send should display appropriate error messages
**Validates: Requirements 5.5**

### Unit Tests
- Test email template generation with good/needs_attention status
- Test custom note validation (empty, too long, valid)
- Test HTML escaping in custom notes
- Test branding text inclusion in templates

### Property-Based Tests
- **Property 1**: For any valid service data, email generation should produce valid HTML and text content
- **Property 2**: For any custom note input, HTML escaping should prevent XSS attacks
- **Property 3**: For any pool status, the correct template should be selected

### Integration Tests
- Test SendReportDialog with different pool statuses
- Test email sending with custom notes
- Test email delivery tracking updates
- Test error handling for various failure scenarios

### Manual Testing
- Verify email appearance in different email clients
- Test responsive design on mobile email apps
- Verify branding consistency across templates
- Test user experience flow from dialog to email receipt