# ChemCheck Interface System

## Direction and feel

ChemCheck is a mobile-first field-operations workbench for pool service teams. Interfaces should feel calm, fast, and trustworthy in bright outdoor conditions: clear enough to scan between stops, compact enough to keep the next action above the fold, and specific to pool-service work rather than generic SaaS.

Use the existing pool-water cyan, deep ink, plaster-white surfaces, equipment slate, and semantic water-condition ramp. Color communicates action or status; it is not decoration.

## Depth and spacing

- Depth strategy: approachable surfaces with one quiet `shadow-card` lift and low-contrast `border-line` edges. Nested data rails are inset with `bg-surface-2` and no additional shadow.
- Radius scale: use the existing concentric `chip` (8px), `control` (12px), `card` (16px), `raised` (20px), and `sheet` (24px) tokens.
- Spacing base: 4px. Typical mobile card padding is 16px; compact rails use 8–12px; section gaps use 16–20px.
- Repeated field actions should remain at least 44px tall. Non-interactive status rails may be 32–40px tall.

## Hierarchy

- Type scale: caption 10–11px, metadata 12px, body 14–16px, section title 18–20px, page title 24–30px.
- Weight and contrast lead before size. Primary task/title uses ink and 600 weight; identity uses 16px/600 secondary ink; metadata uses 11–12px muted ink.
- Dynamic figures and timers use the data font and tabular numbers.
- One focal action per screen. Supporting controls and metadata should not compete with the primary task.

## Saved component patterns

### Connected metric strip

- One shared bordered surface with internal dividers; never one raised card per metric.
- Standard cell height: 56px. Number: 20px/600 data font. Label: 11px/600 muted. Icon: 16px semantic tone.
- Remain one row with three or four columns on mobile; expose complete accessible labels for each metric.

### Field workspace header

- Use a compact 48px utility rail for Back and live save/status information.
- The identity block uses a quiet pool-operations icon, 11px tracked eyebrow, 24px/600 page title, and 16px/600 client identity.
- Autosave status uses a 32px semantic pill with a concise visible label and a fuller accessible label.
- Keep context inside the shared sheet; avoid large tinted hero banners or loose metadata stacks.

### Prior-service chemistry context

- Place beneath the active service identity as a single inset rail.
- Show exact prior-week date and four core readings: pH, chlorine, alkalinity, and CYA.
- Prefer recorded numeric values with units; fall back to Good/Low/High/Critical status.
- Use the shared chemistry status ramp. When no prior-week record exists, show one compact truthful empty row and never fabricate readings.
- Data access must use the compound customer/date index and a one-record limit.
