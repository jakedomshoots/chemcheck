# Report Customization Feature

## Overview

You can now customize exactly what information each customer sees on their service reports. Control visibility of chemical readings, photos, notes, technician info, and more on a per-customer basis.

## What Can Be Customized

For each customer, you can toggle:

### ✅ Overall Pool Status
- Shows "All Good" or "Needs Attention" badge
- Gives customer quick overview of pool condition

### ✅ Chemical Readings
- pH Level
- Chlorine
- Alkalinity
- Stabilizer
- Salt (if applicable)
- Useful for customers who want to track chemical levels

### ✅ Before/After Photos
- Photos taken during service
- Proof of work completed
- Great for documentation

### ✅ Service Notes
- Technician observations and recommendations
- Any issues found or recommendations
- Helpful context for customers

### ✅ Technician Name
- Who performed the service
- Builds trust and accountability

### ✅ Service Duration
- How long the service took
- Shows value of work performed

## How to Use

### 1. Open Customer Settings

On the customer detail page, look for a "Report Settings" button or gear icon.

### 2. Toggle What to Show

```
☑ Overall Pool Status
☑ Chemical Readings
☑ Before/After Photos
☑ Service Notes
☑ Technician Name
☑ Service Duration
```

Check or uncheck each item based on what you want the customer to see.

### 3. Quick Actions

- **Reset to Default**: Show everything (all checked)
- **Show All**: Enable all settings
- **Hide All**: Disable all settings

### 4. Save Settings

Click "Save Settings" to apply changes. These settings apply to all reports sent to this customer.

## Use Cases

### Case 1: Residential Customer (Show Everything)
```
✓ Overall Pool Status
✓ Chemical Readings
✓ Before/After Photos
✓ Service Notes
✓ Technician Name
✓ Service Duration
```
**Why**: Residential customers want full transparency and proof of work.

### Case 2: Commercial Property (Minimal Info)
```
✓ Overall Pool Status
✓ Chemical Readings
✗ Before/After Photos
✗ Service Notes
✗ Technician Name
✗ Service Duration
```
**Why**: Commercial properties just need chemical readings for compliance.

### Case 3: HOA/Community Pool (Professional)
```
✓ Overall Pool Status
✓ Chemical Readings
✓ Before/After Photos
✓ Service Notes
✓ Technician Name
✗ Service Duration
```
**Why**: HOA wants detailed documentation but not duration info.

### Case 4: Minimal Report (Status Only)
```
✓ Overall Pool Status
✗ Chemical Readings
✗ Before/After Photos
✗ Service Notes
✗ Technician Name
✗ Service Duration
```
**Why**: Quick confirmation that service was completed.

## Database Schema

Settings are stored in the customer record:

```typescript
customers: {
  // ... other fields
  report_settings: {
    show_chemical_readings: boolean,
    show_photos: boolean,
    show_service_notes: boolean,
    show_technician_name: boolean,
    show_service_duration: boolean,
    show_overall_status: boolean,
  }
}
```

## API Usage

### Update Customer Settings

```typescript
import { useMutation } from 'convex/react';
import { api } from '../convex/_generated/api';

const updateCustomer = useMutation(api.customers.update);

// Update report settings
await updateCustomer({
  id: customerId,
  report_settings: {
    show_chemical_readings: true,
    show_photos: true,
    show_service_notes: false,
    show_technician_name: true,
    show_service_duration: false,
    show_overall_status: true,
  }
});
```

### Get Customer Settings

```typescript
const customer = await getCustomer(customerId);
const settings = customer.report_settings;

// Use in report display
if (settings?.show_chemical_readings) {
  // Show chemical readings
}
```

## Component Usage

### In Customer Detail Page

```typescript
import { ReportSettingsPanel } from '@/components/service-reports/ReportSettingsPanel';
import { useMutation } from 'convex/react';
import { api } from '../convex/_generated/api';

function CustomerDetail() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const updateCustomer = useMutation(api.customers.update);

  const handleSaveSettings = async (settings) => {
    await updateCustomer({
      id: customer._id,
      report_settings: settings,
    });
  };

  return (
    <>
      <button onClick={() => setSettingsOpen(true)}>
        Report Settings
      </button>

      <ReportSettingsPanel
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSave={handleSaveSettings}
        currentSettings={customer.report_settings}
        customerName={customer.full_name}
      />
    </>
  );
}
```

## Report Page Implementation

The ReportPage automatically respects customer settings:

```typescript
// Show section only if setting is enabled
{report.settings?.show_chemical_readings !== false && (
  <Card>
    <CardHeader>
      <CardTitle>Chemical Readings</CardTitle>
    </CardHeader>
    <CardContent>
      {/* Chemical readings */}
    </CardContent>
  </Card>
)}
```

## Default Behavior

If no settings are configured for a customer, all sections are shown by default:

```typescript
const settings = customer.report_settings || {
  show_chemical_readings: true,
  show_photos: true,
  show_service_notes: true,
  show_technician_name: true,
  show_service_duration: true,
  show_overall_status: true,
};
```

## What Customers See

### With All Settings Enabled
```
┌─────────────────────────────────┐
│ Service Report                  │
│ for John Doe                    │
│                                 │
│              ✓ All Good         │
│                                 │
│ 📅 Sunday, December 21, 2025    │
│ 👤 Mike (Technician)            │
│ ⏱️  45 min                       │
│                                 │
│ 💧 Chemical Readings            │
│ pH: Good, Chlorine: Good, ...   │
│                                 │
│ 📝 Service Notes                │
│ Pool water is crystal clear...  │
│                                 │
│ 📸 Service Photos               │
│ [Before photos] [After photos]  │
└─────────────────────────────────┘
```

### With Minimal Settings
```
┌─────────────────────────────────┐
│ Service Report                  │
│ for John Doe                    │
│                                 │
│              ✓ All Good         │
└─────────────────────────────────┘
```

## Benefits

### For You
- ✅ Control what information is shared
- ✅ Customize per customer
- ✅ Professional appearance
- ✅ Reduce information overload
- ✅ Comply with customer preferences

### For Customers
- ✅ See only relevant information
- ✅ Cleaner, less cluttered reports
- ✅ Faster to review
- ✅ Focus on what matters to them

## Best Practices

1. **Ask customers their preference** - Some may want full details, others minimal
2. **Use consistent settings** - Keep similar customers on same settings
3. **Document your choices** - Remember why you chose certain settings
4. **Review periodically** - Update if customer needs change
5. **Test before sending** - Preview how report looks with settings

## Troubleshooting

### Settings Not Saving
- Check network connection
- Verify customer ID is correct
- Check browser console for errors

### Settings Not Applied to Report
- Refresh the page
- Check that settings were actually saved
- Verify customer has report_settings field

### All Sections Hidden
- Use "Show All" button to quickly enable everything
- Or manually check desired sections

## Migration

If you have existing customers without settings:
- They'll see all sections by default
- Settings are optional
- No action needed - backward compatible

## Future Enhancements

Potential additions:
- 🎨 Custom branding per customer
- 📧 Email template customization
- 🔔 Notification preferences
- 📊 Analytics dashboard
- 🌐 Multi-language support
- 🎯 Conditional visibility (show only if issues found)

## Summary

Report customization gives you fine-grained control over what each customer sees on their service reports. Toggle sections on/off per customer to create the perfect report for their needs.

**Key Features:**
- ✅ Per-customer settings
- ✅ 6 customizable sections
- ✅ Quick action buttons
- ✅ Backward compatible
- ✅ Easy to use UI
- ✅ Persistent storage

**Get Started:**
1. Open customer detail page
2. Click "Report Settings"
3. Toggle sections on/off
4. Click "Save Settings"
5. Done! Settings apply to all future reports
