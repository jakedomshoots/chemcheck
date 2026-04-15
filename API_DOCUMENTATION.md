# ChemCheck API Documentation

This document describes the Convex API endpoints available in ChemCheck.

## Authentication

All API endpoints require authentication via Clerk. The user's identity is automatically verified through the Convex auth integration.

## Base URL

```
https://your-project.convex.cloud
```

---

## Customers

### List Customers

```typescript
customers.list({ order?: string, limit?: number })
```

Returns all customers for the authenticated user.

**Parameters:**
- `order` (optional): Sort order, e.g., "-created_at" for descending
- `limit` (optional): Maximum number of results

**Returns:** Array of Customer objects

**Tenant Isolation:** Only returns customers where `created_by` matches the authenticated user's email.

---

### Get Customer

```typescript
customers.get({ id: Id<"customers"> })
```

Returns a single customer by ID.

**Parameters:**
- `id`: Customer ID

**Returns:** Customer object or null

**Authorization:** Verifies customer belongs to authenticated user.

---

### Create Customer

```typescript
customers.create({
  full_name: string,
  address: string,
  phone?: string,
  email?: string,
  gate_code?: string,
  service_day: string,
  pool_gallons?: number,
  pool_type: string,
  surface_type: string,
  sort_order?: number
})
```

Creates a new customer.

**Returns:** Customer ID

**Auto-populated:** `created_by` is set to authenticated user's email.

---

### Update Customer

```typescript
customers.update({
  id: Id<"customers">,
  full_name?: string,
  address?: string,
  phone?: string,
  email?: string,
  gate_code?: string,
  service_day?: string,
  pool_gallons?: number,
  pool_type?: string,
  surface_type?: string,
  sort_order?: number
})
```

Updates an existing customer.

**Authorization:** Verifies customer belongs to authenticated user.

---

### Delete Customer

```typescript
customers.remove({ id: Id<"customers"> })
```

Deletes a customer.

**Authorization:** Verifies customer belongs to authenticated user.

---

## Service Logs

### List Service Logs

```typescript
serviceLogs.list({ order?: string, limit?: number })
```

Returns service logs for the authenticated user's customers.

**Tenant Isolation:** Filters to only logs for customers owned by the authenticated user.

---

### Get Logs by Customer

```typescript
serviceLogs.getByCustomer({ customer_id: Id<"customers"> })
```

Returns all service logs for a specific customer.

**Authorization:** Verifies customer belongs to authenticated user.

---

### Get Logs by Date

```typescript
serviceLogs.getByDate({ service_date: string })
```

Returns all service logs for a specific date (YYYY-MM-DD format).

---

### Create Service Log

```typescript
serviceLogs.create({
  customer_id: Id<"customers">,
  service_date: string,
  status: string,
  notes?: string,
  ph: string,
  chlorine: string,
  alkalinity: string,
  stabilizer: string,
  salt?: number
})
```

Creates a new service log.

**Authorization:** Verifies customer belongs to authenticated user.

**Field Values:**
- `status`: "completed", "pending", "skipped"
- `ph`, `chlorine`, `alkalinity`, `stabilizer`: "good", "low", "high"
- `salt`: PPM reading (for salt pools only)

---

### Update Service Log

```typescript
serviceLogs.update({
  id: Id<"serviceLogs">,
  customer_id?: Id<"customers">,
  service_date?: string,
  status?: string,
  notes?: string,
  ph?: string,
  chlorine?: string,
  alkalinity?: string,
  stabilizer?: string,
  salt?: number
})
```

Updates an existing service log.

**Authorization:** Verifies log belongs to authenticated user's customer.

---

### Delete Service Log

```typescript
serviceLogs.remove({ id: Id<"serviceLogs"> })
```

Deletes a service log.

**Authorization:** Verifies log belongs to authenticated user's customer.

---

## Chemical Usage

### List Chemical Usage

```typescript
chemicalUsage.list({ order?: string, limit?: number })
```

Returns chemical usage records for the authenticated user's customers.

---

### Get by Customer

```typescript
chemicalUsage.getByCustomer({ customer_id: Id<"customers"> })
```

Returns chemical usage for a specific customer.

**Authorization:** Verifies customer belongs to authenticated user.

---

### Create Chemical Usage

```typescript
chemicalUsage.create({
  customer_id: Id<"customers">,
  chemical_type: string,
  quantity: string,
  notes?: string,
  created_date?: string
})
```

Records chemical usage.

**Authorization:** Verifies customer belongs to authenticated user.

---

### Delete Chemical Usage

```typescript
chemicalUsage.remove({ id: Id<"chemicalUsage"> })
```

Deletes a chemical usage record.

---

## Notes

### List Notes

```typescript
notes.list({ order?: string, limit?: number })
```

Returns all notes for the authenticated user.

---

### Get by Customer

```typescript
notes.getByCustomer({ customer_id: Id<"customers"> })
```

Returns notes for a specific customer.

---

### Create Note

```typescript
notes.create({
  title: string,
  content: string,
  category: string,
  customer_id?: Id<"customers">,
  priority: string,
  completed?: boolean,
  created_date?: string
})
```

Creates a new note.

**Field Values:**
- `category`: "General", "Customer", "Equipment", "Reminder", "Chemical", "Billing"
- `priority`: "low", "medium", "high"

---

### Update Note

```typescript
notes.update({
  id: Id<"notes">,
  title?: string,
  content?: string,
  category?: string,
  customer_id?: Id<"customers">,
  priority?: string,
  completed?: boolean
})
```

Updates an existing note.

---

### Delete Note

```typescript
notes.remove({ id: Id<"notes"> })
```

Deletes a note.

---

## Businesses (Multi-tenancy)

### Get Current Business

```typescript
businesses.getCurrent()
```

Returns the business for the authenticated user.

---

### Create Business

```typescript
businesses.create({
  name: string,
  address?: string,
  phone?: string,
  email?: string
})
```

Creates a new business (tenant). User becomes the owner.

**Limit:** One business per user.

---

### Update Business

```typescript
businesses.update({
  name?: string,
  address?: string,
  phone?: string,
  email?: string
})
```

Updates business information.

**Authorization:** Owner only.

---

### Update Settings

```typescript
businesses.updateSettings({
  working_days?: string[],
  working_hours_start?: string,
  working_hours_end?: string,
  service_types?: string[],
  chemical_types?: string[],
  route_optimization?: boolean,
  require_photos?: boolean,
  require_signatures?: boolean
})
```

Updates business settings.

**Authorization:** Owner only.

---

### Get Team Members

```typescript
businesses.getTeamMembers()
```

Returns all team members for the business.

**Authorization:** Owner only.

---

### Invite Team Member

```typescript
businesses.inviteTeamMember({
  email: string,
  name: string,
  role: string
})
```

Invites a new team member.

**Field Values:**
- `role`: "admin", "employee"

**Authorization:** Owner only.

---

### Remove Team Member

```typescript
businesses.removeTeamMember({ memberId: Id<"team_members"> })
```

Removes a team member (sets inactive).

**Authorization:** Owner only. Cannot remove owner.

---

## Subscriptions

### Get Subscription

```typescript
subscriptions.get()
```

Returns the current user's subscription.

---

### Check Feature Access

```typescript
subscriptions.checkFeatureAccess({ feature: string })
```

Checks if user has access to a feature based on their plan.

**Features:**
- `route-optimization`: Professional, Business
- `chemical-tracking`: Professional, Business
- `advanced-reporting`: Professional, Business
- `api-access`: Business only
- `white-label`: Business only

---

### Check Limit

```typescript
subscriptions.checkLimit({ limitType: "users" | "customers" })
```

Checks if user is within their plan limits.

**Returns:**
```typescript
{
  allowed: boolean,
  current: number,
  limit: number
}
```

---

## Health Check

### Check Health

```typescript
health.check()
```

Returns system health status.

**Returns:**
```typescript
{
  status: "healthy" | "unhealthy",
  timestamp: number,
  version: string,
  services: {
    database: "ok" | "error",
    auth: "ok" | "unknown"
  }
}
```

---

## Error Handling

All endpoints may throw errors with the following structure:

```typescript
{
  message: string,
  code?: string
}
```

Common errors:
- `"Not authenticated"` - User is not logged in
- `"Customer not found or access denied"` - Tenant isolation violation
- `"Access denied"` - Insufficient permissions
- `"Business not found"` - No business associated with user

---

## Rate Limiting

Rate limits are enforced per-action:
- `create`: 100 requests per minute
- `update`: 200 requests per minute
- `delete`: 50 requests per minute
- `list`: 300 requests per minute

Exceeding limits returns a rate limit error.

---

## Webhooks

### Stripe Webhook

```
POST /stripe-webhook
```

Handles Stripe subscription events. Configure in Stripe Dashboard.

**Events handled:**
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_succeeded`
- `invoice.payment_failed`
