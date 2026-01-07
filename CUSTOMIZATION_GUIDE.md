# Report Customization - Visual Guide

## The Settings Panel

When you click "Report Settings" on a customer's page, you'll see this dialog:

```
┌─────────────────────────────────────────────────────┐
│ ⚙️  Report Settings                                 │
├─────────────────────────────────────────────────────┤
│                                                     │
│ Customize what John Doe sees on their reports      │
│                                                     │
│ ℹ️  These settings apply to all reports sent to    │
│    this customer.                                  │
│                                                     │
│ ┌─────────────────────────────────────────────────┐│
│ │ ☑ Overall Pool Status                           ││
│ │   Show "All Good" or "Needs Attention" badge    ││
│ └─────────────────────────────────────────────────┘│
│                                                     │
│ ┌─────────────────────────────────────────────────┐│
│ │ ☑ Chemical Readings                             ││
│ │   Show pH, Chlorine, Alkalinity, Stabilizer...  ││
│ └─────────────────────────────────────────────────┘│
│                                                     │
│ ┌─────────────────────────────────────────────────┐│
│ │ ☑ Before/After Photos                           ││
│ │   Show photos taken during the service          ││
│ └─────────────────────────────────────────────────┘│
│                                                     │
│ ┌─────────────────────────────────────────────────┐│
│ │ ☑ Service Notes                                 ││
│ │   Show technician notes and observations        ││
│ └─────────────────────────────────────────────────┘│
│                                                     │
│ ┌─────────────────────────────────────────────────┐│
│ │ ☑ Technician Name                               ││
│ │   Show who performed the service                ││
│ └─────────────────────────────────────────────────┘│
│                                                     │
│ ┌─────────────────────────────────────────────────┐│
│ │ ☑ Service Duration                              ││
│ │   Show how long the service took                ││
│ └─────────────────────────────────────────────────┘│
│                                                     │
│ ┌──────────────┬──────────────┬──────────────────┐ │
│ │ Reset Default│   Show All   │    Hide All      │ │
│ └──────────────┴──────────────┴──────────────────┘ │
│                                                     │
│              [Cancel]  [Save Settings]             │
└─────────────────────────────────────────────────────┘
```

## Step-by-Step Example

### Scenario: Commercial Property
You want to show only chemical readings and status, hide everything else.

**Step 1: Open Settings**
```
Customer: Acme Corp Pool
[Report Settings] ← Click here
```

**Step 2: Uncheck Unnecessary Items**
```
☑ Overall Pool Status      ← Keep checked
☑ Chemical Readings        ← Keep checked
☐ Before/After Photos      ← Uncheck
☐ Service Notes            ← Uncheck
☐ Technician Name          ← Uncheck
☐ Service Duration         ← Uncheck
```

**Step 3: Save**
```
[Cancel]  [Save Settings] ← Click here
```

**Step 4: Confirmation**
```
✓ Settings saved successfully!
```

**Result**: Next report sent to this customer will only show status and chemical readings.

---

## Quick Actions

### Reset to Default
Quickly enable all sections:
```
[Reset Default] → All checkboxes become checked
```

### Show All
Enable everything:
```
[Show All] → All checkboxes become checked
```

### Hide All
Disable everything:
```
[Hide All] → All checkboxes become unchecked
```

---

## What Customer Sees - Before vs After

### Before Customization (All Enabled)
```
┌──────────────────────────────────┐
│ Service Report                   │
│ for Acme Corp                    │
│                                  │
│              ✓ All Good          │
│                                  │
│ 📅 Dec 21, 2025                  │
│ 👤 Mike (Technician)             │
│ ⏱️  45 min                        │
│                                  │
│ 💧 Chemical Readings             │
│ pH: Good, Chlorine: Good, ...    │
│                                  │
│ 📝 Service Notes                 │
│ Pool water is crystal clear...   │
│                                  │
│ 📸 Service Photos                │
│ [Before] [After]                 │
└──────────────────────────────────┘
```

### After Customization (Minimal)
```
┌──────────────────────────────────┐
│ Service Report                   │
│ for Acme Corp                    │
│                                  │
│              ✓ All Good          │
│                                  │
│ 💧 Chemical Readings             │
│ pH: Good, Chlorine: Good, ...    │
└──────────────────────────────────┘
```

---

## Common Configurations

### 1. Residential Customer (Full Transparency)
```
☑ Overall Pool Status
☑ Chemical Readings
☑ Before/After Photos
☑ Service Notes
☑ Technician Name
☑ Service Duration
```
**Result**: Complete report with all details

### 2. Commercial/HOA (Professional)
```
☑ Overall Pool Status
☑ Chemical Readings
☑ Before/After Photos
☑ Service Notes
☑ Technician Name
☐ Service Duration
```
**Result**: Detailed report without timing info

### 3. Compliance Only (Minimal)
```
☑ Overall Pool Status
☑ Chemical Readings
☐ Before/After Photos
☐ Service Notes
☐ Technician Name
☐ Service Duration
```
**Result**: Just status and chemical readings

### 4. Status Only (Minimal)
```
☑ Overall Pool Status
☐ Chemical Readings
☐ Before/After Photos
☐ Service Notes
☐ Technician Name
☐ Service Duration
```
**Result**: Just the overall status badge

---

## Mobile View

On mobile, the settings panel adapts:

```
┌──────────────────────────┐
│ ⚙️  Report Settings      │
├──────────────────────────┤
│                          │
│ Customize what John Doe  │
│ sees on their reports    │
│                          │
│ ℹ️  These settings apply │
│    to all reports sent   │
│    to this customer.     │
│                          │
│ ┌────────────────────┐   │
│ │ ☑ Overall Status   │   │
│ │   Show badge       │   │
│ └────────────────────┘   │
│                          │
│ ┌────────────────────┐   │
│ │ ☑ Chemical Readings│   │
│ │   Show readings    │   │
│ └────────────────────┘   │
│                          │
│ ┌────────────────────┐   │
│ │ ☑ Photos           │   │
│ │   Show photos      │   │
│ └────────────────────┘   │
│                          │
│ ┌────────────────────┐   │
│ │ ☑ Service Notes    │   │
│ │   Show notes       │   │
│ └────────────────────┘   │
│                          │
│ ┌────────────────────┐   │
│ │ ☑ Technician Name  │   │
│ │   Show name        │   │
│ └────────────────────┘   │
│                          │
│ ┌────────────────────┐   │
│ │ ☑ Service Duration │   │
│ │   Show duration    │   │
│ └────────────────────┘   │
│                          │
│ [Reset] [Show] [Hide]    │
│                          │
│ [Cancel] [Save Settings] │
└──────────────────────────┘
```

---

## Error Handling

### Save Failed
```
┌─────────────────────────────────┐
│ ⚠️  Failed to save settings      │
│                                 │
│ [Cancel]  [Save Settings]       │
└─────────────────────────────────┘
```
**Solution**: Check internet connection and try again

### Saving
```
┌─────────────────────────────────┐
│ ⏳ Saving...                     │
│                                 │
│ [Cancel] (disabled)             │
│ [Save Settings] (disabled)      │
└─────────────────────────────────┘
```
**Wait**: Settings are being saved

### Success
```
┌─────────────────────────────────┐
│ ✓ Settings saved successfully!  │
│                                 │
│ (Dialog closes in 1.5 seconds)  │
└─────────────────────────────────┘
```
**Done**: Settings are now active

---

## Tips & Tricks

### Tip 1: Use Quick Actions
Instead of manually checking/unchecking, use:
- **Show All** to enable everything
- **Hide All** to disable everything
- **Reset Default** to go back to defaults

### Tip 2: Test Before Sending
After changing settings, send a test report to yourself to see how it looks.

### Tip 3: Document Your Choices
Keep notes on why you chose certain settings for each customer type.

### Tip 4: Review Periodically
Check settings quarterly to ensure they still match customer needs.

### Tip 5: Ask Customers
When onboarding, ask what information they want to see on reports.

---

## Keyboard Shortcuts

- **Tab**: Navigate between checkboxes
- **Space**: Toggle checkbox
- **Enter**: Save settings
- **Esc**: Close dialog

---

## Accessibility

The settings panel is fully accessible:
- ✅ Keyboard navigable
- ✅ Screen reader compatible
- ✅ High contrast mode supported
- ✅ Touch-friendly on mobile
- ✅ Clear labels and descriptions

---

## Troubleshooting

### Settings Not Saving
1. Check internet connection
2. Try again
3. Check browser console for errors
4. Contact support if issue persists

### Settings Not Applied
1. Refresh the page
2. Send a new report
3. Check that settings were saved
4. Verify customer ID is correct

### Can't Find Settings Button
1. Make sure you're on customer detail page
2. Look for gear icon (⚙️) or "Report Settings" button
3. Scroll down if needed
4. Check that you have permission to edit customer

---

## Summary

Report customization is simple:
1. **Open** customer detail page
2. **Click** "Report Settings"
3. **Toggle** sections on/off
4. **Save** settings
5. **Done** - applies to all future reports

Each customer can have different settings, giving you complete control over what they see!
