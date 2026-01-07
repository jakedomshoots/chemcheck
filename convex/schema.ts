import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

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
    .index("by_business_and_day", ["business_id", "service_day"]),

  serviceLogs: defineTable({
    customer_id: v.id("customers"),
    service_date: v.string(), // YYYY-MM-DD format
    status: v.string(), // completed, pending, etc.
    notes: v.optional(v.string()),
    ph: v.string(), // good, low, high
    chlorine: v.string(), // good, low, high
    alkalinity: v.string(), // good, low, high
    stabilizer: v.string(), // good, low, high
    salt: v.optional(v.number()), // Only for salt pools
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
    .index("by_service_date", ["service_date"])
    .index("by_customer_and_date", ["customer_id", "service_date"]),

  chemicalUsage: defineTable({
    customer_id: v.id("customers"),
    chemical_type: v.string(),
    quantity: v.string(),
    notes: v.optional(v.string()),
    created_date: v.optional(v.string()),
    created_at: v.optional(v.number()), // Timestamp for sync
    updated_at: v.optional(v.number()), // Timestamp for sync
  })
    .index("by_customer", ["customer_id"])
    .index("by_created_date", ["created_date"]),

  notes: defineTable({
    title: v.string(),
    content: v.string(),
    category: v.string(), // General, Customer, Equipment, Reminder, Chemical, Billing
    customer_id: v.optional(v.id("customers")),
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
    .index("by_created_by", ["created_by"]),

  subscriptions: defineTable({
    user_email: v.string(),
    stripe_customer_id: v.string(),
    stripe_subscription_id: v.string(),
    plan_id: v.string(), // starter, professional, business
    status: v.string(), // active, canceled, trialing, past_due, etc.
    current_period_start: v.number(),
    current_period_end: v.number(),
    cancel_at_period_end: v.boolean(),
    trial_end: v.optional(v.number()),
    created_at: v.number(),
    updated_at: v.number(),
  })
    .index("by_user_email", ["user_email"])
    .index("by_stripe_subscription", ["stripe_subscription_id"])
    .index("by_stripe_customer", ["stripe_customer_id"]),

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
    .index("by_customer", ["customer_id"]),

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
    created_at: v.number(),
    updated_at: v.number(),
  })
    .index("by_owner_email", ["owner_email"]),

  // Team members for a business
  team_members: defineTable({
    business_id: v.id("businesses"),
    user_email: v.string(),
    name: v.string(),
    role: v.string(), // owner, admin, employee
    is_active: v.boolean(),
    invited_at: v.number(),
    joined_at: v.optional(v.number()),
  })
    .index("by_business", ["business_id"])
    .index("by_user_email", ["user_email"]),

  // Salt cell cleaning logs for salt pool maintenance tracking
  saltCellLogs: defineTable({
    customer_id: v.id("customers"),
    cleaning_date: v.string(), // YYYY-MM-DD format
    condition: v.string(), // good, moderate, heavy - scale buildup condition
    notes: v.optional(v.string()),
    next_cleaning_due: v.optional(v.string()), // YYYY-MM-DD format
    created_at: v.optional(v.number()),
    updated_at: v.optional(v.number()),
  })
    .index("by_customer", ["customer_id"])
    .index("by_cleaning_date", ["cleaning_date"]),

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
  })
    .index("by_service_log", ["service_log_id"])
    .index("by_token", ["report_token"]),
});
