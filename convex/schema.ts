import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { stripScanAnalysisVersionValidator, stripScanPadConfidenceValidator, stripScanQualityValidator } from "./lsiValidators";

export default defineSchema({
  customers: defineTable({
    full_name: v.string(),
    address: v.string(),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    gate_code: v.optional(v.string()),
    service_day: v.string(), // Monday, Tuesday, etc.
    pool_gallons: v.optional(v.number()),
    pool_type: v.string(), // Salt or Chlorine
    surface_type: v.string(), // Plaster, Vinyl, Fiberglass, Tile
    sort_order: v.optional(v.number()),
    created_by: v.string(), // User email
    business_id: v.optional(v.string()), // For multi-tenant support
    // Linked Square Customer on the business's connected seller account
    // (work tickets). Only reused while square_merchant_id matches the connection.
    square_customer_id: v.optional(v.string()),
    square_merchant_id: v.optional(v.string()),
    created_at: v.optional(v.number()), // Timestamp for sync
    updated_at: v.optional(v.number()), // Timestamp for sync
    // Report customization settings
    report_settings: v.optional(v.object({
      show_chemical_readings: v.boolean(), // Show pH, Chlorine, etc.
      show_photos: v.boolean(),            // Show before/after photos
      show_service_notes: v.boolean(),     // Show technician notes
      show_technician_name: v.boolean(),   // Show who performed service
      show_service_duration: v.boolean(),  // Show how long service took
      show_overall_status: v.boolean(),    // Show All Good / Needs Attention
    })),
  })
    .index("by_created_by", ["created_by"])
    .index("by_service_day", ["service_day"])
    .index("by_business", ["business_id"])
    .index("by_business_and_day", ["business_id", "service_day"])
    .index("by_created_by_and_service_day", ["created_by", "service_day"]),

  // A customer may own more than one pool. Legacy pool_* fields on customers
  // remain during the migration window; new writes should target this table.
  pools: defineTable({
    customer_id: v.id("customers"),
    business_id: v.optional(v.string()),
    name: v.string(),
    address: v.optional(v.string()),
    service_day: v.string(),
    pool_gallons: v.optional(v.number()),
    pool_type: v.string(),
    surface_type: v.string(),
    sort_order: v.optional(v.number()),
    notes: v.optional(v.string()),
    active: v.boolean(),
    created_at: v.number(),
    updated_at: v.number(),
  })
    .index("by_customer", ["customer_id"])
    .index("by_business", ["business_id"])
    .index("by_business_and_day", ["business_id", "service_day"])
    .index("by_customer_and_active", ["customer_id", "active"]),

  // Equipment is attached to a pool, not a customer, so multi-pool accounts
  // can track independent pumps, filters, heaters, salt cells, and controllers.
  equipment: defineTable({
    customer_id: v.id("customers"),
    pool_id: v.id("pools"),
    business_id: v.optional(v.string()),
    equipment_type: v.string(),
    name: v.string(),
    brand: v.optional(v.string()),
    model: v.optional(v.string()),
    serial_number: v.optional(v.string()),
    install_date: v.optional(v.string()),
    status: v.string(), // active, needs_service, retired
    last_service_date: v.optional(v.string()),
    next_service_due: v.optional(v.string()),
    notes: v.optional(v.string()),
    created_at: v.number(),
    updated_at: v.number(),
  })
    .index("by_pool", ["pool_id"])
    .index("by_customer", ["customer_id"])
    .index("by_business", ["business_id"])
    .index("by_pool_and_status", ["pool_id", "status"]),

  serviceLogs: defineTable({
    customer_id: v.id("customers"),
    pool_id: v.optional(v.id("pools")),
    created_by: v.optional(v.string()), // User email for tenant isolation (optional during backfill)
    service_date: v.string(), // YYYY-MM-DD format
    status: v.string(), // completed, pending, etc.
    service_type: v.optional(v.string()), // e.g. Regular Cleaning, Chemical Balance, etc.
    notes: v.optional(v.string()),
    ph: v.string(), // good, low, high
    chlorine: v.string(), // good, low, high
    alkalinity: v.string(), // good, low, high
    stabilizer: v.string(), // good, low, high
    salt: v.optional(v.number()), // Only for salt pools
    ph_value: v.optional(v.number()),
    chlorine_value: v.optional(v.number()),
    total_chlorine_value: v.optional(v.number()),
    total_bromine_value: v.optional(v.number()),
    // Legacy scan audit fields remain optional so existing logs stay valid.
    // Current product flows create measured LSI data only.
    strip_scan_method: v.optional(v.literal("aquachek_select_photo")),
    strip_scan_confidence: v.optional(v.union(v.literal("low"), v.literal("medium"), v.literal("high"))),
    strip_scan_analysis_version: v.optional(stripScanAnalysisVersionValidator),
    strip_scan_pad_confidence: v.optional(stripScanPadConfidenceValidator),
    strip_scan_quality: v.optional(stripScanQualityValidator),
    lsi_calculation_version: v.optional(v.union(v.literal("aquachek-epa-v1"), v.literal("lsi-v1"))),
    alkalinity_value: v.optional(v.number()),
    stabilizer_value: v.optional(v.number()),
    hardness_value: v.optional(v.number()),
    hardness_source: v.optional(v.union(v.literal("aquachek_total"), v.literal("calcium"))),
    water_temperature: v.optional(v.number()), // Fahrenheit
    water_temperature_source: v.optional(v.union(v.literal("measured"), v.literal("assumed"))),
    tds_value: v.optional(v.number()),
    tds_source: v.optional(v.union(v.literal("measured"), v.literal("assumed"))),
    created_at: v.optional(v.number()), // Timestamp for sync
    updated_at: v.optional(v.number()), // Timestamp for sync
    // Proof-of-service time tracking fields
    start_time: v.optional(v.string()), // ISO 8601 UTC
    end_time: v.optional(v.string()), // ISO 8601 UTC
    duration_ms: v.optional(v.number()), // Calculated duration in milliseconds
    // Proof-of-service photo tracking fields
    photo_count: v.optional(v.number()), // Count of attached photos
    has_before_photos: v.optional(v.boolean()),
    has_after_photos: v.optional(v.boolean()),
  })
    .index("by_customer", ["customer_id"])
    .index("by_created_by", ["created_by"])
    .index("by_service_date", ["service_date"])
    .index("by_customer_and_date", ["customer_id", "service_date"])
    .index("by_created_by_and_service_date", ["created_by", "service_date"])
    // Incremental offline-sync pulls: tenant email + updated_at watermark.
    .index("by_created_by_and_updated_at", ["created_by", "updated_at"]),

  chemicalUsage: defineTable({
    customer_id: v.id("customers"),
    pool_id: v.optional(v.id("pools")),
    created_by: v.optional(v.string()), // User email for tenant isolation (optional during backfill)
    chemical_type: v.string(),
    quantity: v.string(),
    notes: v.optional(v.string()),
    created_date: v.optional(v.string()),
    created_at: v.optional(v.number()), // Timestamp for sync
    updated_at: v.optional(v.number()), // Timestamp for sync
  })
    .index("by_customer", ["customer_id"])
    .index("by_created_date", ["created_date"])
    .index("by_created_by", ["created_by"])
    .index("by_created_by_and_created_date", ["created_by", "created_date"])
    .index("by_created_by_and_updated_at", ["created_by", "updated_at"]),

  notes: defineTable({
    title: v.string(),
    content: v.string(),
    category: v.string(), // General, Customer, Equipment, Reminder, Chemical, Billing
    customer_id: v.optional(v.id("customers")),
    pool_id: v.optional(v.id("pools")),
    priority: v.string(), // low, medium, high
    completed: v.optional(v.boolean()),
    created_date: v.optional(v.string()),
    created_at: v.optional(v.number()), // Timestamp for sync
    updated_at: v.optional(v.number()), // Timestamp for sync
    created_by: v.optional(v.string()), // User email for tenant isolation (optional for migration)
  })
    .index("by_customer", ["customer_id"])
    .index("by_completed", ["completed"])
    .index("by_created_date", ["created_date"])
    .index("by_created_by", ["created_by"])
    .index("by_created_by_and_created_date", ["created_by", "created_date"])
    .index("by_created_by_and_customer_id", ["created_by", "customer_id"])
    .index("by_created_by_and_completed", ["created_by", "completed"])
    .index("by_created_by_and_updated_at", ["created_by", "updated_at"]),

  subscriptions: defineTable({
    // Optional while legacy user-scoped subscriptions are backfilled.
    business_id: v.optional(v.id("businesses")),
    user_email: v.string(),
    // Billing provider that owns this subscription ("square"); absent on legacy Stripe rows.
    provider: v.optional(v.string()),
    // legacy, pre-Square: Stripe ids on subscriptions created before the Square migration.
    stripe_customer_id: v.optional(v.string()),
    stripe_subscription_id: v.optional(v.string()),
    // Square subscription (platform merchant). Written only by the Square webhook.
    square_subscription_id: v.optional(v.string()),
    square_customer_id: v.optional(v.string()),
    square_plan_variation_id: v.optional(v.string()),
    square_status: v.optional(v.string()), // raw Square status: ACTIVE, PENDING, PAUSED, CANCELED, DEACTIVATED
    plan_id: v.string(), // starter, professional, business
    status: v.string(), // active, canceled, trialing, past_due, etc.
    current_period_start: v.number(),
    current_period_end: v.number(),
    cancel_at_period_end: v.boolean(),
    trial_end: v.optional(v.number()),
    // Provider event creation time (ms) of the last applied webhook; older events are ignored.
    last_event_created: v.optional(v.number()),
    created_at: v.number(),
    updated_at: v.number(),
  })
    .index("by_business", ["business_id"])
    .index("by_user_email", ["user_email"])
    // legacy, pre-Square
    .index("by_stripe_subscription", ["stripe_subscription_id"])
    .index("by_stripe_customer", ["stripe_customer_id"])
    .index("by_square_subscription", ["square_subscription_id"])
    .index("by_square_customer", ["square_customer_id"]),

  // Square subscription checkouts started by a business owner. Links the Square
  // subscription (created by Square after payment) back to the business.
  squareSubscriptionCheckouts: defineTable({
    business_id: v.id("businesses"),
    user_email: v.string(),
    buyer_email: v.string(),
    plan_id: v.string(),
    interval: v.string(), // month, year
    plan_variation_id: v.string(),
    payment_link_id: v.optional(v.string()),
    order_id: v.optional(v.string()),
    square_customer_id: v.optional(v.string()),
    status: v.string(), // pending, paid, linked
    linked_subscription_id: v.optional(v.string()),
    created_at: v.number(),
    updated_at: v.number(),
    expires_at: v.number(),
  })
    .index("by_business", ["business_id"])
    .index("by_order_id", ["order_id"])
    .index("by_square_customer", ["square_customer_id"])
    .index("by_buyer_email", ["buyer_email"]),

  // Square OAuth connections of pool companies (sellers). SECRET: holds
  // encrypted OAuth tokens. Only internal functions may read this table;
  // no public query returns its documents.
  squareSellerAccounts: defineTable({
    business_id: v.id("businesses"),
    merchant_id: v.string(),
    access_token_enc: v.string(),
    refresh_token_enc: v.string(),
    expires_at: v.number(), // access token expiry (ms)
    location_id: v.optional(v.string()),
    location_name: v.optional(v.string()),
    scopes: v.optional(v.string()),
    connected_by: v.string(),
    last_refresh_error: v.optional(v.string()),
    created_at: v.number(),
    updated_at: v.number(),
  })
    .index("by_business", ["business_id"])
    .index("by_merchant", ["merchant_id"])
    .index("by_expires_at", ["expires_at"]),

  // Single-use OAuth `state` values for the Square connect flow.
  squareOAuthStates: defineTable({
    state: v.string(),
    business_id: v.id("businesses"),
    user_email: v.string(),
    expires_at: v.number(),
    created_at: v.number(),
  })
    .index("by_state", ["state"])
    .index("by_expires_at", ["expires_at"]),

  // Work tickets: one charge or quote for a customer, mirrored into the
  // business's connected Square account as an Order + Invoice. Money in cents.
  tickets: defineTable({
    business_id: v.id("businesses"),
    created_by: v.string(), // tenant email (business owner)
    created_by_user: v.optional(v.string()), // who created it
    customer_id: v.id("customers"),
    kind: v.string(), // charge | quote
    status: v.string(), // draft | quote | requested | paid | canceled
    note: v.string(),
    items: v.array(v.object({ label: v.string(), amount_cents: v.number() })),
    total_cents: v.number(),
    photo_storage_ids: v.array(v.id("_storage")),
    paid_method: v.optional(v.string()), // square | cash | check | other
    paid_at: v.optional(v.number()),
    square_customer_id: v.optional(v.string()),
    square_order_id: v.optional(v.string()),
    square_invoice_id: v.optional(v.string()),
    square_invoice_version: v.optional(v.number()),
    square_invoice_number: v.optional(v.string()),
    square_invoice_url: v.optional(v.string()),
    square_due_date: v.optional(v.string()), // YYYY-MM-DD
    square_attempts: v.optional(v.number()), // send attempts; scopes Square idempotency keys
    square_lock_until: v.optional(v.number()), // a send to Square is in progress until then
    square_payment_id: v.optional(v.string()), // external (cash/check/other) payment
    // Set while markPaid cancels the Square invoice, so the invoice.canceled
    // webhook does not flip the ticket to canceled.
    settling_outside_square: v.optional(v.boolean()),
    schedule_id: v.optional(v.id("billingSchedules")),
    period_key: v.optional(v.string()),
    period_label: v.optional(v.string()),
    legacy_source: v.optional(v.string()), // invoice:<id> | quote:<id>
    timeline: v.array(v.object({ type: v.string(), text: v.string(), at: v.number() })),
    created_at: v.number(),
    updated_at: v.number(),
  })
    .index("by_business_and_updated", ["business_id", "updated_at"])
    .index("by_square_invoice_id", ["square_invoice_id"])
    .index("by_schedule_and_period", ["schedule_id", "period_key"])
    .index("by_customer", ["customer_id"])
    .index("by_business_and_status", ["business_id", "status"])
    .index("by_legacy_source", ["legacy_source"]),

  // Storage files uploaded for ticket photos, claimed by one business so a
  // storage id cannot be attached across tenants.
  ticketPhotoClaims: defineTable({
    storage_id: v.id("_storage"),
    business_id: v.id("businesses"),
    created_at: v.number(),
  })
    .index("by_storage_id", ["storage_id"])
    .index("by_business", ["business_id"]),

  // Recurring billing: creates a ticket + Square invoice each period.
  billingSchedules: defineTable({
    business_id: v.id("businesses"),
    customer_id: v.id("customers"),
    created_by: v.string(), // tenant email
    cadence: v.string(), // weekly | monthly
    bill_mode: v.string(), // fixed | visits
    rate_cents: v.number(),
    items: v.array(v.object({ label: v.string(), amount_cents: v.number() })),
    note: v.string(),
    autopay: v.boolean(),
    card_label: v.optional(v.string()), // cached from Square ("Visa •• 4242")
    paused: v.boolean(),
    next_run_at: v.optional(v.number()),
    last_error: v.optional(v.string()),
    failed_attempts: v.optional(v.number()),
    last_period_key: v.optional(v.string()),
    created_at: v.number(),
    updated_at: v.number(),
  })
    .index("by_business", ["business_id"])
    .index("by_next_run_at", ["next_run_at"])
    .index("by_customer", ["customer_id"]),

  // Per-business prices for extra chemicals billed by "visits" schedules.
  chemicalPrices: defineTable({
    business_id: v.id("businesses"),
    chemical_type: v.string(),
    unit: v.string(),
    price_cents: v.number(),
    updated_at: v.optional(v.number()),
  })
    .index("by_business", ["business_id"]),

  // Service photos for proof-of-service documentation
  servicePhotos: defineTable({
    service_log_id: v.id("serviceLogs"),
    customer_id: v.id("customers"),
    category: v.string(), // 'before' | 'after'
    storage_id: v.id("_storage"), // Convex file storage
    timestamp: v.string(), // ISO 8601 UTC
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    accuracy: v.optional(v.number()), // GPS accuracy in meters
    address: v.optional(v.string()), // Reverse geocoded address
    created_at: v.number(),
  })
    .index("by_service_log", ["service_log_id"])
    .index("by_customer", ["customer_id"])
    .index("by_storage_id", ["storage_id"]),

  // Business/Tenant table for multi-tenancy
  businesses: defineTable({
    name: v.string(),
    address: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    owner_email: v.string(), // Primary owner's email
    settings: v.object({
      working_days: v.array(v.string()),
      working_hours_start: v.string(),
      working_hours_end: v.string(),
      service_types: v.array(v.string()),
      chemical_types: v.array(v.string()),
      route_optimization: v.boolean(),
      require_photos: v.boolean(),
      require_signatures: v.boolean(),
      default_workorders_section: v.optional(v.string()),
      home_primary_action: v.optional(v.string()),
      show_ops_brief: v.optional(v.boolean()),
      // Proof-of-service requirements - Requirements 5.1, 5.3
      proof_of_service: v.optional(v.object({
        require_before_photos: v.boolean(),
        require_after_photos: v.boolean(),
        require_time_tracking: v.boolean(),
        min_photos_before: v.number(), // Minimum number of before photos required
        min_photos_after: v.number(), // Minimum number of after photos required
        // Per-service-type requirements - Requirement 5.3
        service_type_requirements: v.optional(v.array(v.object({
          service_type: v.string(),
          require_before_photos: v.boolean(),
          require_after_photos: v.boolean(),
          require_time_tracking: v.boolean(),
          min_photos_before: v.number(),
          min_photos_after: v.number(),
        }))),
      })),
    }),
    // legacy, pre-Square: Stripe Connect fields. Square seller connections live
    // in the internal-only squareSellerAccounts table.
    stripe_account_id: v.optional(v.string()),
    stripe_charges_enabled: v.optional(v.boolean()),
    stripe_payouts_enabled: v.optional(v.boolean()),
    stripe_details_submitted: v.optional(v.boolean()),
    stripe_connect_updated_at: v.optional(v.number()),
    // Work tickets: IANA time zone for due dates / billing periods (default
    // America/Chicago) and invoice payment terms in days (default 7).
    timezone: v.optional(v.string()),
    invoice_net_days: v.optional(v.number()),
    created_at: v.number(),
    updated_at: v.number(),
  })
    .index("by_owner_email", ["owner_email"]),

  // Team members for a business
  team_members: defineTable({
    business_id: v.id("businesses"),
    user_email: v.string(),
    name: v.string(),
    role: v.string(), // owner, admin, technician, viewer
    is_active: v.boolean(),
    // Invite lifecycle: pending (invited, grants no access) | active | declined | removed | left.
    // Legacy rows without status are treated as active when is_active is true.
    status: v.optional(v.string()),
    invited_at: v.number(),
    joined_at: v.optional(v.number()),
  })
    .index("by_business", ["business_id"])
    .index("by_user_email", ["user_email"]),

  // Existing production route state. Keep this table in the release schema so
  // the LSI deployment cannot delete live skipped-stop indexes.
  skippedStops: defineTable({
    business_id: v.id("businesses"),
    customer_key: v.string(),
    week_start: v.string(), // YYYY-MM-DD, Monday of the route week
    created_by: v.string(), // user email
    created_at: v.number(),
  })
    .index("by_business_and_week", ["business_id", "week_start"])
    .index("by_business_week_customer", ["business_id", "week_start", "customer_key"]),

  // Salt cell cleaning logs for salt pool maintenance tracking
  saltCellLogs: defineTable({
    customer_id: v.id("customers"),
    pool_id: v.optional(v.id("pools")),
    cleaning_date: v.string(), // YYYY-MM-DD format
    condition: v.string(), // good, moderate, heavy - scale buildup condition
    notes: v.optional(v.string()),
    next_cleaning_due: v.optional(v.string()), // YYYY-MM-DD format
    // Tenant email (the customer's created_by). Optional until
    // sync.backfillChildCreatedBy has run over legacy rows.
    created_by: v.optional(v.string()),
    created_at: v.optional(v.number()),
    updated_at: v.optional(v.number()),
  })
    .index("by_customer", ["customer_id"])
    .index("by_cleaning_date", ["cleaning_date"])
    .index("by_created_by", ["created_by"])
    .index("by_created_by_and_updated_at", ["created_by", "updated_at"]),

  // Client mutation receipts used by offline sync.  Keeping receipts in a
  // dedicated table makes create retries safe when the response is lost after
  // Convex has committed the mutation (for example, when a technician leaves
  // a low-signal area).  Receipts are tenant scoped and expire via the
  // `expires_at` field; cleanup is handled by the sync maintenance job.
  syncOperations: defineTable({
    key: v.string(),
    user_email: v.string(),
    table: v.string(),
    response: v.any(),
    created_at: v.number(),
    expires_at: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_expires_at", ["expires_at"]),

  // Offline-sync deletions. Every record deleted through sync.syncDelete
  // leaves a tombstone so other devices remove their cached copy on the next
  // pull. Tombstones are tenant scoped (business_id for business accounts,
  // created_by for single-user accounts) and pruned after 90 days by
  // sync.cleanupSyncOperations.
  syncTombstones: defineTable({
    table: v.string(),
    server_id: v.string(),
    business_id: v.optional(v.string()),
    created_by: v.string(),
    deleted_by: v.string(),
    deleted_at: v.number(),
  })
    .index("by_business_and_deleted_at", ["business_id", "deleted_at"])
    .index("by_created_by_and_deleted_at", ["created_by", "deleted_at"])
    .index("by_deleted_at", ["deleted_at"]),

  // Service reports for SMS/Email notifications to customers
  serviceReports: defineTable({
    service_log_id: v.id("serviceLogs"),
    customer_id: v.id("customers"),
    report_token: v.string(), // UUID v4, generated at record creation
    sent_at: v.optional(v.number()), // Timestamp when last sent
    sent_to_phone: v.optional(v.string()), // Phone number SMS was sent to (E.164)
    sent_to_email: v.optional(v.string()), // Email address report was sent to
    send_count: v.optional(v.number()), // Number of times sent (for re-sends)
    last_delivery_method: v.optional(v.string()), // 'sms' or 'email'
    created_at: v.number(),
    expires_at: v.optional(v.number()), // Token expiration timestamp (30 days from creation)
  })
    .index("by_service_log", ["service_log_id"])
    .index("by_token", ["report_token"])
    .index("by_expires_at", ["expires_at"]),

  // Month 1 roadmap: work-order operations (one-off + recurring)
  workOrders: defineTable({
    customer_id: v.id("customers"),
    business_id: v.optional(v.id("businesses")),
    created_by: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    status: v.string(), // scheduled, in_progress, completed, cancelled
    assignee_email: v.optional(v.string()),
    scheduled_date: v.string(), // YYYY-MM-DD
    is_recurring: v.boolean(),
    recurrence_rule: v.optional(v.string()), // e.g. WEEKLY:Monday
    source_quote_id: v.optional(v.id("quotes")),
    priority: v.optional(v.string()), // low, medium, high
    completed_at: v.optional(v.number()),
    created_at: v.number(),
    updated_at: v.number(),
  })
    .index("by_created_by", ["created_by"])
    .index("by_customer", ["customer_id"])
    .index("by_status", ["status"])
    .index("by_scheduled_date", ["scheduled_date"])
    .index("by_created_by_and_scheduled_date", ["created_by", "scheduled_date"])
    .index("by_assignee_email", ["assignee_email"])
    .index("by_business", ["business_id"])
    .index("by_business_and_scheduled_date", ["business_id", "scheduled_date", "created_at"]),

  // Month 1 roadmap: invoice drafts for completed work
  invoices: defineTable({
    customer_id: v.id("customers"),
    work_order_id: v.optional(v.id("workOrders")),
    source_quote_id: v.optional(v.id("quotes")),
    service_log_id: v.optional(v.id("serviceLogs")),
    created_by: v.string(),
    status: v.string(), // draft, sent, paid, cancelled
    line_items: v.array(v.object({
      description: v.string(),
      quantity: v.number(),
      unit_price: v.number(),
      amount: v.number(),
    })),
    subtotal: v.number(),
    tax: v.number(),
    deposit_applied: v.optional(v.number()),
    total: v.number(),
    due_date: v.optional(v.string()), // YYYY-MM-DD
    sent_at: v.optional(v.number()),
    paid_at: v.optional(v.number()),
    payment_url: v.optional(v.string()),
    // Payment provider of the current payment link ("square").
    payment_provider: v.optional(v.string()),
    // Square payment link created on the business's own connected merchant.
    square_payment_link_id: v.optional(v.string()),
    square_order_id: v.optional(v.string()),
    square_merchant_id: v.optional(v.string()),
    square_amount_cents: v.optional(v.number()),
    square_payment_id: v.optional(v.string()),
    // legacy, pre-Square
    stripe_checkout_session_id: v.optional(v.string()),
    stripe_payment_intent_id: v.optional(v.string()),
    notes: v.optional(v.string()),
    created_at: v.number(),
    updated_at: v.number(),
  })
    .index("by_created_by", ["created_by"])
    .index("by_customer", ["customer_id"])
    .index("by_status", ["status"])
    .index("by_work_order", ["work_order_id"])
    .index("by_source_quote", ["source_quote_id"])
    .index("by_stripe_checkout_session", ["stripe_checkout_session_id"]) // legacy, pre-Square
    .index("by_square_order", ["square_order_id"])
    .index("by_created_by_and_status", ["created_by", "status", "created_at"])
    .index("by_created_by_and_customer", ["created_by", "customer_id", "created_at"]),

  // Phase 2 roadmap: quote/deposit workflow
  quotes: defineTable({
    customer_id: v.id("customers"),
    created_by: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    status: v.string(), // draft, sent, approved, declined, converted
    line_items: v.array(v.object({
      description: v.string(),
      quantity: v.number(),
      unit_price: v.number(),
      amount: v.number(),
    })),
    subtotal: v.number(),
    tax: v.number(),
    total: v.number(),
    deposit_required: v.optional(v.number()),
    deposit_status: v.optional(v.string()), // not_required, pending, paid
    deposit_payment_url: v.optional(v.string()),
    deposit_checkout_session_id: v.optional(v.string()), // legacy, pre-Square (Stripe session id)
    deposit_square_payment_link_id: v.optional(v.string()),
    deposit_square_order_id: v.optional(v.string()),
    deposit_square_merchant_id: v.optional(v.string()),
    deposit_square_amount_cents: v.optional(v.number()),
    deposit_square_payment_id: v.optional(v.string()),
    deposit_paid_at: v.optional(v.number()),
    deposit_paid_source: v.optional(v.string()), // manual, square (legacy: stripe)
    valid_until: v.optional(v.string()), // YYYY-MM-DD
    converted_work_order_id: v.optional(v.id("workOrders")),
    created_at: v.number(),
    updated_at: v.number(),
  })
    .index("by_created_by", ["created_by"])
    .index("by_created_by_and_status", ["created_by", "status", "created_at"])
    .index("by_created_by_and_customer", ["created_by", "customer_id", "created_at"])
    .index("by_created_by_and_customer_and_status", ["created_by", "customer_id", "status", "created_at"])
    .index("by_customer", ["customer_id"])
    .index("by_status", ["status"])
    .index("by_converted_work_order", ["converted_work_order_id"])
    .index("by_deposit_checkout_session", ["deposit_checkout_session_id"]) // legacy, pre-Square
    .index("by_deposit_square_order", ["deposit_square_order_id"]),

  // Month 1 roadmap: service-text infrastructure and communication events
  communications: defineTable({
    type: v.string(), // service_text, reminder, system
    channel: v.string(), // sms, email, push
    recipient: v.string(),
    customer_id: v.optional(v.id("customers")),
    work_order_id: v.optional(v.id("workOrders")),
    invoice_id: v.optional(v.id("invoices")),
    quote_id: v.optional(v.id("quotes")),
    ticket_id: v.optional(v.id("tickets")),
    template_key: v.optional(v.string()),
    status: v.string(), // queued, sent, delivered, failed
    message: v.string(),
    scheduled_for: v.optional(v.number()),
    sent_at: v.optional(v.number()),
    delivered_at: v.optional(v.number()),
    last_attempt_at: v.optional(v.number()),
    attempts: v.optional(v.number()),
    provider: v.optional(v.string()), // twilio, mailersend, etc.
    provider_message_id: v.optional(v.string()),
    error: v.optional(v.string()),
    created_by: v.string(),
    created_at: v.number(),
    updated_at: v.number(),
  })
    .index("by_created_by", ["created_by"])
    .index("by_status", ["status"])
    .index("by_customer", ["customer_id"])
    .index("by_work_order", ["work_order_id"])
    .index("by_invoice", ["invoice_id"])
    .index("by_quote", ["quote_id"])
    .index("by_created_by_and_status", ["created_by", "status", "created_at"])
    .index("by_created_by_and_customer", ["created_by", "customer_id", "created_at"]),

  // Payment-provider webhook idempotency and delivery diagnostics (Square).
  paymentWebhookEvents: defineTable({
    provider: v.string(), // square
    event_id: v.string(),
    event_type: v.string(),
    status: v.string(), // processing, processed, failed
    attempts: v.number(),
    last_error: v.optional(v.string()),
    processed_at: v.optional(v.number()),
    created_at: v.number(),
    updated_at: v.number(),
  })
    .index("by_provider_and_event_id", ["provider", "event_id"])
    .index("by_status", ["status"]),

  // legacy, pre-Square: Stripe webhook idempotency rows (kept for existing data).
  stripeWebhookEvents: defineTable({
    event_id: v.string(),
    event_type: v.string(),
    status: v.string(), // processing, processed, failed
    attempts: v.number(),
    last_error: v.optional(v.string()),
    processed_at: v.optional(v.number()),
    created_at: v.number(),
    updated_at: v.number(),
  })
    .index("by_event_id", ["event_id"])
    .index("by_status", ["status"]),

  // Audit logging for public report access
  // Tracks all attempts to access reports for security monitoring
  reportAccessLogs: defineTable({
    report_token: v.string(), // Token that was accessed (or attempted)
    ip_address: v.optional(v.string()), // Client IP address if available
    user_agent: v.optional(v.string()), // Client user agent
    success: v.boolean(), // Whether access was granted
    failure_reason: v.optional(v.string()), // Reason for denial (expired, not_found, rate_limited)
    accessed_at: v.number(), // Timestamp of access attempt
  })
    .index("by_token", ["report_token"])
    .index("by_ip", ["ip_address"])
    .index("by_accessed_at", ["accessed_at"]),

  // Rate limiting tables for persistent, distributed rate limiting
  // Replaces in-memory rate limiting that resets on deployment
  rateLimits: defineTable({
    key: v.string(), // Format: "userId:action" or "ip:ipAddress:action"
    count: v.number(), // Current request count in window
    reset_time: v.number(), // Unix timestamp when window resets
    created_at: v.number(),
    updated_at: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_reset_time", ["reset_time"]),

  // Track rate limit violations for exponential backoff
  rateLimitViolations: defineTable({
    key: v.string(), // Same format as rateLimits key
    count: v.number(), // Number of violations in window
    last_violation_at: v.number(), // Unix timestamp of last violation
    expires_at: v.number(), // When this violation record expires
  })
    .index("by_key", ["key"])
    .index("by_expires_at", ["expires_at"]),

});
