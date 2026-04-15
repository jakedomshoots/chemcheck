# Report Settings Button - Visual Location

## Desktop View

```
┌─────────────────────────────────────────────────────────────────┐
│ ← Back                                                          │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  John Doe                                                       │
│  📍 123 Main St, Anytown, USA                                   │
│                                                                 │
│                                    [Analysis] [⚙️ Report Settings] [+ Log]
│                                                                 │
│  📱 (555) 123-4567                                              │
│  ✉️  john@example.com                                           │
│                                                                 │
│  Service Day: Monday                                            │
│  Pool Type: Salt                                                │
│  Surface: Plaster                                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                                    ↑
                            Click this button
```

## Mobile View

```
┌──────────────────────────────────┐
│ ← Back                           │
└──────────────────────────────────┘

┌──────────────────────────────────┐
│                                  │
│  John Doe                        │
│  📍 123 Main St, Anytown, USA    │
│                                  │
│  ┌────────────────────────────┐  │
│  │ [Analysis]                 │  │
│  └────────────────────────────┘  │
│                                  │
│  ┌────────────────────────────┐  │
│  │ [⚙️ Report Settings]        │  │
│  └────────────────────────────┘  │
│           ↑                       │
│    Click this button              │
│                                  │
│  ┌────────────────────────────┐  │
│  │ [+ Log]                    │  │
│  └────────────────────────────┘  │
│                                  │
│  📱 (555) 123-4567               │
│  ✉️  john@example.com            │
│                                  │
└──────────────────────────────────┘
```

## Button Details

### Button Appearance
```
┌──────────────────────────┐
│ ⚙️  Report Settings      │
└──────────────────────────┘
```

- **Icon**: Gear/Settings symbol
- **Text**: "Report Settings"
- **Style**: Gray outline button
- **Size**: Small (sm)
- **Hover**: Light gray background

### Button States

**Normal State**
```
┌──────────────────────────┐
│ ⚙️  Report Settings      │
└──────────────────────────┘
```

**Hover State**
```
┌──────────────────────────┐
│ ⚙️  Report Settings      │  ← Light gray background
└──────────────────────────┘
```

**Disabled State** (if customer has no name)
```
┌──────────────────────────┐
│ ⚙️  Report Settings      │  ← Grayed out
└──────────────────────────┘
```

## Step-by-Step Navigation

### Step 1: Open Clients Page
```
Left Sidebar
├── Home
├── Clients ← Click here
├── History
├── Report
├── Notes
├── Chemicals
├── Pool School
└── Settings
```

### Step 2: Select a Customer
```
Clients List
├── John Doe ← Click here
├── Jane Smith
├── Acme Corp
└── ...
```

### Step 3: Find Report Settings Button
```
Customer Detail Page
┌─────────────────────────────────────────────────────┐
│ Customer Name                                       │
│ Address                                             │
│                                                     │
│                    [Analysis] [⚙️ Report Settings] [+ Log]
│                                                     │
└─────────────────────────────────────────────────────┘
                                    ↑
                            Click this button
```

### Step 4: Settings Dialog Opens
```
┌─────────────────────────────────────────────────────┐
│ ⚙️  Report Settings                                 │
├─────────────────────────────────────────────────────┤
│                                                     │
│ Customize what John Doe sees on their reports      │
│                                                     │
│ ☑ Overall Pool Status                              │
│ ☑ Chemical Readings                                │
│ ☑ Before/After Photos                              │
│ ☑ Service Notes                                    │
│ ☑ Technician Name                                  │
│ ☑ Service Duration                                 │
│                                                     │
│              [Cancel]  [Save Settings]             │
└─────────────────────────────────────────────────────┘
```

## Button Comparison

### All Three Buttons in Customer Card

```
┌─────────────────────────────────────────────────────┐
│ Customer Name                                       │
│ Address                                             │
│                                                     │
│  [Analysis]        [⚙️ Report Settings]    [+ Log]  │
│  (purple outline)  (gray outline)         (blue)   │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Analysis Button**
- Purple outline
- Shows pool analysis
- Only visible if 3+ service logs

**Report Settings Button** ← This one!
- Gray outline
- Customize report visibility
- Always visible

**Log Button**
- Blue gradient
- Create new service log
- Always visible

## Accessibility

The button is:
- ✅ Keyboard accessible (Tab to navigate)
- ✅ Screen reader compatible
- ✅ Touch-friendly on mobile
- ✅ Has tooltip on hover

## If You Still Can't Find It

1. **Check you're on the right page**
   - URL should contain customer ID
   - Example: `/customer?id=123`

2. **Look for the gear icon**
   - Even if text is cut off, look for ⚙️ symbol

3. **Check responsive design**
   - On very small screens, buttons may wrap
   - Scroll right if needed

4. **Verify JavaScript is enabled**
   - Press F12 to open developer tools
   - Check Console tab for errors

5. **Try a different browser**
   - Chrome, Firefox, Safari all supported

## Quick Reference

| Item | Location |
|------|----------|
| Button | Top right of customer card |
| Icon | Gear symbol (⚙️) |
| Text | "Report Settings" |
| Color | Gray outline |
| Position | Between "Analysis" and "Log" buttons |

---

**TL;DR**: Go to Clients → Click a customer → Look top right of the card → Click the gear icon button that says "Report Settings"
