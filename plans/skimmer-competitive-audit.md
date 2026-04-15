# ChemCheck vs Skimmer Competitive Audit (Public Intel)

**Date finalized:** February 13, 2026  
**ICP:** Solo operator + 1 technician  
**Strategy lens:** Must-have parity first  
**Build capacity assumption:** 1-2 engineers

## 1) Objective
Deliver an evidence-backed competitive audit of Skimmer versus ChemCheck and convert findings into a decision-ready gap matrix and a 90-day roadmap.

## 2) Method and Constraints
- **ChemCheck baseline source of truth:**
  - `convex/schema.ts`
  - `src/pages/ProtectedAppRoutes.jsx`
  - `src/pages/RouteOptimizer.jsx`
  - `src/pages/Settings.jsx`
  - `src/components/service-reports/SendReportDialog.tsx`
  - `src/lib/stripe.ts`
  - Supporting evidence for sync/team behavior from `src/lib/sync/SyncService.ts`, `src/lib/serviceWorker.ts`, and `convex/businesses.ts`.
- **Skimmer evidence mode:** Public intel only (official website, help center, App Store listing, Capterra).
- **Freshness rule:** Core sources re-validated on **February 13, 2026**.
- **Note on app listing:** The provided App Store URL with ID `1695503441` returns 404; current active Skimmer iOS listing is ID `1249069756`.

## 3) ChemCheck Baseline (Repo-grounded)
- Strong in core data entities: customers, service logs, chemical usage, notes, photos, team members, service reports, subscriptions (`convex/schema.ts:5-243`).
- Route planning exists but is heuristic (ZIP/street proximity + fixed speed), not map/traffic optimized (`src/pages/RouteOptimizer.jsx:31-43`, `src/pages/RouteOptimizer.jsx:126-133`).
- Report delivery currently defaults to email; SMS is disabled in the dialog (`src/components/service-reports/SendReportDialog.tsx:134-137`, `src/components/service-reports/SendReportDialog.tsx:315-352`).
- Team model exists with role validation and invite flows (`convex/businesses.ts:5-11`, `convex/businesses.ts:232-279`).
- Offline/sync foundation is real (online/offline listeners and deferred sync behavior) (`src/lib/sync/SyncService.ts:43-49`, `src/lib/sync/SyncService.ts:98-117`, `src/lib/sync/SyncService.ts:170-196`).
- Billing implementation is SaaS subscription billing for ChemCheck itself, not pool-customer A/R (`src/lib/stripe.ts:20-75`, `src/lib/stripe.ts:111-124`).

## 4) Skimmer Capability Snapshot (Public Evidence)
- Pricing is positioned around serviced locations with broad feature bundling (work orders, invoicing/payments, reminders) and minimum monthly spend ([Skimmer Pricing](https://www.getskimmer.com/pricing)).
- Field technician workflow messaging includes chemistry/dosing help, route optimization, checklists/tasks, and notes/media ([Technicians](https://www.getskimmer.com/product/technicians)).
- Back-office messaging covers scheduling, billing, customer lifecycle operations, and financing/payment ecosystem depth ([Back Office](https://www.getskimmer.com/product/back-office)).
- Client-facing ops include customer portal, communications, and engagement controls ([Clients](https://www.getskimmer.com/product/clients)).
- Help-center releases show feature velocity in work orders, customer portal, service texts, broadcast emails, advanced roles/API updates:
  - [Introducing Work Orders](https://help.getskimmer.com/en/articles/10054757-introducing-work-orders)
  - [Introducing Customer Portal](https://help.getskimmer.com/en/articles/10054816-introducing-customer-portal)
  - [Introducing Service Texts](https://help.getskimmer.com/en/articles/10477314-introducing-service-texts)
  - [Introducing Broadcast Emails](https://help.getskimmer.com/en/articles/10477325-introducing-broadcast-emails)
  - [Release Notes Collection](https://help.getskimmer.com/en/collections/3300687-release-notes)
- Billing help docs include operational invoicing flows and accounting integration references ([Billing FAQ](https://help.getskimmer.com/en/articles/6981574-billing-faq)).
- App Store confirms active mobile app distribution and recent release cadence ([Skimmer App Store](https://apps.apple.com/us/app/skimmer-pool-service-app/id1249069756)).
- Third-party sentiment signal is currently strong on Capterra ([Capterra Skimmer](https://www.capterra.com/p/183596/Skimmer/)).

## 5) Domain Scorecard (ChemCheck Relative to Skimmer)
Scales: 0-5 (higher is better for first two metrics; higher switching friction means bigger competitive risk).

| Domain | Capability Completeness | Solo-Operator Usefulness | Switching Friction Impact | Confidence |
|---|---:|---:|---:|---|
| Customer CRM and account lifecycle | 3.5 | 4.0 | 3.5 | High |
| Scheduling and dispatch | 2.5 | 4.5 | 4.5 | Medium |
| Route optimization depth | 2.5 | 4.0 | 4.0 | High |
| Service execution workflow | 3.5 | 4.5 | 3.5 | High |
| Work orders and recurrence | 1.0 | 4.5 | 5.0 | High |
| Invoicing and payment collection | 1.0 | 5.0 | 5.0 | High |
| Customer communication/report delivery | 2.5 | 4.5 | 4.5 | High |
| Chemistry and water intelligence | 1.5 | 3.5 | 3.5 | High |
| Team management and permissions | 2.5 | 2.5 | 2.5 | Medium |
| Offline/mobile reliability | 3.0 | 4.0 | 3.0 | Medium |
| Integrations and ecosystem | 1.5 | 3.0 | 4.0 | Medium |
| Pricing/packaging strategy | 2.5 | 4.0 | 3.5 | High |

## 6) Gap Prioritization Model
**Priority Score** = `(ICP Impact x 0.5) + (Revenue Impact x 0.3) + (Competitive Risk x 0.2) - (Effort Penalty)`

Effort penalty map:
- `S = 0.2`
- `M = 0.5`
- `L = 1.0`

## 7) Top 15 Gap Candidates (Scored)

| Rank | Gap | ICP | Revenue | Comp Risk | Effort | Priority Score |
|---|---|---:|---:|---:|---|---:|
| 1 | Work orders (one-off + recurring) | 5 | 5 | 5 | M | **4.5** |
| 2 | Customer invoicing + payment collection | 5 | 5 | 5 | L | **4.0** |
| 3 | Dispatch board + assignment workflow | 5 | 4 | 4 | M | **4.0** |
| 4 | Customer portal (billing + service visibility) | 4 | 5 | 4 | M | **3.8** |
| 5 | Service texts | 4 | 4 | 4 | S | **3.8** |
| 6 | Bulk invoicing + reminders | 4 | 5 | 4 | M | **3.8** |
| 7 | Quote/deposit workflow for repair work | 4 | 4 | 4 | M | **3.5** |
| 8 | Map/traffic route optimization | 4 | 3 | 4 | M | **3.2** |
| 9 | Checklist engine per service type | 4 | 3 | 4 | M | **3.2** |
| 10 | QuickBooks sync | 3 | 4 | 4 | M | **3.0** |
| 11 | LSI/dosing workflow in service execution | 3 | 3 | 4 | M | **2.7** |
| 12 | Advanced roles/permissions matrix | 2 | 2 | 3 | S | **2.0** |
| 13 | Broadcast customer emails | 2 | 2 | 2 | S | **1.8** |
| 14 | LaMotte hardware integration | 2 | 3 | 3 | L | **1.5** |
| 15 | Public API for third-party automations | 1 | 2 | 2 | L | **0.5** |

## 8) Recommended Focus for 90 Days (Parity-first, 1-2 Engineers)
Prioritize the top **9** items that materially change purchase outcomes for solo operators:
1. Work orders (one-off + recurring)
2. Customer invoicing + payment collection
3. Dispatch board + assignment workflow
4. Service texts
5. Customer portal lite
6. Bulk invoicing + reminders
7. Quote/deposit workflow
8. Map/traffic route optimization
9. Checklist engine by service type

These are expanded as implementation milestones in `/plans/skimmer-roadmap-90d.md`.

## 9) Parity vs Differentiation Recommendation
- **Pursue parity now:** work orders, invoicing/payments, dispatch, service texts, customer portal, route depth.
- **Differentiate after parity floor:** chemistry intelligence (LSI/dosing workflows, proactive recommendations), offline resilience quality, and small-team UX speed.
- **Defer for current ICP/capacity:** full public API platform and deep hardware integrations until parity fundamentals drive conversion and retention.

## 10) Validation Against Acceptance Criteria
- 30+ compared capabilities: **Met** (`/plans/skimmer-gap-matrix.csv` contains 36 rows).
- 10+ high-confidence Skimmer citations: **Met** (see citation index below).
- 8-10 prioritized gaps with rationale/effort: **Met** (top 9 and full top 15 scored).
- 90-day phased roadmap with dependencies: **Met** (see `/plans/skimmer-roadmap-90d.md`).
- Clear parity vs intentional differentiation: **Met**.

## 11) Citation Index (High Confidence Sources)
1. [Skimmer Pricing](https://www.getskimmer.com/pricing)
2. [Skimmer Technicians Product](https://www.getskimmer.com/product/technicians)
3. [Skimmer Back Office Product](https://www.getskimmer.com/product/back-office)
4. [Skimmer Clients Product](https://www.getskimmer.com/product/clients)
5. [Skimmer Mobile App Product](https://www.getskimmer.com/product/mobile-app)
6. [Billing FAQ](https://help.getskimmer.com/en/articles/6981574-billing-faq)
7. [Introducing Work Orders](https://help.getskimmer.com/en/articles/10054757-introducing-work-orders)
8. [Introducing Customer Portal](https://help.getskimmer.com/en/articles/10054816-introducing-customer-portal)
9. [Introducing Service Texts](https://help.getskimmer.com/en/articles/10477314-introducing-service-texts)
10. [Introducing Broadcast Emails](https://help.getskimmer.com/en/articles/10477325-introducing-broadcast-emails)
11. [Release Notes Collection](https://help.getskimmer.com/en/collections/3300687-release-notes)
12. [Skimmer App Store Listing](https://apps.apple.com/us/app/skimmer-pool-service-app/id1249069756)
13. [Capterra Listing](https://www.capterra.com/p/183596/Skimmer/)
