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
  })
    .index("by_created_by", ["created_by"])
    .index("by_service_day", ["service_day"]),

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
  })
    .index("by_customer", ["customer_id"])
    .index("by_completed", ["completed"])
    .index("by_created_date", ["created_date"]),
});
