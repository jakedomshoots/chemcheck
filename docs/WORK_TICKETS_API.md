# Work tickets: design and API contract

The Work Orders page is replaced by one simple object, the **ticket**: a
customer, what the work was for, line items, photos and a status. Tickets
live in ChemCheck and are mirrored live into the business's connected Square
account as real Square invoices. Recurring billing is a **billing schedule**
that creates a ticket (and Square invoice) every week or month.

Clickable prototype: https://claude.ai/artifact/AFqiDfLkSYBkPYAUVbrGT6

## Lifecycle

```
kind "charge":  draft ─send→ requested ─paid (Square webhook / in person)→ paid
                                   └─cancel→ canceled
kind "quote":   draft ─send→ quote ─approve→ requested → paid
                                └─decline→ canceled
paid in person: created directly as paid (cash / check / other)
```

`overdue` is derived: `status === "requested"` and the Square due date has
passed.

## Square mirroring (seller's OAuth token, never the platform's)

| ChemCheck | Square |
|---|---|
| customer | Customer (search by email, then phone; create if missing). `customers.square_customer_id` stores the link. |
| send charge / approve quote | Order (line items) → Invoice (`BALANCE`, due today + business net days, default 7) → Publish. Delivery: `EMAIL` when the customer has an email, else `SMS` when they have a phone, else `SHARE_MANUALLY`. `store_payment_method_enabled: true` so customers can save a card. |
| autopay (schedules) | `automatic_payment_source: "CARD_ON_FILE"` + the customer's card id when one exists; otherwise a normal invoice. |
| cancel | `POST /v2/invoices/{id}/cancel` |
| paid in person | Order paid with an `EXTERNAL`/`CASH` payment (no invoice), so it shows in Square sales. |
| quote | Kept in ChemCheck; sent with the existing communications channel. Becomes a Square invoice on approval. |
| status back-sync | Square webhooks `invoice.payment_made`, `invoice.updated`, `invoice.canceled`, `invoice.refunded` (merchant must match). |

Required seller OAuth scopes (added to the existing Square connect):
`CUSTOMERS_READ CUSTOMERS_WRITE INVOICES_READ INVOICES_WRITE ORDERS_READ
ORDERS_WRITE PAYMENTS_READ PAYMENTS_WRITE MERCHANT_PROFILE_READ`.
Businesses connected before this change see "Reconnect Square".

## Convex API (frontend builds against exactly this)

Money is in **dollars** (numbers) at the API boundary. All functions require
auth and scope to the caller's business via `convex/access.ts`.

### `convex/tickets.ts`

```ts
type TicketItem = { label: string; amount: number };
type TimelineEvent = { type: string; text: string; at: number };
type TicketView = {
  _id: Id<"tickets">;
  customer_id: Id<"customers">;
  customer_name: string;
  kind: "charge" | "quote";
  status: "draft" | "quote" | "requested" | "paid" | "canceled";
  overdue: boolean;
  note: string;
  items: TicketItem[];
  total: number;
  photo_urls: string[];
  paid_method?: "square" | "cash" | "check" | "other";
  square_invoice_number?: string;
  square_invoice_url?: string;       // Square public invoice URL
  schedule_id?: Id<"billingSchedules">;
  timeline: TimelineEvent[];         // oldest first
  created_at: number;
  updated_at: number;
};
```

- `query list({ filter?: "all" | "open" | "quote" | "paid" })` → `TicketView[]` newest first. `open` = draft + requested.
- `query get({ id })` → `TicketView | null`
- `query summary()` → `{ outstanding: number; open_requests: number; paid_this_week: number; recurring_active: number; recurring_next_total: number; recurring_next_run_at: number | null; square: { connected: boolean; needs_reconnect: boolean } }`
- `mutation generatePhotoUploadUrl()` → `string` (Convex storage upload URL)
- `mutation saveDraft({ id?, customer_id, kind, note, items, photo_storage_ids? })` → `Id<"tickets">`
- `action send({ id?, customer_id, kind, note, items, photo_storage_ids? })` → `{ id, status, square_invoice_number?, delivered_via: "email" | "sms" | "link" }`
  Charge → Square invoice published, status `requested`. Quote → status `quote`, sent via communications.
- `action recordPaidInPerson({ id?, customer_id, note, items, photo_storage_ids?, method: "cash" | "check" | "other" })` → `{ id }`
- `action markPaid({ id, method: "cash" | "check" | "other" })` → `{ id }` (a `requested` ticket settled outside Square)
- `action remind({ id })` → `{ ok: true }` (Square re-send / reminder)
- `action approveQuote({ id })` → `{ id, square_invoice_number }`
- `mutation declineQuote({ id })`
- `action cancel({ id })` (cancels the Square invoice when there is one)
- `mutation deleteDraft({ id })`

Errors are thrown as `Error` with a user-readable message (e.g. "Connect your
Square account in Settings to send invoices.").

### `convex/billingSchedules.ts`

```ts
type ScheduleView = {
  _id: Id<"billingSchedules">;
  customer_id: Id<"customers">;
  customer_name: string;
  cadence: "weekly" | "monthly";     // weekly = Mondays, monthly = the 1st (business timezone)
  bill_mode: "fixed" | "visits";     // visits = completed service visits in the period × rate + priced extra chemicals
  rate: number;                      // fixed: amount per period; visits: amount per visit
  items: TicketItem[];               // fixed mode line items (sum = rate)
  note: string;
  autopay: boolean;
  card_label?: string;               // e.g. "Visa •• 4242" when Square has a card on file
  paused: boolean;
  next_run_at: number | null;
  preview: { period_label: string; items: TicketItem[]; total: number; unpriced_chemicals: string[] };
  history: { ticket_id: Id<"tickets">; period_label: string; total: number; status: string; square_invoice_number?: string }[];
  last_error?: string;
};
```

- `query list()` → `ScheduleView[]`
- `query get({ id })` → `ScheduleView | null`
- `mutation create({ customer_id, cadence, bill_mode, rate, items, note, autopay })` → `Id<"billingSchedules">`
- `mutation update({ id, ...same fields optional })`
- `mutation setPaused({ id, paused })`
- `mutation remove({ id })`
- `action billNow({ id })` → `{ ticket_id, status, square_invoice_number? }`
- `action customerCard({ customer_id })` → `{ card_label: string | null }` (reads Square cards on file)

A cron creates due schedule runs (idempotent per schedule + period), then
advances `next_run_at`. Failures set `last_error` and do not advance.

### Chemical prices (for "visits" billing)

- `query chemicalPrices.list()` → `{ chemical_type: string; unit: string; price: number }[]`
- `mutation chemicalPrices.set({ prices })` (owner/admin)

Extra chemicals come from `chemicalUsage` rows in the period with a numeric
`quantity`; types without a price are listed in `preview.unpriced_chemicals`
and billed at $0.

## Legacy data

`workOrders`, `quotes` and `invoices` stay in the schema. An internal
migration `tickets:migrateLegacy` copies existing invoices and quotes into
tickets (keeping status, totals, line items and payment state) so history is
not lost. The old Work Orders page and its client code are removed.
