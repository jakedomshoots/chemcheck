# ChemCheck 90-Day Roadmap to Close High-Impact Skimmer Gaps

**Window:** 12 weeks (3 phases)  
**Team shape:** 1-2 engineers (see [Staffing Plan Variants](#staffing-plan-variants))  
**Target segment:** Solo operator + 1 technician  
**Strategy:** Must-have parity first

## Summary
This roadmap closes the highest-conversion competitive gaps first: work orders, customer billing, dispatch, and communications. It intentionally defers broader platform work (public API, deep hardware integrations) until a parity floor is achieved.

## Delivery Principles
1. Ship usable slices every 2 weeks.
2. Prefer end-to-end MVPs over partially implemented "platform" layers.
3. Keep migration risk low by introducing new entities behind feature flags.
4. Validate each phase with real user workflows before expanding scope.

## Milestone Plan (RoadmapMilestone Schema)

| phase | outcome | features_included | acceptance_criteria | risks |
|---|---|---|---|---|
| Phase 0 (Pre-kickoff) | External dependencies unblocked | SMS provisioning, payment processor approval, QuickBooks OAuth submission, map-provider account setup | All provider accounts approved/provisioned; sandbox credentials available | Approval delays from payment processor or QuickBooks |
| Weeks 1-4 (Phase 1) | Establish revenue-critical operations baseline | `WorkOrder` domain (one-off + recurring), dispatch board v1 (day view + assignment), service text infrastructure, invoice data model + draft generation | Tech can create/assign/complete work orders; owner can generate draft invoices from completed work; message queue can send service text templates in staging | Scope creep from trying to replicate full enterprise dispatch; SMS deliverability setup delays |
| Weeks 5-8 (Phase 2) | Monetizable customer-facing billing and communication workflows | Customer invoice send + payment links, portal-lite (invoice history + payment methods), bulk invoice runs + reminders, service text production rollout, quote/deposit v1 | End-to-end: complete work -> create invoice -> send -> customer pays; reminder automations run; quote can be approved and converted to work order | Payment edge cases (refunds/partial payments), portal auth complexity, support load from first billing customers |
| Weeks 9-12 (Phase 3) | Operational polish and competitive parity hardening | Route optimization v2 (maps/travel-time API), service checklists by service type, dispatch UX refinement, QuickBooks export/sync v1 | Route outputs include map-based ETAs; checklist engine prevents work order completion when required checklists are incomplete; invoices sync or export cleanly to accounting workflow | API quota/cost surprises from map providers, accounting sync mismatch handling, regression risk in existing route flow |

---

## Phase 0: Prerequisites (Run in Parallel with Phase 1 Start)

External integrations require lead time. These must be kicked off **before** or **at the same time as** Phase 1 to avoid blocking downstream phases.

| Dependency | Tasks | Est. Lead Time | Owner | Acceptance Criteria |
|---|---|---|---|---|
| **SMS Provider** (Twilio recommended) | Account creation, phone number provisioning (local 10DLC or toll-free), A2P 10DLC campaign registration, sender verification | 1-3 weeks (10DLC registration can take 1-2 weeks) | Engineer A | Sandbox sends succeed; 10DLC campaign approved; local number provisioned |
| **Payment Processor** (Stripe recommended) | Application/approval, Connect account setup, webhook endpoint registration, PCI SAQ-A submission | 1-2 weeks (instant for Stripe; longer for others) | Engineer A | Sandbox payments process; webhook events received; PCI SAQ-A completed |
| **QuickBooks OAuth** | Register app on Intuit Developer portal, submit for OAuth 2.0 app review, configure redirect URIs | 2-4 weeks (Intuit review) | Engineer A | OAuth 2.0 sandbox flow completes; app approved for production (or in review by Phase 2 end) |
| **Map Provider** (see [Route Provider Analysis](#route-provider-selection-and-cost-analysis)) | Account creation, API key provisioning, quota/billing setup | < 1 week | Engineer B | API key active; test requests return valid responses |

> [!IMPORTANT]
> Phase 1 may begin before all prerequisites are fully approved. However, **Phase 2 billing features are gated on payment processor approval** and **Phase 1 SMS features are gated on 10DLC registration**. Track these in the weekly checkpoint.

---

## Phase 1 (Weeks 1-4): Core Ops Foundation
**Goal:** Make ChemCheck viable for daily operations beyond simple service logs.

### 1. Data model additions
- `workOrders` table: `customer_id`, `title`, `description`, `status`, `assignee_id`, `scheduled_date`, `is_recurring`, `recurrence_rule`, `created_at`, `updated_at`.
  > **Note:** `source_quote_id` is **deferred to Phase 2** (added via migration when the quote workflow is implemented). Including it in Phase 1 would create a forward dependency on a table/entity that doesn't exist yet. The Phase 2 migration script will add this nullable column to `workOrders` alongside the `quotes` table creation.
- `invoices` table (MVP): `customer_id`, `status`, `line_items`, `subtotal`, `tax`, `total`, `due_date`, `sent_at`, `paid_at`.
- `communications` table: template + delivery status for service texts/reminders.

### 2. Product slices
- Work order CRUD with assignment and status transitions.
- Simple dispatch board (day lane + unassigned lane).
- Draft invoice generation from completed service/work items.
- **Service text sending service (templated events only):**
  - **Provider:** Twilio (primary recommendation) or AWS SNS (fallback).
    - *Selection criteria:* Deliverability, 2-way messaging support for future phases, cost, regulatory compliance (A2P 10DLC).
  - **Integration tasks:**
    1. Twilio account setup + 10DLC campaign registration (Phase 0 prerequisite).
    2. Phone number provisioning — local 10DLC number for business messaging (not short codes for MVP).
    3. REST API integration: send endpoint, delivery status webhook handler, retry logic (3 retries, exponential backoff).
    4. Phone number verification: validate customer phone numbers on input (E.164 format), optionally send verification SMS on first contact.
  - **Cost estimate:** ~$0.0079/segment outbound (Twilio US); for a solo+1 operator with ~200 service events/month, estimated cost ~$2-5/month.
  - **Volume limits:** Twilio 10DLC throughput ~100 SMS/sec (far above need); A2P registration needed for >~1 msg/sec sustained.
  - **Risk linkage:** These details mitigate the "SMS deliverability setup delays" risk by front-loading provisioning in Phase 0.

### 3. Exit checks
- 3 scripted E2E flows pass:
  - **Create recurring work order -> auto-instance appears in schedule.**
    - **Scheduling mechanism details:**
      - **Background job:** A cron-based scheduler (e.g., Convex scheduled function or `node-cron` worker) runs daily at a configured time (e.g., 02:00 UTC) to evaluate upcoming recurrence windows and create work order instances.
      - **Recurrence rule parsing:** The `recurrence_rule` field uses **iCal RRULE v2 format** (RFC 5545). Parsing is handled by the `rrule` npm package (`rrule.js`). Rules are validated on save — invalid RRULE strings are rejected with a user-facing error.
      - **Timezone handling:** Each work order stores an explicit `timezone` field (IANA timezone string, e.g., `America/New_York`). The scheduler evaluates recurrence in the work order's local timezone. DST transitions: instances scheduled during a skipped hour (spring-forward) are shifted to the next valid hour; instances during a repeated hour (fall-back) use the first occurrence.
      - **Missed/skipped instances:** If the scheduler was down or an instance was missed, the next run performs a backfill: it checks the gap since the last created instance and creates any missing instances up to the current date. Instances older than 7 days are created with `status: skipped` and logged for review rather than silently appearing in the schedule.
      - **Retry strategy:** If instance creation fails (e.g., database error), the scheduler retries on the next run. After 3 consecutive failures for the same recurrence, an alert is sent to the admin dashboard.
      - **Logging & alerts:** All instance creation events are logged with `workOrderId`, `recurrence_rule`, `scheduled_date`, `timezone`, and `created_at`. Failures trigger a `scheduling_failure` alert visible in the admin panel. The scheduler logs a heartbeat entry on each run for monitoring uptime.
      - **Job frequency:** Daily at 02:00 UTC (configurable). Creates instances for the next 14-day lookahead window.
  - Complete work order -> invoice draft generated.
  - Trigger service completion -> service text event emitted and delivered.

### QuickBooks OAuth Setup (Phase 1 task, concurrent with Phase 0)
> OAuth 2.0 app registration and sandbox configuration are started in Phase 0/1 rather than deferred to Phase 3 to avoid blocking the 2-4 week Intuit review timeline. See [Phase 0 Prerequisites](#phase-0-prerequisites-run-in-parallel-with-phase-1-start).

---

## Phase 2 (Weeks 5-8): Billing + Portal + Communication Expansion
**Goal:** Close purchase-blocking commercial gaps.

### Timeline Risk Analysis

> [!WARNING]
> Phase 2 contains **security-critical tasks** (payment processing, customer portal auth) and **external dependencies** (payment processor, SMS production rollout). The 4-week window is aggressive. The milestone breakdown below provides 4-week (compressed) and 8-week (with buffer) options.

**External dependencies for Phase 2:**
- Payment processor sandbox must be approved (Phase 0 prerequisite).
- SMS 10DLC registration must be complete for production rollout.
- Customer email/notification service must be operational.

#### Phase 2 Milestone Breakdown

| Milestone | Items | Est. Effort (eng-days) | Headcount | Week Target | Exit Check Mapping |
|---|---|---|---|---|---|
| **M2.1: Invoice & Payment** | Invoice send flow with payment links, payment webhook handling, failed payment retry | 8-10 days | 1-2 eng | Weeks 5-6 | → Payment funnel conversion test |
| **M2.2: Portal Auth & Core** | Customer portal auth (magic links), invoice history view, payment method storage | 6-8 days | 1-2 eng | Weeks 5-6 | — |
| **M2.3: Portal Billing & Autopay** | Toggle autopay, subscription/payment method mgmt, customer notifications | 4-5 days | 1 eng | Week 7 | → Payment funnel conversion test |
| **M2.4: Bulk Invoicing & Reminders** | Bulk invoice generation, reminder engine, cadence configuration | 5-6 days | 1 eng | Week 7 | → Reminder cadence dry run |
| **M2.5: Quote/Deposit Workflow** | Quote CRUD, acceptance capture, convert-to-work-order, `source_quote_id` migration | 5-6 days | 1 eng | Week 8 | → Quote-to-work-order conversion |
| **M2.6: Operational Hardening** | RBAC enforcement, audit logs, security review | 3-4 days | 1 eng | Week 8 | — |

**Total estimated effort:** 31-39 engineer-days across 20 working days (4 weeks).

- **4-week plan (2 engineers):** Feasible if both engineers are full-time and no external dependency delays. M2.1+M2.2 run in parallel (weeks 5-6), M2.3+M2.4 in parallel (week 7), M2.5+M2.6 in parallel (week 8).
- **Contingency (1 engineer or delays):** Defer M2.5 (Quote/Deposit) to Week 9 overlap with Phase 3 start. Defer M2.3 autopay features to Phase 3.

**Contingency buffer:** 3 days built into estimates. If all milestones slip by >3 days, escalate scope discussion.

### 1. Product slices

#### Invoice send flow with payment links
- **Payment processor:** Stripe (recommended).
  - *Selection criteria:* Instant approval, excellent API/docs, Stripe Connect for future multi-tenant, native payment links, built-in PCI compliance (SAQ-A via Stripe.js/Elements).
  - *PCI compliance:* SAQ-A — no card data touches our servers. All payment UI via Stripe Elements or Stripe-hosted checkout. Annual SAQ-A self-assessment required.
  - *Webhook setup:* Register endpoint for events: `invoice.paid`, `invoice.payment_failed`, `charge.refunded`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `customer.subscription.updated`.
  - *API integration tasks:* (1) Create Stripe customer on ChemCheck customer creation, (2) generate Payment Links or Checkout Sessions for invoices, (3) handle webhook events to update invoice status, (4) implement idempotency keys on all write operations.
  - *Sandbox testing plan:* All development against Stripe test mode; dedicated test clock for subscription scenarios; automated E2E tests against test API keys before any production switch.

#### Customer portal lite
- View unpaid/paid invoices.
- Store/update payment method.
- **Toggle autopay:**
  - Subscription/payment method management: Customer can add/remove cards via Stripe Elements; one default payment method for autopay.
  - Failed-payment retry logic: Stripe Smart Retries enabled (up to 4 attempts over 3 weeks); on final failure, autopay is paused and customer is notified.
  - Webhook handling for charge failures: `invoice.payment_failed` triggers in-app notification + email to customer with a payment update link.
  - Customer notification workflows: Email on autopay enabled, autopay charge success, charge failure (with retry schedule), autopay paused.
  - *Schedule impact:* Autopay adds ~2-3 days to Phase 2. If schedule is tight, defer to Phase 3.

- **Customer portal authentication strategy:**
  > Mitigates the "portal auth complexity" risk identified in the milestone plan.
  - **Auth method:** Magic links (passwordless email-based authentication).
    - *Rationale:* Lowest friction for pool service customers; no password to manage; secure enough for invoice/payment access; simple to implement.
  - **Implementation tasks (Phase 2):**
    1. **Account creation/invite flow:** When first invoice is sent, auto-create portal account; customer receives invite email with magic link.
    2. **Magic link generation:** Time-limited (15 min), single-use tokens; stored hashed in DB; delivered via transactional email (SendGrid/Resend).
    3. **Session/token management:** JWT issued on magic link verification; 30-day session expiry; refresh on activity; secure httpOnly cookie.
    4. **Password reset/recovery:** N/A for magic links — customer requests a new link. Rate limit: max 5 link requests per hour per email.
    5. **MFA option:** Deferred post-90 days. Not required for invoice-viewing scope.
    6. **Multi-location access control:** Portal access scoped to the customer's own data only. If a customer has multiple service locations, they see all locations tied to their email. Authorization enforced server-side on every query.

#### Bulk invoice generation and reminder engine.
#### Quote/deposit workflow:
- Create quote.
- Capture acceptance.
- Convert to work order (adds `source_quote_id` to `workOrders` table via Phase 2 migration).

### 2. Operational hardening
- Failed payment retry handling and notification templates.
- **Permission checks around billing actions — RBAC Scheme:**
  
  | Role | Send Invoices | Issue Refunds | View Payments | Manage Billing Settings | Manage Quotes | View Portal |
  |---|---|---|---|---|---|---|
  | **Owner** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
  | **Admin** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
  | **Technician** | ❌ | ❌ | ❌ (own jobs only) | ❌ | ❌ | ❌ |
  | **Accountant** | ✅ | ❌ (request only) | ✅ | ❌ | ❌ | ✅ |

  - **Permission assignment:** Roles assigned via Settings > Team Management UI. API endpoint `PATCH /team/:id/role` for programmatic changes. Only Owner role can assign/remove Admin roles.
  - **Group membership:** Single role per user. Role changes take effect immediately (session re-evaluation on next API call).
  - **Audit trail requirement:** All permission changes logged to `audit_logs` table with: `actor_id`, `target_user_id`, `previous_role`, `new_role`, `timestamp`, `ip_address`. Audit log is append-only and visible to Owner/Admin roles in Settings > Audit Log.
  - **Enforcement:** Permission checks implemented as middleware/guards on all billing handler endpoints. Unauthorized access returns 403 with logged attempt.

- Audit logs for billing, quote approval, and portal updates.

### 3. Exit checks
- Payment funnel conversion test in staging + pilot tenant. → *Maps to M2.1 + M2.3*
- Reminder cadence test over 7-day dry run. → *Maps to M2.4*
- Quote-to-work-order conversion validated with real sample jobs. → *Maps to M2.5*

---

## Phase 3 (Weeks 9-12): Route + Checklist + Accounting Parity
**Goal:** Reduce remaining "Skimmer advantage" in daily execution depth.

### 1. Product slices

#### Route optimization v2

##### Route Provider Selection and Cost Analysis
> This deliverable mitigates the "API quota/cost surprises" risk. Provider evaluation begins in Phase 1-2; final selection confirmed by Phase 3 start.

| Provider | Distance Matrix | Routing | Traffic/ETA | Pricing (per 1K requests) | Free Tier | Rate Limits |
|---|---|---|---|---|---|---|
| **Google Maps Platform** | ✅ | ✅ | ✅ | $5-10 (Elements), $10 (Routes) | $200/mo credit | 3,000 QPM |
| **Mapbox** | ✅ | ✅ | ✅ (traffic) | $2-5 | 100K free req/mo | 300 RPM |
| **HERE** | ✅ | ✅ | ✅ | $1-5 | 250K free txn/mo | 10 RPS |
| **Azure Maps** | ✅ | ✅ | ✅ | $4-11 | 1K-5K free/day | Varies |

**Projected monthly costs** (solo+1 operator, ~30 routes/day, ~20 stops/route):
- Distance matrix: ~900 requests/day × 30 days = 27K requests/month.
- Google: ~$135-270/mo (after $200 credit: ~$0-70/mo). Mapbox: ~$0 (within free tier). HERE: ~$0 (within free tier).

**Recommendation:** Start with **Mapbox** or **HERE** for cost efficiency; evaluate Google if traffic/ETA accuracy is insufficient. Add this evaluation as a Phase 1-2 deliverable (spike task, 2-3 days).

- Map provider integration.
- ETA/distance-based sequencing.
- Preserve manual override order.

#### Checklist engine
- Configurable per service type.
- Required before completion — **checklist engine prevents work order completion when required checklists are incomplete** (enforced server-side on the work order completion endpoint; UI displays incomplete checklist items with a blocking message).
- Optional photo linkage per checklist item.

#### QuickBooks export/sync v1

**Scope:** QuickBooks Online (QBO) only. Desktop is deferred post-90 days due to different integration architecture (Web Connector vs REST API).

- **OAuth 2.0 integration:** App registered in Phase 0; OAuth sandbox flow validated in Phase 1-2. Production app review submitted by end of Phase 2 (see [Phase 0 Prerequisites](#phase-0-prerequisites-run-in-parallel-with-phase-1-start)). Owner: Engineer A.
- **API constraints and rate-limit handling:**
  - QBO API rate limit: 500 requests/min per realm, with throttling at 80%.
  - Strategy: **Batch sync** (not real-time). Sync runs on-demand or scheduled (nightly). Implements exponential backoff with jitter on 429/503 responses; max 5 retries per request. Failed items queued for next sync cycle.
- **Entity mapping:**

  | ChemCheck Entity | QBO Entity | Notes |
  |---|---|---|
  | Customer | Customer | Match by email or name; create if not found |
  | Invoice | Invoice | Line items mapped 1:1; tax handled by QBO tax codes |
  | Invoice line item | Line (SalesItemLineDetail) | Map to QBO Item (auto-create service items) |
  | Payment | Payment | Linked to QBO Invoice |
  | — | Account | Map to a configurable income account (default: "Services") |

- **Conflict resolution policy:**
  - **Automated rules:** If QBO entity was modified more recently than ChemCheck, skip update and flag for review. If ChemCheck entity is newer, update QBO. Email mismatches: prefer ChemCheck as source of truth.
  - **Manual review workflow:** Conflicts logged to `sync_conflicts` table. Admin UI shows a "Sync Conflicts" panel with side-by-side view and resolve/skip actions. Unresolved conflicts block re-sync for that entity until resolved.
- **Deliverables and milestones:**
  1. Week 9: OAuth flow in production, customer sync.
  2. Week 10: Invoice sync, line item mapping.
  3. Week 11: Payment sync, conflict resolution UI.
  4. Week 12: End-to-end reconciliation testing, documentation.

### 2. Exit checks
- Route ETA accuracy within acceptable tolerance in pilot routes.
- **Checklist engine enforcement verified:** Work order completion is blocked when required checklists are incomplete (automated test + manual QA).
- Accounting export reconciles with sample month-end data.

### 3. Post-Launch Adoption Metrics (Monitored, not exit-gated)
- **95%+ checklist completion compliance** on configured service types — tracked as an adoption KPI via workflow telemetry after launch. This is a monitoring metric, not a release gate, because adoption rates depend on user behavior over time.

---

## Priority-to-Phase Mapping
| Gap | Priority Score | Phase |
|---|---:|---|
| Work orders (one-off + recurring) | 4.5 | Phase 1 |
| Customer invoicing + payments | 4.0 | Phase 1 -> Phase 2 |
| Dispatch board + assignment | 4.0 | Phase 1 |
| Service texts | 3.8 | Phase 1 -> Phase 2 |
| Customer portal lite | 3.8 | Phase 2 |
| Bulk invoicing + reminders | 3.8 | Phase 2 |
| Quote/deposit workflow | 3.5 | Phase 2 |
| Map/traffic route optimization | 3.2 | Phase 3 |
| Checklist engine by service type | 3.2 | Phase 3 |
| QuickBooks sync | 3.0 | Phase 3 |

---

## Staffing Plan Variants

> [!IMPORTANT]
> Staffing must be confirmed before kickoff. The plan below provides two explicit variants. **Choose one and delete the other before sharing with the team.**

### Plan A: 2 Engineers (Full Scope)
- **Engineer A:** Data model + backend workflows + integrations (Stripe, Twilio, QuickBooks, map provider).
- **Engineer B (full-time or part-time):** UI flows + QA + migration safety + E2E tests.
- **Phase 3 scope:** Includes QuickBooks export/sync v1.
- **Total scope:** All 3 phases delivered within 90 days.

### Plan B: 1 Engineer (QuickBooks Deferred)
- **Single Engineer:** All data model, backend, UI, and QA work.
- **Phase 3 scope change:** QuickBooks sync is **deferred post-90 days**. Phase 3 delivers CSV export-only for accounting data. QuickBooks OAuth app review still submitted in Phase 0 to preserve timeline optionality.
- **Quote/deposit workflow:** May slip to early Phase 3 overlap.
- **Total scope:** Core work orders, billing, portal, route optimization, and checklists delivered. QuickBooks integration is a fast-follow.

---

## Risk Controls
1. Feature flags for each major subsystem (`work_orders`, `customer_billing`, `portal`, `route_v2`).
2. Backward-compatible schema migrations with roll-forward scripts.
3. Weekly competitive validation checkpoint against Skimmer release notes.
4. **Pilot cohort feedback loop before broad rollout at each phase gate:**

   #### Pilot Cohort Specification
   - **Cohort size:** N=10-30 users per phase gate.
   - **Selection criteria:** Representative segments — mix of solo operators (60%) and solo+1 teams (40%); mix of new users (<3 months) and established users (>6 months); geographic diversity (2+ regions). Selection is **targeted** (not open opt-in) to ensure representativeness, with opt-in consent required.
   
   #### Timing
   - Pilot feedback runs **concurrently with the final week of each phase's development** and **continues for 5-7 days post-delivery** before the phase gate decision.
   - Phase 1 pilot: starts Week 3, runs through Week 4 + 5 days.
   - Phase 2 pilot: starts Week 7, runs through Week 8 + 5 days.
   - Phase 3 pilot: starts Week 11, runs through Week 12 + 5 days.
   
   #### Feedback Collection Methods
   | Method | Cadence | Owner |
   |---|---|---|
   | In-app micro-survey (3-5 questions, NPS + task-specific) | End of pilot period | Product/PM |
   | Usage telemetry (feature adoption, error rates, task completion time) | Continuous (automated) | Engineering |
   | Scheduled 15-min interview (subset: 5-8 users) | Days 3-5 of pilot | Product/PM |
   | Bug/friction report channel (dedicated Slack or form) | Continuous | Engineering |
   
   #### Triage and Incorporation Workflow
   - **Minor rework** (< 2 eng-days, no architectural change): Accept into current sprint. Decision owner: Tech Lead.
   - **Significant rework** (> 2 eng-days or architectural change): Evaluate against phase timeline. Accept/reject criteria: (1) Is it a blocker for >30% of pilot users? (2) Does it affect a revenue-critical flow? If yes to either, allocate sprint capacity and extend phase by up to 3 days. If no, defer to next phase backlog. Decision owner: Product/PM + Tech Lead.
   - **Rollback trigger:** If pilot NPS < 20 or >25% of pilot users report a critical regression, halt broad rollout and enter a 1-week fix sprint before re-piloting.
   
   #### Customer Communication Templates
   - **Invite email:** "You've been selected for early access to [Feature]. Your feedback directly shapes the product. Here's what to expect: [timeline, scope, how to give feedback]. [Consent link]."
   - **Consent form:** Covers data collection scope (usage telemetry + survey responses), expected time commitment (<15 min/week), and opt-out process.
   - **Timeline communication:** "Pilot runs [start] to [end]. We'll check in on Day 3 and Day 5. Final survey on Day [N]."
   - **SLA for updates:** Feedback acknowledged within 24 hours; status update on reported issues within 72 hours; post-pilot summary shared within 5 business days of pilot end.

---

## Success Metrics (90-day)

### Baseline Collection Plan
> [!IMPORTANT]
> Baselines must be captured **before Phase 1 features go live** to enable meaningful measurement.

**Baseline collection method:** 2-week time-study during Phase 0 / early Phase 1:
- **Workflow timing capture:** Instrument current admin workflows (manual service logging, invoice creation, scheduling) with timing events. Log `task_start` and `task_end` for key admin actions.
- **Self-report survey:** Distribute to pilot cohort: "How many minutes per day do you spend on [scheduling / invoicing / route planning / customer communication]?" Capture 5 working days of data.

### Operational Metrics

| # | Metric | Baseline Source | Data Source | Cadence | Formula | Success Threshold |
|---|---|---|---|---|---|---|
| 1 | Pilot jobs tracked through work orders | Pre-launch: 0% (all ad hoc) | Workflow logs (`workOrders` table) | Daily (automated) | `work_order_jobs / total_jobs × 100` | 80%+ |
| 2 | Pilot invoices sent through billing flow | Pre-launch: 0% | `invoices` table (`sent_at` populated) | Daily (automated) | `sent_invoices / total_invoices × 100` | 60%+ |
| 3 | Invoice volume paid via integrated payments | Pre-launch: 0% | Stripe webhook data + `invoices.paid_at` | Daily (automated) | `online_paid_invoices / total_sent_invoices × 100` | 40%+ |
| 4 | Reduction in manual admin time | Pre-launch baseline from 2-week time-study | Workflow timing logs + weekly self-report survey | Weekly (survey) + daily (logs) | `(baseline_avg_daily_min - post_launch_avg_daily_min) / baseline_avg_daily_min × 100` | 25% reduction |

### Technical Quality Metrics

| Metric | Baseline | Data Source | SLA/Target |
|---|---|---|---|
| System uptime/availability | N/A (new features) | Uptime monitoring (e.g., BetterUptime) | 99.5%+ |
| Payment transaction success rate | N/A | Stripe dashboard + webhook logs | 95%+ on first attempt |
| API error rate (5xx) | Current baseline from existing endpoints | Application logs / error tracking | < 1% |
| Page load performance (P95) | Current baseline from existing pages | Real User Monitoring (RUM) or Lighthouse | < 3 seconds |
| 95%+ checklist completion compliance | N/A (post-Phase 3 launch) | Workflow telemetry (`checklists` table) | Monitored post-launch; target within 30 days of Phase 3 rollout |

### Longer-Term Metric (Post-90-Day)
5. **Win-rate improvement in head-to-head trials** where Skimmer is current incumbent.
   > [!NOTE]
   > This metric requires a longer sales cycle to validate (typically 2-6 months of competitive trials). It is tracked as a **post-90-day milestone** rather than a 90-day success gate. Initial signal expected by Day 120-150.
