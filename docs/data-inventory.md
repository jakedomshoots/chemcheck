# ChemCheck Data Inventory

**Status:** implementation contract. Update this file whenever a store, provider, retention rule, export path, or deletion path changes.

## Classification

- **Restricted:** gate codes, photos, precise location, authentication/session material, payment-provider identifiers.
- **Confidential:** names, addresses, phone/email, service notes, readings, equipment, invoices, communications, audit details.
- **Operational:** business configuration, route order, feature flags, diagnostic counters.

## Cloud data: Convex

| Entity | Key data | Current tenant field | Sensitivity | Export | Delete | Target owner |
|---|---|---|---|---|---|---|
| `customers` | name, address, contact, gate code, pool profile | `created_by`, optional `business_id` | Restricted/Confidential | Yes | Yes | Customer domain |
| `serviceLogs` | stop history, readings, notes, timing | optional `created_by` | Confidential | Yes | Yes | Stop domain |
| `chemicalUsage` | product, quantity, notes | optional `created_by` | Confidential | Yes | Yes | Stop/inventory domain |
| `notes` | customer, equipment, billing notes | optional `created_by` | Confidential | Yes | Yes | Notes domain |
| `saltCellLogs` | maintenance condition/history | none | Confidential | Yes | Yes | Equipment domain |
| `servicePhotos` + `_storage` | service image, GPS, address | customer-derived only | Restricted | No | Partial | Photo domain |
| `serviceReports` | report token, destination, send status | customer-derived only | Confidential | No | Customer cascade | Report domain |
| `businesses` | company settings/contact | owner email | Confidential | Yes | Yes | Business domain |
| `team_members` | user email, role, membership | business ID | Confidential | Yes | Yes | Authorization domain |
| `workOrders` | job details, assignment, recurrence | optional business ID | Confidential | No | No | Work order domain |
| `quotes` | scope, price, deposit status | creator email | Confidential | No | No | Billing domain |
| `invoices` | line items, payment/provider IDs | creator email | Restricted | No | No | Billing domain |
| `communications` | recipient, message, delivery status | creator email | Confidential | Yes | No | Communications domain |
| `subscriptions` | Stripe customer/subscription identifiers | user email | Restricted | Yes | Yes | Subscription domain |
| `stripeWebhookEvents` | provider events/errors | no business scope | Operational/Restricted | No | No | Billing domain |
| `reportAccessLogs` | public token, IP, user agent | no business scope | Restricted | No | Customer cascade only | Report domain |
| `rateLimits` / `rateLimitViolations` | identity/IP action counters | key string | Restricted | No | Yes | Platform domain |

**Required migration:** all business-owned records above receive required `business_id`, owner/audit fields, and indexes before multi-technician release. Missing current export/delete paths are P0 defects.

## Device data: IndexedDB

| Database / table | Key data | Current scope | Sensitivity | Current lifecycle | Target lifecycle |
|---|---|---|---|---|---|
| `chemcheck.customers` | customer, gate, contact, pool profile | `created_by`, often `local` | Restricted | local cache/sync | user + business scope |
| `chemcheck.serviceLogs` | history, readings, notes | none | Confidential | local cache/sync | user + business + stop UUID |
| `chemcheck.chemicalUsage` | chemical detail | none | Confidential | local cache/sync | user + business + stop UUID |
| `chemcheck.notes` | operational notes | none | Confidential | local cache/sync | user + business |
| `chemcheck.saltCellLogs` | maintenance history | none | Confidential | local cache/sync | user + business |
| `proofOfServicePhotos.photos` | base64 image, GPS, service/customer ID | none | Restricted | 90-day/100 MB local store | scoped binary cache with upload/delete acknowledgement |

## Device data: local/session storage

| Key or family | Data | Class | Required action |
|---|---|---|---|
| `chemcheck_current_user`, `chemcheck_users` | local identity/profile | Confidential | remove local identity fallback from production data scope |
| `chemcheck_current_business`, `chemcheck_businesses` | business selection/settings | Confidential | scope/replace with authenticated business context |
| `chemcheck_sync_queue` | full pending record payloads | Restricted | migrate to Dexie outbox |
| `chemcheck_sync_state`, `chemcheck_last_sync` | sync diagnostics | Operational | scope per business |
| `serviceLogDraft_<customerId>` | unsent readings/notes | Confidential | scope by business + customer + stop and expire |
| `timeTracker_<customerId>` | stop times | Confidential | scope and expire/resolve before resume |
| `chemcheck_local_work_orders`, `_invoices`, `_quotes`, `_communications` | local business/billing records | Confidential | replace with explicit offline drafts/outbox |
| `chemcheck_subscription` | demo subscription state | Restricted | remove demo entitlement from production |
| `chemcheck_business_proof_settings`, `chemcheck_settings_fallback` | business settings | Operational/Confidential | scope and sync to business |
| `notification_config`, `scheduled_notifications` | reminders and recipients | Confidential | scope and delete with account |
| `chemcheck.reportSendQueue` | queued report data | Confidential | migrate to outbox |
| `chemcheck_audit_log` | local action/user details | Confidential | scope, redact, export/delete or replace server audit log |
| `emergencyBackup`, `lastAutoBackup` | complete local backup | Restricted | encrypt/scope; include in export/delete/restore drill |
| `optimized_routes` | addresses and route order | Confidential | scope and remove when routing is replaced |
| `analytics_opt_out` | consent state | Operational | honor before initialization and preserve correctly |
| `photo_error_log`, `migration_state`, rate-limit keys | diagnostics | Operational/Confidential | scope, retention, and deletion rules |
| `chemcheck_ff_*`, `skipped_services_*`, auth return session key | UI state | Operational | scope only where user/business data is embedded |

## Third parties and transmission

| Recipient | Data sent | Purpose | Required controls |
|---|---|---|---|
| Clerk | signed-in user identity | authentication | no authorization-only client decisions |
| Convex | all cloud operational data and blobs | source of truth/storage | business authorization, retention, export/delete coverage |
| Stripe | customer/payment references, invoices, subscriptions | hosted payments | signed webhooks, idempotency, no raw card data |
| Twilio | recipient phone and report text | SMS reports | consent, delivery history, retention |
| MailerSend | recipient email and report HTML/photos links | email reports | consent, delivery history, retention |
| Google Analytics | page/event/user-property telemetry | product analytics | consent before load, no customer data |
| Sentry | errors, performance, replay, user context | diagnostics | disable replay until sensitive data is masked/redacted |
| Apple/Capacitor APIs | camera, photo library, location, notifications | field functionality | just-in-time explanation and accurate disclosures |

## Export, deletion, backup, restore contract

| Operation | Current gaps | Required completion condition |
|---|---|---|
| Export | misses photos, work orders, quotes, invoices, storage lifecycle | one scoped machine-readable export plus expiring download object |
| Local delete | clears four Dexie tables and some key prefixes | deletes every scoped database/table/key/blob/outbox/draft/backup |
| Cloud account delete | misses billing/work-order/communication entities | cascade every scoped entity and storage object with post-delete zero check |
| Backup | plaintext local emergency backup excludes entities/photos | encrypted scoped backup, retention, restore validation |
| Restore | only legacy four-table data | explicit supported scope, collision policy, audit event, restore drill |

## P0 acceptance tests defined before implementation

1. **Local tenant isolation:** seed two businesses in one browser; every customer, log, photo, draft, queue, backup, and route lookup returns only the active business.
2. **Logout purge:** seed every device store; sign out; assert no customer identity, gate code, photo, draft, queue, backup, or business record remains accessible.
3. **Delete propagation:** create/sync a record, delete while offline, restart, reconnect, and assert the cloud record and related blobs are removed exactly once.
4. **Export/erase coverage:** seed every cloud/local entity and blob; export contains each scoped item; delete removes each; re-login/export returns none.
5. **RBAC matrix:** owner/admin/technician/viewer attempts across every entity match documented permissions.
6. **Stop integrity:** a new stop has no default good reading; completion requires numeric values or `not_tested`; an exception requires a reason.
7. **Truthful states:** unavailable routing cannot display optimized distance/time; offline billing/report actions cannot display sent or paid.
8. **Telemetry privacy:** analytics opt-out prevents GA initialization; Sentry event/replay payload contains no gate code, address, photo data URL, note, email, or user name.
